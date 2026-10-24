import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui";
import { canSeeAuditDetail, REPORTS } from "@/lib/reports";
import { getOrgIndex } from "@/lib/authz";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function Reports() {
  const actor = await requireActor();
  const auditOk = canSeeAuditDetail(actor, await getOrgIndex());
  return (
    <>
      <PageHeader title="Reports" lede="Each report covers only the contracts your roles can see. Downloads open in Excel. Contracts completed through the demo e-signature mock are left out of financial reports." />
      <Panel flush>
        <ul className="divide-y divide-rule-soft">
          {REPORTS.filter((r) => !r.restricted || auditOk).map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="max-w-2xl">
                <p className="font-semibold">{r.title}</p>
                <p className="text-sm text-muted">{r.description}</p>
              </div>
              <a className="rounded-md border border-rule px-3 py-1.5 text-sm font-semibold hover:border-teal hover:text-teal" href={`/api/v1/reports/${r.key}`}>Download CSV</a>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
