/**
 * Contract documents: validated upload, encrypted storage, malware scan gate, immutable versions,
 * Word tracked-change detection and a basic text comparison between versions.
 *
 * Honest scope: the CLM stores .docx files with their tracked changes intact and can tell whether a
 * version contains tracked changes. It does not edit or render Word track changes in the browser;
 * reviewers open the .docx in Word. The comparison view is a word-level diff of extracted text.
 */
import { randomUUID } from "node:crypto";
import { diffWords } from "diff";
import JSZip from "jszip";
import { and, desc, eq, max } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { contract, contractDocument, contractRequest, documentVersion, workflowInstance, workflowTask } from "@/db/schema";
import { sha256, writeAudit } from "./audit";
import {
  assertCanViewContract,
  getOrgIndex,
  hasRole,
  isContractAdminFor,
  seesEverything,
  type Actor,
} from "./authz";
import { ForbiddenError, NotFoundError, StateError, ValidationError } from "./errors";
import { getScanner } from "./scan";
import { getSetting } from "./settings";
import { getStorage } from "./storage";
import { applyMaterialChange } from "./workflow";

export type DocKind = (typeof contractDocument.$inferSelect)["kind"];
export const USER_UPLOADABLE_KINDS: DocKind[] = ["AGREEMENT", "REDLINE", "EXHIBIT", "SOW", "QUOTE", "SUPPORTING"];

const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: ["application/msword"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt: ["text/plain"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};

export type IncomingFile = { name: string; type: string; bytes: Buffer };

export async function validateFile(f: IncomingFile) {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = await getSetting("documents.allowedExtensions");
  const maxBytes = await getSetting("documents.maxBytes");
  if (!allowed.includes(ext)) throw new ValidationError(`Files of type .${ext || "?"} are not accepted. Allowed: ${allowed.join(", ")}.`);
  if (f.bytes.length === 0) throw new ValidationError("The file is empty.");
  if (f.bytes.length > maxBytes) throw new ValidationError(`File exceeds the ${Math.round(maxBytes / 1048576)} MB limit.`);
  const okMimes = MIME_BY_EXT[ext] ?? [];
  const mime = f.type && f.type !== "application/octet-stream" ? f.type : okMimes[0];
  if (okMimes.length && !okMimes.includes(mime)) throw new ValidationError(`File type ${f.type} does not match extension .${ext}.`);
  // Magic-number check for the formats that have one
  const head = f.bytes.subarray(0, 4).toString("binary");
  if (ext === "pdf" && !head.startsWith("%PDF")) throw new ValidationError("File is not a valid PDF.");
  if ((ext === "docx" || ext === "xlsx") && !head.startsWith("PK")) throw new ValidationError(`File is not a valid .${ext}.`);
  return { ext, mime };
}

/** Extracts readable text from .docx (accepted-changes view) and .txt; flags tracked changes. */
export async function analyzeDocument(ext: string, bytes: Buffer): Promise<{ text: string | null; hasTrackedChanges: boolean | null }> {
  if (ext === "txt") return { text: bytes.toString("utf8").slice(0, 2_000_000), hasTrackedChanges: null };
  if (ext !== "docx") return { text: null, hasTrackedChanges: null };
  try {
    const zip = await JSZip.loadAsync(bytes);
    // Guard against decompression bombs before inflating the document body.
    const entry = zip.file("word/document.xml") as unknown as { _data?: { uncompressedSize?: number } } | null;
    const declared = entry?._data?.uncompressedSize ?? 0;
    const total = Object.values(zip.files).reduce((n, f) => n + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
    if (declared > 50 * 1024 * 1024 || total > 200 * 1024 * 1024) throw new ValidationError("The .docx expands to an unreasonable size and was rejected.");
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    const hasTrackedChanges = /<w:(ins|del|moveFrom|moveTo)\b/.test(xml);
    const text = xml
      .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, "") // deletions removed: text as if changes accepted
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, hasTrackedChanges };
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError("The .docx file could not be read; it may be corrupt or password-protected.");
  }
}

async function canUpload(tx: Tx, actor: Actor, c: typeof contract.$inferSelect) {
  const idx = await getOrgIndex(tx);
  if (isContractAdminFor(actor, c, idx)) return true;
  if (c.ownerId === actor.id || c.serviceOwnerId === actor.id) return true;
  if (c.legalReviewOrgId && hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId)) return true;
  const [req] = await tx
    .select({ id: contractRequest.id })
    .from(contractRequest)
    .where(and(eq(contractRequest.contractId, c.id), eq(contractRequest.requesterId, actor.id)))
    .limit(1);
  return Boolean(req);
}

export type UploadInput = {
  contractId: string;
  documentId?: string; // add a new version to an existing document
  title?: string;
  kind?: DocKind;
  confidential?: boolean;
  note?: string;
  isMaterialChange?: boolean;
  file: IncomingFile;
  /** internal callers (signature completion) may store system-generated kinds */
  system?: boolean;
};

export async function uploadDocument(actor: Actor, input: UploadInput, outer?: Tx) {
  const { ext, mime } = await validateFile(input.file);
  const analysis = await analyzeDocument(ext, input.file.bytes);
  const scan = await getScanner().scan(input.file.bytes);
  const hash = sha256(input.file.bytes);
  const storageKey = `${input.contractId}/${randomUUID()}.${ext}.enc`;

  const run = async (tx: Tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, input.contractId));
    if (!c) throw new NotFoundError("Contract");
    if (!input.system) await assertCanViewContract(actor, c, tx);
    if (!input.system && !(await canUpload(tx, actor, c))) throw new ForbiddenError("You cannot add documents to this contract.");
    if (["ARCHIVED", "CANCELLED"].includes(c.status)) throw new StateError(`Contract is ${c.status.toLowerCase()}.`);

    let doc: typeof contractDocument.$inferSelect;
    if (input.documentId) {
      const [d] = await tx.select().from(contractDocument).where(eq(contractDocument.id, input.documentId));
      if (!d || d.contractId !== c.id) throw new NotFoundError("Document");
      doc = d;
    } else {
      const kind = input.kind ?? "SUPPORTING";
      if (!input.system && !USER_UPLOADABLE_KINDS.includes(kind)) throw new ValidationError(`Documents of kind ${kind} are created by the system.`);
      if (kind === "AGREEMENT") {
        const [existing] = await tx
          .select({ id: contractDocument.id })
          .from(contractDocument)
          .where(and(eq(contractDocument.contractId, c.id), eq(contractDocument.kind, "AGREEMENT")));
        if (existing) throw new ValidationError("This contract already has an agreement document. Upload a new version of it instead.");
      }
      [doc] = await tx
        .insert(contractDocument)
        .values({
          contractId: c.id,
          title: input.title?.trim() || input.file.name,
          kind,
          confidential: Boolean(input.confidential),
          createdById: actor.id,
        })
        .returning();
    }
    if (!input.system && ["EXECUTED", "SIGNATURE_CERTIFICATE"].includes(doc.kind)) throw new ForbiddenError("Executed documents are created by the signature process.");
    if (doc.kind === "AGREEMENT" && ["SENT", "PARTIALLY_SIGNED"].includes(c.signatureStatus)) {
      throw new StateError("The agreement is out for signature. Void the signature request before uploading a new version.");
    }
    if (doc.kind === "AGREEMENT" && ["EXECUTED", "EXECUTED_EXTERNALLY", "DEMO_EXECUTED"].includes(c.signatureStatus) && !input.system) {
      throw new StateError("The agreement is executed. Changes require an amendment.");
    }

    const [{ v }] = await tx.select({ v: max(documentVersion.versionNo) }).from(documentVersion).where(eq(documentVersion.documentId, doc.id));
    await getStorage().put(storageKey, input.file.bytes);
    const [ver] = await tx
      .insert(documentVersion)
      .values({
        documentId: doc.id,
        versionNo: (v ?? 0) + 1,
        fileName: input.file.name,
        mimeType: mime,
        sizeBytes: input.file.bytes.length,
        sha256: hash,
        storageKey,
        uploadedById: actor.id,
        note: input.note ?? null,
        isMaterialChange: Boolean(input.isMaterialChange),
        hasTrackedChanges: analysis.hasTrackedChanges,
        extractedText: analysis.text,
        scanStatus: scan.status,
      })
      .returning();
    await writeAudit(tx, {
      actorId: actor.id,
      action: "DOCUMENT_VERSION_UPLOADED",
      entityType: "document_version",
      entityId: ver.id,
      contractId: c.id,
      data: { document: doc.title, kind: doc.kind, version: ver.versionNo, sha256: hash, scan: scan.status, material: ver.isMaterialChange, trackedChanges: analysis.hasTrackedChanges },
    });
    if (scan.status === "INFECTED") {
      await writeAudit(tx, { actorId: actor.id, action: "DOCUMENT_QUARANTINED", entityType: "document_version", entityId: ver.id, contractId: c.id, data: { signature: scan.signature } });
    }
    let reopened = 0;
    // A new agreement version after approvals began invalidates those approvals when:
    //  - the uploader marked it a material change (re-opens Legal and other flagged steps), or
    //  - Legal review was waived, so no Legal clearance vouches for the new text (re-opens every approval).
    const inReview = ["IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE"].includes(c.status);
    if (doc.kind === "AGREEMENT" && !input.system && inReview && (ver.isMaterialChange || !c.legalRequired)) {
      const why = input.note?.trim() || `New agreement version ${ver.versionNo}`;
      reopened = (await applyMaterialChange(tx, actor, c.id, why, { reopenAll: !c.legalRequired })).reopened;
    }
    return { document: doc, version: ver, scan, reopened };
  };
  return outer ? run(outer) : db.transaction(run);
}

async function loadVersion(versionId: string) {
  const [row] = await db
    .select({ v: documentVersion, d: contractDocument, c: contract })
    .from(documentVersion)
    .innerJoin(contractDocument, eq(contractDocument.id, documentVersion.documentId))
    .innerJoin(contract, eq(contract.id, contractDocument.contractId))
    .where(eq(documentVersion.id, versionId));
  if (!row) throw new NotFoundError("Document");
  return row;
}

export async function canSeeConfidential(actor: Actor, c: typeof contract.$inferSelect, uploaderId?: string) {
  const idx = await getOrgIndex();
  return (
    seesEverything(actor, idx) ||
    isContractAdminFor(actor, c, idx) ||
    c.ownerId === actor.id ||
    c.serviceOwnerId === actor.id ||
    uploaderId === actor.id ||
    (c.legalReviewOrgId != null && hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId))
  );
}

export async function downloadVersion(actor: Actor, versionId: string) {
  const { v, d, c } = await loadVersion(versionId);
  await assertCanViewContract(actor, c);
  if ((d.confidential || c.confidential) && !(await canSeeConfidential(actor, c, v.uploadedById))) {
    throw new ForbiddenError("This document is marked confidential.");
  }
  if (v.scanStatus !== "CLEAN") throw new StateError(v.scanStatus === "INFECTED" ? "This file is quarantined by the malware scan." : "This file has not finished scanning.");
  const bytes = await getStorage().get(v.storageKey);
  if (sha256(bytes) !== v.sha256) throw new StateError("Stored file failed its integrity check. Contact the CLM administrator.");
  await db.transaction((tx) =>
    writeAudit(tx, { actorId: actor.id, action: "DOCUMENT_DOWNLOADED", entityType: "document_version", entityId: v.id, contractId: c.id, data: { file: v.fileName, version: v.versionNo } }),
  );
  return { bytes, fileName: v.fileName, mimeType: v.mimeType };
}

export async function compareVersions(actor: Actor, fromVersionId: string, toVersionId: string) {
  const a = await loadVersion(fromVersionId);
  const b = await loadVersion(toVersionId);
  if (a.c.id !== b.c.id) throw new ValidationError("Versions belong to different contracts.");
  await assertCanViewContract(actor, a.c);
  if ((a.d.confidential || b.d.confidential || a.c.confidential) && !(await canSeeConfidential(actor, a.c))) {
    throw new ForbiddenError("This document is marked confidential.");
  }
  if (a.v.scanStatus !== "CLEAN" || b.v.scanStatus !== "CLEAN") {
    return { supported: false as const, reason: "One of these versions has not passed the malware scan." };
  }
  if (a.v.extractedText == null || b.v.extractedText == null) {
    return { supported: false as const, reason: "Text comparison is available for .docx and .txt versions only." };
  }
  const parts = diffWords(a.v.extractedText, b.v.extractedText);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);
  return {
    supported: true as const,
    from: { versionNo: a.v.versionNo, fileName: a.v.fileName, document: a.d.title },
    to: { versionNo: b.v.versionNo, fileName: b.v.fileName, document: b.d.title },
    added,
    removed,
    parts: parts.map((p) => ({ value: p.value, added: Boolean(p.added), removed: Boolean(p.removed) })),
  };
}

export async function listDocuments(contractId: string) {
  return db.query.contractDocument.findMany({
    where: eq(contractDocument.contractId, contractId),
    orderBy: desc(contractDocument.createdAt),
    with: { versions: { orderBy: desc(documentVersion.versionNo), with: { uploadedBy: true } } },
  });
}

/** True if the actor has a pending task on the contract (used to allow reviewers to see the agreement). */
export async function hasOpenTaskOn(contractId: string) {
  const rows = await db
    .select({ id: workflowTask.id })
    .from(workflowTask)
    .innerJoin(workflowInstance, eq(workflowInstance.id, workflowTask.instanceId))
    .where(and(eq(workflowInstance.contractId, contractId), eq(workflowTask.status, "PENDING")));
  return rows.length > 0;
}
