/**
 * Runtime detection and demo defaults for StackBlitz (WebContainers), where the whole app — including an
 * in-browser PostgreSQL (PGlite) — runs inside the visitor's browser tab. Everything here is demo-only.
 */
export function onStackBlitz(): boolean {
  return (
    process.env.CLM_STACKBLITZ === "1" ||
    Boolean((process.versions as Record<string, string | undefined>).webcontainer) ||
    process.env.SHELL === "/bin/jsh"
  );
}

/** Which database driver to use: "pg" (node-postgres) normally, "pglite" on StackBlitz or when asked. */
export function dbDriver(): "pg" | "pglite" {
  if (process.env.DB_DRIVER === "pglite" || process.env.DB_DRIVER === "pg") return process.env.DB_DRIVER;
  return onStackBlitz() ? "pglite" : "pg";
}

/**
 * Fills in demo settings on StackBlitz so the project runs with no .env file. The values are public
 * (they ship in the repository) and protect nothing — synthetic demo data only.
 */
export function applyStackBlitzDefaults() {
  if (!onStackBlitz()) return;
  const d: Record<string, string> = {
    DB_DRIVER: "pglite",
    PGLITE_DIR: "./.pglite-data",
    SESSION_SECRET: "stackblitz-demo-only-session-secret-not-secret",
    STORAGE_KEY: "5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1e5ab1",
    STORAGE_PROVIDER: "local",
    STORAGE_DIR: "./storage",
    AUTH_MODE: "dev",
    ALLOW_DEMO_LOGIN: "true",
    ESIGN_PROVIDER: "mock",
    ALLOW_MOCK_ESIGN: "true",
    EMAIL_PROVIDER: "outbox",
    SEED_DEMO: "true",
    MAX_UPLOAD_MB: "10",
  };
  for (const [k, v] of Object.entries(d)) if (!process.env[k]) process.env[k] = v;
}
