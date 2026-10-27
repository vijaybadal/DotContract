import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

const PUBLIC = ["/login", "/api/auth", "/api/v1/openapi.json", "/api/health", "/api/v1/esign/webhook", "/api/cron/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // CSRF defense for state-changing API calls: require a same-origin request.
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean);
    if (!origin || !hosts.includes(new URL(origin).host)) {
      return NextResponse.json({ error: { code: "CSRF", message: "Cross-origin request rejected." } }, { status: 403 });
    }
  }

  const userId = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"] };
