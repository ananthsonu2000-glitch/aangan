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
 * Assumes HMAC-SHA256 (hex or base64) of the raw body in the signature header (optionally "sha256=" prefixed),
 * or the shared secret sent directly as a header value / bearer token. ADJUST once Vaani's scheme is confirmed.
 */
export function verifySignature(rawBody: string, headers: Headers, secret: string | undefined, headerName = "x-vaani-signature"): boolean {
  if (!secret) return false; // fail closed
  const provided = (headers.get(headerName) ?? "").trim().replace(/^sha256=/i, "");
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

export function normalizeVaaniPayload(body: Json): NormalizedCall {
  const d: Json = body?.data && typeof body.data === "object" ? { ...body, ...body.data } : body;
  const id = pick(d, ["call_id", "callId", "id", "call.id", "uuid", "conversation_id"]);
  if (!id) throw new Error("Vaani payload has no call id (adapter needs updating for the real payload)");
  const started = pick(d, ["started_at", "startedAt", "start_time", "call.started_at", "created_at", "timestamp"]);
  const dur = pick(d, ["duration", "duration_sec", "duration_seconds", "call.duration", "call_duration"]);
  const extracted = (pick(d, ["extracted_data", "extractedData", "variables", "analysis.data", "collected_data"]) ?? {}) as Json;
  return {
    externalCallId: String(id),
    transcript: transcriptToText(pick(d, ["transcript", "call.transcript", "conversation", "messages"])),
    callerNumber: pick(d, ["from", "caller_number", "customer_number", "phone", "phone_number", "call.from", "customer.number"]) ?? null,
    callerName: pick(d, ["caller_name", "customer_name", "name", "customer.name"]) ?? extracted.name ?? null,
    callerEmail: pick(d, ["email", "customer.email"]) ?? extracted.email ?? null,
    startedAt: started && !isNaN(Date.parse(started)) ? new Date(started) : null,
    durationSec: dur != null && !isNaN(Number(dur)) ? Math.round(Number(dur)) : null,
    agreedMeetingTimeHint: pick(d, ["meeting_time", "agreed_time", "appointment_time", "extracted_data.meeting_time", "variables.meeting_time"]) ?? null,
    vaaniExtracted: extracted,
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
