/** Pure payload builders for notifications and HubSpot (unit-tested; no I/O). */

export type LeadView = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  projectType: string | null;
  budget: string | null;
  timeline: string | null;
  designRequirement: string | null;
  meetingTime: Date | null;
  status: string;
  score: number | null;
  employeeSummary: string | null;
  founderSummary: string | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dash = (v: string | null | undefined) => v || "—";
const fmtMeeting = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "not agreed");

export function leadUrl(appUrl: string, id: string) {
  return `${appUrl.replace(/\/$/, "")}/leads/${id}`;
}

function heading(lead: LeadView, assigneeRole: "designer" | "front_desk") {
  return assigneeRole === "designer" ? `New qualified lead — ${dash(lead.name)}` : `Lead needs recheck — ${dash(lead.name)}`;
}

export function buildEmail(lead: LeadView, assigneeName: string, role: "designer" | "front_desk", appUrl: string) {
  const url = leadUrl(appUrl, lead.id);
  const rows: [string, string][] = [
    ["Phone", dash(lead.phone)], ["Email", dash(lead.email)], ["Location", dash(lead.location)],
    ["Project", dash(lead.projectType)], ["Budget", dash(lead.budget)], ["Timeline", dash(lead.timeline)],
    ["Meeting", fmtMeeting(lead.meetingTime)], ["Score", lead.score != null ? `${lead.score}/100` : "—"],
  ];
  const subject = `${role === "designer" ? "[Qualified]" : "[Recheck]"} ${dash(lead.name)} — ${dash(lead.projectType)}, ${dash(lead.location)}`;
  const html = `<div style="font-family:sans-serif;max-width:560px">
<h2 style="margin:0 0 8px">${esc(heading(lead, role))}</h2>
<p>Hi ${esc(assigneeName)}, this lead has been assigned to you.</p>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p style="white-space:pre-wrap">${esc(lead.employeeSummary ?? "")}</p>
<p><a href="${url}">Open lead in dashboard</a></p></div>`;
  const text = `${heading(lead, role)}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${lead.employeeSummary ?? ""}\n\n${url}`;
  return { subject, html, text };
}

export function buildTelegram(lead: LeadView, assigneeName: string, role: "designer" | "front_desk", appUrl: string) {
  const url = leadUrl(appUrl, lead.id);
  const text = [
    `<b>${esc(heading(lead, role))}</b>`,
    `Assigned to: ${esc(assigneeName)}`,
    `📞 ${esc(dash(lead.phone))}  📍 ${esc(dash(lead.location))}`,
    `🏠 ${esc(dash(lead.projectType))} · ⏱ ${esc(dash(lead.timeline))} · 💰 ${esc(dash(lead.budget))}`,
    `📅 ${esc(fmtMeeting(lead.meetingTime))}  ⭐ ${lead.score ?? "—"}/100`,
    "",
    esc(lead.employeeSummary ?? ""),
    "",
    `<a href="${url}">Open lead</a>`,
  ].join("\n");
  return { text, parse_mode: "HTML" as const, disable_web_page_preview: true };
}

export type HubspotConfig = { pipelineId: string; stageQualified: string; stageRecheck: string };

export function buildHubspotContact(lead: LeadView) {
  const [first, ...rest] = (lead.name ?? "").split(/\s+/).filter(Boolean);
  const properties: Record<string, string> = {};
  if (first) properties.firstname = first;
  if (rest.length) properties.lastname = rest.join(" ");
  if (lead.email) properties.email = lead.email;
  if (lead.phone) properties.phone = lead.phone;
  if (lead.location) properties.city = lead.location;
  return { properties };
}

/** Deal properties; the aangan_* custom properties are created by `npm run hubspot:setup`. */
export function buildHubspotDeal(lead: LeadView, assigneeName: string | null, cfg: HubspotConfig, appUrl: string) {
  const qualified = lead.status === "qualified";
  return {
    properties: {
      dealname: `${dash(lead.name)} — ${dash(lead.projectType)} (${dash(lead.location)})`,
      pipeline: cfg.pipelineId,
      dealstage: qualified ? cfg.stageQualified : cfg.stageRecheck,
      aangan_lead_score: String(lead.score ?? ""),
      aangan_qualification_status: lead.status,
      aangan_summary: lead.founderSummary ?? "",
      aangan_assigned_to: assigneeName ?? "",
      aangan_budget: lead.budget ?? "",
      aangan_timeline: lead.timeline ?? "",
      aangan_meeting_time: lead.meetingTime ? lead.meetingTime.toISOString() : "",
      aangan_lead_url: leadUrl(appUrl, lead.id),
    } as Record<string, string>,
  };
}

export const HUBSPOT_CUSTOM_DEAL_PROPERTIES = [
  { name: "aangan_lead_score", label: "Aangan Lead Score", type: "number", fieldType: "number" },
  { name: "aangan_qualification_status", label: "Aangan Qualification Status", type: "string", fieldType: "text" },
  { name: "aangan_summary", label: "Aangan Founder Summary", type: "string", fieldType: "textarea" },
  { name: "aangan_assigned_to", label: "Aangan Assigned To", type: "string", fieldType: "text" },
  { name: "aangan_budget", label: "Aangan Budget", type: "string", fieldType: "text" },
  { name: "aangan_timeline", label: "Aangan Timeline", type: "string", fieldType: "text" },
  { name: "aangan_meeting_time", label: "Aangan Meeting Time", type: "string", fieldType: "text" },
  { name: "aangan_lead_url", label: "Aangan Lead URL", type: "string", fieldType: "text" },
] as const;
