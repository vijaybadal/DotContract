import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { appSetting, role, user, userRoleAssignment } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { canAdministerWorkflows, getOrgIndex, isSystemAdmin, type Org } from "@/lib/authz";
import { Notice, PageHeader, Panel, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Organizations & roles" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const actor = await requireActor();
  const idx = await getOrgIndex(db, true);
  if (!canAdministerWorkflows(actor, idx) && !isSystemAdmin(actor, idx)) return <Notice tone="amber" title="Administrators only">You need the System Administrator or enterprise Contract Administrator role.</Notice>;
  const [users, assignments, roles, settings] = await Promise.all([
    db.select().from(user).orderBy(asc(user.name)),
    db.select().from(userRoleAssignment),
    db.select().from(role),
    db.select().from(appSetting),
  ]);
  const roots = idx.all().filter((o) => !o.parentId);
  const tree = (o: Org, depth = 0): React.ReactNode => (
    <li key={o.id}>
      <div className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 18 }}>
        <span className={depth === 0 ? "font-semibold" : ""}>{o.name}</span>
        <span className="text-[0.75rem] text-muted">{o.code}</span>
        {o.isLegalEntity && <Pill tone="teal">Legal entity</Pill>}
        {o.legalAuthorityId && <span className="text-[0.75rem] text-muted">Legal review: {idx.name(o.legalAuthorityId)}</span>}
      </div>
      <ul>{(idx.children.get(o.id) ?? []).map((c) => tree(idx.get(c)!, depth + 1))}</ul>
    </li>
  );
  return (
    <>
      <PageHeader title="Organizations & roles" lede="The organization hierarchy, who holds which role where, and platform settings. Organizations and roles are data, not code." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Organizations">
          <ul>{roots.map((r) => tree(r))}</ul>
          <p className="mt-3 text-[0.8rem] text-muted">Phase 1 manages organizations through the seed/import scripts; an editing screen is on the Phase 2 backlog.</p>
        </Panel>
        <Panel title="Users and role assignments" flush>
          <table className="tbl">
            <thead><tr><th>User</th><th>Roles (scope)</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="text-sm"><span className="font-semibold">{u.name}</span><div className="text-[0.8rem] text-muted">{u.title} · {u.email}</div></td>
                  <td className="text-[0.8rem]">
                    {assignments.filter((a) => a.userId === u.id).map((a) => (
                      <div key={a.id}>{roles.find((r) => r.key === a.roleKey)?.name} <span className="text-muted">— {idx.name(a.orgId)}{a.includeChildren && (idx.children.get(a.orgId)?.length ?? 0) > 0 ? " and below" : ""}</span></div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Settings" className="mt-5" flush>
        <table className="tbl">
          <thead><tr><th>Setting</th><th>Value</th><th>Note</th></tr></thead>
          <tbody>{settings.map((s) => <tr key={s.key}><td className="font-mono text-[0.8rem]">{s.key}</td><td className="text-[0.85rem]">{JSON.stringify(s.value)}</td><td className="text-[0.85rem] text-muted">{s.note}</td></tr>)}</tbody>
        </table>
        <p className="border-t border-rule px-4 py-3 text-[0.8rem] text-muted">Records retention periods are intentionally not set; configure them after City and County records schedules are confirmed by Legal.</p>
      </Panel>
    </>
  );
}
