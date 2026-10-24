/**
 * HTTP smoke test against a running server (default http://localhost:3000, seeded demo data).
 * Verifies the API boundary: authentication, CSRF, agency scoping, exports and security headers.
 *   npm run smoke
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { contract, user } from "@/db/schema";
import { signSession } from "@/lib/auth/token";
import { toCsv } from "@/lib/reports";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function cookieFor(key: string) {
  const [u] = await db.select().from(user).where(eq(user.email, `${key}@demo.clm.invalid`));
  return `clm_session=${await signSession(u.id, "dev")}`;
}

async function main() {
  const nina = await cookieFor("nina"); // City public-safety requester
  const owen = await cookieFor("owen"); // auditor
  const [countyOnly] = await db.select().from(contract).where(eq(contract.title, "Payroll & HR cloud"));
  const [treasurer] = await db.select().from(contract).where(eq(contract.title, "Treasurer tax collection system"));

  let r = await fetch(`${BASE}/api/health`);
  check("health endpoint reports the database", r.status === 200 && (await r.json()).database === "ok");

  r = await fetch(`${BASE}/api/v1/contracts`);
  check("API rejects unauthenticated calls (401)", r.status === 401);

  r = await fetch(`${BASE}/contracts`, { redirect: "manual" });
  check("pages redirect anonymous users to sign-in", r.status === 307 && (r.headers.get("location") ?? "").includes("/login"));

  r = await fetch(`${BASE}/api/v1/contracts/${countyOnly.id}`, { headers: { cookie: nina } });
  check("City user gets 404 for a County-only contract", r.status === 404);

  r = await fetch(`${BASE}/api/v1/contracts/${countyOnly.id}`, { headers: { cookie: owen } });
  check("auditor can read the same contract", r.status === 200);

  r = await fetch(`${BASE}/api/v1/contracts`, { headers: { cookie: nina } });
  const list = (await r.json()).data as { entityName: string }[];
  check("contract list is scoped to the caller's agencies", list.length > 0 && list.every((c) => c.entityName !== "Douglas County"));

  r = await fetch(`${BASE}/api/v1/requests`, { method: "POST", headers: { cookie: nina, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  check("cross-origin state change rejected (CSRF)", r.status === 403 && (await r.json()).error.code === "CSRF");

  r = await fetch(`${BASE}/api/v1/requests`, { method: "POST", headers: { cookie: nina, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
  check("validation errors return 422 with field details", r.status === 422 && Array.isArray((await r.json()).error.details));

  r = await fetch(`${BASE}/api/v1/requests`, { method: "POST", headers: { cookie: owen, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ title: "Auditor attempt" }) });
  check("read-only auditor cannot change anything (403)", r.status === 403);

  r = await fetch(`${BASE}/api/v1/contracts/${treasurer.id}/authority-check`, { headers: { cookie: await cookieFor("kevin") } }); // Kevin owns it but is not an administrator
  check("signing-authority lookups are limited to administrators and auditors", r.status === 403);

  r = await fetch(`${BASE}/api/v1/reports/change-history`, { headers: { cookie: nina } });
  check("audit-detail report is limited to administrators and auditors", r.status === 403);

  r = await fetch(`${BASE}/api/v1/reports/inventory`, { headers: { cookie: owen } });
  const csv = await r.text();
  check("inventory report downloads as CSV", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv") && csv.includes("Number,Title"));

  check("CSV cells are guarded against formula injection", toCsv({ columns: ["a"], rows: [["=HYPERLINK(\"x\")"]] }).includes("'=HYPERLINK"));

  r = await fetch(`${BASE}/api/v1/openapi.json`);
  check("OpenAPI document is published", r.status === 200 && (await r.json()).openapi === "3.1.0");

  r = await fetch(`${BASE}/login`);
  const csp = r.headers.get("content-security-policy") ?? "";
  check("security headers are set", csp.includes("frame-ancestors 'none'") && r.headers.get("x-content-type-options") === "nosniff" && !r.headers.get("x-powered-by"));

  if (process.env.CRON_SECRET) {
    r = await fetch(`${BASE}/api/cron/jobs`);
    check("scheduled-job endpoint refuses calls without the cron secret", r.status === 401);
    r = await fetch(`${BASE}/api/cron/jobs`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check("scheduled-job endpoint runs with the cron secret", r.status === 200 && Boolean((await r.json()).data?.renewals));
  }
  if (process.env.DEMO_ACCESS_CODE) {
    r = await fetch(`${BASE}/login`);
    const html = await r.text();
    check("demo account picker is hidden behind the access code", html.includes('name="code"') && !html.includes("Priya Natarajan"));
  }

  r = await fetch(`${BASE}/api/v1/esign/webhook`, { method: "POST" });
  check("unconfigured e-signature webhook refuses calls (501)", r.status === 501);

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll HTTP checks passed.");
  await closeDb();
  process.exit(failures ? 1 : 0);
}
main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
