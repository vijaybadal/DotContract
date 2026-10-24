/**
 * Report definitions. Every report is computed from the contracts the requesting user can see.
 * Output is CSV (opens in Excel); cells are guarded against spreadsheet formula injection.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  contractAgency,
  obligation,
  subscriptionLicense,
  user,
  workflowInstance,
  workflowTask,
} from "@/db/schema";
import { getOrgIndex, hasRole, isPlatformWide, type Actor, type OrgIndex } from "./authz";
import { ForbiddenError } from "./errors";

export function canSeeAuditDetail(a: Actor, idx: OrgIndex) {
  return isPlatformWide(a, "AUDITOR", idx) || isPlatformWide(a, "SYSTEM_ADMIN", idx) || a.assignments.some((x) => x.roleKey === "CLM_ADMIN");
}
import { listContracts, type ContractFilters } from "./contracts";
import { daysBetween, todayIn } from "./dates";
import { allocate, toNumber } from "./money";

type Cell = string | number | boolean | null | undefined;
export type Table = { columns: string[]; rows: Cell[][] };

export function toCsv(t: Table): string {
  const esc = (v: Cell) => {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`; // formula-injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const days = (a: Date, b: Date | null | undefined) => (b ? Math.round(((b.getTime() - a.getTime()) / 86_400_000) * 10) / 10 : null);

export async function contractInventory(actor: Actor, f: ContractFilters = {}): Promise<Table> {
  const rows = await listContracts(actor, { ...f, limit: 2000 });
  return {
    columns: ["Number", "Title", "Category", "Vendor", "Status", "Approval", "Legal", "Signature", "Contracting entity", "Administering org", "Requesting dept", "Administered on behalf", "Owner", "Total value", "Annual value", "Effective", "Expires", "Auto-renew", "Notice days", "Demo execution"],
    rows: rows.map((c) => [c.number, c.title, c.typeName, c.vendorName, c.status, c.approvalStatus, c.legalStatus, c.signatureStatus, c.entityName, c.adminName, c.deptName, c.administeredOnBehalf ? "Yes" : "No", c.ownerName, toNumber(c.totalValue), c.annualValue ? toNumber(c.annualValue) : null, c.effectiveDate, c.expirationDate, c.autoRenew ? "Yes" : "No", c.noticeDays, c.executionIsDemo ? "Yes" : "No"]),
  };
}

/** Demo executions (mock e-signature) are not real commitments and stay out of financial totals. */
const real = <T extends { executionIsDemo: boolean }>(rows: T[]) => rows.filter((c) => !c.executionIsDemo);

export const REPORTS: { key: string; title: string; description: string; restricted?: boolean; build: (a: Actor) => Promise<Table> }[] = [
  { key: "inventory", title: "Contract inventory", description: "Every contract with parties, status, value and dates.", build: (a) => contractInventory(a) },
  {
    key: "expirations",
    title: "Expirations and renewal exposure (next 12 months)",
    description: "Active contracts ending within a year, with notice deadlines and what happens if no one acts.",
    build: async (a) => {
      const today = todayIn();
      const rows = real(await listContracts(a, { status: "ACTIVE", expiringDays: 365, limit: 2000 })).map((c) => {
        const notice = c.noticeDays && c.expirationDate ? new Date(Date.parse(`${c.expirationDate}T00:00:00Z`) - c.noticeDays * 86_400_000).toISOString().slice(0, 10) : c.expirationDate;
        return [c.number, c.title, c.vendorName, c.entityName, c.ownerName, c.expirationDate, notice, notice ? daysBetween(today, notice) : null, c.autoRenew ? "Auto-renews" : "Expires", toNumber(c.annualValue ?? c.totalValue)];
      });
      return { columns: ["Number", "Title", "Vendor", "Contracting entity", "Owner", "Expires", "Decision due", "Days to decision", "If no action", "Annual value at risk"], rows };
    },
  },
  {
    key: "vendor-spend",
    title: "Commitments by vendor",
    description: "Active contract commitments grouped by vendor.",
    build: async (a) => {
      const m = new Map<string, { n: number; total: number; annual: number }>();
      for (const c of real(await listContracts(a, { status: "ACTIVE", limit: 2000 }))) {
        const k = c.vendorName ?? "(none)";
        const e = m.get(k) ?? { n: 0, total: 0, annual: 0 };
        e.n++;
        e.total += toNumber(c.totalValue);
        e.annual += toNumber(c.annualValue);
        m.set(k, e);
      }
      return { columns: ["Vendor", "Active contracts", "Total commitments", "Annual commitments"], rows: [...m.entries()].sort((x, y) => y[1].total - x[1].total).map(([k, e]) => [k, e.n, e.total, e.annual]) };
    },
  },
  {
    key: "agency-allocation",
    title: "Agency cost allocation",
    description: "Annual commitments split by paying agency, including shared contracts.",
    build: async (a) => {
      const idx = await getOrgIndex();
      const active = real(await listContracts(a, { status: "ACTIVE", limit: 2000 }));
      const fin = active.length ? await db.select().from(contractAgency).where(and(inArray(contractAgency.contractId, active.map((c) => c.id)), eq(contractAgency.role, "FINANCIAL"))) : [];
      const rows: Cell[][] = [];
      for (const c of active) {
        const annual = toNumber(c.annualValue ?? c.totalValue);
        const parts = fin.filter((f) => f.contractId === c.id);
        if (!parts.length) rows.push([c.number, c.title, c.entityName, 100, annual]);
        else {
          const amts = allocate(annual, parts.map((p) => Number(p.allocationPct ?? 0)));
          parts.forEach((p, i) => rows.push([c.number, c.title, idx.path(p.orgId), Number(p.allocationPct), amts[i]]));
        }
      }
      return { columns: ["Number", "Title", "Paying agency", "Share %", "Annual amount"], rows };
    },
  },
  {
    key: "pending-approvals",
    title: "Pending approvals",
    description: "Every open approval and legal step, how long it has waited and whether it is overdue.",
    build: async (a) => {
      const visible = await listContracts(a, { limit: 2000 });
      const ids = visible.map((c) => c.id);
      const tasks = ids.length
        ? await db
            .select({ t: workflowTask, contractId: workflowInstance.contractId })
            .from(workflowTask)
            .innerJoin(workflowInstance, eq(workflowInstance.id, workflowTask.instanceId))
            .where(and(eq(workflowTask.status, "PENDING"), inArray(workflowInstance.contractId, ids)))
        : [];
      const now = new Date();
      return {
        columns: ["Contract", "Title", "Step", "Role", "Waiting (days)", "Due", "Overdue"],
        rows: tasks.map(({ t, contractId }) => {
          const c = visible.find((x) => x.id === contractId)!;
          return [c.number, c.title, t.name, t.roleKey, t.activatedAt ? days(t.activatedAt, now) : null, t.dueAt?.toISOString().slice(0, 10), t.dueAt && t.dueAt < now ? "Yes" : "No"];
        }),
      };
    },
  },
  {
    key: "cycle-times",
    title: "Approval, legal and execution cycle times",
    description: "Days from submission to Legal clearance, approval and execution for contracts processed in the CLM.",
    build: async (a) => {
      const visible = await listContracts(a, { limit: 2000 });
      const ids = visible.map((c) => c.id);
      const events = ids.length ? await db.select().from(auditLog).where(inArray(auditLog.contractId, ids)).orderBy(asc(auditLog.id)) : [];
      const rows: Cell[][] = [];
      for (const c of visible) {
        const ev = events.filter((e) => e.contractId === c.id);
        const at = (action: string) => ev.find((e) => e.action === action)?.at;
        const start = at("WORKFLOW_STARTED");
        if (!start) continue;
        const legalStart = ev.find((e) => e.action === "LEGAL_REVIEW_STARTED")?.at;
        const cleared = [...ev].reverse().find((e) => e.action === "LEGAL_CLEARED")?.at;
        const approved = [...ev].reverse().find((e) => e.action === "WORKFLOW_COMPLETED")?.at;
        const executed = ev.find((e) => ["CONTRACT_EXECUTED", "CONTRACT_DEMO_EXECUTED", "CONTRACT_EXECUTED_EXTERNALLY"].includes(e.action))?.at;
        rows.push([c.number, c.title, start.toISOString().slice(0, 10), legalStart && cleared ? days(legalStart, cleared) : null, days(start, approved), days(start, executed), c.status]);
      }
      return { columns: ["Number", "Title", "Submitted", "Legal review days", "Submission to approval (days)", "Submission to execution (days)", "Current status"], rows };
    },
  },
  {
    key: "saas",
    title: "SaaS subscriptions and license utilization",
    description: "Licensed vs. assigned seats, annual cost and the cost of unassigned licenses.",
    build: async (a) => {
      const active = real(await listContracts(a, { status: "ACTIVE", limit: 2000 }));
      const subs = active.length ? await db.select().from(subscriptionLicense).where(inArray(subscriptionLicense.contractId, active.map((c) => c.id))) : [];
      return {
        columns: ["Contract", "Vendor", "Product", "Plan", "Licensed", "Assigned", "Utilization %", "Unit cost", "Annual cost", "Unassigned cost", "Renews"],
        rows: subs.map((s) => {
          const c = active.find((x) => x.id === s.contractId)!;
          const unit = toNumber(s.unitCost);
          return [c.number, c.vendorName, s.product, s.plan, s.licensedQty, s.assignedQty, s.assignedQty != null ? Math.round((s.assignedQty / s.licensedQty) * 100) : null, unit, unit * s.licensedQty, s.assignedQty != null ? Math.max(0, s.licensedQty - s.assignedQty) * unit : null, c.expirationDate];
        }),
      };
    },
  },
  {
    key: "obligations",
    title: "Contractual obligations",
    description: "Open, overdue and met obligations with owners and due dates.",
    build: async (a) => {
      const active = await listContracts(a, { status: "ACTIVE", limit: 2000 });
      const rows = active.length ? await db.select({ o: obligation, owner: user.name }).from(obligation).innerJoin(user, eq(user.id, obligation.ownerId)).where(inArray(obligation.contractId, active.map((c) => c.id))) : [];
      const today = todayIn();
      return {
        columns: ["Contract", "Obligation", "Category", "Owner", "Due", "Status"],
        rows: rows.map(({ o, owner }) => [active.find((c) => c.id === o.contractId)!.number, o.title, o.category, owner, o.dueDate, o.status === "OPEN" && o.dueDate && o.dueDate < today ? "OVERDUE" : o.status]),
      };
    },
  },
  {
    key: "change-history",
    title: "Contract change history",
    description: "Every recorded event — submissions, decisions, document versions, signatures — from the audit log. Administrators and auditors only.",
    restricted: true,
    build: async (a) => {
      const idx = await getOrgIndex();
      if (!canSeeAuditDetail(a, idx)) throw new ForbiddenError("The change history report is limited to contract administrators and auditors.");
      const visible = (await listContracts(a, { limit: 2000 })).filter((c) => isPlatformWide(a, "AUDITOR", idx) || isPlatformWide(a, "SYSTEM_ADMIN", idx) || hasRole(a, "CLM_ADMIN", idx, c.administeringOrgId));
      const ids = visible.map((c) => c.id);
      const users = await db.select({ id: user.id, name: user.name }).from(user);
      const ev = ids.length ? await db.select().from(auditLog).where(inArray(auditLog.contractId, ids)).orderBy(asc(auditLog.id)) : [];
      return {
        columns: ["When (UTC)", "Contract", "Event", "By", "Details"],
        rows: ev.map((e) => [e.at.toISOString(), visible.find((c) => c.id === e.contractId)?.number, e.action, users.find((u) => u.id === e.actorId)?.name ?? "System", e.data ? JSON.stringify(e.data) : ""]),
      };
    },
  },
];
