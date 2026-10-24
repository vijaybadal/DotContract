/**
 * Electronic-signature provider interface. Production providers (DocuSign, Adobe Acrobat Sign, or
 * whichever the City/County has approved) implement this contract; the CLM never treats a signature
 * as legally complete unless the provider reports completion and supplies the completion certificate.
 */
export type EnvelopeSigner = { order: number; name: string; email: string; role: "AGENCY" | "VENDOR" };
export type CreateEnvelopeInput = {
  subject: string;
  message: string;
  document: { fileName: string; bytes: Buffer; sha256: string };
  signers: EnvelopeSigner[];
  callbackRef: string; // our signature_request id, echoed back in webhooks
};
export type CompletedArtifacts = {
  executed: { fileName: string; mimeType: string; bytes: Buffer };
  certificate: { fileName: string; mimeType: string; bytes: Buffer };
};

export interface ESignProvider {
  readonly name: string;
  /** True for development mocks. Mock completions never produce a legally executed contract. */
  readonly isMock: boolean;
  createEnvelope(input: CreateEnvelopeInput): Promise<{ envelopeId: string }>;
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
  fetchCompletedArtifacts(envelopeId: string, original: CreateEnvelopeInput["document"]): Promise<CompletedArtifacts>;
}
