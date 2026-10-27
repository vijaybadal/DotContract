// Ensures the test database exists. Each test file resets and seeds it (see tests/helpers.ts).
import { Pool } from "pg";

export default async function setup() {
  if (process.env.DB_DRIVER === "pglite") return; // in-memory PGlite per test file
  const admin = new Pool({ connectionString: "postgresql://clm@localhost:5433/postgres" });
  const exists = await admin.query("select 1 from pg_database where datname = 'clm_test'");
  if (!exists.rowCount) await admin.query("create database clm_test");
  await admin.end();
}
