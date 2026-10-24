import "server-only";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { isReadOnly, type Actor } from "@/lib/authz";

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: authenticates, maps domain errors to HTTP, never leaks internals. */
export function api<P = Record<string, string>>(fn: (req: Request, actor: Actor, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
    if (!["GET", "HEAD"].includes(req.method) && isReadOnly(actor)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Your account is read-only." } }, { status: 403 });
    }
    try {
      const out = await fn(req, actor, await ctx.params);
      if (out instanceof Response) return out;
      return NextResponse.json({ data: out ?? null });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (isAppError(e)) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected error. The incident was logged." } }, { status: 500 });
}

export async function jsonBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
