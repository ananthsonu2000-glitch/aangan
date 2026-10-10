// Seeds team + default config. Replace the placeholder emails (Admin page or here) before going live. Safe to re-run.
import { db, employees, appConfig } from "../src/db";
import { DEFAULT_RUBRIC } from "../src/config/defaults";

const team = [
  { name: "Alpha", role: "designer", email: "alpha@example.com", sortOrder: 1 },
  { name: "Beta", role: "designer", email: "beta@example.com", sortOrder: 2 },
  { name: "Charlie", role: "designer", email: "charlie@example.com", sortOrder: 3 },
  { name: "Delta", role: "designer", email: "delta@example.com", sortOrder: 4 },
  { name: "Front Desk 1", role: "front_desk", email: "frontdesk1@example.com", sortOrder: 1 },
  { name: "Front Desk 2", role: "front_desk", email: "frontdesk2@example.com", sortOrder: 2 },
] as const;

async function main() {
  const d = db();
  const existing = await d.select().from(employees);
  for (const t of team) if (!existing.some((e) => e.name === t.name)) await d.insert(employees).values(t);
  await d.insert(appConfig).values({ key: "rubric", value: DEFAULT_RUBRIC as any }).onConflictDoNothing();
  await d.insert(appConfig).values({ key: "assignment_strategy", value: "round_robin" as any }).onConflictDoNothing();
  await d.insert(appConfig).values({ key: "notification_recipients", value: { extraEmails: [] } as any }).onConflictDoNothing();
  console.log("seeded");
}
main().catch((e) => { console.error(e); process.exit(1); });
