import { api } from "@/lib/api";
import { listContracts } from "@/lib/contracts";
import { filtersFrom } from "@/lib/contract-filters";

/** GET /api/v1/contracts — contracts visible to the caller (same filters as the repository page). */
export const GET = api(async (req, actor) => {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  return listContracts(actor, { ...filtersFrom(sp), limit: Number(sp.limit ?? 200), offset: Number(sp.offset ?? 0) });
});
