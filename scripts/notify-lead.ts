// Send (or retry) the assignment notification for one lead: `npm run notify -- <lead-id>`
import { eq } from "drizzle-orm";
import { db, leads, employees } from "../src/db";
import { notifyAssignee } from "../src/lib/integrations";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: npm run notify -- <lead-id>");
  const [lead] = await db().select().from(leads).where(eq(leads.id, id));
  if (!lead?.assignedToId) throw new Error("lead not found or unassigned");
  const [a] = await db().select().from(employees).where(eq(employees.id, lead.assignedToId));
  await notifyAssignee(lead, a, a.role === "designer" ? "designer" : "front_desk");
  console.log("notified", a.name);
}
main().catch((e) => { console.error(e); process.exit(1); });
