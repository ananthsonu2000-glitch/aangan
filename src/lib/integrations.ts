/** External services: Resend, Telegram, HubSpot, Google Calendar. Each is retry-safe and logs failures to the DB. */
import { and, eq } from "drizzle-orm";
import { db, notifications, hubspotSyncLogs, leads, type Lead } from "@/db";
import { buildEmail, buildTelegram, buildHubspotContact, buildHubspotDeal, type LeadView } from "./payloads";

const appUrl = () => process.env.APP_URL || "http://localhost:3000";

// ---------- Notifications ----------
/** Provider: EMAIL_PROVIDER=gmail|resend. Default: Resend if RESEND_API_KEY is set, otherwise Gmail SMTP if GMAIL_USER is set. */
export function emailProvider(): "resend" | "gmail" | null {
  const forced = process.env.EMAIL_PROVIDER;
  if (forced === "gmail" || forced === "resend") return forced;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return "gmail";
  return null;
}

async function sendEmailRaw(to: string, p: { subject: string; html: string; text: string }) {
  const provider = emailProvider();
  if (provider === "gmail") {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not configured");
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: pass.replace(/\s+/g, "") } });
    await transport.sendMail({ from: process.env.EMAIL_FROM || `Aangan Studio <${user}>`, to, subject: p.subject, html: p.html, text: p.text });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (provider !== "resend" || !key || !from) throw new Error("Email not configured: set RESEND_API_KEY + EMAIL_FROM, or GMAIL_USER + GMAIL_APP_PASSWORD");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: p.subject, html: p.html, text: p.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendTelegramRaw(chatId: string, p: { text: string; parse_mode: string; disable_web_page_preview: boolean }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, ...p }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Insert-or-reuse by dedupeKey, skip if already sent, otherwise attempt send and record the outcome. */
async function deliver(leadId: string, channel: "email" | "telegram", recipient: string, payload: object, dedupeKey: string, send: () => Promise<void>) {
  const d = db();
  await d.insert(notifications).values({ leadId, channel, recipient, payload, dedupeKey }).onConflictDoNothing();
  const [row] = await d.select().from(notifications).where(eq(notifications.dedupeKey, dedupeKey));
  if (!row || row.status === "sent") return;
  try {
    await send();
    await d.update(notifications).set({ status: "sent", attempts: row.attempts + 1, sentAt: new Date(), lastError: null }).where(eq(notifications.id, row.id));
  } catch (err) {
    await d.update(notifications).set({ status: "failed", attempts: row.attempts + 1, lastError: String(err).slice(0, 1000) }).where(eq(notifications.id, row.id));
  }
}

export async function notifyAssignee(lead: LeadView, assignee: { id: string; name: string; email: string; telegramChatId: string | null }, role: "designer" | "front_desk", extraEmails: string[] = []) {
  const email = buildEmail(lead, assignee.name, role, appUrl());
  const tg = buildTelegram(lead, assignee.name, role, appUrl());
  const groupChat = role === "designer" ? process.env.TELEGRAM_DESIGNER_CHAT_ID : process.env.TELEGRAM_FRONTDESK_CHAT_ID;
  const chat = assignee.telegramChatId || groupChat;
  const key = (c: string, r: string) => `${lead.id}:${c}:${r}:assigned:${lead.status}`;
  const jobs: Promise<void>[] = [];
  for (const to of [assignee.email, ...extraEmails]) {
    jobs.push(deliver(lead.id, "email", to, email, key("email", to), () => sendEmailRaw(to, email)));
  }
  if (chat) jobs.push(deliver(lead.id, "telegram", chat, tg, key("telegram", chat), () => sendTelegramRaw(chat, tg)));
  await Promise.all(jobs);
}

/** Re-attempt every failed notification (cron / manual retry). */
export async function retryFailedNotifications(leadId?: string) {
  const d = db();
  const rows = await d.select().from(notifications).where(leadId ? and(eq(notifications.status, "failed"), eq(notifications.leadId, leadId)) : eq(notifications.status, "failed"));
  for (const r of rows) {
    if (r.attempts >= 8) continue;
    const send = r.channel === "email" ? () => sendEmailRaw(r.recipient, r.payload as any) : () => sendTelegramRaw(r.recipient, r.payload as any);
    await deliver(r.leadId, r.channel, r.recipient, r.payload as object, r.dedupeKey, send);
  }
  return rows.length;
}

// ---------- HubSpot ----------
async function hs(method: string, path: string, body?: unknown) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

async function logHs(leadId: string, operation: string, status: "success" | "failed", request: unknown, response: unknown, error?: string) {
  await db().insert(hubspotSyncLogs).values({ leadId, operation, status, request: request as any, response: response as any, error });
}

/** Idempotent: contact is looked up by email/phone then created or updated; deal id is stored on the lead, so reruns update instead of duplicating. */
export async function syncToHubspot(lead: Lead, assigneeName: string | null) {
  const cfg = {
    pipelineId: process.env.HUBSPOT_PIPELINE_ID || "default",
    stageQualified: process.env.HUBSPOT_STAGE_QUALIFIED || "qualifiedtobuy",
    stageRecheck: process.env.HUBSPOT_STAGE_RECHECK || "appointmentscheduled",
  };
  const d = db();
  let step = "contact_upsert";
  try {
    const contact = buildHubspotContact(lead);
    let contactId = lead.hubspotContactId;
    if (!contactId && (lead.email || lead.phone)) {
      const filterGroups = [lead.email && { filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }, lead.phone && { filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] }].filter(Boolean);
      const found = await hs("POST", "/crm/v3/objects/contacts/search", { filterGroups, limit: 1 });
      contactId = found.results?.[0]?.id ?? null;
    }
    const res = contactId ? await hs("PATCH", `/crm/v3/objects/contacts/${contactId}`, contact) : await hs("POST", "/crm/v3/objects/contacts", contact);
    contactId = res.id;
    await logHs(lead.id, "contact_upsert", "success", contact, { id: contactId });

    step = "deal_upsert";
    const deal = buildHubspotDeal(lead, assigneeName, cfg, appUrl());
    let dealId = lead.hubspotDealId;
    const dres = dealId ? await hs("PATCH", `/crm/v3/objects/deals/${dealId}`, deal) : await hs("POST", "/crm/v3/objects/deals", deal);
    dealId = dres.id;
    await logHs(lead.id, "deal_upsert", "success", deal, { id: dealId });

    step = "associate";
    await hs("PUT", `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`);
    await logHs(lead.id, "associate", "success", { dealId, contactId }, null);

    await d.update(leads).set({ hubspotContactId: contactId, hubspotDealId: dealId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    return true;
  } catch (err) {
    await logHs(lead.id, step, "failed", null, null, String(err).slice(0, 1000));
    return false;
  }
}

// ---------- Google Calendar (separate module; stores intent if not configured) ----------
export const calendarConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

export function buildCalendarEvent(lead: Lead, designerEmail: string | null, durationMin = 60) {
  const start = lead.meetingTime!;
  const attendees = [designerEmail, lead.email].filter((e): e is string => !!e).map((email) => ({ email }));
  return {
    // deterministic id => creating twice cannot duplicate (Google returns 409). base32hex-safe.
    id: `aan${lead.id.replace(/-/g, "")}`,
    summary: `Aangan Studio consultation — ${lead.name ?? "Customer"}`,
    description: `${lead.projectType ?? ""}\n${lead.location ?? ""}\nPhone: ${lead.phone ?? "—"}\n${lead.employeeSummary ?? ""}\n${appUrl()}/leads/${lead.id}`,
    location: lead.location ?? undefined,
    start: { dateTime: start.toISOString(), timeZone: "Asia/Kolkata" },
    end: { dateTime: new Date(start.getTime() + durationMin * 60000).toISOString(), timeZone: "Asia/Kolkata" },
    attendees,
  };
}

export async function createCalendarInvite(lead: Lead, designerEmail: string | null) {
  const d = db();
  if (!lead.meetingTime) return;
  if (lead.calendarStatus === "created") return;
  if (!calendarConfigured()) {
    await d.update(leads).set({ calendarStatus: "pending_config" }).where(eq(leads.id, lead.id));
    return;
  }
  try {
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token" }),
    });
    if (!tok.ok) throw new Error(`Google token ${tok.status}: ${(await tok.text()).slice(0, 200)}`);
    const { access_token } = (await tok.json()) as { access_token: string };
    const event = buildCalendarEvent(lead, designerEmail);
    const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?sendUpdates=all`, {
      method: "POST",
      headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (res.status === 409) {
      await d.update(leads).set({ calendarStatus: "created", calendarEventId: event.id }).where(eq(leads.id, lead.id));
      return;
    }
    if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const created: any = await res.json();
    await d.update(leads).set({ calendarStatus: "created", calendarEventId: created.id, calendarLink: created.htmlLink ?? null }).where(eq(leads.id, lead.id));
  } catch (err) {
    console.error("calendar failed", err);
    await d.update(leads).set({ calendarStatus: "failed" }).where(eq(leads.id, lead.id));
  }
}
