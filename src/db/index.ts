import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

type Schema = typeof schema;
export type DB = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Conn = DB | Tx;

const globalForDb = globalThis as unknown as { __clmPool?: Pool; __clmDb?: DB };

function create(): DB {
  const pool =
    globalForDb.__clmPool ??
    new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) });
  globalForDb.__clmPool = pool;
  return drizzle(pool, { schema });
}

export const db: DB = globalForDb.__clmDb ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.__clmDb = db;

export async function closeDb() {
  await globalForDb.__clmPool?.end();
  globalForDb.__clmPool = undefined;
  globalForDb.__clmDb = undefined;
}

export { schema };
