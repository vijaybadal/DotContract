/**
 * Runs before `next build` on Vercel:
 *   1. applies database migrations (uses the direct, unpooled connection when Neon provides one)
 *   2. loads the synthetic demo data when SEED_DEMO=true and the database is empty
 *   3. wipes and reloads demo data when RESEED_DEMO=true (turn it off again after one deploy)
 */
import "./load-env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const direct = process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (!direct) {
    console.log("vercel-build: no DATABASE_URL; skipping database setup.");
    return;
  }
  const pool = new Pool({ connectionString: direct, max: 1 });
  const d = drizzle(pool);

  if (process.env.RESEED_DEMO === "true") {
    console.log("vercel-build: RESEED_DEMO=true — dropping and recreating the schema.");
    await d.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  }
  await migrate(d, { migrationsFolder: "./drizzle" });
  console.log("vercel-build: migrations applied.");

  const wantSeed = process.env.SEED_DEMO === "true" || process.env.RESEED_DEMO === "true";
  const { rows } = await pool.query("select count(*)::int as n from organization");
  await pool.end();
  if (!wantSeed) return;
  if (rows[0].n > 0) {
    console.log("vercel-build: demo data already present; leaving it as is.");
    return;
  }
  process.env.DATABASE_URL = direct;
  const { seedDatabase } = await import("@/db/seed");
  const { closeDb } = await import("@/db");
  await seedDatabase();
  await closeDb();
  console.log("vercel-build: synthetic demo data loaded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
