import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { listContracts, referenceData } from "@/lib/contracts";
import { filtersFrom, type FilterParams } from "@/lib/contract-filters";
import { getOrgIndex } from "@/lib/authz";
import { DateText, Empty, LinkButton, Money, PageHeader, Panel, Pill, Status } from "@/components/ui";
import { LifecycleRail } from "@/components/lifecycle-rail";
import { daysBetween, todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  ["", "All except cancelled"],
  ["ACTIVE", "Active"],
  ["OPEN_REQUESTS", "In approval pipeline"],
  ["DRAFT", "Draft"],
  ["IN_REVIEW", "In review"],
  ["IN_LEGAL", "In legal review"],
  ["PENDING_SIGNATURE", "Awaiting signature"],
  ["EXPIRED", "Expired"],
  ["CANCELLED", "Cancelled"],
];

type SP = FilterParams;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const [rows, ref, idx] = await Promise.all([listContracts(actor, filtersFrom(sp)), referenceData(), getOrgIndex()]);
  const today = todayIn();
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const filtered = Object.values(sp).some(Boolean);
  const govs = ref.orgs.filter((o) => o.isLegalEntity);

  return (
    <>
      <PageHeader
        title="Contracts"
        lede="Every technology agreement the City, the County and DOTComm hold, in the scope of your roles."
        actions={
          <>
            <LinkButton href={`/api/v1/contracts/export?${qs}`}>Export CSV</LinkButton>
            <LinkButton href="/requests/new" variant="primary">New contract request</LinkButton>
          </>
        }
      />
      <form className="mb-4 grid gap-3 rounded-md border border-rule bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter contracts">
        <label className="field lg:col-span-2">
          <span>Search</span>
          <input className="input" name="q" defaultValue={sp.q} placeholder="Title, number, vendor, purpose" />
        </label>
        <label className="field">
          <span>Status</span>
          <select className="input" name="status" defaultValue={sp.status ?? ""}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select className="input" name="type" defaultValue={sp.type ?? ""}>
            <option value="">All categories</option>
            {ref.types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Agency</span>
          <select className="input" name="org" defaultValue={sp.org ?? ""}>
            <option value="">All agencies</option>
            {govs.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={g.id}>All of {g.name}</option>
                {ref.orgs.filter((o) => o.parentId === g.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vendor</span>
          <select className="input" name="vendor" defaultValue={sp.vendor ?? ""}>
            <option value="">All vendors</option>
            {ref.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Expiring within</span>
          <select className="input" name="expiring" defaultValue={sp.expiring ?? ""}>
            <option value="">Any time</option>
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sort by</span>
          <select className="input" name="sort" defaultValue={sp.sort ?? ""}>
            <option value="">Expiration date</option>
            <option value="value">Total value</option>
            <option value="updated">Recently updated</option>
            <option value="number">Contract number</option>
          </select>
        </label>
        <fieldset className="flex flex-wrap items-end gap-4 text-sm lg:col-span-3">
          <legend className="sr-only">More filters</legend>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="onbehalf" value="1" defaultChecked={sp.onbehalf === "1"} /> Administered by DOTComm for another entity</label>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="autorenew" value="1" defaultChecked={sp.autorenew === "1"} /> Auto-renewing</label>
        </fieldset>
        <div className="flex items-end gap-2">
          <button className="rounded-md bg-teal px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-ink">Apply</button>
          {filtered && <Link href="/contracts" className="px-2 py-2 text-sm font-semibold text-teal hover:underline">Clear</Link>}
        </div>
      </form>

      <Panel flush title={`${rows.length} contract${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty title="No contracts match these filters" action={<LinkButton href="/contracts">Clear filters</LinkButton>}>
            Try a broader search, or check that the agency is within your role scope.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Contract</th><th>Vendor</th><th>Contracting entity / administrator</th><th>Lifecycle</th><th className="num">Total value</th><th>Expires</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const left = c.expirationDate ? daysBetween(today, c.expirationDate) : null;
                  return (
                    <tr key={c.id}>
                      <td className="min-w-64">
                        <Link href={`/contracts/${c.id}`} className="font-semibold hover:text-teal hover:underline">{c.title}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.8rem] text-muted">
                          <span>{c.number}</span>
                          <span>·</span>
                          <span>{c.typeName}</span>
                          {c.executionIsDemo && <Pill tone="red">Demo execution</Pill>}
                        </div>
                      </td>
                      <td className="text-[0.85rem]">{c.vendorName ?? "—"}</td>
                      <td className="text-[0.85rem]">
                        {c.entityName}
                        {c.administeredOnBehalf && <div className="text-[0.8rem] text-muted">Administered by {idx.legalEntityOf(c.administeringOrgId)?.name}</div>}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <LifecycleRail c={c} compact />
                          {c.status !== "ACTIVE" && <Status value={c.status} />}
                        </div>
                      </td>
                      <td className="num"><Money value={c.totalValue} /></td>
                      <td className="whitespace-nowrap text-[0.85rem]">
                        <DateText value={c.expirationDate} />
                        {c.status === "ACTIVE" && left != null && left <= 90 && <div className={left <= 30 ? "font-semibold text-red" : "font-semibold text-amber"}>{left} days</div>}
                        {c.autoRenew && <div className="text-[0.8rem] text-muted">auto-renews</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
