import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notification, notificationDelivery } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { Empty, PageHeader, Panel, Pill, cx } from "@/components/ui";
import { MarkAllReadButton } from "@/components/client/admin-panels";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const actor = await requireActor();
  const rows = await db.select().from(notification).where(eq(notification.userId, actor.id)).orderBy(desc(notification.createdAt)).limit(200);
  const deliveries = rows.length ? await db.select().from(notificationDelivery).where(inArray(notificationDelivery.notificationId, rows.map((r) => r.id))) : [];
  return (
    <>
      <PageHeader title="Notifications" lede="Assignments, reminders and outcomes. Each is also emailed unless you've turned that kind off." actions={rows.some((r) => !r.readAt) ? <MarkAllReadButton /> : undefined} />
      <Panel flush>
        {rows.length === 0 ? <Empty title="No notifications yet" /> : (
          <ul className="divide-y divide-rule-soft">
            {rows.map((n) => {
              const d = deliveries.find((x) => x.notificationId === n.id);
              return (
                <li key={n.id} className={cx("flex gap-3 px-4 py-3 text-sm", !n.readAt && "bg-teal-wash/40")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-teal")} aria-label={n.readAt ? undefined : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{n.link ? <Link className="hover:text-teal hover:underline" href={n.link}>{n.title}</Link> : n.title}</p>
                    {n.body && <p className="text-ink-soft">{n.body}</p>}
                    <p className="mt-0.5 text-[0.8rem] text-muted">{formatDateTime(n.createdAt)} · email {d ? <Pill tone={d.status === "SENT" ? "green" : d.status === "FAILED" ? "red" : "neutral"}>{d.status.toLowerCase()}</Pill> : "—"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
