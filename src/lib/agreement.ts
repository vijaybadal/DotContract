import { and, desc, eq } from "drizzle-orm";
import type { Conn } from "@/db";
import { contractDocument, documentVersion } from "@/db/schema";

/** The latest version of the contract's primary agreement document — what approvals and signatures are pinned to. */
export async function currentAgreementVersion(conn: Conn, contractId: string) {
  const [row] = await conn
    .select({
      versionId: documentVersion.id,
      documentId: contractDocument.id,
      versionNo: documentVersion.versionNo,
      sha256: documentVersion.sha256,
      fileName: documentVersion.fileName,
      scanStatus: documentVersion.scanStatus,
      createdAt: documentVersion.createdAt,
    })
    .from(documentVersion)
    .innerJoin(contractDocument, eq(contractDocument.id, documentVersion.documentId))
    .where(and(eq(contractDocument.contractId, contractId), eq(contractDocument.kind, "AGREEMENT")))
    .orderBy(desc(documentVersion.createdAt), desc(documentVersion.versionNo))
    .limit(1);
  return row ?? null;
}
