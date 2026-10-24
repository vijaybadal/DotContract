import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadActor, type Actor } from "@/lib/authz";
import { readSession, SESSION_COOKIE, SESSION_HOURS, signSession } from "./token";

export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // A demo-login session is never honored once the server requires single sign-on.
  if (session.method === "dev" && authMode() !== "dev") return null;
  try {
    return await loadActor(session.userId);
  } catch {
    return null;
  }
});

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  return a;
}

export async function startSession(userId: string, method: "dev" | "oidc") {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(userId, method), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * "dev" shows the demonstration account picker. It is never enabled implicitly in a production build:
 * a production server needs ALLOW_DEMO_LOGIN=true as well (demonstration servers only).
 */
export const authMode = (): "dev" | "oidc" => {
  if (process.env.AUTH_MODE !== "dev") return "oidc";
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_LOGIN !== "true") return "oidc";
  return "dev";
};

// ───────────── Optional demo access code (DEMO_ACCESS_CODE) ─────────────
// A public demo URL would otherwise let anyone pick any demo identity. When set, visitors must enter
// the code once; a signed cookie remembers it for 30 days.
import { createHmac, timingSafeEqual } from "node:crypto";
const GATE_COOKIE = "clm_demo_gate";
const gateValue = () => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`gate:${process.env.DEMO_ACCESS_CODE}`).digest("hex");

export const accessCodeRequired = () => Boolean(process.env.DEMO_ACCESS_CODE);

export async function passedAccessGate() {
  if (!accessCodeRequired()) return true;
  const v = (await cookies()).get(GATE_COOKIE)?.value ?? "";
  const want = gateValue();
  return v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want));
}

export async function checkAccessCode(code: string) {
  const want = Buffer.from(process.env.DEMO_ACCESS_CODE ?? "");
  const got = Buffer.from(code.trim());
  const ok = want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
  if (ok) {
    (await cookies()).set(GATE_COOKIE, gateValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
  }
  return ok;
}
