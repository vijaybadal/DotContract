import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/api";
import { runAllJobs } from "@/lib/jobs";

/**
 * Scheduled-job endpoint for hosts without a long-running process (Vercel Cron, see vercel.json).
 * Vercel sends "Authorization: Bearer $CRON_SECRET". Without CRON_SECRET configured, the endpoint refuses.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Invalid cron credentials." } }, { status: 401 });
  try {
    return Response.json({ data: await runAllJobs() });
  } catch (e) {
    return errorResponse(e);
  }
}
