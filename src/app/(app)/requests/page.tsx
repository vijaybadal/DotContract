import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { listRequests } from "@/lib/contracts";
import { formatDateTime } from "@/lib/dates";
import { Empty, LinkButton, Money, PageHeader, Panel, Status, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Contract requests" };
export const dynamic = "force-dynamic";

export default async function Requests({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope = "mine" } = await searchParams;
  const actor = await requireActor();
  const rows = await listRequests(actor, scope === "all" ? "all" : "mine");
  return (
    <>
      <PageHeader title="Contract requests" lede="New contracts, amendments, renewals and other changes, from draft to approval." actions={<LinkButton href="/requests/new" variant="primary">New contract request</LinkButton>} />
      <div className="mb-3 flex gap-1 text-sm" role="tablist" aria-label="Which requests">
        {[["mine", "My requests"], ["all", "All requests I can see"]].map(([k, l]) => (
          <Link key={k} href={`/requests?scope=${k}`} role="tab" aria-selected={scope === k} className={cx("rounded px-3 py-1.5 font-semibold", scope === k ? "bg-ink text-white" : "text-muted hover:bg-panel")}>{l}</Link>
        ))}
      </div>
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={scope === "mine" ? "You haven't made any requests yet" : "No requests in your scope"} action={<LinkButton href="/requests/new" variant="primary">Start a request</LinkButton>}>
            Requests capture the vendor, cost, purpose and agencies involved, then route to the right approvers automatically.
          </Empty>
        ) : (
          <table className="tbl">
            <thead><tr><th>Request</th><th>Type</th><th>Requested by</th><th>Vendor</th><th className="num">Value</th><th>Updated</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ r, c, requesterName, typeName, vendorName }) => (
                <tr key={r.id}>
                  <td><Link href={`/requests/${r.id}`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link><div className="text-[0.8rem] text-muted">{r.number} · {typeName}</div></td>
                  <td className="text-[0.85rem]">{r.type.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="text-[0.85rem]">{requesterName}</td>
                  <td className="text-[0.85rem]">{vendorName ?? "—"}</td>
                  <td className="num"><Money value={c.totalValue} /></td>
                  <td className="whitespace-nowrap text-[0.85rem]">{formatDateTime(r.updatedAt)}</td>
                  <td><Status value={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
