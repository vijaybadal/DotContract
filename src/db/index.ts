import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { applyStackBlitzDefaults, dbDriver } from "@/lib/runtime";
import * as schema from "./schema";

applyStackBlitzDefaults();

type Schema = typeof schema;
export type DB = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Conn = DB | Tx;

const globalForDb = globalThis as unknown as { __clmPool?: Pool; __clmPglite?: PGlite; __clmDb?: DB };

function create(): DB {
  if (dbDriver() === "pglite") {
    // PostgreSQL compiled to WebAssembly, running in-process (StackBlitz demo mode). One connection:
    // every query and transaction is serialized, which is fine for a single-visitor demo.
    const client = globalForDb.__clmPglite ?? new PGlite(process.env.PGLITE_DIR ?? "./.pglite-data");
    globalForDb.__clmPglite = client;
    return drizzlePglite(client, { schema }) as unknown as DB;
  }
  const pool =
    globalForDb.__clmPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless functions each hold their own pool: keep it small and let the provider's pooler fan in.
      max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    });
  globalForDb.__clmPool = pool;
  return drizzle(pool, { schema });
}

export const db: DB = globalForDb.__clmDb ?? create();
globalForDb.__clmDb = db;

export async function closeDb() {
  await globalForDb.__clmPool?.end();
  await globalForDb.__clmPglite?.close();
  globalForDb.__clmPool = undefined;
  globalForDb.__clmPglite = undefined;
  globalForDb.__clmDb = undefined;
}

/** Applies migrations with the active driver. */
export async function migrateDb() {
  if (dbDriver() === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./drizzle" });
  }
}

export { schema };
