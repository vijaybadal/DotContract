import { sql } from "drizzle-orm";
import type { Conn } from "@/db";
import { counter } from "@/db/schema";

/** Gap-tolerant, concurrency-safe numbering: CTR-2026-0001, REQ-2026-0001. */
export async function nextNumber(tx: Conn, prefix: "CTR" | "REQ", year = new Date().getFullYear()): Promise<string> {
  const name = `${prefix}-${year}`;
  const [row] = await tx
    .insert(counter)
    .values({ name, value: 1 })
    .onConflictDoUpdate({ target: counter.name, set: { value: sql`${counter.value} + 1` } })
    .returning({ value: counter.value });
  return `${name}-${String(row.value).padStart(4, "0")}`;
}
