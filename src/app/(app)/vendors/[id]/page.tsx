import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vendor, vendorContact } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { formatDate } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { DateText, Empty, KV, Money, PageHeader, Panel, Status } from "@/components/ui";
import { LifecycleRail } from "@/components/lifecycle-rail";

export const metadata: Metadata = { title: "Vendor" };
export const dynamic = "force-dynamic";

const SEC: Record<string, string> = { NOT_REVIEWED: "Not reviewed", IN_REVIEW: "In review", APPROVED: "Approved", APPROVED_WITH_CONDITIONS: "Approved with conditions", NOT_APPROVED: "Not approved" };

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const [v] = await db.select().from(vendor).where(eq(vendor.id, id));
  if (!v) notFound();
  const contacts = await db.select().from(vendorContact).where(eq(vendorContact.vendorId, id));
  const contracts = await listContracts(actor, { vendorId: id, status: undefined, limit: 500 });
  const active = contracts.filter((c) => c.status === "ACTIVE");
  return (
    <>
      <PageHeader crumbs={[{ href: "/vendors", label: "Vendors" }]} title={v.name} lede={v.productsServices ?? undefined} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <Panel title="Profile">
            <KV items={[
              ["ERP supplier ID", v.erpSupplierId ?? "Not linked"],
              ["Classification", v.classification],
              ["Security review", `${SEC[v.securityReviewStatus]}${v.securityReviewedOn ? ` (${formatDate(v.securityReviewedOn)})` : ""}`],
              ["Insurance certificate expires", <DateText key="i" value={v.insuranceExpiresOn} />],
              ["Website", v.website],
              ["Address", v.address],
              ["Active agreements (your scope)", String(active.length)],
              ["Commitments (your scope)", <Money key="m" value={active.reduce((a, c) => a + toNumber(c.totalValue), 0)} />],
            ]} />
            {v.notes && <p className="mt-3 text-sm text-muted">{v.notes}</p>}
          </Panel>
          <Panel title="Contacts" flush>
            <ul className="divide-y divide-rule-soft">
              {contacts.map((c) => (
                <li key={c.id} className="px-4 py-2.5 text-sm"><span className="font-semibold">{c.name}</span> · {c.role}{c.isSigner && " (authorized signer)"}<div className="text-muted">{c.email}</div></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Performance">
            <p className="text-sm text-muted">SLA results and service reviews are tracked as contract obligations today. A vendor scorecard is on the Phase 3 backlog.</p>
          </Panel>
        </div>
        <Panel title="Agreements" flush>
          {contracts.length === 0 ? <Empty title="No agreements with this vendor in your scope" /> : (
            <table className="tbl">
              <thead><tr><th>Agreement</th><th>Stage</th><th className="num">Value</th><th>Expires</th></tr></thead>
              <tbody>{contracts.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${c.id}`}>{c.title}</Link><div className="text-[0.8rem] text-muted">{c.number} · {c.typeName} · {c.entityName}</div></td>
                  <td><div className="flex items-center gap-2"><LifecycleRail c={c} compact />{c.status !== "ACTIVE" && <Status value={c.status} />}</div></td>
                  <td className="num"><Money value={c.totalValue} /></td>
                  <td className="whitespace-nowrap text-[0.85rem]"><DateText value={c.expirationDate} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
