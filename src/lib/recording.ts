/** Streams a call recording from Vaani (GET /api/stream/{call_id}, X-API-Key) so the browser never sees the API key. */
export const VAANI_API_BASE = "https://api.vaanivoice.ai";

export async function fetchRecording(externalCallId: string, range: string | null, apiKey: string | undefined, doFetch: typeof fetch = fetch): Promise<Response> {
  if (!apiKey) return Response.json({ error: "VAANI_API_KEY is not configured" }, { status: 503 });
  const headers: Record<string, string> = { "X-API-Key": apiKey };
  if (range) headers.Range = range; // lets the audio player seek
  const upstream = await doFetch(`${VAANI_API_BASE}/api/stream/${encodeURIComponent(externalCallId)}`, { headers, cache: "no-store" });
  if (upstream.status === 404) return Response.json({ error: "Recording not available yet" }, { status: 404 });
  if (!upstream.ok && upstream.status !== 206) return Response.json({ error: `Vaani ${upstream.status}` }, { status: 502 });
  const out = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("cache-control", "private, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
