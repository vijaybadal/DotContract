import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { blankValues, wizardRef } from "@/lib/wizard-data";
import { RequestWizard } from "@/components/client/request-wizard";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "New contract request" };
export const dynamic = "force-dynamic";

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ parent?: string; type?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const ref = await wizardRef(actor);
  const initial = { ...blankValues(actor, ref.myDepts), parentContractId: sp.parent ?? "", requestType: sp.type ?? "NEW_CONTRACT" };
  return (
    <>
      <PageHeader crumbs={[{ href: "/requests", label: "Contract requests" }]} title="New contract request" lede="Tell us what you need. You can save a draft at any step and come back to it." />
      {ref.myDepts.length === 0 ? (
        <Notice tone="amber" title="You don't hold the Requester role for any department">Ask your CLM administrator to add it, or ask a requester in your department to submit on your behalf.</Notice>
      ) : (
        <RequestWizard refData={ref} initial={initial} />
      )}
    </>
  );
}
