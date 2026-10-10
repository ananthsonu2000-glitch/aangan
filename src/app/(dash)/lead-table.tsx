import Link from "next/link";
import type { Lead } from "@/db";

export type LeadRow = Lead & { assigneeName: string | null };

export function StatusBadge({ status }: { status: string }) {
  const c = status === "qualified" ? "bg-emerald-100 text-emerald-800" : status === "needs_recheck" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{status.replace("_", " ")}</span>;
}

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export function LeadTable({ rows, empty = "No leads yet." }: { rows: LeadRow[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase text-stone-500">
          <tr>{["Lead", "Project", "Location", "Score", "Status", "Assigned", "Meeting", "Received"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((l) => (
            <tr key={l.id} className="hover:bg-stone-50">
              <td className="px-3 py-2"><Link className="font-medium text-stone-900 underline-offset-2 hover:underline" href={`/leads/${l.id}`}>{l.name ?? l.phone ?? "Unknown"}</Link><div className="text-xs text-stone-500">{l.phone}</div></td>
              <td className="px-3 py-2">{l.projectType ?? "—"}</td>
              <td className="px-3 py-2">{l.location ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">{l.score ?? "—"}</td>
              <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
              <td className="px-3 py-2">{l.assigneeName ?? "—"}</td>
              <td className="px-3 py-2">{fmt(l.meetingTime)}{l.meetingTime && l.calendarStatus === "voice_agent" && <div className="text-xs text-stone-500">booked live by voice agent</div>}{l.meetingTime && l.calendarStatus !== "created" && l.calendarStatus !== "voice_agent" && <div className="text-xs text-amber-700">invite: {l.calendarStatus.replace("_", " ")}</div>}</td>
              <td className="px-3 py-2 text-stone-500">{fmt(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
