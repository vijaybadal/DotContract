import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, lede, actions, crumbs }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && <span aria-hidden className="mx-1.5">/</span>}
                <Link href={c.href} className="hover:text-teal hover:underline">{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {lede && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, actions, children, className, flush, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("rounded-md border border-rule bg-panel", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          {title && <h2 className="text-[0.95rem] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={flush ? "overflow-x-auto" : "p-4"}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-slate-wash text-ink-soft",
  teal: "bg-teal-wash text-teal-ink",
  green: "bg-green-wash text-green",
  amber: "bg-amber-wash text-amber",
  red: "bg-red-wash text-red",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[0.75rem] font-semibold leading-4", TONES[tone])}>
      {children}
    </span>
  );
}

const STATUS: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  IN_REVIEW: ["In review", "teal"],
  IN_LEGAL: ["In legal review", "teal"],
  PENDING_SIGNATURE: ["Awaiting signature", "amber"],
  ACTIVE: ["Active", "green"],
  EXPIRED: ["Expired", "neutral"],
  TERMINATED: ["Terminated", "neutral"],
  CANCELLED: ["Cancelled", "neutral"],
  ARCHIVED: ["Archived", "neutral"],
  // requests
  SUBMITTED: ["Submitted", "teal"],
  RETURNED: ["Returned for changes", "amber"],
  APPROVED: ["Approved", "green"],
  REJECTED: ["Rejected", "red"],
  WITHDRAWN: ["Withdrawn", "neutral"],
  COMPLETED: ["Completed", "green"],
  // tasks
  PENDING: ["Pending", "amber"],
  WAITING: ["Waiting", "neutral"],
  SKIPPED: ["Not required", "neutral"],
  SUPERSEDED: ["Superseded", "neutral"],
  // legal
  NOT_REQUIRED: ["Not required", "neutral"],
  PENDING_REVIEW: ["Pending review", "neutral"],
  CHANGES_REQUESTED: ["Changes requested", "amber"],
  UNDER_NEGOTIATION: ["Under negotiation", "teal"],
  CLEARED: ["Cleared by Legal", "green"],
  // signature
  NOT_READY: ["Not ready", "neutral"],
  READY: ["Ready to send", "amber"],
  SENT: ["Out for signature", "teal"],
  PARTIALLY_SIGNED: ["Partially signed", "teal"],
  COMPLETING: ["All signed — recording", "amber"],
  EXECUTED: ["Executed", "green"],
  EXECUTED_EXTERNALLY: ["Executed (outside CLM)", "green"],
  DEMO_EXECUTED: ["Demo only — not executed", "red"],
  DECLINED: ["Declined", "red"],
  VOIDED: ["Voided", "neutral"],
  // obligations / issues
  OPEN: ["Open", "amber"],
  MET: ["Met", "green"],
  OVERDUE: ["Overdue", "red"],
  WAIVED: ["Waived", "neutral"],
  RESOLVED: ["Resolved", "green"],
  ACCEPTED_RISK: ["Risk accepted", "neutral"],
  // renewals
  RENEW: ["Renew", "green"],
  RENEGOTIATE: ["Renegotiate", "teal"],
  EXTEND: ["Extend", "teal"],
  REPLACE: ["Replace", "amber"],
  CONSOLIDATE: ["Consolidate", "teal"],
  TERMINATE: ["Terminate", "red"],
  // scans
  CLEAN: ["Scanned clean", "green"],
  INFECTED: ["Quarantined", "red"],
};

export function Status({ value }: { value: string }) {
  const [label, tone] = STATUS[value] ?? [value.replace(/_/g, " ").toLowerCase(), "neutral" as Tone];
  return <Pill tone={tone}>{label}</Pill>;
}

export function statusLabel(value: string) {
  return STATUS[value]?.[0] ?? value;
}

export function Money({ value, compact }: { value: string | number | null | undefined; compact?: boolean }) {
  return <span className="tabular-nums">{value == null ? "—" : formatMoney(value, { compact })}</span>;
}

export function DateText({ value }: { value: string | null | undefined }) {
  return <span className="whitespace-nowrap">{formatDate(value)}</span>;
}

export function KV({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-3 text-sm", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted">{k}</dt>
          <dd className="mt-0.5 break-words font-medium">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center gap-1.5 rounded-md bg-teal px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-ink disabled:opacity-50",
  secondary: "inline-flex items-center gap-1.5 rounded-md border border-rule bg-panel px-3.5 py-2 text-sm font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-50",
  danger: "inline-flex items-center gap-1.5 rounded-md border border-red/40 bg-panel px-3.5 py-2 text-sm font-semibold text-red hover:bg-red-wash disabled:opacity-50",
  quiet: "inline-flex items-center gap-1 rounded px-1.5 py-1 text-sm font-semibold text-teal hover:bg-teal-wash disabled:opacity-50",
};

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: keyof typeof btn }) {
  return (
    <Link href={href} className={btn[variant]}>
      {children}
    </Link>
  );
}

export function Notice({ tone = "teal", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  const border = { neutral: "border-rule", teal: "border-teal", green: "border-green", amber: "border-amber", red: "border-red" }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-md border-l-4 px-4 py-3 text-sm", border, TONES[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1 text-ink-soft" : "text-ink-soft"}>{children}</div>}
    </div>
  );
}
