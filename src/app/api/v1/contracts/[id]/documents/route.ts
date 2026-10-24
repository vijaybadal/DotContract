import { api } from "@/lib/api";
import { canSeeConfidential, listDocuments, uploadDocument, type DocKind } from "@/lib/documents";
import { getContractDetail } from "@/lib/contracts";
import { ValidationError } from "@/lib/errors";

export const GET = api<{ id: string }>(async (_req, actor, { id }) => {
  const { contract } = await getContractDetail(actor, id); // visibility check
  const privileged = await canSeeConfidential(actor, contract);
  return (await listDocuments(id)).map((d) => {
    if ((d.confidential || contract.confidential) && !privileged) {
      return { id: d.id, kind: d.kind, confidential: true, title: "Confidential document", versions: d.versions.map((v) => ({ id: v.id, versionNo: v.versionNo, createdAt: v.createdAt })) };
    }
    return { ...d, versions: d.versions.map(({ storageKey: _s, extractedText: _t, uploadedBy, ...v }) => ({ ...v, uploadedBy: { id: uploadedBy.id, name: uploadedBy.name } })) };
  });
});

/** multipart/form-data: file, kind?, documentId?, title?, note?, confidential?, material? */
export const POST = api<{ id: string }>(async (req, actor, { id }) => {
  const f = await req.formData();
  const file = f.get("file");
  if (!(file instanceof File)) throw new ValidationError("Attach a file in the 'file' field.");
  const r = await uploadDocument(actor, {
    contractId: id,
    documentId: (f.get("documentId") as string) || undefined,
    kind: ((f.get("kind") as string) || "SUPPORTING") as DocKind,
    title: (f.get("title") as string) || undefined,
    note: (f.get("note") as string) || undefined,
    confidential: f.get("confidential") === "true",
    isMaterialChange: f.get("material") === "true",
    file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
  });
  return { documentId: r.document.id, versionId: r.version.id, versionNo: r.version.versionNo, sha256: r.version.sha256, scan: r.scan.status, reopenedSteps: r.reopened };
});
