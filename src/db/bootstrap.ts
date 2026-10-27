/**
 * StackBlitz demo bootstrap: runs once when the server starts (see src/instrumentation.ts).
 * Creates the in-browser database, applies migrations, and loads synthetic demo data if it is empty.
 */
import { sql } from "drizzle-orm";
import { db, migrateDb } from "./index";

export async function bootstrapDemoDatabase() {
  const started = Date.now();
  await migrateDb();
  const res = (await db.execute(sql`select count(*)::int as n from organization`)) as unknown as { rows: { n: number }[] };
  if (res.rows[0].n > 0 || process.env.SEED_DEMO !== "true") {
    console.log(`[clm] database ready (${Date.now() - started} ms)`);
    return;
  }
  console.log("[clm] loading synthetic demo data — first start only, about a minute in the browser…");
  const { seedDatabase } = await import("./seed");
  await seedDatabase();
  console.log(`[clm] demo data loaded (${Math.round((Date.now() - started) / 1000)} s)`);
}
