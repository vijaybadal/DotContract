import Link from "next/link";
import type { Metadata } from "next";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { signatureRequest, signatureSigner } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { formatDateTime } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, Pill, Status } from "@/components/ui";

export const metadata: Metadata = { title: "Signatures" };
export const dynamic = "force-dynamic";

export default async function Signatures() {
  const actor = await requireActor();
  const ready = await listContracts(actor, { status: "PENDING_SIGNATURE" });
  const visible = await listContracts(actor, { limit: 2000 });
  const ids = visible.map((c) => c.id);
  const reqs = ids.length ? await db.select().from(signatureRequest).where(inArray(signatureRequest.contractId, ids)).orderBy(desc(signatureRequest.sentAt)) : [];
  const signers = reqs.length ? await db.select().from(signatureSigner).where(inArray(signatureSigner.requestId, reqs.map((r) => r.id))) : [];
  const title = (id: string) => visible.find((c) => c.id === id);
  return (
    <>
      <PageHeader title="Signatures" lede="Approved agreements waiting for a signature package, and the status of every signature request." />
      <Panel title={`Awaiting signature (${ready.length})`} flush>
        {ready.length === 0 ? <Empty title="No approved agreements are waiting for signature" /> : (
          <table className="tbl">
            <thead><tr><th>Agreement</th><th>Contracting entity</th><th className="num">Value</th><th>Signature</th></tr></thead>
            <tbody>{ready.map((c) => (
              <tr key={c.id}>
                <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${c.id}?tab=signature`}>{c.title}</Link><div className="text-[0.8rem] text-muted">{c.number}</div></td>
                <td className="text-[0.85rem]">{c.entityName}{c.administeredOnBehalf && <div className="text-[0.8rem] text-muted">administered by {c.adminName}</div>}</td>
                <td className="num"><Money value={c.totalValue} /></td>
                <td><Status value={c.signatureStatus} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Signature requests" className="mt-5" flush>
        {reqs.length === 0 ? <Empty title="No signature requests yet" /> : (
          <table className="tbl">
            <thead><tr><th>Agreement</th><th>Provider</th><th>Signers</th><th>Sent</th><th>Status</th></tr></thead>
            <tbody>{reqs.map((r) => {
              const c = title(r.contractId);
              return (
                <tr key={r.id}>
                  <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${r.contractId}?tab=signature`}>{c?.title}</Link><div className="text-[0.8rem] text-muted">{c?.number}</div></td>
                  <td className="text-[0.85rem]">{r.isMock ? <Pill tone="red">Mock (demo)</Pill> : r.provider}</td>
                  <td className="text-[0.85rem]">{signers.filter((s) => s.requestId === r.id).sort((a, b) => a.order - b.order).map((s) => `${s.name} (${s.status.toLowerCase()})`).join(", ")}</td>
                  <td className="whitespace-nowrap text-[0.85rem]">{formatDateTime(r.sentAt)}</td>
                  <td><Status value={r.status} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
