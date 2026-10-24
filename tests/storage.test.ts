/** Database-backed storage used on Vercel: encrypted at rest, immutable, integrity-checked. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { DatabaseEncryptedStorage, decrypt, storageProvider } from "@/lib/storage";
import { resetAndSeed } from "./helpers";

beforeAll(async () => {
  await resetAndSeed();
});

describe("database storage", () => {
  const store = new DatabaseEncryptedStorage();

  it("round-trips bytes and stores only ciphertext", async () => {
    await store.put("t/1.txt.enc", Buffer.from("VENDOR-PRICING-42"));
    expect((await store.get("t/1.txt.enc")).toString()).toBe("VENDOR-PRICING-42");
    const [row] = await db.select().from(s.storedObject).where(eq(s.storedObject.key, "t/1.txt.enc"));
    expect(row.bytes.includes(Buffer.from("VENDOR-PRICING-42"))).toBe(false);
    expect(decrypt(row.bytes).toString()).toBe("VENDOR-PRICING-42");
  });

  it("never overwrites, and the database refuses edits", async () => {
    await expect(store.put("t/1.txt.enc", Buffer.from("other"))).rejects.toThrow();
    const err = await db.execute(sql`update stored_object set bytes = '\\x00' where key = 't/1.txt.enc'`).then(() => "no error", (e) => String(e.cause?.message ?? e));
    expect(err).toMatch(/append-only/);
  });

  it("detects tampered ciphertext", async () => {
    await db.execute(sql`alter table stored_object disable trigger stored_object_append_only`);
    await db.execute(sql`update stored_object set bytes = overlay(bytes placing '\\xff'::bytea from 40 for 1) where key = 't/1.txt.enc'`);
    await db.execute(sql`alter table stored_object enable trigger stored_object_append_only`);
    await expect(store.get("t/1.txt.enc")).rejects.toThrow();
  });

  it("rejects unsafe keys", async () => {
    await expect(store.put("../etc/passwd", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
  });

  it("is selected automatically on Vercel", () => {
    const saved = { v: process.env.VERCEL, p: process.env.STORAGE_PROVIDER };
    delete process.env.STORAGE_PROVIDER;
    process.env.VERCEL = "1";
    expect(storageProvider()).toBe("db");
    delete process.env.VERCEL;
    expect(storageProvider()).toBe("local");
    if (saved.v) process.env.VERCEL = saved.v;
    if (saved.p) process.env.STORAGE_PROVIDER = saved.p;
  });
});
