// Next.js calls register() once per server start, before serving requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyStackBlitzDefaults, dbDriver } = await import("@/lib/runtime");
  applyStackBlitzDefaults();
  if (dbDriver() !== "pglite") return; // regular PostgreSQL is migrated by npm run db:migrate / vercel-build
  const { bootstrapDemoDatabase } = await import("@/db/bootstrap");
  await bootstrapDemoDatabase();
}
