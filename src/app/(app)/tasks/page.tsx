import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { actionItem, user } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listEligibleTasks, dueLabel } from "@/lib/workflow";
import { getOrgIndex } from "@/lib/authz";
import { DateText, Empty, Money, PageHeader, Panel, Pill, cx } from "@/components/ui";
import { TaskDecisionForm } from "@/components/client/contract-panels";

export const metadata: Metadata = { title: "My tasks & approvals" };
export const dynamic = "force-dynamic";

export default async function Tasks() {
  const actor = await requireActor();
  const idx = await getOrgIndex();
  const tasks = await listEligibleTasks(actor);
  const items = await db.select().from(actionItem).where(and(eq(actionItem.assigneeId, actor.id), eq(actionItem.status, "OPEN")));
  const behalfIds = tasks.map((t) => t.onBehalfOfUserId).filter(Boolean) as string[];
  const behalf = behalfIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, behalfIds)) : [];
  const approvals = tasks.filter((t) => t.task.kind === "APPROVAL");
  const legal = tasks.filter((t) => t.task.kind === "LEGAL_REVIEW");

  return (
    <>
      <PageHeader title="My tasks & approvals" lede="Decisions assigned to your roles, including any you hold under an approval delegation." />
      {tasks.length === 0 && items.length === 0 && <Panel><Empty title="Nothing needs your decision">When a request reaches a step your role covers, it appears here and you are notified.</Empty></Panel>}

      {approvals.length > 0 && <h2 className="mb-3 text-lg font-semibold">Approvals ({approvals.length})</h2>}
      <div className="space-y-4">
        {approvals.map(({ task, contract: c, request, onBehalfOfUserId }) => {
          const overdue = task.dueAt && task.dueAt < new Date();
          return (
            <article key={task.id} id={task.id} className={cx("rounded-md border bg-panel", overdue ? "border-red/40" : "border-rule")}>
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_24rem]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="teal">{task.name}</Pill>
                    <span className={cx("text-[0.8rem] font-semibold", overdue ? "text-red" : "text-muted")}>{dueLabel(task.dueAt)}</span>
                    {onBehalfOfUserId && <Pill tone="amber">On behalf of {behalf.find((b) => b.id === onBehalfOfUserId)?.name}</Pill>}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold"><Link href={`/contracts/${c.id}`} className="hover:text-teal hover:underline">{c.title}</Link></h3>
                  <p className="text-sm text-muted">{c.number} · {request.number} · {idx.path(c.requestingDeptId)}</p>
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted">Total value</dt><dd className="font-semibold"><Money value={c.totalValue} /></dd></div>
                    <div><dt className="text-muted">Term</dt><dd><DateText value={c.effectiveDate} /> – <DateText value={c.expirationDate} /></dd></div>
                    <div><dt className="text-muted">Contracting entity</dt><dd>{idx.name(c.contractingEntityId)}</dd></div>
                  </dl>
                  {c.businessPurpose && <p className="mt-3 max-w-prose text-sm">{c.businessPurpose}</p>}
                  <p className="mt-3 text-sm"><Link href={`/contracts/${c.id}?tab=documents`} className="font-semibold text-teal hover:underline">Review documents</Link> · <Link href={`/contracts/${c.id}?tab=workflow`} className="font-semibold text-teal hover:underline">See other approvals</Link></p>
                </div>
                <div className="border-t border-rule pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"><TaskDecisionForm taskId={task.id} compact /></div>
              </div>
            </article>
          );
        })}
      </div>

      {legal.length > 0 && (
        <Panel title={`Legal reviews (${legal.length})`} className="mt-6" flush>
          <ul className="divide-y divide-rule-soft">
            {legal.map(({ task, contract: c }) => (
              <li key={task.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span><Link href={`/contracts/${c.id}?tab=legal`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link> <span className="text-muted">· {c.number}</span></span>
                <span className="text-muted">{dueLabel(task.dueAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {items.length > 0 && (
        <Panel title="Follow-ups" className="mt-6" flush>
          <ul className="divide-y divide-rule-soft">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{i.contractId ? <Link href={`/contracts/${i.contractId}?tab=renewals`} className="font-semibold hover:text-teal hover:underline">{i.title}</Link> : i.title}</span>
                <span className="whitespace-nowrap text-muted">Due <DateText value={i.dueDate} /></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
