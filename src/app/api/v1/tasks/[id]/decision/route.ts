import { api, jsonBody } from "@/lib/api";
import { decideTask, legalAction } from "@/lib/workflow";
import { ValidationError } from "@/lib/errors";

/** POST { decision: APPROVE|REJECT|RETURN, comment? } or { legalAction: START|NEGOTIATE|REQUEST_CHANGES|CLEAR, comment? } */
export const POST = api<{ id: string }>(async (req, actor, { id }) => {
  const b = (await jsonBody(req)) as { decision?: string; legalAction?: string; comment?: string };
  if (b.legalAction && ["START", "NEGOTIATE", "REQUEST_CHANGES", "CLEAR"].includes(b.legalAction)) return legalAction(actor, id, b.legalAction as "START", b.comment);
  if (b.decision && ["APPROVE", "REJECT", "RETURN"].includes(b.decision)) return decideTask(actor, id, b.decision as "APPROVE", b.comment);
  throw new ValidationError("Provide decision (APPROVE, REJECT, RETURN) or legalAction.");
});
