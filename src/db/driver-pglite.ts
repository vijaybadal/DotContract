/** PGlite: PostgreSQL compiled to WebAssembly, running in-process (StackBlitz demo mode). */
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type * as schemaModule from "./schema";

const g = globalThis as unknown as { __clmPglite?: PGlite };

export function createDb(schema: typeof schemaModule) {
  // One connection: every query and transaction is serialized, which is fine for a single-visitor demo.
  const client = g.__clmPglite ?? new PGlite(process.env.PGLITE_DIR ?? "./.pglite-data");
  g.__clmPglite = client;
  return drizzle(client, { schema });
}

export async function closeDriver() {
  await g.__clmPglite?.close();
  g.__clmPglite = undefined;
}

export async function migrateWith(db: unknown) {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as never, { migrationsFolder: "./drizzle" });
}
