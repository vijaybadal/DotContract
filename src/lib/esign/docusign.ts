import { NotConfiguredError } from "../errors";
import type { CompletedArtifacts, ESignProvider } from "./provider";

/**
 * Production adapter skeleton. Implementation notes (docs/INTEGRATIONS.md):
 *  - Auth: JWT grant with an integration key and RSA key held in the secrets store.
 *  - createEnvelope: POST /envelopes with documents + recipients (routingOrder = signer.order),
 *    eventNotification webhook → /api/v1/esign/webhook (HMAC-verified).
 *  - fetchCompletedArtifacts: GET combined document + certificate of completion.
 * Requires the City/County's DocuSign (or Acrobat Sign) account, credentials and approval.
 */
export class DocuSignProvider implements ESignProvider {
  readonly name = "docusign";
  readonly isMock = false;
  async createEnvelope(): Promise<{ envelopeId: string }> {
    throw new NotConfiguredError(
      process.env.NODE_ENV === "production" && process.env.ESIGN_PROVIDER !== "docusign"
        ? "No e-signature provider is configured. The development mock is disabled in production; set ALLOW_MOCK_ESIGN=true only for a demonstration server, or record a signature obtained outside the CLM."
        : "DocuSign is not configured for this environment. Record a signature obtained outside the CLM instead.",
    );
  }
  async voidEnvelope(): Promise<void> {
    throw new NotConfiguredError("DocuSign is not configured.");
  }
  async fetchCompletedArtifacts(): Promise<CompletedArtifacts> {
    throw new NotConfiguredError("DocuSign is not configured.");
  }
}
