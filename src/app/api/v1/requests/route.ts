import { api, jsonBody } from "@/lib/api";
import { createRequest, listRequests } from "@/lib/contracts";

export const GET = api(async (req, actor) => (await listRequests(actor, new URL(req.url).searchParams.get("scope") === "all" ? "all" : "mine")).map((r) => ({ ...r.r, contract: { id: r.c.id, number: r.c.number, title: r.c.title, status: r.c.status } })));
/** POST intake payload (see intakeSchema in src/lib/contracts.ts) — creates a draft request and contract. */
export const POST = api(async (req, actor) => createRequest(actor, await jsonBody(req)));
