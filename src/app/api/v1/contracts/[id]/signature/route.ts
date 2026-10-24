import { api, jsonBody } from "@/lib/api";
import { sendForSignature } from "@/lib/signing";

/** POST { signerUserId, vendorSignerName?, vendorSignerEmail?, message? } */
export const POST = api<{ id: string }>(async (req, actor, { id }) => sendForSignature(actor, id, await jsonBody(req)));
