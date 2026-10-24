import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { canAdministerWorkflows, getOrgIndex, ROLE_KEYS } from "@/lib/authz";
import { listDefinitions } from "@/lib/workflow-admin";
import { listContracts, REQUEST_TYPES } from "@/lib/contracts";
import { describe, type Rule } from "@/lib/rules";
import { formatDateTime } from "@/lib/dates";
import { Notice, PageHeader, Panel, Pill } from "@/components/ui";
import { RoutingPreview, WorkflowEditor } from "@/components/client/admin-panels";

export const metadata: Metadata = { title: "Approval workflows" };
export const dynamic = "force-dynamic";

const SCOPES = ["REQUESTING_DEPT", "BENEFITING_AGENCY", "CONTRACTING_ENTITY", "ADMINISTERING_ORG", "LEGAL_AUTHORITY"];

export default async function Workflows({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const actor = await requireActor();
  if (!canAdministerWorkflows(actor, await getOrgIndex())) return <Notice tone="amber" title="Enterprise contract administrators only" />;
  const defs = await listDefinitions();
  const active = defs.filter((d) => d.active);
  const contracts = (await listContracts(actor, { limit: 200 })).map((c) => ({ id: c.id, number: c.number, title: c.title }));
  return (
    <>
      <PageHeader title="Approval workflows" lede="Who approves what, in which order, and when. Publishing creates a new version; requests already in progress keep the version they started with." />
      <Notice tone="amber" title="Demonstration thresholds">The dollar thresholds and routing below are placeholders. Replace them with the approval matrix adopted by the City, County and DOTComm.</Notice>
      <div className="mt-5 space-y-5">
        {active.map((d) => (
          <Panel key={d.id} title={<span>{d.name} <span className="font-normal text-muted">v{d.version}</span></span>} actions={<a href={edit === d.key ? "/admin/workflows" : `/admin/workflows?edit=${d.key}`} className="text-sm font-semibold text-teal hover:underline">{edit === d.key ? "Close editor" : "Edit"}</a>}>
            <p className="text-sm text-muted">{d.description}</p>
            <p className="mt-2 text-sm">Used for: {d.requestTypes.map((t) => t.replace(/_/g, " ").toLowerCase()).join(", ")}</p>
            {Object.keys(d.variables).length > 0 && <p className="mt-1 text-sm">Policy values: {Object.entries(d.variables).map(([k, v]) => `${k} = ${v}`).join("; ")}</p>}
            {edit === d.key ? (
              <div className="mt-5 border-t border-rule pt-5">
                <WorkflowEditor
                  defKey={d.key}
                  initial={{ name: d.name, description: d.description, requestTypes: d.requestTypes, variables: d.variables, steps: d.steps.map((s) => ({ key: s.key, name: s.name, stage: s.stage, kind: s.kind, roleKey: s.roleKey, scope: s.scope, condition: s.condition, dueDays: s.dueDays, reapproveOnMaterialChange: s.reapproveOnMaterialChange })) }}
                  roles={[...ROLE_KEYS]}
                  scopes={SCOPES}
                  requestTypes={[...REQUEST_TYPES]}
                />
              </div>
            ) : (
              <ol className="mt-4 space-y-3">
                {[...new Set(d.steps.map((s) => s.stage))].map((stage) => (
                  <li key={stage} className="grid gap-2 sm:grid-cols-[5rem_1fr]">
                    <span className="text-sm font-semibold text-muted">Stage {stage}</span>
                    <ul className="grid gap-2 md:grid-cols-2">
                      {d.steps.filter((s) => s.stage === stage).map((s) => (
                        <li key={s.id} className="rounded border border-rule px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{s.name}</span>{s.kind === "LEGAL_REVIEW" && <Pill tone="teal">Legal</Pill>}</div>
                          <p className="text-[0.8rem] text-muted">{s.roleKey.replace(/_/g, " ").toLowerCase()} for the {s.scope.replace(/_/g, " ").toLowerCase()} · due in {s.dueDays} days{s.reapproveOnMaterialChange && " · re-approves on material change"}</p>
                          <p className="mt-1 text-[0.8rem]">When: {describe(s.condition as Rule)}</p>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-5 border-t border-rule pt-4"><RoutingPreview definitionId={d.id} contracts={contracts} /></div>
          </Panel>
        ))}
        <Panel title="Version history" flush>
          <table className="tbl">
            <thead><tr><th>Workflow</th><th>Version</th><th>Published</th><th>Status</th></tr></thead>
            <tbody>{defs.map((d) => <tr key={d.id}><td>{d.name}</td><td>v{d.version}</td><td className="text-[0.85rem]">{formatDateTime(d.createdAt)}</td><td>{d.active ? <Pill tone="green">Active</Pill> : <Pill>Retired</Pill>}</td></tr>)}</tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
