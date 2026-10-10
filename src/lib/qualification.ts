import { z } from "zod";

const criterion = z.object({
  result: z.enum(["pass", "fail", "unclear"]),
  note: z.string().default(""),
});

const nullableStr = z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null));

export const evaluationSchema = z.object({
  status: z.enum(["qualified", "needs_recheck"]),
  score: z.number().min(0).max(100).transform((n) => Math.round(n)),
  reason: z.string().min(1),
  employeeSummary: z.string().min(1),
  founderSummary: z.string().min(1),
  leadType: z.enum(["new_enquiry", "existing_client_issue", "no_conversation"]).default("new_enquiry"),
  criteria: z.object({
    realProject: criterion,
    serviceArea: criterion,
    timeline: criterion,
    budget: criterion,
    decisionMaker: criterion,
  }),
  extracted: z.object({
    name: nullableStr,
    phone: nullableStr,
    email: nullableStr,
    location: nullableStr,
    projectType: nullableStr,
    budget: nullableStr,
    timeline: nullableStr,
    designRequirement: nullableStr,
    agreedMeetingTime: nullableStr, // ISO-8601 with offset, or null
  }),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Criteria = Evaluation["criteria"];

/** Extract and validate JSON from a model response (tolerates code fences / surrounding prose). */
export function parseEvaluation(text: string): Evaluation {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith("{")) {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
  }
  return evaluationSchema.parse(JSON.parse(s));
}

/**
 * Deterministic enforcement of Nikhil's rubric on top of the model's per-criterion verdicts:
 *  - unclear on budget / decision-maker => still qualified (note in handoff)
 *  - any fail or unclear on real project / service area / timeline => needs_recheck
 *  - two or more fails => needs_recheck (likely decline)
 *  - a budget fail on its own => needs_recheck (obvious misalignment, do not forward to a designer)
 *  - existing-client issues and calls with no conversation never go to a designer
 */
export function decideStatus(e: Pick<Evaluation, "criteria" | "leadType">): { status: "qualified" | "needs_recheck"; why: string } {
  if (e.leadType !== "new_enquiry") return { status: "needs_recheck", why: `lead type: ${e.leadType}` };
  const c = e.criteria;
  const all = Object.entries(c);
  const fails = all.filter(([, v]) => v.result === "fail").map(([k]) => k);
  if (fails.length >= 2) return { status: "needs_recheck", why: `multiple criteria failed: ${fails.join(", ")}` };
  if (fails.length === 1) return { status: "needs_recheck", why: `criterion failed: ${fails[0]}` };
  const core = (["realProject", "serviceArea", "timeline"] as const).filter((k) => c[k].result === "unclear");
  if (core.length) return { status: "needs_recheck", why: `unclear: ${core.join(", ")}` };
  return { status: "qualified", why: "all criteria pass or are non-blocking unclear (budget / decision-maker)" };
}
