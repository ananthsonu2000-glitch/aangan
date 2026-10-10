/** Streams a call recording from Vaani (GET /api/stream/{call_id}, X-API-Key) so the browser never sees the API key. */
export const VAANI_API_BASE = "https://api.vaanivoice.ai";

export async function fetchRecording(externalCallId: string, range: string | null, apiKey: string | undefined, doFetch: typeof fetch = fetch): Promise<Response> {
  if (!apiKey) return Response.json({ error: "VAANI_API_KEY is not configured" }, { status: 503 });
  const headers: Record<string, string> = { "X-API-Key": apiKey };
  if (range) headers.Range = range; // lets the audio player seek
  const upstream = await doFetch(`${VAANI_API_BASE}/api/stream/${encodeURIComponent(externalCallId)}`, { headers, cache: "no-store" });
  if (upstream.status === 404) return Response.json({ error: "Recording not available yet" }, { status: 404 });
  if (!upstream.ok && upstream.status !== 206) return Response.json({ error: `Vaani ${upstream.status}` }, { status: 502 });
  // Vaani ignores Range and returns the whole file. Slice it ourselves so seeking works (recordings are a few MB).
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && upstream.status === 200 && (m[1] || m[2])) {
    const buf = new Uint8Array(await upstream.arrayBuffer());
    const total = buf.length;
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start >= total || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    const part = buf.slice(start, end + 1);
    return new Response(part, {
      status: 206,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/ogg",
        "content-length": String(part.length),
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=300",
      },
    });
  }
  const out = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("cache-control", "private, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
