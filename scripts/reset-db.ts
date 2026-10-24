import "./load-env";
import { Pool } from "pg";

// Development only: drops and recreates the public schema.
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await pool.end();
  console.log("Database reset.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
