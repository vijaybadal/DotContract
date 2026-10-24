import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { notification, notificationDelivery, notificationPreference, user } from "@/db/schema";
import { getEmailAdapter } from "./email";

export type NotifyInput = {
  userIds: string[];
  kind: string;
  title: string;
  body?: string;
  link?: string;
  /** Unique per (event, recipient) — repeated calls never duplicate a notification. */
  dedupeKey: string;
};

const MAX_ATTEMPTS = 5;

export async function notify(conn: Conn, n: NotifyInput): Promise<number> {
  const recipients = [...new Set(n.userIds)];
  if (!recipients.length) return 0;
  const prefs = await conn
    .select()
    .from(notificationPreference)
    .where(inArray(notificationPreference.userId, recipients));
  let created = 0;
  for (const uid of recipients) {
    const [row] = await conn
      .insert(notification)
      .values({ userId: uid, kind: n.kind, title: n.title, body: n.body, link: n.link, dedupeKey: `${n.dedupeKey}:${uid}` })
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning({ id: notification.id });
    if (!row) continue;
    created++;
    const pref =
      prefs.find((p) => p.userId === uid && p.kind === n.kind) ?? prefs.find((p) => p.userId === uid && p.kind === "*");
    await conn.insert(notificationDelivery).values({
      notificationId: row.id,
      channel: "EMAIL",
      status: pref && !pref.email ? "SUPPRESSED" : "QUEUED",
    });
  }
  return created;
}

/** Sends queued email with retry and exponential backoff. Safe to run concurrently (row locks). */
export async function processOutbox(now = new Date(), limit = 100) {
  const adapter = getEmailAdapter();
  let sent = 0;
  let failed = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notificationDelivery)
      .where(and(eq(notificationDelivery.status, "QUEUED"), lte(notificationDelivery.nextAttemptAt, now)))
      .orderBy(asc(notificationDelivery.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const d of due) {
      const [n] = await tx
        .select({ title: notification.title, body: notification.body, link: notification.link, email: user.email })
        .from(notification)
        .innerJoin(user, eq(user.id, notification.userId))
        .where(eq(notification.id, d.notificationId));
      const base = process.env.APP_BASE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
      const link = n.link ? `${base}${n.link}` : null;
      try {
        const res = await adapter.send({ to: n.email, subject: n.title, text: n.body ?? n.title, link });
        await tx
          .update(notificationDelivery)
          .set({ status: "SENT", attempts: d.attempts + 1, sentAt: now, lastError: null, payload: { provider: adapter.name, id: res.id, to: n.email, subject: n.title, link } })
          .where(eq(notificationDelivery.id, d.id));
        sent++;
      } catch (e) {
        const attempts = d.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await tx
          .update(notificationDelivery)
          .set({
            attempts,
            status: giveUp ? "FAILED" : "QUEUED",
            lastError: e instanceof Error ? e.message : String(e),
            nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 60_000),
          })
          .where(eq(notificationDelivery.id, d.id));
        failed++;
      }
    }
  });
  return { sent, failed };
}

export async function unreadCount(userId: string) {
  const rows = await db
    .select({ id: notification.id })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return rows.length;
}
