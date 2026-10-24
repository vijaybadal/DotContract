import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { obligation, user } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { listContracts } from "@/lib/contracts";
import { todayIn } from "@/lib/dates";
import { DateText, Empty, PageHeader, Panel, Status } from "@/components/ui";

export const metadata: Metadata = { title: "Obligations" };
export const dynamic = "force-dynamic";

export default async function Obligations() {
  const actor = await requireActor();
  const today = todayIn();
  const contracts = await listContracts(actor, { status: "ACTIVE", limit: 2000 });
  const rows = contracts.length
    ? await db.select({ o: obligation, owner: user.name }).from(obligation).innerJoin(user, eq(user.id, obligation.ownerId)).where(inArray(obligation.contractId, contracts.map((c) => c.id))).orderBy(asc(obligation.dueDate))
    : [];
  const status = (o: typeof obligation.$inferSelect) => (o.status === "OPEN" && o.dueDate && o.dueDate < today ? "OVERDUE" : o.status);
  const sorted = rows.sort((a, b) => (status(a.o) === "OVERDUE" ? -1 : 0) - (status(b.o) === "OVERDUE" ? -1 : 0));
  return (
    <>
      <PageHeader title="Obligations" lede="Deliverables, certifications, insurance, reporting and exit commitments that someone must follow up on." />
      <Panel flush>
        {rows.length === 0 ? <Empty title="No obligations recorded in your scope" /> : (
          <table className="tbl">
            <thead><tr><th>Obligation</th><th>Contract</th><th>Category</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{sorted.map(({ o, owner }) => {
              const c = contracts.find((x) => x.id === o.contractId)!;
              return (
                <tr key={o.id}>
                  <td className="font-semibold">{o.title}</td>
                  <td className="text-[0.85rem]"><Link className="hover:text-teal hover:underline" href={`/contracts/${c.id}?tab=obligations`}>{c.title}</Link><div className="text-[0.8rem] text-muted">{c.vendorName}</div></td>
                  <td className="text-[0.85rem]">{o.category}</td>
                  <td className="text-[0.85rem]">{owner}</td>
                  <td><DateText value={o.dueDate} /></td>
                  <td><Status value={status(o)} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
      <p className="mt-3 text-[0.8rem] text-muted">Phase 1 shows obligations recorded on contracts. Editing, evidence uploads and escalation rules for obligations are on the Phase 3 backlog.</p>
    </>
  );
}
