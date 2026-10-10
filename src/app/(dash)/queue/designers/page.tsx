import { LeadTable } from "../../lead-table";
import { openQueue } from "../../queries";

export const dynamic = "force-dynamic";

export default async function DesignerQueue() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Designer queue</h1>
      <p className="text-sm text-stone-500">Qualified leads awaiting a consultation.</p>
      <LeadTable rows={await openQueue("qualified")} empty="No open qualified leads." />
    </div>
  );
}
