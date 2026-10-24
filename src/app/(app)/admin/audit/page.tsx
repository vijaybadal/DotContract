import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, jobRun, notificationDelivery, user } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { canAdministerWorkflows, getOrgIndex, isPlatformWide } from "@/lib/authz";
import { verifyAuditChain } from "@/lib/audit";
import { formatDateTime } from "@/lib/dates";
import { Notice, PageHeader, Panel, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await requireActor();
  const idx = await getOrgIndex();
  if (!canAdministerWorkflows(actor, idx) && !isPlatformWide(actor, "AUDITOR", idx)) return <Notice tone="amber" title="Administrators and auditors only" />;
  const [chain, events, users, jobs, deliveries] = await Promise.all([
    verifyAuditChain(),
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100),
    db.select({ id: user.id, name: user.name }).from(user),
    db.select().from(jobRun).orderBy(desc(jobRun.startedAt)).limit(10),
    db.select().from(notificationDelivery).orderBy(desc(notificationDelivery.nextAttemptAt)).limit(1000),
  ]);
  const counts = deliveries.reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  return (
    <>
      <PageHeader title="Audit log" lede="Every significant action, hash-chained so that any edited, inserted or deleted entry is detectable." />
      {chain.ok ? (
        <Notice tone="green" title={`Chain verified: ${chain.checked.toLocaleString()} entries intact`}>Recomputed just now from the first entry. Database triggers also block updates and deletes.</Notice>
      ) : (
        <Notice tone="red" title="Audit chain broken">Entry {chain.brokenAtId} does not match its recorded hash. Preserve the database and contact Information Security.</Notice>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Scheduled jobs" flush>
          <table className="tbl">
            <thead><tr><th>Started</th><th>Result</th><th>Summary</th></tr></thead>
            <tbody>{jobs.length === 0 ? <tr><td colSpan={3} className="text-muted">No runs yet. Schedule <code>npm run jobs</code> hourly.</td></tr> : jobs.map((j) => <tr key={j.id}><td className="text-[0.85rem]">{formatDateTime(j.startedAt)}</td><td>{j.ok ? <Pill tone="green">ok</Pill> : <Pill tone="red">failed</Pill>}</td><td className="text-[0.75rem]">{JSON.stringify(j.summary)}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Email delivery">
          <p className="text-sm">{Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "No email yet."}</p>
          <p className="mt-2 text-[0.8rem] text-muted">Development uses the outbox adapter: messages are recorded, not sent. Failed sends retry with backoff up to five times.</p>
        </Panel>
      </div>
      <Panel title="Latest 100 events" className="mt-5" flush>
        <table className="tbl">
          <thead><tr><th>#</th><th>When</th><th>Event</th><th>By</th><th>Record</th><th>Hash</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id}>
              <td className="text-[0.8rem] text-muted">{e.id}</td>
              <td className="whitespace-nowrap text-[0.85rem]">{formatDateTime(e.at)}</td>
              <td className="text-[0.85rem]">{e.action.replace(/_/g, " ").toLowerCase()}</td>
              <td className="text-[0.85rem]">{users.find((u) => u.id === e.actorId)?.name ?? "System"}</td>
              <td className="text-[0.85rem]">{e.contractId ? <Link className="text-teal hover:underline" href={`/contracts/${e.contractId}?tab=audit`}>{e.entityType.replace(/_/g, " ")}</Link> : e.entityType.replace(/_/g, " ")}</td>
              <td className="font-mono text-[0.72rem] text-muted">{e.hash.slice(0, 12)}…</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}
