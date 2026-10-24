import Link from "next/link";
import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptionLicense } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { daysBetween, formatDate, todayIn } from "@/lib/dates";
import { formatMoney, toNumber } from "@/lib/money";
import { Empty, PageHeader, Panel, Pill, cx } from "@/components/ui";

export const metadata: Metadata = { title: "SaaS & licenses" };
export const dynamic = "force-dynamic";

export default async function Saas() {
  const actor = await requireActor();
  const today = todayIn();
  const contracts = (await listContracts(actor, { status: "ACTIVE", limit: 2000 }));
  const subs = contracts.length ? await db.select().from(subscriptionLicense).where(inArray(subscriptionLicense.contractId, contracts.map((c) => c.id))) : [];
  const rows = subs.map((s) => {
    const c = contracts.find((x) => x.id === s.contractId)!;
    const annual = toNumber(s.unitCost) * s.licensedQty;
    const util = s.assignedQty != null && s.licensedQty ? s.assignedQty / s.licensedQty : null;
    const unused = s.assignedQty != null ? Math.max(0, s.licensedQty - s.assignedQty) : 0;
    return { s, c, annual, util, unusedCost: unused * toNumber(s.unitCost), unused };
  }).sort((a, b) => b.annual - a.annual);
  const total = rows.reduce((a, r) => a + r.annual, 0);
  const waste = rows.reduce((a, r) => a + r.unusedCost, 0);
  const renewing = rows.filter((r) => r.c.expirationDate && daysBetween(today, r.c.expirationDate) <= 180);
  return (
    <>
      <PageHeader title="SaaS & licenses" lede="Subscriptions under active contracts, what they cost each year, and how many licenses are actually assigned." />
      <p className="mb-5 max-w-3xl text-[0.95rem]">
        <strong>{formatMoney(total)}</strong> a year across {rows.length} subscriptions. About <strong className="text-amber">{formatMoney(waste)}</strong> of that pays for licenses that are not assigned to anyone, and {renewing.length} subscription{renewing.length === 1 ? "" : "s"} renew in the next 180 days — the moment to right-size.
      </p>
      <Panel flush>
        {rows.length === 0 ? <Empty title="No subscriptions recorded in your scope" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Contract</th><th className="num">Licensed</th><th>Assigned</th><th className="num">Annual cost</th><th className="num">Unassigned cost</th><th>Renews</th></tr></thead>
              <tbody>
                {rows.map(({ s, c, annual, util, unusedCost, unused }) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.product}<div className="text-[0.8rem] font-normal text-muted">{s.plan} · {c.vendorName}</div></td>
                    <td className="text-[0.85rem]"><Link href={`/contracts/${c.id}`} className="hover:text-teal hover:underline">{c.number}</Link><div className="text-[0.8rem] text-muted">{c.deptName}</div></td>
                    <td className="num">{s.licensedQty.toLocaleString()}</td>
                    <td className="min-w-40">
                      {util == null ? <span className="text-muted">Not reported</span> : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-24 rounded-sm bg-rule-soft" aria-hidden><span className={cx("block h-full rounded-sm", util < 0.7 ? "bg-amber" : "bg-teal")} style={{ width: `${Math.min(100, util * 100)}%` }} /></span>
                            <span className="tabular-nums">{Math.round(util * 100)}%</span>
                          </div>
                          <div className="text-[0.75rem] text-muted">{s.assignedQty?.toLocaleString()} assigned{unused ? ` · ${unused.toLocaleString()} unused` : ""} · {s.usageSource}{s.usageAsOf ? `, ${formatDate(s.usageAsOf)}` : ""}</div>
                        </>
                      )}
                    </td>
                    <td className="num">{formatMoney(annual)}</td>
                    <td className="num">{unusedCost > 0 ? <span className={unusedCost > 10000 ? "font-semibold text-amber" : ""}>{formatMoney(unusedCost)}</span> : "—"}</td>
                    <td className="whitespace-nowrap text-[0.85rem]">{formatDate(c.expirationDate)}{c.autoRenew && <div><Pill tone="amber">Auto-renews</Pill></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-[0.8rem] text-muted">Usage is entered manually today; the schema supports later feeds from vendor admin APIs. Annual cost is licensed quantity × unit cost.</p>
    </>
  );
}
