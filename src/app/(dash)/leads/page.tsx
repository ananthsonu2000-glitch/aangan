import { LeadTable } from "../lead-table";
import { listLeads } from "../queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">All leads</h1>
      <LeadTable rows={await listLeads()} />
    </div>
  );
}
