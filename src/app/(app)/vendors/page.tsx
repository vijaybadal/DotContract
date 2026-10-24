import Link from "next/link";
import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { vendor } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { daysBetween, formatDate, todayIn } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { Money, PageHeader, Panel, Status } from "@/components/ui";

export const metadata: Metadata = { title: "Vendors" };
export const dynamic = "force-dynamic";

export default async function Vendors() {
  const actor = await requireActor();
  const today = todayIn();
  const [vendors, contracts] = await Promise.all([db.select().from(vendor).orderBy(asc(vendor.name)), listContracts(actor, { limit: 2000 })]);
  return (
    <>
      <PageHeader title="Vendors" lede="Suppliers, their active agreements in your scope, security review status and insurance dates. The ERP supplier master remains the system of record." />
      <Panel flush>
        <table className="tbl">
          <thead><tr><th>Vendor</th><th>ERP supplier ID</th><th className="num">Active agreements</th><th className="num">Commitments</th><th>Security review</th><th>Insurance expires</th></tr></thead>
          <tbody>
            {vendors.map((v) => {
              const mine = contracts.filter((c) => c.vendorId === v.id && c.status === "ACTIVE");
              const ins = v.insuranceExpiresOn ? daysBetween(today, v.insuranceExpiresOn) : null;
              return (
                <tr key={v.id}>
                  <td><Link href={`/vendors/${v.id}`} className="font-semibold hover:text-teal hover:underline">{v.name}</Link><div className="text-[0.8rem] text-muted">{v.productsServices}</div></td>
                  <td className="text-[0.85rem]">{v.erpSupplierId ?? "Not linked"}</td>
                  <td className="num">{mine.length}</td>
                  <td className="num"><Money value={mine.reduce((a, c) => a + toNumber(c.totalValue), 0)} /></td>
                  <td><Status value={v.securityReviewStatus === "APPROVED" ? "APPROVED" : v.securityReviewStatus === "APPROVED_WITH_CONDITIONS" ? "CHANGES_REQUESTED" : v.securityReviewStatus === "NOT_REVIEWED" ? "PENDING_REVIEW" : "IN_REVIEW"} /></td>
                  <td className="whitespace-nowrap text-[0.85rem]">{formatDate(v.insuranceExpiresOn)}{ins != null && ins <= 30 && <div className="font-semibold text-red">{ins < 0 ? "expired" : `in ${ins} days`}</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
