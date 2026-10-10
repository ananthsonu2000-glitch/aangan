// Creates the aangan_* custom deal properties in HubSpot (idempotent: 409 = already exists).
import { HUBSPOT_CUSTOM_DEAL_PROPERTIES } from "../src/lib/payloads";

async function main() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not set");
  for (const p of HUBSPOT_CUSTOM_DEAL_PROPERTIES) {
    const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...p, groupName: "dealinformation" }),
    });
    console.log(p.name, res.status === 409 ? "exists" : res.ok ? "created" : `FAILED ${res.status} ${await res.text()}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
