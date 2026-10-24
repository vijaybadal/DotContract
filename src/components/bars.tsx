import Link from "next/link";
import { formatMoney } from "@/lib/money";

/** Horizontal bars for a ranked breakdown; values share one scale so lengths compare honestly. */
export function Bars({ rows, href }: { rows: { label: string; value: number; count?: number }[]; href?: (label: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted">No data in your scope.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>
            {href ? <Link href={href(r.label)} className="hover:text-teal hover:underline">{r.label}</Link> : r.label}
          </span>
          <span className="h-2.5 rounded-sm bg-rule-soft" aria-hidden>
            <span className="block h-full rounded-sm bg-teal" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="w-24 text-right tabular-nums">
            {formatMoney(r.value, { compact: true })}
            {r.count != null && <span className="ml-1 text-muted">({r.count})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
