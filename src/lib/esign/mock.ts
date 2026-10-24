import { randomUUID } from "node:crypto";
import type { CompletedArtifacts, CreateEnvelopeInput, ESignProvider } from "./provider";

/**
 * DEVELOPMENT MOCK — not an electronic signature service.
 * Envelopes are simulated; "signing" is triggered from the Signatures screen (dev only).
 * Completed contracts are marked DEMO_EXECUTED and banner-flagged as not legally executed.
 */
export class MockESignProvider implements ESignProvider {
  readonly name = "mock";
  readonly isMock = true;

  async createEnvelope(input: CreateEnvelopeInput) {
    if (!input.signers.length) throw new Error("At least one signer is required");
    return { envelopeId: `MOCK-${randomUUID().slice(0, 8).toUpperCase()}` };
  }
  async voidEnvelope() {}
  async fetchCompletedArtifacts(envelopeId: string, original: CreateEnvelopeInput["document"]): Promise<CompletedArtifacts> {
    const cert = [
      "DEMO SIGNATURE CERTIFICATE — NOT A LEGAL EXECUTION",
      "======================================================",
      `Envelope: ${envelopeId}`,
      `Document: ${original.fileName}`,
      `SHA-256:  ${original.sha256}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "This record was produced by the CLM development mock e-signature adapter.",
      "No signature was applied and no party has executed this agreement.",
    ].join("\n");
    const ext = original.fileName.split(".").pop() ?? "pdf";
    return {
      executed: { fileName: `DEMO-NOT-EXECUTED-${original.fileName.replace(/\.[^.]+$/, "")}.${ext}`, mimeType: mimeFor(ext), bytes: original.bytes },
      certificate: { fileName: `DEMO-certificate-${envelopeId}.txt`, mimeType: "text/plain", bytes: Buffer.from(cert, "utf8") },
    };
  }
}

function mimeFor(ext: string) {
  return ext === "pdf"
    ? "application/pdf"
    : ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "text/plain";
}
