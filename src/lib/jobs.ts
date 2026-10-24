import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobRun } from "@/db/schema";
import { processOutbox } from "./notifications";
import { runRenewalReminders } from "./renewals";
import { runTaskReminders } from "./workflow";

/**
 * Scheduled work. Run every hour or so (cron, Kubernetes CronJob, or `npm run jobs`).
 * Every step is idempotent, so overlapping or repeated runs never duplicate reminders.
 */
export async function runAllJobs(now = new Date()) {
  const [run] = await db.insert(jobRun).values({ job: "all" }).returning();
  try {
    const renewals = await runRenewalReminders(now);
    const tasks = await runTaskReminders(now);
    const email = await processOutbox(now);
    const summary = { renewals, tasks, email };
    await db.update(jobRun).set({ finishedAt: new Date(), ok: true, summary }).where(eq(jobRun.id, run.id));
    return summary;
  } catch (e) {
    await db.update(jobRun).set({ finishedAt: new Date(), ok: false, summary: { error: String(e) } }).where(eq(jobRun.id, run.id));
    throw e;
  }
}
