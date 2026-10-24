/**
 * Document storage. Every object is encrypted with AES-256-GCM before it leaves the application.
 *
 *  - "local"  (default): encrypted files in STORAGE_DIR. For a single server or a container with a volume.
 *  - "db":     encrypted bytes in PostgreSQL (stored_object table). For serverless hosts such as Vercel,
 *              which have no lasting disk. Suited to demonstrations and modest volumes.
 *  - "s3":     S3-compatible object storage with versioning; the recommended production target
 *              (see docs/INTEGRATIONS.md). Not implemented yet.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NotConfiguredError } from "./errors";

export interface StorageAdapter {
  readonly name: string;
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

function key32(): Buffer {
  const hex = process.env.STORAGE_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("STORAGE_KEY must be 64 hex characters (256-bit key).");
  return Buffer.from(hex, "hex");
}

function assertKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

/** Format: "CLM1" | 12-byte IV | 16-byte tag | ciphertext */
export function encrypt(bytes: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key32(), iv);
  const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from("CLM1"), iv, cipher.getAuthTag(), enc]);
}

export function decrypt(buf: Buffer): Buffer {
  if (buf.subarray(0, 4).toString() !== "CLM1") throw new Error("Unrecognized storage format");
  const decipher = createDecipheriv("aes-256-gcm", key32(), buf.subarray(4, 16));
  decipher.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]);
}

export class LocalEncryptedStorage implements StorageAdapter {
  readonly name = "local-encrypted";
  constructor(private dir = process.env.STORAGE_DIR ?? "./storage") {}
  private file(key: string) {
    assertKey(key);
    return path.join(this.dir, key);
  }
  async put(key: string, bytes: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, encrypt(bytes), { flag: "wx" }); // never overwrite: versions are immutable
  }
  async get(key: string) {
    return decrypt(await readFile(this.file(key)));
  }
}

export class DatabaseEncryptedStorage implements StorageAdapter {
  readonly name = "db-encrypted";
  async put(key: string, bytes: Buffer) {
    assertKey(key);
    const { db } = await import("@/db");
    const { storedObject } = await import("@/db/schema");
    await db.insert(storedObject).values({ key, bytes: encrypt(bytes) }); // primary key: never overwritten
  }
  async get(key: string) {
    assertKey(key);
    const { db } = await import("@/db");
    const { storedObject } = await import("@/db/schema");
    const [row] = await db.select().from(storedObject).where(eq(storedObject.key, key));
    if (!row) throw new Error("Stored object not found");
    return decrypt(row.bytes);
  }
}

export class S3Storage implements StorageAdapter {
  readonly name = "s3";
  async put(): Promise<void> {
    throw new NotConfiguredError("S3 storage is not configured. Provide bucket, region and credentials via the secrets store.");
  }
  async get(): Promise<Buffer> {
    throw new NotConfiguredError("S3 storage is not configured.");
  }
}

export function storageProvider(): "local" | "db" | "s3" {
  const p = process.env.STORAGE_PROVIDER;
  if (p === "db" || p === "s3" || p === "local") return p;
  return process.env.VERCEL ? "db" : "local"; // serverless hosts have no lasting disk
}

export function getStorage(): StorageAdapter {
  switch (storageProvider()) {
    case "db":
      return new DatabaseEncryptedStorage();
    case "s3":
      return new S3Storage();
    default:
      return new LocalEncryptedStorage();
  }
}
