import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, leads, calls, employees, aiEvaluations, notifications, hubspotSyncLogs, assignments } from "@/db";
import { assignLead, resyncLead } from "@/lib/pipeline";
import { retryFailedNotifications } from "@/lib/integrations";
import { StatusBadge } from "../../lead-table";

export const dynamic = "force-dynamic";

async function retry(id: string) {
  "use server";
  await resyncLead(id);
  await retryFailedNotifications(id);
  revalidatePath(`/leads/${id}`);
}
async function reassign(id: string, status: "qualified" | "needs_recheck") {
  "use server";
  await assignLead(id, status, "manual reassign");
  revalidatePath(`/leads/${id}`);
}
async function markDone(id: string) {
  "use server";
  await db().update(leads).set({ assignmentState: "done", updatedAt: new Date() }).where(eq(leads.id, id));
  revalidatePath(`/leads/${id}`);
}

// Prefer our authenticated proxy to Vaani's API (needs VAANI_API_KEY); fall back to a URL delivered by webhook. Simulated calls have no audio.
const recSrc = (c: { id: string; externalCallId: string; recordingUrl: string | null }) =>
  c.externalCallId.startsWith("sim-") ? null : process.env.VAANI_API_KEY ? `/api/calls/${c.id}/recording` : c.recordingUrl;

const Field = ({ k, v }: { k: string; v: string | number | null | undefined }) => (
  <div><dt className="text-xs text-stone-500">{k}</dt><dd className="text-sm">{v ?? "—"}</dd></div>
);

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = db();
  const [lead] = await d.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();
  const [assignee] = lead.assignedToId ? await d.select().from(employees).where(eq(employees.id, lead.assignedToId)) : [];
  const callRows = await d.select().from(calls).where(eq(calls.leadId, id)).orderBy(desc(calls.receivedAt));
  const [ev] = await d.select().from(aiEvaluations).where(eq(aiEvaluations.leadId, id)).orderBy(desc(aiEvaluations.createdAt)).limit(1);
  const notifs = await d.select().from(notifications).where(eq(notifications.leadId, id)).orderBy(desc(notifications.createdAt));
  const hs = await d.select().from(hubspotSyncLogs).where(eq(hubspotSyncLogs.leadId, id)).orderBy(desc(hubspotSyncLogs.createdAt)).limit(10);
  const history = await d.select().from(assignments).where(eq(assignments.leadId, id)).orderBy(desc(assignments.createdAt));
  const criteria = (ev?.criteria ?? {}) as Record<string, { result: string; note: string }>;
  const meeting = lead.meetingTime?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });
  const portal = process.env.HUBSPOT_PORTAL_ID;
  const card = "rounded-lg border border-stone-200 bg-white p-4";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{lead.name ?? lead.phone ?? "Unknown lead"}</h1>
        <StatusBadge status={lead.status} />
        <span className="text-sm text-stone-500">score {lead.score ?? "—"}/100</span>
        <div className="ml-auto flex gap-2">
          <form action={retry.bind(null, id)}><button className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm">Retry sync &amp; notifications</button></form>
          {lead.status !== "failed" && lead.status !== "new" && <form action={reassign.bind(null, id, lead.status as "qualified" | "needs_recheck")}><button className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm">Reassign</button></form>}
          <form action={markDone.bind(null, id)}><button className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Mark done</button></form>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <dl className={`${card} grid grid-cols-2 gap-3 md:col-span-2`}>
          <Field k="Phone" v={lead.phone} /><Field k="Email" v={lead.email} />
          <Field k="Location" v={lead.location} /><Field k="Project type" v={lead.projectType} />
          <Field k="Budget" v={lead.budget} /><Field k="Timeline" v={lead.timeline} />
          <div className="col-span-2"><Field k="Design requirement" v={lead.designRequirement} /></div>
          <div className="col-span-2"><Field k="Agreed meeting" v={meeting ? `${meeting} · invite: ${lead.calendarStatus.replace("_", " ")}` : "none agreed"} />{lead.calendarLink && <a className="text-xs underline" href={lead.calendarLink}>Open calendar event</a>}</div>
        </dl>
        <div className={`${card} space-y-2`}>
          <Field k="Assigned to" v={assignee ? `${assignee.name} (${assignee.role.replace("_", " ")})` : "unassigned"} />
          <Field k="State" v={lead.assignmentState} />
          <Field k="HubSpot deal" v={lead.hubspotDealId ?? "not synced"} />
          {portal && lead.hubspotDealId && <a className="text-xs underline" target="_blank" href={`https://app.hubspot.com/contacts/${portal}/record/0-3/${lead.hubspotDealId}`}>Open in HubSpot</a>}
        </div>
      </div>

      {ev && (
        <div className={`${card} space-y-3`}>
          <h2 className="font-medium">AI evaluation <span className="text-xs font-normal text-stone-500">({ev.model})</span></h2>
          <p className="text-sm">{ev.reason}</p>
          <div className="grid gap-2 md:grid-cols-5">
            {Object.entries(criteria).map(([k, v]) => (
              <div key={k} className="rounded-md bg-stone-50 p-2 text-xs"><div className="font-medium">{k} · <span className={v.result === "pass" ? "text-emerald-700" : v.result === "fail" ? "text-red-700" : "text-amber-700"}>{v.result}</span></div><div className="text-stone-500">{v.note}</div></div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><div className="text-xs text-stone-500">Employee summary</div><p className="whitespace-pre-wrap text-sm">{ev.employeeSummary}</p></div>
            <div><div className="text-xs text-stone-500">Founder summary</div><p className="whitespace-pre-wrap text-sm">{ev.founderSummary}</p></div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h2 className="mb-2 font-medium">Notifications</h2>
          {notifs.length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : notifs.map((n) => (
            <div key={n.id} className="flex justify-between border-b border-stone-100 py-1 text-sm last:border-0"><span>{n.channel} → {n.recipient}</span><span className={n.status === "failed" ? "text-red-700" : n.status === "sent" ? "text-emerald-700" : "text-stone-500"} title={n.lastError ?? ""}>{n.status}{n.attempts > 1 ? ` (${n.attempts})` : ""}</span></div>
          ))}
        </div>
        <div className={card}>
          <h2 className="mb-2 font-medium">HubSpot sync log</h2>
          {hs.length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : hs.map((h) => (
            <div key={h.id} className="border-b border-stone-100 py-1 text-sm last:border-0"><div className="flex justify-between"><span>{h.operation}</span><span className={h.status === "failed" ? "text-red-700" : "text-emerald-700"}>{h.status}</span></div>{h.error && <div className="text-xs text-red-700">{h.error}</div>}</div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-2 font-medium">Assignment history</h2>
        {history.map((h) => <div key={h.id} className="text-sm text-stone-600">{h.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {h.role} · {h.strategy}{h.reason ? ` · ${h.reason.slice(0, 80)}` : ""}</div>)}
      </div>

      <div className={card}>
        <h2 className="mb-2 font-medium">Call transcript{callRows.length > 1 ? "s" : ""}</h2>
        {callRows.map((c) => (
          <div key={c.id} className="mb-4">
            <div className="mb-1 flex items-center gap-3 text-xs text-stone-500">
              <span>{c.startedAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) ?? ""}{c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : ""}</span>
              {recSrc(c) ? <a className="underline" href={recSrc(c)!} target="_blank" rel="noreferrer">Open / download recording</a> : <span>No recording available</span>}
            </div>
            {recSrc(c) && <audio controls preload="none" src={recSrc(c)!} className="mb-2 w-full" />}
            <pre className="whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-xs leading-relaxed">{c.transcript ?? "(no transcript)"}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
