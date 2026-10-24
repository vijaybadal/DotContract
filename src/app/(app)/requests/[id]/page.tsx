import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { getRequest } from "@/lib/contracts";
import { isAppError } from "@/lib/errors";
import { docsFor, valuesFrom, wizardRef } from "@/lib/wizard-data";
import { RequestWizard } from "@/components/client/request-wizard";
import { workflowHistory } from "@/lib/workflow";
import { Notice, PageHeader, Status } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Contract request" };
export const dynamic = "force-dynamic";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string; step?: string; saved?: string }> }) {
  const { id } = await params;
  const { submitted, step, saved } = await searchParams;
  const actor = await requireActor();
  let data: Awaited<ReturnType<typeof getRequest>>;
  try {
    data = await getRequest(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  const { request: r, canEdit, canSubmit } = data;
  const history = await workflowHistory(r.contractId);
  const returned = history.find((i) => i.status === "RETURNED");
  const returnTask = returned?.tasks.find((t) => t.status === "RETURNED");

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/requests", label: "Contract requests" }]}
        title={r.contract.title}
        lede={<span>{r.number} · {r.type.replace(/_/g, " ").toLowerCase()} · requested by {r.requester.name}</span>}
        actions={<><Status value={r.status} /><Link href={`/contracts/${r.contractId}?tab=workflow`} className="text-sm font-semibold text-teal hover:underline">View approval progress</Link></>}
      />
      {submitted && <div className="mb-5"><Notice tone="green" title="Submitted for approval">The first approvers have been notified. Track progress on the contract&apos;s Workflow tab.</Notice></div>}
      {r.status === "RETURNED" && returnTask && (
        <div className="mb-5">
          <Notice tone="amber" title={`Returned by ${returnTask.decidedBy?.name ?? "a reviewer"} at “${returnTask.name}”`}>
            “{returnTask.comment}” — {formatDateTime(returnTask.decidedAt)}. Make the changes and submit again; earlier decisions stay in the history.
          </Notice>
        </div>
      )}
      {canEdit ? (
        <RequestWizard refData={await wizardRef(actor)} initial={valuesFrom(r)} requestId={r.id} contractId={r.contractId} documents={await docsFor(r.contractId)} canSubmit={canSubmit} initialStep={Number(step ?? 0)} savedNumber={saved || undefined} />
      ) : (
        <Notice tone="teal" title="This request is no longer editable">
          It is {r.status.toLowerCase()}. Open the <Link className="font-semibold underline" href={`/contracts/${r.contractId}`}>contract record</Link> for documents, approvals and history.
        </Notice>
      )}
    </>
  );
}
