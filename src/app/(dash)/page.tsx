import { count, eq, sql } from "drizzle-orm";
import { db, leads, notifications, hubspotSyncLogs } from "@/db";
import { LeadTable } from "./lead-table";
import { listLeads } from "./queries";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const d = db();
  const byStatus = await d.select({ status: leads.status, n: count(), avg: sql<number>`coalesce(avg(${leads.score}),0)` }).from(leads).groupBy(leads.status);
  const get = (s: string) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);
  const [{ failedN }] = await d.select({ failedN: count() }).from(notifications).where(eq(notifications.status, "failed"));
  const [{ hsFail }] = await d.select({ hsFail: count() }).from(hubspotSyncLogs).where(eq(hubspotSyncLogs.status, "failed"));
  const total = byStatus.reduce((a, r) => a + Number(r.n), 0);
  const recent = await listLeads(undefined, 10);
  const portal = process.env.HUBSPOT_PORTAL_ID;
  const tiles = [["Total leads", total], ["Qualified", get("qualified")], ["Needs recheck", get("needs_recheck")], ["Failed notifications", Number(failedN)], ["HubSpot sync failures", Number(hsFail)]];
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-semibold">Founder overview</h1>
        {portal && <a className="text-sm underline" href={`https://app.hubspot.com/contacts/${portal}/deals`} target="_blank">Open pipeline in HubSpot →</a>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-stone-200 bg-white p-4"><div className="text-2xl font-semibold tabular-nums">{v}</div><div className="text-xs text-stone-500">{k}</div></div>
        ))}
      </div>
      <h2 className="font-medium">Latest leads</h2>
      <LeadTable rows={recent} />
    </div>
  );
}
