import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db, calls, webhookFailures } from "@/db";
import { normalizeVaaniPayload, normalizePhone, verifySignature, isTestEvent } from "@/lib/vaani";
import { processCall } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

async function logRejected(req: Request, reason: string, body: string) {
  try {
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = /^(authorization|cookie|x-vercel-.*)$/i.test(k) ? "[redacted]" : v; });
    await db().insert(webhookFailures).values({ reason, headers, body: body.slice(0, 20000) });
  } catch (e) { console.error("could not log rejected webhook", e); }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  const valid = verifySignature(raw, req.headers, secret, process.env.VAANI_SIGNATURE_HEADER || "x-webhook-signature");
  // Fail closed. Unsigned requests are only tolerated with an explicit dev flag and no secret configured.
  const devBypass = !secret && process.env.ALLOW_UNSIGNED_WEBHOOKS === "true" && process.env.NODE_ENV !== "production";
  if (!valid && !devBypass) { await logRejected(req, "invalid signature", raw); return NextResponse.json({ error: "invalid signature" }, { status: 401 }); }

  let body: any;
  try { body = JSON.parse(raw); } catch { await logRejected(req, "invalid json", raw); return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (isTestEvent(body)) return NextResponse.json({ ok: true, test: true }); // "Test Connectivity" ping: acknowledge, store nothing

  let n;
  try { n = normalizeVaaniPayload(body); } catch (e) { await logRejected(req, `unparseable: ${String(e)}`, raw); return NextResponse.json({ error: String(e) }, { status: 422 }); }

  const [row] = await db()
    .insert(calls)
    .values({
      externalCallId: n.externalCallId, rawPayload: body, transcript: n.transcript, callerNumber: normalizePhone(n.callerNumber),
      startedAt: n.startedAt, durationSec: n.durationSec, agreedMeetingTimeHint: n.agreedMeetingTimeHint, recordingUrl: n.recordingUrl, signatureValid: true,
    })
    .onConflictDoNothing() // Vaani retries are safe: same call id is stored once
    .returning({ id: calls.id });

  if (!row) {
    // Same call id seen before (Vaani may send call_ended and call_postprocessing separately).
    const [existing] = await db().select().from(calls).where(eq(calls.externalCallId, n.externalCallId));
    if (!existing) return NextResponse.json({ ok: true, duplicate: true });
    const needsTranscript = !existing.transcript?.trim() && !!n.transcript?.trim();
    const needsRecording = !existing.recordingUrl && !!n.recordingUrl;
    if (!needsTranscript && !needsRecording) return NextResponse.json({ ok: true, duplicate: true });
    await db().update(calls).set({
      recordingUrl: existing.recordingUrl ?? n.recordingUrl,
      ...(needsTranscript ? { rawPayload: body, transcript: n.transcript, durationSec: n.durationSec ?? existing.durationSec, startedAt: n.startedAt ?? existing.startedAt, agreedMeetingTimeHint: n.agreedMeetingTimeHint ?? existing.agreedMeetingTimeHint, processingStatus: "received" as const, processingError: null } : {}),
    }).where(eq(calls.id, existing.id));
    // Only (re)process when we newly got the transcript; a late recording just attaches to the call.
    if (needsTranscript) after(async () => { try { await processCall(existing.id); } catch (e) { console.error("processCall failed", existing.id, e); } });
    return NextResponse.json({ ok: true, callId: existing.id, upgraded: true });
  }
  // No transcript yet (e.g. a bare call_ended): keep it, and process when the post-processing event arrives (see upgrade above).
  if (!n.transcript?.trim()) return NextResponse.json({ ok: true, callId: row.id, awaitingTranscript: true });
  // Ack fast, process after the response. If this dies, /api/cron/retry picks the call up.
  after(async () => { try { await processCall(row.id); } catch (e) { console.error("processCall failed", row.id, e); } });
  return NextResponse.json({ ok: true, callId: row.id });
}
