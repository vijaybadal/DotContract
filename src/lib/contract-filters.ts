import type { ContractFilters } from "./contracts";

export type FilterParams = { q?: string; status?: string; type?: string; org?: string; vendor?: string; expiring?: string; onbehalf?: string; autorenew?: string; sort?: string };

export function filtersFrom(sp: FilterParams): ContractFilters {
  return {
    q: sp.q,
    status: sp.status,
    typeKey: sp.type,
    orgId: sp.org,
    vendorId: sp.vendor,
    expiringDays: sp.expiring ? Number(sp.expiring) : undefined,
    administeredOnBehalf: sp.onbehalf === "1",
    autoRenew: sp.autorenew === "1",
    sort: (sp.sort as ContractFilters["sort"]) || undefined,
  };
}
