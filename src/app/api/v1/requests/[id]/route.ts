import { api, jsonBody } from "@/lib/api";
import { getRequest, updateRequest } from "@/lib/contracts";

export const GET = api<{ id: string }>(async (_req, actor, { id }) => (await getRequest(actor, id)).request);
export const PATCH = api<{ id: string }>(async (req, actor, { id }) => updateRequest(actor, id, await jsonBody(req)));
