/** Regular PostgreSQL through node-postgres (local, Docker, Vercel + Neon). */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type * as schemaModule from "./schema";

const g = globalThis as unknown as { __clmPool?: Pool };

export function createDb(schema: typeof schemaModule) {
  const pool =
    g.__clmPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless functions each hold their own pool: keep it small and let the provider's pooler fan in.
      max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    });
  g.__clmPool = pool;
  return drizzle(pool, { schema });
}

export async function closeDriver() {
  await g.__clmPool?.end();
  g.__clmPool = undefined;
}

export async function migrateWith(db: unknown) {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db as never, { migrationsFolder: "./drizzle" });
}
