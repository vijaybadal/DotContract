import type { Metadata } from "next";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { contractType, signingAuthority, user } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { canManageSigningAuthority, getOrgIndex, isSystemAdmin, hasRole } from "@/lib/authz";
import { authorityStatus } from "@/lib/signing";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Notice, PageHeader, Panel, Pill } from "@/components/ui";
import { AuthorityForm, RevokeAuthority } from "@/components/client/admin-panels";

export const metadata: Metadata = { title: "Signing authority" };
export const dynamic = "force-dynamic";

export default async function SigningAuthority() {
  const actor = await requireActor();
  const idx = await getOrgIndex();
  const canSee = isSystemAdmin(actor, idx) || hasRole(actor, "AUTHORITY_ADMIN", idx) || hasRole(actor, "CLM_ADMIN", idx) || hasRole(actor, "AUDITOR", idx);
  if (!canSee) return <Notice tone="amber" title="Restricted">Signing authority records are visible to administrators, Legal and auditors.</Notice>;
  const [rows, users, types] = await Promise.all([
    db.select().from(signingAuthority).orderBy(desc(signingAuthority.createdAt)),
    db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.name)),
    db.select({ key: contractType.key, name: contractType.name }).from(contractType).orderBy(asc(contractType.sortOrder)),
  ]);
  const entities = idx.all().filter((o) => o.isLegalEntity);
  const manageable = entities.filter((e) => canManageSigningAuthority(actor, e.id, idx));
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const tone = { ACTIVE: "green", EXPIRED: "neutral", FUTURE: "teal", REVOKED: "red" } as const;
  return (
    <>
      <PageHeader title="Signing authority" lede="Who may sign for each legal entity, up to what amount, for which kinds of contracts, and under what authorizing document. Execution is blocked unless a valid record covers the contract." />
      <Notice tone="amber" title="Demonstration records">The authorities below are synthetic. Record actual authority only from adopted ordinances, resolutions and written delegations confirmed by Legal.</Notice>
      <Panel title="Registry" className="mt-5" flush>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Signatory</th><th>For</th><th>Basis</th><th className="num">Limit</th><th>Categories</th><th>Effective</th><th>Authorizing document</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((a) => {
                const st = authorityStatus(a);
                return (
                  <tr key={a.id}>
                    <td className="font-semibold">{name(a.userId)}</td>
                    <td className="text-[0.85rem]">{idx.name(a.legalEntityId)}</td>
                    <td className="text-[0.85rem]">{a.source === "DIRECT" ? "Direct" : `Delegated by ${name(a.delegatedFromUserId)}`}</td>
                    <td className="num">{a.maxAmount ? formatMoney(a.maxAmount) : "No limit recorded"}</td>
                    <td className="text-[0.8rem]">{a.contractTypeKeys.length ? a.contractTypeKeys.map((k) => types.find((t) => t.key === k)?.name ?? k).join(", ") : "All"}</td>
                    <td className="whitespace-nowrap text-[0.85rem]">{formatDate(a.effectiveFrom)} – {a.effectiveTo ? formatDate(a.effectiveTo) : "open"}</td>
                    <td className="text-[0.85rem]">{a.authorizingReference}{a.authorizingNote && <div className="text-[0.75rem] text-muted">{a.authorizingNote}</div>}{a.revokedReason && <div className="text-[0.75rem] text-red">Revoked: {a.revokedReason}</div>}</td>
                    <td><Pill tone={tone[st]}>{st.toLowerCase()}</Pill></td>
                    <td>{st !== "REVOKED" && canManageSigningAuthority(actor, a.legalEntityId, idx) && <RevokeAuthority id={a.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {manageable.length > 0 && (
        <Panel title="Record signing authority" className="mt-5">
          <AuthorityForm users={users.filter((u) => u.id !== actor.id)} entities={manageable.map((e) => ({ id: e.id, name: e.name }))} types={types} />
          <p className="mt-3 text-[0.8rem] text-muted">You cannot record authority for yourself. Every change is written to the audit log.</p>
        </Panel>
      )}
    </>
  );
}
