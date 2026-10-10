import { eq } from "drizzle-orm";
import { db, calls } from "@/db";
import { fetchRecording } from "@/lib/recording";

export const runtime = "nodejs";
export const maxDuration = 60;

// Protected by the dashboard session (middleware). The Vaani API key never leaves the server.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const [call] = await db().select({ ext: calls.externalCallId }).from(calls).where(eq(calls.id, id));
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  return fetchRecording(call.ext, req.headers.get("range"), process.env.VAANI_API_KEY);
}
