// Re-run the full pipeline for one stored call: `npm run reprocess -- <call-uuid>`
import { processCall } from "../src/lib/pipeline";
const id = process.argv[2];
if (!id) throw new Error("usage: npm run reprocess -- <call-uuid>");
processCall(id).then((r) => console.log("done", r)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
