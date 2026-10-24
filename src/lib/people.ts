import { and, eq, inArray } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { approvalDelegation, user, userRoleAssignment } from "@/db/schema";
import { covers, getOrgIndex, isPlatformWide, loadActor } from "./authz";
import { todayIn } from "./dates";

export type Person = { id: string; name: string; email: string; title: string | null };

/** Active users whose role scope covers orgId. */
export async function usersWithRole(conn: Conn, roleKey: string, orgId: string | null, today = todayIn()): Promise<Person[]> {
  const idx = await getOrgIndex(conn);
  const rows = await conn
    .select({
      userId: userRoleAssignment.userId,
      orgId: userRoleAssignment.orgId,
      includeChildren: userRoleAssignment.includeChildren,
      effectiveFrom: userRoleAssignment.effectiveFrom,
      effectiveTo: userRoleAssignment.effectiveTo,
      roleKey: userRoleAssignment.roleKey,
    })
    .from(userRoleAssignment)
    .where(eq(userRoleAssignment.roleKey, roleKey));
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.effectiveFrom && r.effectiveFrom > today) continue;
    if (r.effectiveTo && r.effectiveTo < today) continue;
    if (!orgId || covers(r, orgId, idx)) ids.add(r.userId);
  }
  if (!ids.size) return [];
  return conn
    .select({ id: user.id, name: user.name, email: user.email, title: user.title })
    .from(user)
    .where(and(inArray(user.id, [...ids]), eq(user.active, true)));
}

/** Users who have delegated approval authority to `userId` today (optionally for one role). */
export async function delegatorsFor(conn: Conn, userId: string, roleKey?: string, today = todayIn()) {
  const rows = await conn.select().from(approvalDelegation).where(eq(approvalDelegation.toUserId, userId));
  return rows.filter(
    (d) => !d.revokedAt && d.startsOn <= today && d.endsOn >= today && (!d.roleKey || !roleKey || d.roleKey === roleKey),
  );
}

/** Active delegates acting for any of the given users today. */
export async function delegatesOf(conn: Conn, userIds: string[], roleKey?: string, today = todayIn()) {
  if (!userIds.length) return [];
  const rows = await conn.select().from(approvalDelegation).where(inArray(approvalDelegation.fromUserId, userIds));
  return rows.filter(
    (d) => !d.revokedAt && d.startsOn <= today && d.endsOn >= today && (!d.roleKey || !roleKey || d.roleKey === roleKey),
  );
}

export async function contractAdmins(conn: Conn, administeringOrgId: string): Promise<Person[]> {
  return usersWithRole(conn, "CLM_ADMIN", administeringOrgId);
}

export async function isPlatformAdminUser(userId: string, conn: Conn = db) {
  const actor = await loadActor(userId, conn);
  return isPlatformWide(actor, "SYSTEM_ADMIN", await getOrgIndex(conn));
}
