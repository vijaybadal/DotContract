import { api, jsonBody } from "@/lib/api";
import { decideRenewal, type RenewalDecisionValue } from "@/lib/renewals";

export const POST = api<{ id: string }>(async (req, actor, { id }) => {
  const b = (await jsonBody(req)) as { decision: RenewalDecisionValue; note?: string };
  return decideRenewal(actor, id, b.decision, b.note);
});
