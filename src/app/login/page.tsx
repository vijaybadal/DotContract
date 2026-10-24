import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user, userRoleAssignment } from "@/db/schema";
import { authMode, passedAccessGate } from "@/lib/auth/session";
import { getOrgIndex } from "@/lib/authz";
import { enterAccessCode, signInAsDemoUser } from "@/app/actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const SCENARIO_HINTS: Record<string, string> = {
  "Priya Natarajan": "Requests software (Scenario 1)",
  "Kevin Lindqvist": "County Treasurer requester (Scenario 2)",
  "Dana Whitfield": "Prepares signature packages",
  "Jonathan Pryce": "County legal review",
  "Elaine Cho": "Final approval; delegated signer",
  "Marcus Hale": "Department approver",
  "Owen Fitch": "Read-only auditor",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  if (authMode() === "oidc") {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-sm rounded-md border border-rule bg-panel p-8">
          <h1 className="text-xl font-semibold">DOTComm Contracts</h1>
          <p className="mt-2 text-sm text-muted">Sign in with your City, County or DOTComm account.</p>
          <a href={`/api/auth/oidc/login?next=${encodeURIComponent(next)}`} className="mt-6 inline-flex w-full justify-center rounded-md bg-teal px-4 py-2.5 font-semibold text-white hover:bg-teal-ink">
            Sign in with single sign-on
          </a>
        </div>
      </main>
    );
  }

  if (!(await passedAccessGate())) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <form action={enterAccessCode} className="w-full max-w-sm rounded-md border border-rule bg-panel p-8">
          <h1 className="text-xl font-semibold">DOTComm Contracts</h1>
          <p className="mt-2 text-sm text-muted">This demonstration is shared by invitation. Enter the access code you were given.</p>
          {error === "code" && <p role="alert" className="mt-3 rounded border-l-4 border-red bg-red-wash px-3 py-2 text-sm">That code is not right. Check it and try again.</p>}
          <input type="hidden" name="next" value={next} />
          <label className="field mt-4"><span>Access code</span><input className="input" name="code" type="password" autoComplete="off" required autoFocus /></label>
          <button className="mt-4 w-full rounded-md bg-teal px-4 py-2.5 font-semibold text-white hover:bg-teal-ink">Continue</button>
        </form>
      </main>
    );
  }
  const idx = await getOrgIndex(db, true);
  const users = await db.select().from(user).where(eq(user.isDemo, true)).orderBy(asc(user.name));
  const roles = await db.select().from(userRoleAssignment);
  const groups = new Map<string, typeof users>();
  for (const u of users) {
    const ent = u.primaryOrgId ? (idx.legalEntityOf(u.primaryOrgId)?.name ?? "Other") : "Other";
    groups.set(ent, [...(groups.get(ent) ?? []), u]);
  }
  const order = ["DOTComm", "City of Omaha", "Douglas County"];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-[2rem] font-semibold tracking-tight">DOTComm Contracts</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Choose a demonstration account. Each person sees only the contracts their roles cover, so switching accounts is the quickest way to walk through a request
        from submission to signature.
      </p>
      {error === "unknown" && <p className="mt-4 rounded border-l-4 border-red bg-red-wash px-4 py-2 text-sm">That account could not be used. Choose another.</p>}
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {order.filter((g) => groups.has(g)).map((g) => (
          <section key={g}>
            <h2 className="mb-2 border-b border-rule pb-1.5 font-semibold">{g}</h2>
            <ul className="space-y-1">
              {groups.get(g)!.map((u) => {
                const r = [...new Set(roles.filter((x) => x.userId === u.id).map((x) => x.roleKey.replace(/_/g, " ").toLowerCase()))];
                return (
                  <li key={u.id}>
                    <form action={signInAsDemoUser}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="next" value={next} />
                      <button className="w-full rounded-md px-3 py-2 text-left hover:bg-panel focus-visible:bg-panel">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{u.name}</span>
                          {SCENARIO_HINTS[u.name] && <span className="text-[0.72rem] font-semibold text-teal">{SCENARIO_HINTS[u.name]}</span>}
                        </span>
                        <span className="block text-[0.8rem] text-muted">{u.title} · {idx.name(u.primaryOrgId)}</span>
                        <span className="block text-[0.75rem] text-muted/80">{r.join(", ")}</span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-10 max-w-2xl text-sm text-muted">
        Demonstration data only: people, vendors, amounts, approval thresholds and signing authorities are invented and do not reflect City, County or DOTComm policy.
        In production this page is replaced by single sign-on.
      </p>
    </main>
  );
}
