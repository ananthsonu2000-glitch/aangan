import { and, eq, count, inArray, or, lt, isNotNull } from "drizzle-orm";
import { db, calls, leads, employees, aiEvaluations, assignments, appConfig } from "@/db";
import { evaluateLead } from "./gemini";
import { decideStatus } from "./qualification";
import { pickAssignee, roleForStatus, type Strategy } from "./assignment";
import { normalizePhone, normalizeVaaniPayload } from "./vaani";
import { createCalendarInvite, notifyAssignee, syncToHubspot } from "./integrations";
import type { LeadView } from "./payloads";

async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db().select().from(appConfig).where(eq(appConfig.key, key));
  return (row?.value as T) ?? fallback;
}

/** Assign (or re-assign) a lead per the configured strategy. */
export async function assignLead(leadId: string, status: "qualified" | "needs_recheck", reason: string) {
  const d = db();
  const role = roleForStatus(status);
  const strategy = (await getConfig<string>("assignment_strategy", process.env.ASSIGNMENT_STRATEGY || "round_robin")) as Strategy;
  const pool = await d.select().from(employees).where(and(eq(employees.role, role), eq(employees.active, true)));
  let openCounts: Record<string, number> = {};
  if (strategy === "least_loaded") {
    const rows = await d.select({ id: leads.assignedToId, n: count() }).from(leads).where(eq(leads.assignmentState, "open")).groupBy(leads.assignedToId);
    openCounts = Object.fromEntries(rows.map((r) => [r.id ?? "", Number(r.n)]));
  }
  const chosen = pickAssignee(pool, strategy, openCounts);
  if (!chosen) throw new Error(`No active ${role} available to assign`);
  const now = new Date();
  await d.update(employees).set({ lastAssignedAt: now }).where(eq(employees.id, chosen.id));
  await d.update(leads).set({ assignedToId: chosen.id, assignmentState: "open", updatedAt: now }).where(eq(leads.id, leadId));
  await d.insert(assignments).values({ leadId, employeeId: chosen.id, role, strategy, reason });
  return chosen;
}

/** Full processing of one stored call. Every step is idempotent so the whole thing can be re-run safely. */
export async function processCall(callId: string) {
  const d = db();
  const [call] = await d.select().from(calls).where(eq(calls.id, callId));
  if (!call) throw new Error("call not found");
  if (!call.transcript || call.transcript.trim().length < 20) throw new Error("No usable transcript on call");
  await d.update(calls).set({ processingStatus: "processing", attempts: call.attempts + 1 }).where(eq(calls.id, callId));
  try {
    const n = normalizeVaaniPayload(call.rawPayload as any);
    const phone = normalizePhone(n.callerNumber);

    // 1. lead (reuse if this call already has one, else the same caller within 30 days)
    let leadId = call.leadId;
    if (!leadId && phone) {
      const since = new Date(Date.now() - 30 * 864e5);
      const [existing] = await d.select().from(leads).where(and(eq(leads.phone, phone))).limit(1);
      if (existing && existing.createdAt > since) leadId = existing.id;
    }
    if (!leadId) {
      const [l] = await d.insert(leads).values({ phone, name: n.callerName, email: n.callerEmail }).returning();
      leadId = l.id;
    }
    await d.update(calls).set({ leadId }).where(eq(calls.id, callId));

    // 2. AI evaluation (skipped if already stored for this call)
    let [ev] = await d.select().from(aiEvaluations).where(eq(aiEvaluations.callId, callId));
    if (!ev) {
      if (!call.transcript || call.transcript.trim().length < 20) {
        throw new Error("No usable transcript on call");
      }
      const rubric = await getConfig<string | undefined>("rubric", undefined);
      const { evaluation, raw, model } = await evaluateLead({ transcript: call.transcript, callerNumber: phone, callStartedAt: call.startedAt, vaaniExtracted: n.vaaniExtracted, meetingHint: n.agreedMeetingTimeHint, rubric });
      const decision = decideStatus(evaluation);
      [ev] = await d
        .insert(aiEvaluations)
        .values({
          leadId, callId, model, status: decision.status, modelStatus: evaluation.status, score: evaluation.score,
          reason: decision.status === evaluation.status ? evaluation.reason : `${evaluation.reason} [Rule override: ${decision.why}]`,
          employeeSummary: evaluation.employeeSummary, founderSummary: evaluation.founderSummary,
          criteria: evaluation.criteria, extracted: { ...evaluation.extracted, leadType: evaluation.leadType }, raw: { text: raw },
        })
        .onConflictDoNothing()
        .returning();
      if (!ev) [ev] = await d.select().from(aiEvaluations).where(eq(aiEvaluations.callId, callId));
    }
    const x = ev.extracted as Record<string, string | null>;
    const meeting = x.agreedMeetingTime && !isNaN(Date.parse(x.agreedMeetingTime)) ? new Date(x.agreedMeetingTime) : null;
    await d
      .update(leads)
      .set({
        status: ev.status, score: ev.score, name: x.name ?? n.callerName, phone: normalizePhone(x.phone) ?? phone, email: x.email ?? n.callerEmail,
        location: x.location, projectType: x.projectType, budget: x.budget, timeline: x.timeline, designRequirement: x.designRequirement,
        meetingTime: meeting, calendarStatus: meeting ? undefined : "none", founderSummary: ev.founderSummary, employeeSummary: ev.employeeSummary, updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    // 3. assignment (once per lead status)
    let [lead] = await d.select().from(leads).where(eq(leads.id, leadId));
    const role = roleForStatus(ev.status);
    let assignee = lead.assignedToId ? (await d.select().from(employees).where(eq(employees.id, lead.assignedToId)))[0] : undefined;
    if (!assignee || assignee.role !== role) assignee = await assignLead(leadId, ev.status, ev.reason);
    [lead] = await d.select().from(leads).where(eq(leads.id, leadId));

    // 4. side effects — independent, each failure is logged and retryable, none blocks the others
    const view: LeadView = lead;
    const extra = await getConfig<{ extraEmails?: string[] }>("notification_recipients", {});
    await Promise.allSettled([
      notifyAssignee(view, assignee, role, extra.extraEmails ?? []),
      syncToHubspot(lead, assignee.name),
      createCalendarInvite(lead, role === "designer" ? assignee.email : null),
    ]);
    await d.update(calls).set({ processingStatus: "done", processingError: null }).where(eq(calls.id, callId));
    return { leadId, status: ev.status };
  } catch (err) {
    await d.update(calls).set({ processingStatus: "failed", processingError: String(err).slice(0, 1000) }).where(eq(calls.id, callId));
    throw err;
  }
}

/** Calls stuck in received/failed (e.g. process died after webhook ack) — used by the cron retry. */
export async function retryStuckCalls(maxAttempts = 5) {
  const d = db();
  const stale = new Date(Date.now() - 5 * 60000);
  const rows = await d
    .select()
    .from(calls)
    .where(and(eq(calls.signatureValid, true), isNotNull(calls.transcript), lt(calls.attempts, maxAttempts), or(eq(calls.processingStatus, "failed"), and(inArray(calls.processingStatus, ["received", "processing"]), lt(calls.receivedAt, stale)))));
  const results = [];
  for (const c of rows) {
    try { results.push(await processCall(c.id)); } catch (e) { results.push({ error: String(e) }); }
  }
  return results;
}

/** Re-run HubSpot + notifications + calendar for a lead (manual "retry" button). */
export async function resyncLead(leadId: string) {
  const d = db();
  const [lead] = await d.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error("lead not found");
  const [assignee] = lead.assignedToId ? await d.select().from(employees).where(eq(employees.id, lead.assignedToId)) : [];
  await syncToHubspot(lead, assignee?.name ?? null);
  if (lead.calendarStatus !== "none") await createCalendarInvite(lead, assignee?.role === "designer" ? assignee.email : null);
}
