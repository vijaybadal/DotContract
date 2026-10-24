/**
 * Calendar-date helpers. Contract dates are plain 'YYYY-MM-DD' strings so that a deadline is the same
 * day for everyone; "today" is always computed in the contracting entity's time zone.
 */
export type ISODate = string;

export function todayIn(timeZone = "America/Chicago", now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toUtc(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}
function fromUtc(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUtc(toUtc(d) + n * 86_400_000);
}

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target.getTime());
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function monthsBetween(a: ISODate, b: ISODate): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1 - 1) months -= 1; // partial month
  return Math.max(0, months);
}

export function isValidISODate(s: unknown): s is ISODate {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined, timeZone = "America/Chicago"): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Non-renewal notice deadline: expiration minus notice days (null if either is unknown). */
export function noticeDeadline(expiration: ISODate | null, noticeDays: number | null): ISODate | null {
  if (!expiration) return null;
  if (noticeDays == null || noticeDays <= 0) return expiration;
  return addDays(expiration, -noticeDays);
}
