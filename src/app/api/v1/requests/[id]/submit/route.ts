import { api } from "@/lib/api";
import { submitRequest } from "@/lib/contracts";

export const POST = api<{ id: string }>(async (_req, actor, { id }) => ({ workflowInstanceId: await submitRequest(actor, id) }));
