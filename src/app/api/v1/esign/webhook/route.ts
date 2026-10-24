import { NotConfiguredError } from "@/lib/errors";
import { errorResponse } from "@/lib/api";

/**
 * Provider callback endpoint (DocuSign Connect / Acrobat Sign webhooks).
 * Production implementation: verify the provider's HMAC signature with a secret from the secrets
 * store, map the envelope id to signature_request.provider_envelope_id, then call applySignerSigned()
 * for each completed recipient. Until a provider is configured this endpoint refuses all calls.
 */
export async function POST() {
  return errorResponse(new NotConfiguredError("No e-signature provider is configured for webhooks."));
}
