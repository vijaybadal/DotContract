export function toNumber(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(v: string | number | null | undefined, opts: { compact?: boolean } = {}): string {
  const n = toNumber(v);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.compact || Math.abs(n) >= 1000 ? 0 : 2,
    notation: opts.compact ? "compact" : "standard",
  }).format(n);
}

/** Splits an amount across percentage allocations in whole cents; remainder goes to the largest share. */
export function allocate(amount: number, pcts: number[]): number[] {
  const cents = Math.round(amount * 100);
  const total = pcts.reduce((a, b) => a + b, 0);
  if (total <= 0) return pcts.map(() => 0);
  const raw = pcts.map((p) => Math.floor((cents * p) / total));
  const remainder = cents - raw.reduce((a, b) => a + b, 0);
  const largest = pcts.indexOf(Math.max(...pcts));
  raw[largest] += remainder;
  return raw.map((c) => c / 100);
}
