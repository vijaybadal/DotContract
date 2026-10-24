/**
 * Authorization. Every service function receives an Actor and checks permissions server-side;
 * the UI hides controls only as a convenience.
 *
 * Model
 *  - A user holds roles scoped to an organization (optionally including its descendants).
 *  - SYSTEM_ADMIN and AUDITOR assigned at the ENTERPRISE org are platform-wide.
 *  - A contract is visible to anyone whose role scope covers one of its organizations
 *    (contracting entity, administering org, requesting department, legal review office,
 *    benefiting/financial agencies), and to its owner, service owner and requesters.
 */
import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { contract, contractAgency, contractRequest, organization, user, userRoleAssignment } from "@/db/schema";
import { todayIn } from "./dates";
import { ForbiddenError, NotFoundError } from "./errors";

export const ROLE_KEYS = [
  "SYSTEM_ADMIN",
  "CLM_ADMIN",
  "REQUESTER",
  "CONTRACT_OWNER",
  "SERVICE_OWNER",
  "PURCHASING_REVIEWER",
  "FINANCE_REVIEWER",
  "LEGAL_REVIEWER",
  "SECURITY_REVIEWER",
  "DEPARTMENT_APPROVER",
  "AGENCY_EXECUTIVE",
  "DOTCOMM_MANAGEMENT",
  "AUTHORIZED_SIGNATORY",
  "AUTHORITY_ADMIN",
  "AUDITOR",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const PLATFORM_WIDE_ROLES: RoleKey[] = ["SYSTEM_ADMIN", "AUDITOR"];

export type Org = typeof organization.$inferSelect;
export type Assignment = {
  roleKey: string;
  orgId: string;
  includeChildren: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};
export type Actor = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  primaryOrgId: string | null;
  assignments: Assignment[];
};

// ───────────── Organization index ─────────────
export class OrgIndex {
  byId = new Map<string, Org>();
  children = new Map<string, string[]>();
  constructor(orgs: Org[]) {
    for (const o of orgs) {
      this.byId.set(o.id, o);
      if (o.parentId) this.children.set(o.parentId, [...(this.children.get(o.parentId) ?? []), o.id]);
    }
  }
  get(id: string | null | undefined): Org | undefined {
    return id ? this.byId.get(id) : undefined;
  }
  name(id: string | null | undefined): string {
    return this.get(id)?.name ?? "—";
  }
  ancestors(id: string): string[] {
    const out: string[] = [];
    let cur = this.byId.get(id)?.parentId;
    let guard = 0;
    while (cur && guard++ < 50) {
      out.push(cur);
      cur = this.byId.get(cur)?.parentId ?? null;
    }
    return out;
  }
  descendants(id: string): string[] {
    const out: string[] = [];
    const stack = [...(this.children.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      out.push(c);
      stack.push(...(this.children.get(c) ?? []));
    }
    return out;
  }
  /** Nearest legal entity at or above the org (the government or DOTComm itself). */
  legalEntityOf(id: string): Org | undefined {
    for (const oid of [id, ...this.ancestors(id)]) {
      const o = this.byId.get(oid);
      if (o?.isLegalEntity) return o;
    }
    return undefined;
  }
  /** Path label, e.g. "Douglas County › Treasurer". */
  path(id: string | null | undefined): string {
    if (!id) return "—";
    const chain = [id, ...this.ancestors(id)].reverse().map((x) => this.byId.get(x)?.name ?? "?");
    return chain.join(" › ");
  }
  all(): Org[] {
    return [...this.byId.values()];
  }
}

let orgCache: { at: number; idx: OrgIndex } | null = null;
export async function getOrgIndex(conn: Conn = db, fresh = false): Promise<OrgIndex> {
  if (!fresh && orgCache && Date.now() - orgCache.at < 30_000) return orgCache.idx;
  const rows = await conn.select().from(organization);
  const idx = new OrgIndex(rows);
  orgCache = { at: Date.now(), idx };
  return idx;
}
export function invalidateOrgCache() {
  orgCache = null;
}

// ───────────── Actor ─────────────
export async function loadActor(userId: string, conn: Conn = db): Promise<Actor> {
  const [u] = await conn.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!u || !u.active) throw new NotFoundError("User");
  const assignments = await conn
    .select({
      roleKey: userRoleAssignment.roleKey,
      orgId: userRoleAssignment.orgId,
      includeChildren: userRoleAssignment.includeChildren,
      effectiveFrom: userRoleAssignment.effectiveFrom,
      effectiveTo: userRoleAssignment.effectiveTo,
    })
    .from(userRoleAssignment)
    .where(eq(userRoleAssignment.userId, userId));
  return { id: u.id, name: u.name, email: u.email, title: u.title, primaryOrgId: u.primaryOrgId, assignments };
}

function assignmentActive(a: Assignment, today: string) {
  return (!a.effectiveFrom || a.effectiveFrom <= today) && (!a.effectiveTo || a.effectiveTo >= today);
}

/** True if the assignment's scope covers orgId. */
export function covers(a: Assignment, orgId: string, idx: OrgIndex): boolean {
  if (a.orgId === orgId) return true;
  return a.includeChildren && idx.ancestors(orgId).includes(a.orgId);
}

export function isPlatformWide(actor: Actor, roleKey: RoleKey, idx: OrgIndex, today = todayIn()): boolean {
  if (!PLATFORM_WIDE_ROLES.includes(roleKey)) return false;
  return actor.assignments.some(
    (a) => a.roleKey === roleKey && assignmentActive(a, today) && idx.get(a.orgId)?.kind === "ENTERPRISE",
  );
}

/** Does the actor hold roleKey with a scope covering orgId (or anywhere, if orgId is omitted)? */
export function hasRole(actor: Actor, roleKey: string, idx: OrgIndex, orgId?: string | null, today = todayIn()): boolean {
  if (isPlatformWide(actor, roleKey as RoleKey, idx, today)) return true;
  return actor.assignments.some(
    (a) => a.roleKey === roleKey && assignmentActive(a, today) && (!orgId || covers(a, orgId, idx)),
  );
}

export function hasAnyRole(actor: Actor, roleKeys: string[], idx: OrgIndex, orgId?: string | null) {
  return roleKeys.some((r) => hasRole(actor, r, idx, orgId));
}

export function isSystemAdmin(actor: Actor, idx: OrgIndex) {
  return isPlatformWide(actor, "SYSTEM_ADMIN", idx);
}

export function seesEverything(actor: Actor, idx: OrgIndex) {
  return isPlatformWide(actor, "SYSTEM_ADMIN", idx) || isPlatformWide(actor, "AUDITOR", idx);
}

/** Read-only auditors may see everything but change nothing. */
export function isReadOnly(actor: Actor) {
  const today = todayIn();
  const active = actor.assignments.filter((a) => assignmentActive(a, today));
  return active.length > 0 && active.every((a) => a.roleKey === "AUDITOR");
}

/** Org ids within any of the actor's role scopes. */
export function scopedOrgIds(actor: Actor, idx: OrgIndex, today = todayIn()): string[] {
  const set = new Set<string>();
  for (const a of actor.assignments) {
    if (!assignmentActive(a, today)) continue;
    set.add(a.orgId);
    if (a.includeChildren) for (const d of idx.descendants(a.orgId)) set.add(d);
  }
  return [...set];
}

export type ContractScopeFields = {
  id: string;
  contractingEntityId: string;
  administeringOrgId: string;
  requestingDeptId: string;
  legalReviewOrgId: string | null;
  ownerId: string;
  serviceOwnerId: string | null;
};

/** SQL predicate restricting contract queries to what the actor may see. */
export function contractVisibilityFilter(actor: Actor, idx: OrgIndex): SQL | undefined {
  if (seesEverything(actor, idx)) return undefined;
  const ids = scopedOrgIds(actor, idx);
  const clauses: SQL[] = [
    eq(contract.ownerId, actor.id),
    eq(contract.serviceOwnerId, actor.id),
    exists(
      db
        .select({ one: sql`1` })
        .from(contractRequest)
        .where(and(eq(contractRequest.contractId, contract.id), eq(contractRequest.requesterId, actor.id))),
    ),
  ];
  if (ids.length) {
    clauses.push(
      inArray(contract.contractingEntityId, ids),
      inArray(contract.administeringOrgId, ids),
      inArray(contract.requestingDeptId, ids),
      inArray(contract.legalReviewOrgId, ids),
      exists(
        db
          .select({ one: sql`1` })
          .from(contractAgency)
          .where(and(eq(contractAgency.contractId, contract.id), inArray(contractAgency.orgId, ids))),
      ),
    );
  }
  return or(...clauses);
}

export async function canViewContract(actor: Actor, c: ContractScopeFields, conn: Conn = db): Promise<boolean> {
  const idx = await getOrgIndex(conn);
  if (seesEverything(actor, idx)) return true;
  if (c.ownerId === actor.id || c.serviceOwnerId === actor.id) return true;
  const ids = new Set(scopedOrgIds(actor, idx));
  for (const o of [c.contractingEntityId, c.administeringOrgId, c.requestingDeptId, c.legalReviewOrgId]) {
    if (o && ids.has(o)) return true;
  }
  const agencies = await conn
    .select({ orgId: contractAgency.orgId })
    .from(contractAgency)
    .where(eq(contractAgency.contractId, c.id));
  if (agencies.some((a) => ids.has(a.orgId))) return true;
  const [req] = await conn
    .select({ id: contractRequest.id })
    .from(contractRequest)
    .where(and(eq(contractRequest.contractId, c.id), eq(contractRequest.requesterId, actor.id)))
    .limit(1);
  return Boolean(req);
}

export async function assertCanViewContract(actor: Actor, c: ContractScopeFields, conn: Conn = db) {
  if (!(await canViewContract(actor, c, conn))) {
    // Do not reveal existence of contracts outside the actor's scope.
    throw new NotFoundError("Contract");
  }
}

/** Contract administrators for the administering organization (or platform admins). */
export function isContractAdminFor(actor: Actor, c: ContractScopeFields, idx: OrgIndex) {
  return isSystemAdmin(actor, idx) || hasRole(actor, "CLM_ADMIN", idx, c.administeringOrgId);
}

export function canEditContract(actor: Actor, c: ContractScopeFields & { status: string }, idx: OrgIndex, requesterIds: string[]) {
  if (isContractAdminFor(actor, c, idx)) return true;
  const editableByRequester = c.status === "DRAFT";
  if (editableByRequester && (requesterIds.includes(actor.id) || c.ownerId === actor.id)) return true;
  return false;
}

export function canAdministerWorkflows(actor: Actor, idx: OrgIndex) {
  return isSystemAdmin(actor, idx) || actor.assignments.some((a) => a.roleKey === "CLM_ADMIN" && idx.get(a.orgId)?.kind === "ENTERPRISE");
}

export function canManageSigningAuthority(actor: Actor, legalEntityId: string, idx: OrgIndex) {
  return isSystemAdmin(actor, idx) || hasRole(actor, "AUTHORITY_ADMIN", idx, legalEntityId);
}

export function canRunJobs(actor: Actor, idx: OrgIndex) {
  return canAdministerWorkflows(actor, idx);
}

export function assert(cond: unknown, message?: string): asserts cond {
  if (!cond) throw new ForbiddenError(message);
}
