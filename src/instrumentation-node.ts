import { applyStackBlitzDefaults, dbDriver } from "@/lib/runtime";

applyStackBlitzDefaults();
// Regular PostgreSQL is migrated by `npm run db:migrate` / `vercel-build`; PGlite (StackBlitz) sets itself up here.
if (dbDriver() === "pglite") {
  const { bootstrapDemoDatabase } = await import("@/db/bootstrap");
  await bootstrapDemoDatabase();
}
