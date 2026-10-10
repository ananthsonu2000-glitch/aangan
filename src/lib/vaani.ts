/**
 * Vaani adapter layer.
 * NOTE: the exact Vaani payload is NOT confirmed yet. Everything Vaani-specific lives in this file
 * (`verifySignature` and `normalizeVaaniPayload`). Once we have a real sample, only these change.
 * The normalizer is deliberately tolerant: it looks for each field under several likely key names.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type NormalizedCall = {
  externalCallId: string;
  transcript: string | null;
  callerNumber: string | null;
  callerName: string | null;
  callerEmail: string | null;
  startedAt: Date | null;
  durationSec: number | null;
  agreedMeetingTimeHint: string | null;
  vaaniExtracted: Record<string, unknown>;
};

type Json = Record<string, any>;

/**
 * CONFIRMED from a real Vaani webhook test: header `x-webhook-signature: sha256=<hex>`, HMAC-SHA256 of the raw body.
 * Also tolerates base64 / bearer for safety.
 */
export function verifySignature(rawBody: string, headers: Headers, secret: string | undefined, headerName = "x-webhook-signature"): boolean {
  if (!secret) return false; // fail closed
  // Vaani sends x-webhook-signature. A configured header name is tried too, so a stale env value cannot break verification.
  const provided = [headerName, "x-webhook-signature", "x-vaani-signature"].map((h) => (headers.get(h) ?? "").trim().replace(/^sha256=/i, "")).find(Boolean) ?? "";
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const safeEq = (a: string, b: string) => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  };
  const mac = createHmac("sha256", secret).update(rawBody).digest();
  if (provided && (safeEq(provided, mac.toString("hex")) || safeEq(provided, mac.toString("base64")))) return true;
  if (provided && safeEq(provided, secret)) return true;
  if (bearer && safeEq(bearer, secret)) return true;
  return false;
}

const pick = (obj: Json, paths: string[]): any => {
  for (const p of paths) {
    const v = p.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function transcriptToText(t: unknown): string | null {
  if (!t) return null;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    return t
      .map((m: Json) => {
        const who = m.role ?? m.speaker ?? m.from ?? "";
        const text = m.content ?? m.text ?? m.message ?? "";
        return who ? `${who}: ${text}` : String(text);
      })
      .join("\n");
  }
  return JSON.stringify(t);
}

/**
 * CONFIRMED Vaani format (from the webhook test): a batch
 *   { event, timestamp, events: [ { event: "call_ended", data: {...} }, { event: "call_postprocessing", call_id, data: { transcript, summary, entities, dispositions, recording_url, call_duration, ... } } ] }
 * Single-event bodies ({ event, data }) are handled too. Post-processing data wins over call_ended data.
 */
function flatten(body: Json): { data: Json; timestamp: string | undefined; event: string | undefined } {
  const events: Json[] | null = Array.isArray(body?.events) ? body.events : null;
  if (events) {
    const ended = events.find((e) => e?.event === "call_ended");
    const post = events.find((e) => e?.event === "call_postprocessing");
    return { data: { ...(ended?.data ?? {}), ...(post?.data ?? {}) }, timestamp: (post ?? ended ?? events[0])?.timestamp ?? body.timestamp, event: post ? "call_postprocessing" : ended?.event ?? events[0]?.event };
  }
  const data = body?.data && typeof body.data === "object" ? { ...body, ...body.data } : body;
  return { data, timestamp: body?.timestamp, event: body?.event };
}

export function isTestEvent(body: Json): boolean {
  return body?.event === "webhook_test";
}

export function normalizeVaaniPayload(body: Json): NormalizedCall {
  const { data: d, timestamp } = flatten(body);
  const id = pick(d, ["call_id", "callId", "room_name", "id", "call.id", "uuid", "conversation_id"]);
  if (!id) throw new Error("Vaani payload has no call id (adapter needs updating for the real payload)");
  const dur = pick(d, ["call_duration", "duration", "duration_sec", "duration_seconds", "call.duration"]);
  const durationSec = dur != null && !isNaN(Number(dur)) ? Math.round(Number(dur)) : null;
  const ended = pick(d, ["ended_at", "end_time"]) ?? timestamp;
  const startedExplicit = pick(d, ["started_at", "startedAt", "start_time", "call.started_at"]);
  let startedAt: Date | null = null;
  if (startedExplicit && !isNaN(Date.parse(startedExplicit))) startedAt = new Date(startedExplicit);
  else if (ended && !isNaN(Date.parse(ended))) startedAt = new Date(Date.parse(ended) - (durationSec ?? 0) * 1000);
  const entities = (pick(d, ["entities", "extracted_data", "extractedData", "variables", "collected_data"]) ?? {}) as Json;
  const dispositions = (d.dispositions ?? {}) as Json;
  return {
    externalCallId: String(id),
    transcript: transcriptToText(pick(d, ["transcript", "call.transcript", "conversation", "messages"])),
    callerNumber: pick(d, ["from", "from_number", "caller_number", "customer_number", "phone", "phone_number", "customer.number"]) ?? entities.phone ?? entities.customer_phone ?? entities.phone_number ?? null,
    callerName: entities.customer_name ?? entities.name ?? pick(d, ["caller_name", "customer_name", "name"]) ?? null,
    callerEmail: entities.email ?? pick(d, ["email", "customer.email"]) ?? null,
    startedAt,
    durationSec,
    agreedMeetingTimeHint: entities.meeting_time ?? entities.appointment_time ?? entities.preferred_time ?? pick(d, ["meeting_time", "agreed_time", "appointment_time"]) ?? null,
    vaaniExtracted: { ...entities, ...(Object.keys(dispositions).length ? { dispositions } : {}), ...(d.summary ? { vaani_summary: d.summary } : {}) },
  };
}

export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, "");
  if (!digits) return null;
  const d = digits.replace(/^\+/, "");
  if (d.length === 10) return `+91${d}`;
  return `+${d}`;
}
