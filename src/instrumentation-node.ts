import { applyStackBlitzDefaults, dbDriver } from "@/lib/runtime";

applyStackBlitzDefaults();
// Regular PostgreSQL is migrated by `npm run db:migrate` / `vercel-build`; PGlite (StackBlitz) sets itself up here.
if (dbDriver() === "pglite") {
  // Load PGlite once, outside any request, for src/db/pglite-shim.cjs to hand to the page bundles.
  const g = globalThis as unknown as { __clmPgliteModule?: unknown };
  g.__clmPgliteModule ??= await import(/* webpackIgnore: true */ "@electric-sql/pglite");
  const { bootstrapDemoDatabase } = await import("@/db/bootstrap");
  await bootstrapDemoDatabase();
}
