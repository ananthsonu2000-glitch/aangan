import { LeadTable } from "../../lead-table";
import { openQueue } from "../../queries";

export const dynamic = "force-dynamic";

export default async function FrontDeskQueue() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Front desk recheck queue</h1>
      <p className="text-sm text-stone-500">Leads that did not clearly pass the rubric — call back and confirm scope, area, timeline.</p>
      <LeadTable rows={await openQueue("needs_recheck")} empty="Nothing to recheck." />
    </div>
  );
}
