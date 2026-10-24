/**
 * Dashboard and reporting metrics. Everything is computed from the contracts the actor can see,
 * so the same page respects agency scoping for every user.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  contractAgency,
  financialCommitment,
  obligation,
  subscriptionLicense,
  workflowInstance,
  workflowTask,
} from "@/db/schema";
import { getOrgIndex, type Actor } from "./authz";
import { listContracts } from "./contracts";
import { daysBetween, todayIn } from "./dates";
import { toNumber } from "./money";

export async function dashboardData(actor: Actor) {
  const idx = await getOrgIndex();
  const today = todayIn();
  const contracts = await listContracts(actor, { limit: 2000 });
  const ids = contracts.map((c) => c.id);
  const active = contracts.filter((c) => c.status === "ACTIVE");
  const activeIds = active.map((c) => c.id);

  const [subs, commitments, obligations, agencies, pendingTasks] = ids.length
    ? await Promise.all([
        db.select().from(subscriptionLicense).where(inArray(subscriptionLicense.contractId, activeIds.length ? activeIds : ["-"])),
        db.select().from(financialCommitment).where(inArray(financialCommitment.contractId, ids)),
        db.select().from(obligation).where(inArray(obligation.contractId, activeIds.length ? activeIds : ["-"])),
        db.select().from(contractAgency).where(and(inArray(contractAgency.contractId, ids), eq(contractAgency.role, "BENEFITING"))),
        db
          .select({ task: workflowTask, contractId: workflowInstance.contractId })
          .from(workflowTask)
          .innerJoin(workflowInstance, eq(workflowInstance.id, workflowTask.instanceId))
          .where(and(eq(workflowTask.status, "PENDING"), eq(workflowInstance.status, "RUNNING"), inArray(workflowInstance.contractId, ids))),
      ])
    : [[], [], [], [], []];

  const daysTo = (d: string | null) => (d ? daysBetween(today, d) : Infinity);
  const expiring = (n: number) => active.filter((c) => daysTo(c.expirationDate) >= 0 && daysTo(c.expirationDate) <= n);
  const noticeDate = (c: (typeof active)[number]) => {
    if (!c.expirationDate) return null;
    if (!c.noticeDays) return c.expirationDate;
    return new Date(Date.parse(`${c.expirationDate}T00:00:00Z`) - c.noticeDays * 86_400_000).toISOString().slice(0, 10);
  };
  const deadlines = active
    .map((c) => ({ ...c, deadline: noticeDate(c) }))
    .filter((c) => c.deadline && daysTo(c.deadline) <= 120)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1));

  const sum = (xs: { totalValue: string }[]) => xs.reduce((a, c) => a + toNumber(c.totalValue), 0);
  const annual = active.reduce((a, c) => a + toNumber(c.annualValue), 0);
  const saasActive = active.filter((c) => c.typeKey === "SAAS");
  const saasAnnual = saasActive.reduce((a, c) => a + toNumber(c.annualValue ?? c.totalValue), 0);

  const group = <K extends string>(rows: typeof active, key: (c: (typeof active)[number]) => K) => {
    const m = new Map<K, { label: K; count: number; value: number }>();
    for (const c of rows) {
      const k = key(c);
      const g = m.get(k) ?? { label: k, count: 0, value: 0 };
      g.count++;
      g.value += toNumber(c.annualValue ?? c.totalValue);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };

  // Agency view: credit each benefiting agency (or the contracting entity when none recorded)
  const byAgency = new Map<string, { label: string; count: number; value: number }>();
  for (const c of active) {
    const ben = agencies.filter((a) => a.contractId === c.id).map((a) => a.orgId);
    const targets = ben.length ? ben.map((o) => idx.legalEntityOf(o)?.name ?? idx.name(o)) : [c.entityName];
    for (const t of new Set(targets)) {
      const g = byAgency.get(t) ?? { label: t, count: 0, value: 0 };
      g.count++;
      g.value += toNumber(c.annualValue ?? c.totalValue) / new Set(targets).size;
      byAgency.set(t, g);
    }
  }

  const bottlenecks = new Map<string, { step: string; count: number; oldestDays: number; overdue: number }>();
  for (const { task } of pendingTasks) {
    const key = task.name.split(" — ")[0];
    const age = task.activatedAt ? Math.floor((Date.now() - task.activatedAt.getTime()) / 86_400_000) : 0;
    const b = bottlenecks.get(key) ?? { step: key, count: 0, oldestDays: 0, overdue: 0 };
    b.count++;
    b.oldestDays = Math.max(b.oldestDays, age);
    if (task.dueAt && task.dueAt < new Date()) b.overdue++;
    bottlenecks.set(key, b);
  }

  const byYear = new Map<number, number>();
  for (const f of commitments) if (f.fiscalYear) byYear.set(f.fiscalYear, (byYear.get(f.fiscalYear) ?? 0) + toNumber(f.amount));

  const licensed = subs.reduce((a, s) => a + s.licensedQty, 0);
  const assigned = subs.reduce((a, s) => a + (s.assignedQty ?? 0), 0);
  const unusedCost = subs.reduce((a, s) => a + Math.max(0, s.licensedQty - (s.assignedQty ?? s.licensedQty)) * toNumber(s.unitCost), 0);

  return {
    today,
    totals: {
      active: active.length,
      totalValue: sum(active),
      annualValue: annual,
      saasAnnual,
      saasCount: saasActive.length,
      pendingRequests: contracts.filter((c) => ["DRAFT"].includes(c.status)).length,
      inReview: contracts.filter((c) => c.status === "IN_REVIEW").length,
      inLegal: contracts.filter((c) => c.status === "IN_LEGAL").length,
      awaitingSignature: contracts.filter((c) => c.status === "PENDING_SIGNATURE").length,
      overdueObligations: obligations.filter((o) => o.status === "OVERDUE" || (o.status === "OPEN" && o.dueDate && o.dueDate < today)).length,
      onBehalf: active.filter((c) => c.administeredOnBehalf).length,
      autoRenewing: active.filter((c) => c.autoRenew).length,
    },
    expiring: { d30: expiring(30), d60: expiring(60), d90: expiring(90), d180: expiring(180) },
    deadlines,
    byAgency: [...byAgency.values()].sort((a, b) => b.value - a.value),
    byVendor: group(active, (c) => (c.vendorName ?? "—") as string).slice(0, 8),
    byType: group(active, (c) => c.typeName as string),
    bottlenecks: [...bottlenecks.values()].sort((a, b) => b.oldestDays - a.oldestDays),
    commitmentsByYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount })),
    licenses: { licensed, assigned, unusedCost },
    inFlight: contracts.filter((c) => ["IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE"].includes(c.status)),
  };
}
