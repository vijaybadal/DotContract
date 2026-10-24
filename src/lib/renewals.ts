/**
 * Renewal & expiration management.
 * - Each active contract term has one renewal cycle (unique per contract + expiration date).
 * - Reminders fire at configurable offsets before the non-renewal notice deadline (or expiration when
 *   no notice period is recorded). Each threshold fires at most once (dedupe key), and if the job was
 *   down past several thresholds only the most recent one is sent — no reminder floods.
 * - "Today" is computed in the contracting entity's time zone.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { actionItem, contract, renewal } from "@/db/schema";
import { writeAudit } from "./audit";
import { assertCanViewContract, getOrgIndex, isContractAdminFor, type Actor } from "./authz";
import { addMonths, daysBetween, formatDate, noticeDeadline, todayIn } from "./dates";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { notify } from "./notifications";
import { getSetting } from "./settings";

type ContractRow = typeof contract.$inferSelect;
export type RenewalDecisionValue = (typeof renewal.$inferSelect)["decision"];

export async function ensureRenewalCycle(conn: Conn, c: ContractRow) {
  if (!c.expirationDate) return null;
  const [row] = await conn
    .insert(renewal)
    .values({
      contractId: c.id,
      cycleExpiration: c.expirationDate,
      noticeDeadline: noticeDeadline(c.expirationDate, c.noticeDays),
      ownerId: c.ownerId,
    })
    .onConflictDoNothing({ target: [renewal.contractId, renewal.cycleExpiration] })
    .returning();
  if (row) return row;
  const [existing] = await conn
    .select()
    .from(renewal)
    .where(and(eq(renewal.contractId, c.id), eq(renewal.cycleExpiration, c.expirationDate)));
  return existing;
}

/** Which reminder threshold (if any) is due: the smallest offset the countdown has crossed. */
export function dueThreshold(daysUntil: number, offsets: number[]): number | null {
  const crossed = offsets.filter((d) => daysUntil <= d);
  return crossed.length ? Math.min(...crossed) : null;
}

export async function runRenewalReminders(now = new Date()) {
  const offsets = [...(await getSetting("renewal.reminderDays"))].sort((a, b) => b - a);
  const idx = await getOrgIndex(db, true);
  const active = await db
    .select()
    .from(contract)
    .where(and(eq(contract.status, "ACTIVE"), isNotNull(contract.expirationDate)))
    .orderBy(asc(contract.expirationDate));
  const summary = { reminders: 0, expired: 0, autoRolled: 0, deadlinePassed: 0 };

  for (const c0 of active) {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, c0.id)).for("update");
      if (c.status !== "ACTIVE" || !c.expirationDate) return;
      const tz = idx.get(c.contractingEntityId)?.timeZone ?? "America/Chicago";
      const today = todayIn(tz, now);
      const cycle = await ensureRenewalCycle(tx, c);
      if (!cycle) return;

      // Term ended
      if (c.expirationDate < today) {
        const stopping = ["TERMINATE", "REPLACE", "CONSOLIDATE"].includes(cycle.decision);
        // A demo execution (mock e-signature) is not a legal contract, so it never auto-renews.
        if (c.autoRenew && c.renewalTermMonths && !stopping && !c.executionIsDemo) {
          let next = c.expirationDate;
          while (next < today) next = addMonths(next, c.renewalTermMonths);
          await tx.update(contract).set({ expirationDate: next }).where(eq(contract.id, c.id));
          await writeAudit(tx, {
            actorId: null,
            action: "AUTO_RENEWAL_TERM_ROLLED",
            entityType: "contract",
            entityId: c.id,
            contractId: c.id,
            data: { from: c.expirationDate, to: next, basis: "Auto-renewal recorded in contract terms; no termination decision on file" },
          });
          await ensureRenewalCycle(tx, { ...c, expirationDate: next });
          await notify(tx, {
            userIds: [c.ownerId, cycle.ownerId],
            kind: "AUTO_RENEWED",
            title: `${c.number} auto-renewed through ${formatDate(next)}`,
            body: "The term rolled forward under the contract's auto-renewal terms. Confirm pricing against the vendor invoice.",
            link: `/contracts/${c.id}?tab=renewals`,
            dedupeKey: `auto-roll:${c.id}:${next}`,
          });
          summary.autoRolled++;
        } else {
          await tx.update(contract).set({ status: "EXPIRED" }).where(eq(contract.id, c.id));
          await writeAudit(tx, { actorId: null, action: "CONTRACT_EXPIRED", entityType: "contract", entityId: c.id, contractId: c.id, data: { expiration: c.expirationDate } });
          await notify(tx, {
            userIds: [c.ownerId, cycle.ownerId],
            kind: "CONTRACT_EXPIRED",
            title: `${c.number} expired on ${formatDate(c.expirationDate)}`,
            link: `/contracts/${c.id}`,
            dedupeKey: `expired:${c.id}:${c.expirationDate}`,
          });
          summary.expired++;
        }
        return;
      }

      if (cycle.decision !== "PENDING") return; // decided: no further countdown reminders
      const target = cycle.noticeDeadline ?? c.expirationDate;
      const daysUntil = daysBetween(today, target);
      const recipients = [...new Set([cycle.ownerId, c.ownerId, c.serviceOwnerId].filter(Boolean) as string[])];

      if (daysUntil < 0) {
        const n = await notify(tx, {
          userIds: recipients,
          kind: "NOTICE_DEADLINE_PASSED",
          title: `Notice deadline passed: ${c.number}`,
          body: `The non-renewal notice deadline was ${formatDate(target)}. ${c.autoRenew ? "The contract will auto-renew unless the vendor agrees otherwise." : `The contract expires ${formatDate(c.expirationDate)}.`}`,
          link: `/contracts/${c.id}?tab=renewals`,
          dedupeKey: `renewal:${c.id}:${cycle.cycleExpiration}:deadline-passed`,
        });
        if (n) summary.deadlinePassed++;
        return;
      }
      const threshold = dueThreshold(daysUntil, offsets);
      if (threshold == null) return;
      const created = await notify(tx, {
        userIds: recipients,
        kind: c.autoRenew ? "CANCELLATION_DEADLINE" : "RENEWAL_REMINDER",
        title: (c.executionIsDemo ? "DEMO: " : "") + (c.autoRenew
          ? `${c.number} auto-renews: decide by ${formatDate(target)} (${daysUntil} days)`
          : `${c.number} expires ${formatDate(c.expirationDate)}: renewal decision due ${formatDate(target)}`),
        body: `${c.title}. Reminder at the ${threshold}-day mark. Record a decision: renew, renegotiate, extend, replace, consolidate or terminate.`,
        link: `/contracts/${c.id}?tab=renewals`,
        dedupeKey: `renewal:${c.id}:${cycle.cycleExpiration}:${threshold}`,
      });
      if (created) summary.reminders++;
      await tx
        .insert(actionItem)
        .values({
          sourceKey: `renewal-decision:${cycle.id}`,
          kind: "RENEWAL_DECISION",
          title: `Renewal decision for ${c.number} ${c.title}`,
          contractId: c.id,
          assigneeId: cycle.ownerId,
          dueDate: target,
        })
        .onConflictDoNothing({ target: actionItem.sourceKey });
    });
  }
  return summary;
}

export async function decideRenewal(actor: Actor, renewalId: string, decision: RenewalDecisionValue, note?: string) {
  if (decision === "PENDING") throw new ValidationError("Choose a renewal decision.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(renewal).where(eq(renewal.id, renewalId)).for("update");
    if (!r) throw new NotFoundError("Renewal");
    const [c] = await tx.select().from(contract).where(eq(contract.id, r.contractId));
    await assertCanViewContract(actor, c, tx);
    const idx = await getOrgIndex(tx);
    if (![r.ownerId, c.ownerId].includes(actor.id) && !isContractAdminFor(actor, c, idx)) {
      throw new ForbiddenError("Only the renewal owner, contract owner or contract administrator can record this decision.");
    }
    await tx.update(renewal).set({ decision, decisionNote: note ?? null, decidedById: actor.id, decidedAt: new Date() }).where(eq(renewal.id, r.id));
    await tx.update(actionItem).set({ status: "DONE" }).where(eq(actionItem.sourceKey, `renewal-decision:${r.id}`));
    if (decision === "TERMINATE") {
      await tx
        .insert(actionItem)
        .values({
          sourceKey: `nonrenewal-notice:${r.id}`,
          kind: "SEND_NOTICE",
          title: `Send written non-renewal notice to the vendor for ${c.number}`,
          contractId: c.id,
          assigneeId: r.ownerId,
          dueDate: r.noticeDeadline ?? r.cycleExpiration,
        })
        .onConflictDoNothing({ target: actionItem.sourceKey });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "RENEWAL_DECISION",
      entityType: "renewal",
      entityId: r.id,
      contractId: c.id,
      data: { decision, note: note ?? null, cycle: r.cycleExpiration },
    });
    return { decision };
  });
}

export async function listRenewals(contractIds?: string[]) {
  const rows = await db.query.renewal.findMany({
    with: { contract: { with: { vendor: true, type: true } }, owner: true },
    orderBy: asc(renewal.cycleExpiration),
  });
  return contractIds ? rows.filter((r) => contractIds.includes(r.contractId)) : rows;
}
