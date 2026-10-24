import { createHash } from "node:crypto";
import { asc, desc, eq, gt, sql } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  contractId?: string | null;
  data?: Record<string, unknown> | null;
};

const GENESIS = "GENESIS";

export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

function entryHash(prevHash: string, at: Date, e: AuditEntry): string {
  return sha256(
    [prevHash, at.toISOString(), e.actorId ?? "", e.action, e.entityType, e.entityId, e.contractId ?? "", stableStringify(e.data ?? null)].join("|"),
  );
}

/**
 * Appends to the hash-chained audit log. Call inside the same transaction as the change it records,
 * so the audit row and the business change commit (or roll back) together.
 */
export async function writeAudit(tx: Conn, e: AuditEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clm_audit_chain'))`);
  const [last] = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const at = new Date();
  await tx.insert(auditLog).values({
    at,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    contractId: e.contractId ?? null,
    data: e.data ?? null,
    prevHash,
    hash: entryHash(prevHash, at, e),
  });
}

/** Recomputes the whole chain. Any edited, inserted or removed row breaks it at that point. */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
  let prev = GENESIS;
  let checked = 0;
  let after = 0;
  for (;;) {
    const rows = await db.select().from(auditLog).where(gt(auditLog.id, after)).orderBy(asc(auditLog.id)).limit(1000);
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = entryHash(prev, r.at, {
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        contractId: r.contractId,
        data: (r.data as Record<string, unknown> | null) ?? null,
      });
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAtId: r.id };
      prev = r.hash;
      checked++;
      after = r.id;
    }
  }
  return { ok: true, checked };
}

export async function auditForContract(contractId: string) {
  return db.select().from(auditLog).where(eq(auditLog.contractId, contractId)).orderBy(desc(auditLog.id));
}
