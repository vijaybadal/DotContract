import { api } from "@/lib/api";
import { canRunJobs, getOrgIndex } from "@/lib/authz";
import { ForbiddenError } from "@/lib/errors";
import { runAllJobs } from "@/lib/jobs";

export const POST = api(async (_req, actor) => {
  if (!canRunJobs(actor, await getOrgIndex())) throw new ForbiddenError();
  return runAllJobs();
});
