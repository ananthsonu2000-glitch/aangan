import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { normalizeVaaniPayload, normalizePhone, verifySignature, isTestEvent } from "@/lib/vaani";
import { parseEvaluation, decideStatus } from "@/lib/qualification";
import { evaluateLead } from "@/lib/gemini";
import { pickAssignee, roleForStatus } from "@/lib/assignment";
import { buildEmail, buildTelegram, buildHubspotContact, buildHubspotDeal, type LeadView } from "@/lib/payloads";
import { buildCalendarEvent } from "@/lib/integrations";
import { SAMPLE_CALLS, evalJson } from "./fixtures";

const lead: LeadView = {
  id: "11111111-2222-3333-4444-555555555555", name: "Priya Kulkarni", phone: "+919822012345", email: "priya@example.com", location: "Kothrud, Pune",
  projectType: "3BHK full home", budget: null, timeline: "by March", designRequirement: "Kitchen & bedrooms", meetingTime: new Date("2026-09-10T05:30:00Z"),
  status: "qualified", score: 88, employeeSummary: "Full redesign <by March>.", founderSummary: "Strong lead.",
};

describe("webhook intake", () => {
  const body = JSON.stringify(SAMPLE_CALLS.t01.payload);
  it("verifies HMAC signature, rejects tampering / missing secret", () => {
    const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifySignature(body, new Headers({ "x-webhook-signature": sig }), "s3cret")).toBe(true);
    expect(verifySignature(body, new Headers({ "x-webhook-signature": `sha256=${sig}` }), "s3cret")).toBe(true);
    expect(verifySignature(body + " ", new Headers({ "x-webhook-signature": sig }), "s3cret")).toBe(false);
    expect(verifySignature(body, new Headers(), "s3cret")).toBe(false);
    expect(verifySignature(body, new Headers({ "x-webhook-signature": sig }), undefined)).toBe(false);
  });
  it("normalizes payload and phone", () => {
    const n = normalizeVaaniPayload(SAMPLE_CALLS.t01.payload);
    expect(n.externalCallId).toBe("t01");
    expect(n.durationSec).toBe(252);
    expect(n.transcript).toContain("Kothrud");
    expect(normalizePhone("98220 12345")).toBe("+919822012345");
  });
  it("handles transcript arrays and nested data; rejects payload without id", () => {
    const n = normalizeVaaniPayload({ data: { id: "x1", transcript: [{ role: "user", content: "hi" }, { role: "agent", content: "hello" }] } });
    expect(n.transcript).toBe("user: hi\nagent: hello");
    expect(() => normalizeVaaniPayload({ foo: 1 })).toThrow();
  });
});

describe("Gemini JSON parsing", () => {
  it("parses fenced JSON and coerces empty strings to null", () => {
    const e = parseEvaluation("```json\n" + JSON.stringify(evalJson({ extracted: { ...evalJson().extracted, email: "  " } })) + "\n```");
    expect(e.extracted.email).toBeNull();
    expect(e.score).toBe(88);
  });
  it("rejects invalid shape", () => {
    expect(() => parseEvaluation(JSON.stringify({ status: "maybe" }))).toThrow();
    expect(() => parseEvaluation("not json")).toThrow();
  });
  it("retries once on invalid output, then succeeds", async () => {
    let calls = 0;
    const r = await evaluateLead({ transcript: "x".repeat(30), callerNumber: null, callStartedAt: null, vaaniExtracted: {}, meetingHint: null }, async () => (++calls === 1 ? "garbage" : JSON.stringify(evalJson())));
    expect(calls).toBe(2);
    expect(r.evaluation.status).toBe("qualified");
  });
});

describe("qualification branching", () => {
  const f = { result: "fail" as const, note: "" };
  const u = { result: "unclear" as const, note: "" };
  const c = evalJson().criteria;
  it("all pass => qualified", () => expect(decideStatus(evalJson()).status).toBe("qualified"));
  it("unclear budget or decision-maker still qualified", () => {
    expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, budget: u, decisionMaker: u } }).status).toBe("qualified");
  });
  it("out of area => needs_recheck (T03)", () => expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, serviceArea: f } }).status).toBe("needs_recheck"));
  it("advice only => needs_recheck (T04)", () => expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, realProject: f } }).status).toBe("needs_recheck"));
  it("clear budget mismatch => needs_recheck (T10)", () => expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, budget: f } }).status).toBe("needs_recheck"));
  it("unclear timeline => needs_recheck; two fails => needs_recheck", () => {
    expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, timeline: u } }).status).toBe("needs_recheck");
    expect(decideStatus({ leadType: "new_enquiry", criteria: { ...c, timeline: f, serviceArea: f } }).why).toMatch(/multiple/);
  });
  it("existing-client complaints never reach a designer (T09)", () => expect(decideStatus({ leadType: "existing_client_issue", criteria: c }).status).toBe("needs_recheck"));
});

describe("assignment", () => {
  const mk = (id: string, order: number, last: string | null, active = true) => ({ id, name: id, active, sortOrder: order, lastAssignedAt: last ? new Date(last) : null });
  const designers = [mk("alpha", 1, null), mk("beta", 2, null), mk("charlie", 3, null), mk("delta", 4, null)];
  it("routes by status", () => {
    expect(roleForStatus("qualified")).toBe("designer");
    expect(roleForStatus("needs_recheck")).toBe("front_desk");
  });
  it("round-robins through designers in order and wraps", () => {
    const pool = designers.map((d) => ({ ...d }));
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = pickAssignee(pool)!;
      p.lastAssignedAt = new Date(2026, 0, 1, 0, i);
      order.push(p.id);
    }
    expect(order).toEqual(["alpha", "beta", "charlie", "delta", "alpha"]);
  });
  it("skips inactive and returns null on empty pool", () => {
    expect(pickAssignee([mk("a", 1, null, false), mk("b", 2, null)])!.id).toBe("b");
    expect(pickAssignee([mk("a", 1, null, false)])).toBeNull();
  });
  it("least_loaded prefers fewest open leads", () => {
    expect(pickAssignee(designers, "least_loaded", { alpha: 3, beta: 1, charlie: 2, delta: 1 })!.id).toBe("beta");
  });
});

describe("payload generation", () => {
  it("email: escapes HTML, includes link, role-specific subject", () => {
    const e = buildEmail(lead, "Alpha", "designer", "https://app.example.com/");
    expect(e.subject).toMatch(/^\[Qualified\]/);
    expect(e.html).toContain("&lt;by March&gt;");
    expect(e.html).not.toContain("<by March>");
    expect(e.text).toContain(`https://app.example.com/leads/${lead.id}`);
    expect(buildEmail({ ...lead, status: "needs_recheck" }, "FD1", "front_desk", "https://a.b").subject).toMatch(/^\[Recheck\]/);
  });
  it("telegram: HTML mode with escaped summary and link", () => {
    const t = buildTelegram(lead, "Alpha", "designer", "https://app.example.com");
    expect(t.parse_mode).toBe("HTML");
    expect(t.text).toContain("&lt;by March&gt;");
    expect(t.text).toContain(`/leads/${lead.id}`);
  });
  it("hubspot contact splits name; deal maps stage + custom properties", () => {
    expect(buildHubspotContact(lead).properties).toMatchObject({ firstname: "Priya", lastname: "Kulkarni", email: "priya@example.com", phone: "+919822012345" });
    const cfg = { pipelineId: "default", stageQualified: "QUAL", stageRecheck: "RECHECK" };
    const q = buildHubspotDeal(lead, "Alpha", cfg, "https://a.b").properties;
    expect(q).toMatchObject({ dealstage: "QUAL", aangan_lead_score: "88", aangan_qualification_status: "qualified", aangan_assigned_to: "Alpha", aangan_summary: "Strong lead." });
    expect(buildHubspotDeal({ ...lead, status: "needs_recheck" }, null, cfg, "https://a.b").properties.dealstage).toBe("RECHECK");
  });
  it("calendar event is deterministic and 1 hour long", () => {
    const ev = buildCalendarEvent({ ...(lead as any) }, "alpha@example.com");
    expect(ev.id).toBe(buildCalendarEvent({ ...(lead as any) }, null).id);
    expect(ev.id).toMatch(/^[a-v0-9]+$/);
    expect(new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()).toBe(3600000);
    expect(ev.attendees.map((a) => a.email)).toEqual(["alpha@example.com", "priya@example.com"]);
  });
});

describe("Gemini model routing", () => {
  it("builds the chain primary-first, de-duplicated, from env", async () => {
    const { modelChain } = await import("@/lib/gemini");
    process.env.GEMINI_MODEL = "m1";
    process.env.GEMINI_FALLBACK_MODELS = "m2, m1 ,m3";
    expect(modelChain()).toEqual(["m1", "m2", "m3"]);
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODELS;
    expect(modelChain()[0]).toBe("gemini-3.8-flash");
  });
});

describe("real Vaani webhook format", () => {
  const real = {
    event: "call_postprocessing_batch", timestamp: "2026-10-10T10:30:00+00:00",
    events: [
      { event: "call_ended", timestamp: "2026-10-10T10:29:59+00:00", data: { room_name: "webrtc-179", call_id: "webrtc-179", end_reason: "completed", call_duration: 197, technical_issue: false } },
      { event: "call_postprocessing", call_id: "webrtc-179", timestamp: "2026-10-10T10:30:00+00:00", data: { call_id: "webrtc-179", call_duration: 197, summary: "Caller wants a 3BHK redesign.", entities: { customer_name: "Rahul Mehta", phone: "9876543210" }, dispositions: { call_disposition: "Interested" }, recording_url: "https://x/r.mp3", transcript: "Agent: Hello\nUser: I have a 3BHK in Baner" } },
    ],
  };
  it("merges call_ended + call_postprocessing into one normalized call", () => {
    const n = normalizeVaaniPayload(real);
    expect(n.externalCallId).toBe("webrtc-179");
    expect(n.durationSec).toBe(197);
    expect(n.transcript).toContain("3BHK in Baner");
    expect(n.callerName).toBe("Rahul Mehta");
    expect(n.callerNumber).toBe("9876543210");
    expect(n.vaaniExtracted).toMatchObject({ vaani_summary: "Caller wants a 3BHK redesign." });
    expect(n.startedAt!.toISOString()).toBe("2026-10-10T10:26:43.000Z");
  });
  it("a bare call_ended has no transcript; the test ping is recognised", () => {
    expect(normalizeVaaniPayload({ events: [real.events[0]] }).transcript).toBeNull();
    expect(isTestEvent({ event: "webhook_test", events: [] })).toBe(true);
  });
  it("accepts the exact signed webhook_test captured from Vaani", () => {
    const body = '{"event": "webhook_test", "timestamp": "2026-10-10T10:04:37.982273+00:00"}';
    const sig = createHmac("sha256", "k").update(body).digest("hex");
    expect(verifySignature(body, new Headers({ "x-webhook-signature": `sha256=${sig}` }), "k", "x-vaani-signature")).toBe(true);
  });
});
