import { api } from "@/lib/api";
import { getContractDetail } from "@/lib/contracts";

export const GET = api<{ id: string }>(async (_req, actor, { id }) => {
  const d = await getContractDetail(actor, id);
  return { ...d.contract, parties: d.orgs, administeredOnBehalf: d.administeredOnBehalf, permissions: d.can };
});
