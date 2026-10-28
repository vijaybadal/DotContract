import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { applyStackBlitzDefaults } from "@/lib/runtime";
import { driver } from "./driver";
import * as schema from "./schema";

applyStackBlitzDefaults();

type Schema = typeof schema;
export type DB = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Conn = DB | Tx;

const globalForDb = globalThis as unknown as { __clmDb?: DB };

// Both drivers expose the same Drizzle query API; the app is typed against node-postgres.
export const db: DB = globalForDb.__clmDb ?? (driver.createDb(schema) as unknown as DB);
globalForDb.__clmDb = db;

export async function closeDb() {
  await driver.closeDriver();
  globalForDb.__clmDb = undefined;
}

/** Applies migrations with the active driver. */
export async function migrateDb() {
  await driver.migrateWith(db);
}

export { schema };
