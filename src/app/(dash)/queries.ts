import { desc, eq, and, type SQL } from "drizzle-orm";
import { db, leads, employees } from "@/db";
import type { LeadRow } from "./lead-table";

export async function listLeads(where?: SQL, limit = 200): Promise<LeadRow[]> {
  const rows = await db()
    .select({ lead: leads, assigneeName: employees.name })
    .from(leads)
    .leftJoin(employees, eq(leads.assignedToId, employees.id))
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.lead, assigneeName: r.assigneeName }));
}

export const openQueue = (status: "qualified" | "needs_recheck") => listLeads(and(eq(leads.status, status), eq(leads.assignmentState, "open")));
