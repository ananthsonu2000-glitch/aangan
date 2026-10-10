import { NextResponse } from "next/server";
import { retryStuckCalls } from "@/lib/pipeline";
import { retryFailedNotifications } from "@/lib/integrations";

export const runtime = "nodejs";
export const maxDuration = 300;

// Call from a scheduler (e.g. Vercel Cron) with: Authorization: Bearer $CRON_SECRET
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const calls = await retryStuckCalls();
  const notifications = await retryFailedNotifications();
  return NextResponse.json({ calls: calls.length, notificationsRetried: notifications });
}
