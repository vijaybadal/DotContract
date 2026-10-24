/**
 * Document storage. Development uses an encrypted local directory (AES-256-GCM per object).
 * Production should use the S3-compatible adapter against approved object storage with
 * server-side encryption and versioning enabled (see docs/INTEGRATIONS.md).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

export class LocalEncryptedStorage implements StorageAdapter {
  readonly name = "local-encrypted";
  constructor(private dir = process.env.STORAGE_DIR ?? "./storage") {}

  private file(key: string) {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    return path.join(this.dir, key);
  }
  async put(key: string, bytes: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key32(), iv);
    const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const out = Buffer.concat([Buffer.from("CLM1"), iv, cipher.getAuthTag(), enc]);
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, out, { flag: "wx" }); // never overwrite: versions are immutable
  }
  async get(key: string) {
    const buf = await readFile(this.file(key));
    if (buf.subarray(0, 4).toString() !== "CLM1") throw new Error("Unrecognized storage format");
    const iv = buf.subarray(4, 16);
    const tag = buf.subarray(16, 32);
    const decipher = createDecipheriv("aes-256-gcm", key32(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]);
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

export function getStorage(): StorageAdapter {
  return process.env.STORAGE_PROVIDER === "s3" ? new S3Storage() : new LocalEncryptedStorage();
}
