/**
 * Scenario 2 — DOTComm administers a contract on behalf of a County department (charter §12).
 * The County department is the benefiting agency, DOTComm the administrator, Douglas County the
 * contracting legal entity. DOTComm may sign only under documented, valid, sufficient delegated
 * authority; otherwise signing is blocked and routed to an authorized signatory.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { createRequest, getContractDetail, submitRequest, amendTermsInReview } from "@/lib/contracts";
import { decideTask, legalAction } from "@/lib/workflow";
import { uploadDocument } from "@/lib/documents";
import { AuthorityBlockedError, authorizedSignatories, checkAuthority, createAuthority, revokeAuthority, sendForSignature, simulateMockSigning } from "@/lib/signing";
import { ForbiddenError } from "@/lib/errors";
import { actor, agreementFile, day, getContract, pendingTask, resetAndSeed, tasksFor, type Seeded } from "./helpers";

let seed: Seeded;

async function approvedTreasurerContract(value: number, typeKey = "SAAS") {
  const kevin = await actor(seed, "kevin");
  const r = await createRequest(kevin, {
    title: `Treasurer ${typeKey} ${value}`,
    typeKey,
    vendorId: seed.vendor.heartland,
    requestingDeptId: seed.org["CTY-TRS"],
    contractingEntityId: seed.org.COUNTY,
    administeringOrgId: seed.org["DOT-AA"],
    benefitingAgencyIds: [seed.org["CTY-TRS"]],
    financialAllocations: [{ orgId: seed.org["CTY-TRS"], pct: 100 }],
    serviceOwnerId: seed.user.priya,
    businessPurpose: "Treasurer service administered by DOTComm.",
    totalValue: value,
    fundingSource: "Treasurer technology fee",
    effectiveDate: day(15),
    expirationDate: day(15 + 365 * 2),
    dataSensitivity: "CONFIDENTIAL",
    customFieldValues: { deliverables: "Implementation and training" },
  });
  await uploadDocument(kevin, { contractId: r.contractId, kind: "AGREEMENT", file: await agreementFile("Treasurer Agreement") });
  await submitRequest(kevin, r.requestId);
  return r;
}

async function approveAll(contractId: string) {
  const who: Record<string, string> = { dept: "luis", benefiting: "beth", purchasing: "raymond", finance: "grace", security: "aisha", final: "elaine" };
  for (let guard = 0; guard < 10; guard++) {
    const pending = (await tasksFor(contractId)).filter((t) => t.status === "PENDING");
    if (!pending.length) return;
    for (const t of pending) {
      if (t.kind === "LEGAL_REVIEW") {
        const j = await actor(seed, "jonathan");
        await legalAction(j, t.id, "START");
        await legalAction(j, t.id, "CLEAR");
      } else await decideTask(await actor(seed, who[t.stepKey]), t.id, "APPROVE");
    }
  }
}

beforeAll(async () => {
  seed = await resetAndSeed();
});

describe("Scenario 2: DOTComm administers for a County department", () => {
  let contractId: string;

  it("records the benefiting agency, the administrator and the contracting legal entity", async () => {
    const r = await approvedTreasurerContract(140000);
    contractId = r.contractId;
    const detail = await getContractDetail(await actor(seed, "kevin"), contractId);
    expect(detail.orgs.entity.code).toBe("COUNTY");
    expect(detail.orgs.admin.code).toBe("DOT-AA");
    expect(detail.orgs.dept.code).toBe("CTY-TRS");
    expect(detail.contract.agencies.find((a) => a.role === "BENEFITING")!.org.code).toBe("CTY-TRS");
    expect(detail.administeredOnBehalf).toBe(true);
    expect(detail.orgs.legal?.code).toBe("CTY-ATTY"); // County legal reviews County contracts
  });

  it("requires the benefiting agency's approval and DOTComm's final approval", async () => {
    const tasks = await tasksFor(contractId);
    expect(tasks.find((t) => t.stepKey === "benefiting")!.status).toBe("PENDING");
    expect(tasks.find((t) => t.stepKey === "final")!.status).toBe("WAITING");
    await approveAll(contractId);
    expect((await getContract(contractId)).status).toBe("PENDING_SIGNATURE");
  });

  it("the contract administrator is not, by that role, a valid signatory", async () => {
    const c = await getContract(contractId);
    const res = await checkAuthority(db, c, seed.user.dana);
    expect(res.passed).toBe(false);
    expect(res.reasons[0].code).toBe("NO_AUTHORITY_FOR_ENTITY");
    // and the contract owner is not either
    expect((await checkAuthority(db, c, seed.user.kevin)).passed).toBe(false);
  });

  it("verifies DOTComm's documented delegated authority and allows signing", async () => {
    const c = await getContract(contractId);
    const res = await checkAuthority(db, c, seed.user.elaine);
    expect(res.passed).toBe(true);
    expect(res.authority!.source).toBe("DELEGATED");
    expect(res.authority!.authorizingReference).toBe("DEMO-County-Delegation-Memo-07");

    const dana = await actor(seed, "dana");
    await sendForSignature(dana, contractId, { signerUserId: seed.user.elaine });
    const [req] = await db.select().from(s.signatureRequest).where(eq(s.signatureRequest.contractId, contractId));
    await simulateMockSigning(dana, req.id);
    expect((await getContract(contractId)).status).toBe("ACTIVE");
  });

  it("blocks signing when delegated authority is insufficient and routes to an authorized signatory", async () => {
    const r = await approvedTreasurerContract(300000); // over the $250,000 delegated limit
    await approveAll(r.contractId);
    const dana = await actor(seed, "dana");
    const err = await sendForSignature(dana, r.contractId, { signerUserId: seed.user.elaine }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthorityBlockedError);
    expect(err.reasons.map((x: { code: string }) => x.code)).toContain("AMOUNT_EXCEEDS_LIMIT");
    expect(err.alternatives.map((a: { name: string }) => a.name)).toContain("Harold Jensen");
    expect((await getContract(r.contractId)).signatureStatus).toBe("READY"); // nothing was sent

    // the failed check is still on the permanent record
    const [check] = await db.select().from(s.signingAuthorityCheck).where(eq(s.signingAuthorityCheck.contractId, r.contractId)).orderBy(desc(s.signingAuthorityCheck.createdAt));
    expect(check.passed).toBe(false);

    // routed to the County's authorized signatory, it proceeds
    await sendForSignature(dana, r.contractId, { signerUserId: seed.user.harold });
    expect((await getContract(r.contractId)).signatureStatus).toBe("SENT");
  });

  it("blocks when the contract type is outside the delegation", async () => {
    const r = await approvedTreasurerContract(90000, "PROFESSIONAL_SERVICES");
    const c = await getContract(r.contractId);
    const res = await checkAuthority(db, c, seed.user.elaine);
    expect(res.passed).toBe(false);
    expect(res.reasons.map((x) => x.code)).toContain("TYPE_NOT_COVERED");
  });

  it("blocks expired delegations", async () => {
    // Dana's City delegation expired 30 days ago
    const [cityContract] = await db.select().from(s.contract).where(eq(s.contract.contractingEntityId, seed.org.CITY)).limit(1);
    const res = await checkAuthority(db, { ...cityContract, totalValue: "1000" }, seed.user.dana);
    expect(res.passed).toBe(false);
    expect(res.reasons.map((x) => x.code)).toContain("AUTHORITY_EXPIRED");
  });

  it("invalidates a delegation when the delegating official's authority is revoked", async () => {
    const r = await approvedTreasurerContract(50000);
    const c = await getContract(r.contractId);
    expect((await checkAuthority(db, c, seed.user.elaine)).passed).toBe(true);
    const [harolds] = await db.select().from(s.signingAuthority).where(eq(s.signingAuthority.userId, seed.user.harold));
    await revokeAuthority(await actor(seed, "jonathan"), harolds.id, "Test: board term ended");
    const res = await checkAuthority(db, c, seed.user.elaine);
    expect(res.passed).toBe(false);
    expect(res.reasons.map((x) => x.code)).toContain("DELEGATOR_AUTHORITY_INVALID");
    expect(await authorizedSignatories(db, c)).toEqual([]);
  });

  it("signing authority cannot be self-granted or recorded by unauthorized users", async () => {
    const base = { legalEntityId: seed.org.COUNTY, source: "DIRECT" as const, effectiveFrom: day(0), authorizingReference: "TEST" };
    await expect(createAuthority(await actor(seed, "dana"), { ...base, userId: seed.user.dana })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAuthority(await actor(seed, "jonathan"), { ...base, userId: seed.user.jonathan })).rejects.toThrow(/yourself/);
    await expect(createAuthority(await actor(seed, "maria"), { ...base, userId: seed.user.harold })).rejects.toBeInstanceOf(ForbiddenError); // City admin, County entity
  });

  it("the final history shows who requested, reviewed, approved, signed, funded and administered", async () => {
    const detail = await getContractDetail(await actor(seed, "owen"), contractId); // auditor
    expect(detail.contract.requests[0].requester.name).toBe("Kevin Lindqvist");
    expect(detail.contract.agencies.find((a) => a.role === "FINANCIAL")!.org.code).toBe("CTY-TRS");
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.contractId, contractId));
    const approvals = audit.filter((a) => a.action === "TASK_APPROVED").map((a) => a.actorId);
    expect(approvals).toEqual(expect.arrayContaining([seed.user.luis, seed.user.beth, seed.user.raymond, seed.user.grace, seed.user.aisha, seed.user.elaine]));
    expect(audit.some((a) => a.action === "LEGAL_CLEARED" && a.actorId === seed.user.jonathan)).toBe(true);
    const sent = audit.find((a) => a.action === "SIGNATURE_REQUEST_SENT")!;
    expect((sent.data as { authority: string }).authority).toBe("DEMO-County-Delegation-Memo-07");
  });

  it("a material change after approval re-opens Legal and final approval", async () => {
    const r = await approvedTreasurerContract(120000);
    await approveAll(r.contractId);
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");
    await amendTermsInReview(await actor(seed, "dana"), r.contractId, { totalValue: 135000 }, "Vendor added payment-gateway fees");
    const c = await getContract(r.contractId);
    expect(c.status).toBe("IN_LEGAL");
    expect(c.signatureStatus).toBe("NOT_READY");
    const tasks = await tasksFor(r.contractId);
    expect(tasks.filter((t) => t.status === "SUPERSEDED").map((t) => t.stepKey).sort()).toEqual(["final", "legal"]);
    expect(tasks.find((t) => t.stepKey === "legal" && t.status === "PENDING")).toBeTruthy();
    expect(tasks.find((t) => t.stepKey === "purchasing")!.status).toBe("APPROVED"); // not flagged for re-approval
    await approveAll(r.contractId);
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");
  });

  it("detects an agreement swapped after approval without a material-change flag", async () => {
    const r = await approvedTreasurerContract(60000);
    await approveAll(r.contractId);
    const kevin = await actor(seed, "kevin");
    const [doc] = await db.select().from(s.contractDocument).where(eq(s.contractDocument.contractId, r.contractId));
    await uploadDocument(kevin, { contractId: r.contractId, documentId: doc.id, file: await agreementFile("Treasurer Agreement v2 — quietly changed") });
    const err = await sendForSignature(await actor(seed, "dana"), r.contractId, { signerUserId: seed.user.harold }).catch((e) => e);
    const codes = (err.details as { code: string }[]).map((d) => d.code);
    expect(codes).toContain("LEGAL_VERSION_MISMATCH");
    expect(codes).toContain("APPROVAL_VERSION_MISMATCH");
    void pendingTask;
  });
});
