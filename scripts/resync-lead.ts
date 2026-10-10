// Re-run HubSpot sync + calendar for one lead: `npm run resync -- <lead-id>`
import { resyncLead } from "../src/lib/pipeline";
const id = process.argv[2];
if (!id) throw new Error("usage: npm run resync -- <lead-id>");
resyncLead(id).then(() => console.log("resynced", id)).catch((e) => { console.error(e); process.exit(1); });
