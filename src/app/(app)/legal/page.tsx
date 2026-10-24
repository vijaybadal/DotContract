import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clauseTemplate, legalIssue } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { listEligibleTasks, dueLabel } from "@/lib/workflow";
import { Empty, Money, PageHeader, Panel, Pill, Status } from "@/components/ui";

export const metadata: Metadata = { title: "Legal review" };
export const dynamic = "force-dynamic";

export default async function Legal() {
  const actor = await requireActor();
  const mine = (await listEligibleTasks(actor)).filter((t) => t.task.kind === "LEGAL_REVIEW");
  const inLegal = await listContracts(actor, { status: "IN_LEGAL" });
  const ids = inLegal.map((c) => c.id);
  const issues = ids.length ? await db.select().from(legalIssue).where(and(inArray(legalIssue.contractId, ids), eq(legalIssue.status, "OPEN"))) : [];
  const clauses = await db.select().from(clauseTemplate);
  return (
    <>
      <PageHeader title="Legal review" lede="Agreements with your legal office, their open issues, and the clause library." />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel title={`Assigned to your office (${mine.length})`} flush>
            {mine.length === 0 ? <Empty title="No agreements are waiting on your office" /> : (
              <table className="tbl">
                <thead><tr><th>Agreement</th><th>Status</th><th className="num">Value</th><th>Due</th></tr></thead>
                <tbody>
                  {mine.map(({ task, contract: c }) => (
                    <tr key={task.id}>
                      <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${c.id}?tab=legal`}>{c.title}</Link><div className="text-[0.8rem] text-muted">{c.number}</div></td>
                      <td><Status value={c.legalStatus} /></td>
                      <td className="num"><Money value={c.totalValue} /></td>
                      <td className="whitespace-nowrap text-[0.85rem]">{dueLabel(task.dueAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="All agreements in legal review" flush>
            {inLegal.length === 0 ? <Empty title="Nothing is in legal review" /> : (
              <table className="tbl">
                <thead><tr><th>Agreement</th><th>Legal status</th><th className="num">Open issues</th></tr></thead>
                <tbody>
                  {inLegal.map((c) => (
                    <tr key={c.id}>
                      <td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${c.id}?tab=legal`}>{c.title}</Link><div className="text-[0.8rem] text-muted">{c.number} · {c.entityName}</div></td>
                      <td><Status value={c.legalStatus} /></td>
                      <td className="num">{issues.filter((i) => i.contractId === c.id).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <Panel title="Clause library" flush>
          <ul className="divide-y divide-rule-soft">
            {clauses.map((cl) => (
              <li key={cl.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2"><p className="font-semibold">{cl.title}</p>{cl.isStandard ? <Pill tone="green">Standard</Pill> : <Pill tone="amber">Watch for</Pill>}</div>
                <p className="mt-1 text-ink-soft">{cl.body}</p>
                {cl.guidance && <p className="mt-1 text-[0.8rem] text-muted">{cl.guidance}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
