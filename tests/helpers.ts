import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { db, migrateDb } from "@/db";
import * as s from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { DOCX_MIME, makeDocx, STANDARD_TERMS } from "@/db/fixtures";
import { invalidateOrgCache, loadActor } from "@/lib/authz";
import { addDays, todayIn } from "@/lib/dates";

export type Seeded = Awaited<ReturnType<typeof seedDatabase>>;

export async function resetAndSeed(opts: { inFlight?: boolean } = {}): Promise<Seeded> {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await rm(process.env.STORAGE_DIR ?? "./.test-storage", { recursive: true, force: true });
  await migrateDb();
  invalidateOrgCache();
  return seedDatabase({ inFlight: opts.inFlight ?? false });
}

export const actor = (seed: Seeded, key: string) => loadActor(seed.user[key]);
export const day = (n: number) => addDays(todayIn(), n);

export async function agreementFile(title = "Test Agreement", tracked: Parameters<typeof makeDocx>[2] = []) {
  return { name: `${title.replace(/\W+/g, "-")}.docx`, type: DOCX_MIME, bytes: await makeDocx(title, STANDARD_TERMS, tracked) };
}

export async function tasksFor(contractId: string) {
  return db
    .select({ t: s.workflowTask, i: s.workflowInstance })
    .from(s.workflowTask)
    .innerJoin(s.workflowInstance, eq(s.workflowInstance.id, s.workflowTask.instanceId))
    .where(eq(s.workflowInstance.contractId, contractId))
    .then((rows) => rows.map((r) => ({ ...r.t, instanceStatus: r.i.status })));
}

export async function pendingTask(contractId: string, stepKey: string) {
  const rows = await db
    .select({ t: s.workflowTask })
    .from(s.workflowTask)
    .innerJoin(s.workflowInstance, eq(s.workflowInstance.id, s.workflowTask.instanceId))
    .where(and(eq(s.workflowInstance.contractId, contractId), eq(s.workflowTask.stepKey, stepKey), eq(s.workflowTask.status, "PENDING")));
  if (!rows.length) throw new Error(`No pending task ${stepKey}`);
  return rows[0].t;
}

export async function getContract(id: string) {
  const [c] = await db.select().from(s.contract).where(eq(s.contract.id, id));
  return c;
}
