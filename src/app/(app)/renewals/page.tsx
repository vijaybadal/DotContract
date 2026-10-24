import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { listRenewals } from "@/lib/renewals";
import { canRunJobs, getOrgIndex } from "@/lib/authz";
import { daysBetween, formatDate, todayIn } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, Pill, Status, cx } from "@/components/ui";
import { RunJobsButton } from "@/components/client/admin-panels";

export const metadata: Metadata = { title: "Renewals" };
export const dynamic = "force-dynamic";

export default async function Renewals() {
  const actor = await requireActor();
  const today = todayIn();
  const visible = await listContracts(actor, { status: "ACTIVE", limit: 2000 });
  const all = await listRenewals(visible.map((c) => c.id));
  const current = all.filter((r) => r.contract.status === "ACTIVE" && r.cycleExpiration === r.contract.expirationDate);
  const months = new Map<string, typeof current>();
  for (const r of current) {
    const key = (r.noticeDeadline ?? r.cycleExpiration).slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), r]);
  }
  const keys = [...months.keys()].sort();
  const monthName = (k: string) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <PageHeader
        title="Renewals"
        lede="Active contracts by the month their renewal or cancellation decision is due. Reminders go out 180, 120, 90, 60 and 30 days ahead."
        actions={canRunJobs(actor, await getOrgIndex()) ? <RunJobsButton /> : undefined}
      />
      {keys.length === 0 && <Panel><Empty title="No active contracts with an end date in your scope" /></Panel>}
      <div className="space-y-6">
        {keys.map((k) => (
          <section key={k}>
            <h2 className="mb-2 flex items-baseline gap-3 font-semibold">{monthName(k)} <span className="text-sm font-normal text-muted">{months.get(k)!.length} decision{months.get(k)!.length > 1 ? "s" : ""}</span></h2>
            <Panel flush>
              <table className="tbl">
                <thead><tr><th>Contract</th><th>Decide by</th><th>Term ends</th><th>If no action</th><th className="num">Annual value</th><th>Decision</th></tr></thead>
                <tbody>
                  {months.get(k)!.sort((a, b) => ((a.noticeDeadline ?? a.cycleExpiration) < (b.noticeDeadline ?? b.cycleExpiration) ? -1 : 1)).map((r) => {
                    const target = r.noticeDeadline ?? r.cycleExpiration;
                    const left = daysBetween(today, target);
                    return (
                      <tr key={r.id}>
                        <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${r.contractId}?tab=renewals`}>{r.contract.title}</Link><div className="text-[0.8rem] text-muted">{r.contract.vendor?.name} · owner {r.owner.name}</div></td>
                        <td className="whitespace-nowrap"><span className={cx("font-semibold", left < 0 ? "text-red" : left <= 30 ? "text-amber" : "")}>{formatDate(target)}</span><div className="text-[0.8rem] text-muted">{left < 0 ? `${-left} days ago` : `in ${left} days`}</div></td>
                        <td className="whitespace-nowrap text-[0.85rem]">{formatDate(r.cycleExpiration)}</td>
                        <td>{r.contract.autoRenew ? <Pill tone="amber">Auto-renews</Pill> : <Pill>Expires</Pill>}</td>
                        <td className="num"><Money value={r.contract.annualValue ?? r.contract.totalValue} /></td>
                        <td><Status value={r.decision === "PENDING" ? "OPEN" : r.decision} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          </section>
        ))}
      </div>
    </>
  );
}
