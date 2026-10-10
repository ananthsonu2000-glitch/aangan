import { NextResponse, after } from "next/server";
import { db, calls } from "@/db";
import { normalizeVaaniPayload, normalizePhone, verifySignature } from "@/lib/vaani";
import { processCall } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  const valid = verifySignature(raw, req.headers, secret, process.env.VAANI_SIGNATURE_HEADER || "x-vaani-signature");
  // Fail closed. Unsigned requests are only tolerated with an explicit dev flag and no secret configured.
  const devBypass = !secret && process.env.ALLOW_UNSIGNED_WEBHOOKS === "true" && process.env.NODE_ENV !== "production";
  if (!valid && !devBypass) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  let n;
  try { n = normalizeVaaniPayload(body); } catch (e) { return NextResponse.json({ error: String(e) }, { status: 422 }); }

  const [row] = await db()
    .insert(calls)
    .values({
      externalCallId: n.externalCallId, rawPayload: body, transcript: n.transcript, callerNumber: normalizePhone(n.callerNumber),
      startedAt: n.startedAt, durationSec: n.durationSec, agreedMeetingTimeHint: n.agreedMeetingTimeHint, signatureValid: true,
    })
    .onConflictDoNothing() // Vaani retries are safe: same call id is stored once
    .returning({ id: calls.id });

  if (!row) return NextResponse.json({ ok: true, duplicate: true });
  // Ack fast, process after the response. If this dies, /api/cron/retry picks the call up.
  after(async () => { try { await processCall(row.id); } catch (e) { console.error("processCall failed", row.id, e); } });
  return NextResponse.json({ ok: true, callId: row.id });
}
