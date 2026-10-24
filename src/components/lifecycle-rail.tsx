import { cx } from "./ui";
import { daysBetween, noticeDeadline, todayIn } from "@/lib/dates";

/**
 * Where a contract sits in its lifecycle: Request → Review → Legal → Signature → Active → Renewal.
 * The current stage is filled; completed stages carry a solid bar; skipped stages are dashed.
 */
const STAGES = ["Request", "Review", "Legal", "Signature", "Active", "Renewal"] as const;

type Input = {
  status: string;
  legalStatus?: string;
  expirationDate?: string | null;
  noticeDays?: number | null;
};

export function stageIndex(c: Input): { current: number; ended?: string } {
  switch (c.status) {
    case "DRAFT":
      return { current: 0 };
    case "IN_REVIEW":
      return { current: 1 };
    case "IN_LEGAL":
      return { current: 2 };
    case "PENDING_SIGNATURE":
      return { current: 3 };
    case "ACTIVE": {
      const deadline = noticeDeadline(c.expirationDate ?? null, c.noticeDays ?? null);
      if (deadline && daysBetween(todayIn(), deadline) <= 180) return { current: 5 };
      return { current: 4 };
    }
    case "EXPIRED":
    case "TERMINATED":
      return { current: 6, ended: c.status === "EXPIRED" ? "Expired" : "Terminated" };
    case "CANCELLED":
      return { current: -1, ended: "Cancelled" };
    default:
      return { current: 4 };
  }
}

export function LifecycleRail({ c, compact }: { c: Input; compact?: boolean }) {
  const { current, ended } = stageIndex(c);
  const legalSkipped = c.legalStatus === "NOT_REQUIRED";
  const label = ended ?? STAGES[Math.min(current, 5)];
  return (
    <div role="img" aria-label={`Lifecycle stage: ${label}`} className={compact ? "w-28" : "w-full"}>
      <ol className={cx("grid grid-cols-6", compact ? "gap-0.5" : "gap-1")}>
        {STAGES.map((s, i) => {
          const done = current > i;
          const here = current === i;
          const skipped = i === 2 && legalSkipped && current > 2;
          return (
            <li key={s} className="min-w-0">
              <div
                className={cx(
                  "rounded-sm",
                  compact ? "h-1.5" : "h-2",
                  skipped ? "border border-dashed border-rule bg-transparent" : done ? "bg-teal/70" : here ? "bg-teal" : "bg-rule",
                  ended === "Cancelled" && "bg-rule",
                )}
              />
              {!compact && (
                <span className={cx("mt-1.5 block truncate text-[0.75rem]", here ? "font-semibold text-teal-ink" : done ? "text-ink-soft" : "text-muted")}>
                  {s}
                  {skipped && " (n/a)"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {compact && <span className="mt-1 block text-[0.7rem] text-muted">{label}</span>}
    </div>
  );
}
