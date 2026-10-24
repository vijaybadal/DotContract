import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { dashboardData } from "@/lib/dashboard";
import { listEligibleTasks, dueLabel } from "@/lib/workflow";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Bars } from "@/components/bars";
import { DateText, Empty, Money, PageHeader, Panel, Pill, Status, cx } from "@/components/ui";
import { LifecycleRail } from "@/components/lifecycle-rail";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const actor = await requireActor();
  const [d, tasks] = await Promise.all([dashboardData(actor), listEligibleTasks(actor)]);
  const first = actor.name.split(" ")[0];
  const urgent = d.deadlines.filter((c) => daysBetween(d.today, c.deadline!) <= 30);

  const windows = [
    { label: "30 days", rows: d.expiring.d30, href: "/contracts?expiring=30" },
    { label: "60 days", rows: d.expiring.d60, href: "/contracts?expiring=60" },
    { label: "90 days", rows: d.expiring.d90, href: "/contracts?expiring=90" },
    { label: "180 days", rows: d.expiring.d180, href: "/contracts?expiring=180" },
  ];

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${first}`}
        lede={
          <>
            {tasks.length ? `${tasks.length} item${tasks.length > 1 ? "s" : ""} waiting on you` : "Nothing is waiting on you"}
            {urgent.length ? `, and ${urgent.length} renewal decision${urgent.length > 1 ? "s" : ""} due within 30 days.` : "."}
          </>
        }
        actions={<Link href="/requests/new" className="rounded-md bg-teal px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-ink">New contract request</Link>}
      />

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Renewal and cancellation decisions due" actions={<Link href="/renewals" className="text-sm font-semibold text-teal hover:underline">All renewals</Link>} flush>
          {d.deadlines.length === 0 ? (
            <Empty title="No notice deadlines in the next 120 days" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Contract</th><th>Decide by</th><th className="num">Annual value</th><th>If no action</th></tr>
              </thead>
              <tbody>
                {d.deadlines.slice(0, 8).map((c) => {
                  const left = daysBetween(d.today, c.deadline!);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/contracts/${c.id}?tab=renewals`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link>
                        <div className="text-[0.8rem] text-muted">{c.vendorName} · {c.number}</div>
                      </td>
                      <td>
                        <span className={cx("font-semibold", left < 0 ? "text-red" : left <= 30 ? "text-amber" : "")}>
                          {left < 0 ? `${-left} days ago` : left === 0 ? "Today" : `${left} days`}
                        </span>
                        <div className="whitespace-nowrap text-[0.8rem] text-muted">{formatDate(c.deadline)}</div>
                      </td>
                      <td className="num"><Money value={c.annualValue ?? c.totalValue} /></td>
                      <td>{c.autoRenew ? <Pill tone="amber">Auto-renews</Pill> : <Pill>Expires {formatDate(c.expirationDate)}</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Waiting on you" actions={<Link href="/tasks" className="text-sm font-semibold text-teal hover:underline">My tasks</Link>} flush>
          {tasks.length === 0 ? (
            <Empty title="You're caught up">Approvals and legal reviews assigned to your roles will appear here.</Empty>
          ) : (
            <ul className="divide-y divide-rule-soft">
              {tasks.slice(0, 7).map(({ task, contract }) => (
                <li key={task.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={task.kind === "LEGAL_REVIEW" ? `/contracts/${contract.id}?tab=legal` : `/tasks#${task.id}`} className="font-semibold hover:text-teal hover:underline">
                      {contract.title}
                    </Link>
                    <div className="text-[0.8rem] text-muted">{task.name} · <Money value={contract.totalValue} /></div>
                  </div>
                  <span className={cx("shrink-0 text-[0.8rem] font-semibold", task.dueAt && task.dueAt < new Date() ? "text-red" : "text-muted")}>{dueLabel(task.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section aria-labelledby="portfolio" className="mt-8">
        <h2 id="portfolio" className="mb-3 text-lg font-semibold">Portfolio in your scope</h2>
        <div className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Active contracts", String(d.totals.active), `${d.totals.onBehalf} administered by DOTComm for another agency`, "/contracts?status=ACTIVE"],
            ["Annual commitments", formatMoney(d.totals.annualValue, { compact: true }), `${formatMoney(d.totals.totalValue, { compact: true })} total contract value`, "/financials"],
            ["SaaS subscriptions", formatMoney(d.totals.saasAnnual, { compact: true }), `${d.totals.saasCount} subscriptions · ${formatMoney(d.licenses.unusedCost, { compact: true })} in unassigned licenses`, "/saas"],
            ["In the approval pipeline", String(d.totals.inReview + d.totals.inLegal + d.totals.awaitingSignature), `${d.totals.inReview} in review · ${d.totals.inLegal} in Legal · ${d.totals.awaitingSignature} awaiting signature`, "/contracts?status=OPEN_REQUESTS"],
          ].map(([k, v, sub, href]) => (
            <Link key={k} href={href} className="bg-panel px-4 py-3.5 hover:bg-[#f8f9f7]">
              <span className="block text-sm text-muted">{k}</span>
              <span className="mt-0.5 block text-2xl font-semibold tabular-nums">{v}</span>
              <span className="mt-0.5 block text-[0.8rem] text-muted">{sub}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Expiring active contracts">
          <ol className="grid grid-cols-4 gap-2">
            {windows.map((w) => (
              <li key={w.label}>
                <Link href={w.href} className="block rounded border border-rule px-3 py-2 hover:border-teal">
                  <span className="block text-2xl font-semibold tabular-nums">{w.rows.length}</span>
                  <span className="block text-[0.8rem] text-muted">within {w.label}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[0.8rem] text-muted">{d.totals.autoRenewing} active contracts renew automatically unless notice is given.</p>
        </Panel>

        <Panel title="Where approvals are waiting">
          {d.bottlenecks.length === 0 ? (
            <p className="text-sm text-muted">No pending approval steps in your scope.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Step</th><th className="num">Waiting</th><th className="num">Oldest</th><th className="num">Overdue</th></tr></thead>
              <tbody>
                {d.bottlenecks.map((b) => (
                  <tr key={b.step}>
                    <td>{b.step}</td>
                    <td className="num">{b.count}</td>
                    <td className="num">{b.oldestDays} d</td>
                    <td className="num">{b.overdue ? <span className="font-semibold text-red">{b.overdue}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Annual commitments by agency">
          <Bars rows={d.byAgency} />
          <p className="mt-3 text-[0.8rem] text-muted">Shared contracts are split evenly across the agencies they serve. Commitments are not expenditures; actuals come from the ERP.</p>
        </Panel>
        <Panel title="Annual commitments by category">
          <Bars rows={d.byType} />
        </Panel>
        <Panel title="Largest vendors">
          <Bars rows={d.byVendor} />
        </Panel>
        <Panel title="Commitments by fiscal year">
          <Bars rows={d.commitmentsByYear.map((y) => ({ label: `FY${y.year}`, value: y.amount }))} />
          <p className="mt-3 text-[0.8rem] text-muted">Recurring and one-time commitments recorded on contracts (July–June fiscal year assumed).</p>
        </Panel>
      </div>

      <Panel title="In flight" className="mt-5" flush actions={<Link href="/contracts?status=OPEN_REQUESTS" className="text-sm font-semibold text-teal hover:underline">View all</Link>}>
        {d.inFlight.length === 0 ? (
          <Empty title="No contracts in the approval pipeline" />
        ) : (
          <table className="tbl">
            <thead><tr><th>Contract</th><th>Stage</th><th>Status</th><th>Requested by</th><th className="num">Value</th></tr></thead>
            <tbody>
              {d.inFlight.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contracts/${c.id}`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link>
                    <div className="text-[0.8rem] text-muted">{c.number} · {c.deptName}</div>
                  </td>
                  <td><LifecycleRail c={c} compact /></td>
                  <td><Status value={c.status} /></td>
                  <td className="text-[0.85rem]">{c.ownerName}</td>
                  <td className="num"><Money value={c.totalValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="mt-6 text-[0.8rem] text-muted">As of <DateText value={d.today} /> (America/Chicago).</p>
    </>
  );
}
