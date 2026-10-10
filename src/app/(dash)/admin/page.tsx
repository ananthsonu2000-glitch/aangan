import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, employees, appConfig } from "@/db";
import { DEFAULT_RUBRIC } from "@/config/defaults";

export const dynamic = "force-dynamic";

const setConfig = (key: string, value: unknown) =>
  db().insert(appConfig).values({ key, value: value as any }).onConflictDoUpdate({ target: appConfig.key, set: { value: value as any, updatedAt: new Date() } });

async function saveRubric(fd: FormData) {
  "use server";
  await setConfig("rubric", String(fd.get("rubric") ?? ""));
  revalidatePath("/admin");
}
async function saveStrategy(fd: FormData) {
  "use server";
  await setConfig("assignment_strategy", String(fd.get("strategy")));
  revalidatePath("/admin");
}
async function saveRecipients(fd: FormData) {
  "use server";
  const extraEmails = String(fd.get("emails") ?? "").split(/[,\s]+/).filter(Boolean);
  await setConfig("notification_recipients", { extraEmails });
  revalidatePath("/admin");
}
async function updateEmployee(fd: FormData) {
  "use server";
  await db().update(employees).set({ email: String(fd.get("email")), telegramChatId: String(fd.get("telegram") || "") || null, calcomEventTypeId: Number(fd.get("calcom")) || null, active: fd.get("active") === "on" }).where(eq(employees.id, String(fd.get("id"))));
  revalidatePath("/admin");
}

export default async function Admin() {
  const d = db();
  const staff = await d.select().from(employees).orderBy(asc(employees.role), asc(employees.sortOrder));
  const cfg = Object.fromEntries((await d.select().from(appConfig)).map((r) => [r.key, r.value])) as Record<string, any>;
  const card = "rounded-lg border border-stone-200 bg-white p-4 space-y-3";
  const input = "rounded-md border border-stone-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Admin</h1>

      <section className={card}>
        <h2 className="font-medium">Team</h2>
        {staff.map((e) => (
          <form key={e.id} action={updateEmployee} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="id" value={e.id} />
            <span className="w-32 font-medium">{e.name}</span><span className="w-20 text-stone-500">{e.role.replace("_", " ")}</span>
            <input name="email" defaultValue={e.email} className={`${input} w-56`} />
            <input name="telegram" defaultValue={e.telegramChatId ?? ""} placeholder="Telegram chat id" className={`${input} w-40`} />
            {e.role === "designer" && <input name="calcom" defaultValue={e.calcomEventTypeId ?? ""} placeholder="Cal.com event type id" className={`${input} w-44`} />}
            <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={e.active} /> active</label>
            <button className="rounded-md border border-stone-300 px-2 py-1">Save</button>
          </form>
        ))}
      </section>

      <section className={card}>
        <h2 className="font-medium">Assignment strategy</h2>
        <form action={saveStrategy} className="flex gap-2">
          <select name="strategy" defaultValue={cfg.assignment_strategy ?? process.env.ASSIGNMENT_STRATEGY ?? "round_robin"} className={input}>
            <option value="round_robin">Round-robin</option><option value="least_loaded">Least loaded (fewest open leads)</option>
          </select>
          <button className="rounded-md border border-stone-300 px-2 py-1 text-sm">Save</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-medium">Extra email recipients (CC on every assignment, e.g. founder)</h2>
        <form action={saveRecipients} className="flex gap-2">
          <input name="emails" defaultValue={(cfg.notification_recipients?.extraEmails ?? []).join(", ")} className={`${input} flex-1`} placeholder="founder@example.com, ops@example.com" />
          <button className="rounded-md border border-stone-300 px-2 py-1 text-sm">Save</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-medium">Qualification rubric</h2>
        <p className="text-xs text-stone-500">Sent to Gemini with every evaluation. Criteria keys (real project, service area, timeline, budget, decision-maker) are fixed in code.</p>
        <form action={saveRubric} className="space-y-2">
          <textarea name="rubric" rows={18} defaultValue={cfg.rubric ?? DEFAULT_RUBRIC} className={`${input} w-full font-mono text-xs`} />
          <button className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Save rubric</button>
        </form>
      </section>
    </div>
  );
}
