// Sends a signed fake Vaani webhook to a running app: `npm run simulate -- t01` (t01 | t03 | t04 | t10)
import { createHmac } from "node:crypto";
import { SAMPLE_CALLS } from "../tests/fixtures";

async function main() {
  const key = (process.argv[2] ?? "t01") as keyof typeof SAMPLE_CALLS;
  const sample = SAMPLE_CALLS[key];
  if (!sample) throw new Error(`unknown sample ${key}; options: ${Object.keys(SAMPLE_CALLS).join(", ")}`);
  const body = JSON.stringify({ ...sample.payload, call_id: `sim-${key}-${Date.now()}` });
  const secret = process.env.VAANI_WEBHOOK_SECRET ?? "";
  const res = await fetch(`${process.env.APP_URL ?? "http://localhost:3000"}/api/webhooks/vaani`, {
    method: "POST",
    headers: { "content-type": "application/json", [process.env.VAANI_SIGNATURE_HEADER ?? "x-vaani-signature"]: createHmac("sha256", secret).update(body).digest("hex") },
    body,
  });
  console.log(res.status, await res.text());
}
main();
