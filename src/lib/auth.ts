// Edge-compatible (Web Crypto) signed-cookie auth. One shared DASHBOARD_PASSWORD; session cookie signed with AUTH_SECRET.
export const COOKIE = "aangan_session";

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(secret: string) {
  const exp = String(Date.now() + 7 * 864e5);
  return `${exp}.${await hmac(exp, secret)}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined) {
  if (!token || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = await hmac(exp, secret);
  return expected.length === sig.length && expected === sig;
}
