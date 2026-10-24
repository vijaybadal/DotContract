import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadActor, type Actor } from "@/lib/authz";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./token";

export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const userId = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  try {
    return await loadActor(userId);
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

export const authMode = () => (process.env.AUTH_MODE === "oidc" ? "oidc" : "dev");
