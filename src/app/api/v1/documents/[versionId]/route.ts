import { api } from "@/lib/api";
import { downloadVersion } from "@/lib/documents";

export const GET = api<{ versionId: string }>(async (_req, actor, { versionId }) => {
  const f = await downloadVersion(actor, versionId);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `attachment; filename="${f.fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
