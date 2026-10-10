import { DEFAULT_RUBRIC, SERVICES_REFERENCE, PRICING_REFERENCE } from "@/config/defaults";
import { parseEvaluation, type Evaluation } from "./qualification";

export type EvalInput = {
  transcript: string;
  callerNumber: string | null;
  callStartedAt: Date | null;
  vaaniExtracted: Record<string, unknown>;
  meetingHint: string | null;
  rubric?: string;
};

export function buildPrompt(i: EvalInput) {
  const system = `You evaluate inbound phone enquiries for Aangan Studio, an interior design studio in Pune. Apply the rubric strictly.
Return ONLY a JSON object, no prose, no code fences.

=== QUALIFICATION RUBRIC ===
${i.rubric ?? DEFAULT_RUBRIC}

=== SERVICES & SERVICE AREA ===
${SERVICES_REFERENCE}

=== INTERNAL PRICING GUIDE (only to sanity-check a budget the caller volunteered; never put prices in summaries as quotes) ===
${PRICING_REFERENCE}

=== OUTPUT JSON SHAPE ===
{
  "status": "qualified" | "needs_recheck",
  "score": 0-100 (fit for a designer's time),
  "reason": "why this decision, citing criteria",
  "employeeSummary": "3-5 lines for the assignee: who, what, where, timeline, concerns, what to do next. Note any uncertainty on budget or decision-maker.",
  "founderSummary": "1-2 line gist for the founder",
  "leadType": "new_enquiry" | "existing_client_issue" | "no_conversation",
  "criteria": { "realProject"|"serviceArea"|"timeline"|"budget"|"decisionMaker": { "result": "pass"|"fail"|"unclear", "note": "..." } },
  "extracted": { "name","phone","email","location","projectType","budget","timeline","designRequirement","agreedMeetingTime": string|null }
}
Rules:
- budget: "pass" if not mentioned (note that); "fail" only if a volunteered number is clearly below what the scope costs; "unclear" if ambiguous.
- leadType "existing_client_issue" = an existing customer complaining or chasing their project; "no_conversation" = missed/dropped call or no usable content.
- agreedMeetingTime: only if a specific date AND time was agreed for the consultation; ISO-8601 with +05:30 offset, resolved relative to the call date. Otherwise null.
- Use null for any field not stated. Do not invent data.`;
  const user = `Call received: ${i.callStartedAt ? i.callStartedAt.toISOString() : "unknown"} (timezone Asia/Kolkata)
Caller number: ${i.callerNumber ?? "unknown"}
Voice-agent extracted fields (may be empty): ${JSON.stringify(i.vaaniExtracted)}
Voice-agent meeting-time hint: ${i.meetingHint ?? "none"}

TRANSCRIPT:
${i.transcript}`;
  return { system, user };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModel(model: string, key: string, system: string, user: string): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 500) };
  const json: any = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
  if (!text) return { ok: false, status: 502, body: "Gemini returned no text" };
  return { ok: true, text };
}

/** Ordered model chain: GEMINI_MODEL first, then GEMINI_FALLBACK_MODELS (comma-separated), best-first. */
export function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest").split(",").map((m) => m.trim()).filter(Boolean);
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/**
 * On high demand (429/5xx) or an unavailable model (404) we do NOT wait and retry the same model:
 * we route straight to the next model in the chain. If the whole chain fails we pause briefly and sweep it once more.
 */
async function callGemini(system: string, user: string): Promise<{ text: string; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const errors: string[] = [];
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const model of modelChain()) {
      const r = await callModel(model, key, system, user);
      if (r.ok) return { text: r.text, model };
      errors.push(`${model} ${r.status}`);
      console.warn(`Gemini ${model} failed (${r.status}), routing to next model`);
    }
    if (sweep === 0) await sleep(3000);
  }
  throw new Error(`All Gemini models failed: ${errors.join(", ")}`);
}

/** Calls Gemini, validates strictly with zod; on invalid JSON retries once with the validation error fed back. */
export async function evaluateLead(
  i: EvalInput,
  call: (system: string, user: string) => Promise<string | { text: string; model: string }> = callGemini,
): Promise<{ evaluation: Evaluation; raw: string; model: string }> {
  const { system, user } = buildPrompt(i);
  const run = async (u: string) => {
    const r = await call(system, u);
    return typeof r === "string" ? { text: r, model: modelChain()[0] } : r;
  };
  let r = await run(user);
  try {
    return { evaluation: parseEvaluation(r.text), raw: r.text, model: r.model };
  } catch (err) {
    r = await run(`${user}

Your previous reply was invalid (${String(err).slice(0, 600)}). Reply again with ONLY valid JSON in the exact shape.`);
    return { evaluation: parseEvaluation(r.text), raw: r.text, model: r.model };
  }
}
