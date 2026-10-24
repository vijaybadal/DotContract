import Link from "next/link";
import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { contractAgency, financialCommitment } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { getOrgIndex } from "@/lib/authz";
import { allocate, formatMoney, toNumber } from "@/lib/money";
import { Bars } from "@/components/bars";
import { Money, PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Financials" };
export const dynamic = "force-dynamic";

export default async function Financials() {
  const actor = await requireActor();
  const idx = await getOrgIndex();
  const active = await listContracts(actor, { status: "ACTIVE", limit: 2000 });
  const ids = active.map((c) => c.id);
  const [commit, agencies] = ids.length
    ? await Promise.all([db.select().from(financialCommitment).where(inArray(financialCommitment.contractId, ids)), db.select().from(contractAgency).where(inArray(contractAgency.contractId, ids))])
    : [[], []];

  // Who pays: financial allocations when recorded, otherwise the contracting entity pays 100%.
  const payer = new Map<string, number>();
  const shared: { c: (typeof active)[number]; parts: { org: string; amount: number; pct: number }[] }[] = [];
  for (const c of active) {
    const annual = toNumber(c.annualValue ?? c.totalValue);
    const fin = agencies.filter((a) => a.contractId === c.id && a.role === "FINANCIAL");
    if (fin.length) {
      const amounts = allocate(annual, fin.map((f) => Number(f.allocationPct ?? 0)));
      const parts = fin.map((f, i) => ({ org: idx.path(f.orgId), amount: amounts[i], pct: Number(f.allocationPct) }));
      parts.forEach((p) => payer.set(p.org, (payer.get(p.org) ?? 0) + p.amount));
      if (fin.length > 1) shared.push({ c, parts });
    } else payer.set(c.entityName, (payer.get(c.entityName) ?? 0) + annual);
  }
  const fy = new Map<number, { recurring: number; oneTime: number }>();
  for (const f of commit) {
    if (!f.fiscalYear) continue;
    const e = fy.get(f.fiscalYear) ?? { recurring: 0, oneTime: 0 };
    if (f.kind === "RECURRING") e.recurring += toNumber(f.amount); else e.oneTime += toNumber(f.amount);
    fy.set(f.fiscalYear, e);
  }
  return (
    <>
      <PageHeader title="Financials" lede="Contractual commitments by who pays and when. These are commitments, not expenditures: purchase orders, invoices and payments stay in the ERP." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Annual commitments by paying agency"><Bars rows={[...payer.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} /></Panel>
        <Panel title="Commitments by fiscal year" flush>
          <table className="tbl">
            <thead><tr><th>Fiscal year</th><th className="num">Recurring</th><th className="num">One-time / rate card</th><th className="num">Total</th></tr></thead>
            <tbody>{[...fy.entries()].sort((a, b) => a[0] - b[0]).map(([y, e]) => (
              <tr key={y}><td>FY{y}</td><td className="num">{formatMoney(e.recurring)}</td><td className="num">{formatMoney(e.oneTime)}</td><td className="num font-semibold">{formatMoney(e.recurring + e.oneTime)}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Shared contracts and their cost split" className="mt-5" flush>
        <table className="tbl">
          <thead><tr><th>Contract</th><th className="num">Annual value</th><th>Allocation</th></tr></thead>
          <tbody>{shared.map(({ c, parts }) => (
            <tr key={c.id}>
              <td><Link href={`/contracts/${c.id}?tab=financials`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link><div className="text-[0.8rem] text-muted">{c.number} · administered by {c.adminName}</div></td>
              <td className="num"><Money value={c.annualValue ?? c.totalValue} /></td>
              <td className="text-[0.85rem]">{parts.map((p) => `${p.org} ${p.pct}% (${formatMoney(p.amount)})`).join(" · ")}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      <p className="mt-3 text-[0.8rem] text-muted">ERP integration point: purchase orders, invoices and payments will be read from the ERP adapter (see docs/INTEGRATIONS.md) once the Oracle EBS replacement is selected.</p>
    </>
  );
}
