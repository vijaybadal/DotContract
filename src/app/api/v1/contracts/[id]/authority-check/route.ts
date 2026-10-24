import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contract } from "@/db/schema";
import { api } from "@/lib/api";
import { assertCanViewContract } from "@/lib/authz";
import { authorizedSignatories, checkAuthority } from "@/lib/signing";
import { NotFoundError, ValidationError } from "@/lib/errors";

/** GET ?signer=<userId>[&on=YYYY-MM-DD] — dry-run authority check (not recorded). */
export const GET = api<{ id: string }>(async (req, actor, { id }) => {
  const sp = new URL(req.url).searchParams;
  const [c] = await db.select().from(contract).where(eq(contract.id, id));
  if (!c) throw new NotFoundError("Contract");
  await assertCanViewContract(actor, c);
  const signer = sp.get("signer");
  if (!signer) return { authorizedSignatories: (await authorizedSignatories(db, c)).map((s) => ({ userId: s.userId, name: s.name, authority: s.authority.authorizingReference })) };
  if (!/^[0-9a-f-]{36}$/.test(signer)) throw new ValidationError("Invalid signer id.");
  const r = await checkAuthority(db, c, signer, sp.get("on") ?? undefined);
  return { passed: r.passed, authority: r.authority?.authorizingReference ?? null, reasons: r.reasons };
});
