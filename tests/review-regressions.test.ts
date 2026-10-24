/**
 * Regression tests for findings from the independent security review (docs/SECURITY-REVIEW.md).
 * Each block names the finding it guards.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@/db";
import * as s from "@/db/schema";
import { addLegalIssue, amendTermsInReview, createRequest, resolveLegalIssue, submitRequest, updateRequest } from "@/lib/contracts";
import { compareVersions, uploadDocument } from "@/lib/documents";
import { decideRenewal } from "@/lib/renewals";
import { executionBlockers, recordExternalExecution, retryCompletion, sendForSignature, simulateMockSigning, voidSignatureRequest } from "@/lib/signing";
import { decideTask, legalAction } from "@/lib/workflow";
import { NotFoundError, StateError, ValidationError } from "@/lib/errors";
import { actor, agreementFile, day, getContract, pendingTask, resetAndSeed, tasksFor, type Seeded } from "./helpers";

let seed: Seeded;
beforeAll(async () => {
  seed = await resetAndSeed();
});

const base = (over: Record<string, unknown> = {}) => ({
  title: "Regression contract",
  typeKey: "SOFTWARE_LICENSE",
  vendorId: seed.vendor.granite,
  requestingDeptId: seed.org["DOT-AA"],
  businessPurpose: "Regression test",
  totalValue: 20000,
  fundingSource: "Ops",
  effectiveDate: day(5),
  expirationDate: day(370),
  ...over,
});

const WHO: Record<string, string> = { dept: "marcus", purchasing: "raymond", finance: "grace", security: "aisha", final: "elaine", benefiting: "victoria" };
async function approveAll(contractId: string) {
  for (let guard = 0; guard < 12; guard++) {
    const pending = (await tasksFor(contractId)).filter((t) => t.status === "PENDING");
    if (!pending.length) return;
    for (const t of pending) {
      if (t.kind === "LEGAL_REVIEW") {
        const j = await actor(seed, "jonathan");
        if ((await getContract(contractId)).legalStatus === "PENDING_REVIEW") await legalAction(j, t.id, "START");
        await legalAction(j, t.id, "CLEAR");
      } else await decideTask(await actor(seed, WHO[t.stepKey]), t.id, "APPROVE");
    }
  }
}
async function submitted(over: Record<string, unknown> = {}, who = "priya") {
  const a = await actor(seed, who);
  const r = await createRequest(a, base(over));
  await uploadDocument(a, { contractId: r.contractId, kind: "AGREEMENT", file: await agreementFile("Regression Agreement") });
  await submitRequest(a, r.requestId);
  return r;
}

describe("#1 Legal review cannot be waived by the requester", () => {
  it("rejects legalRequired=false from a requester on create and on edit", async () => {
    await expect(createRequest(await actor(seed, "priya"), base({ legalRequired: false }))).rejects.toThrow(/Only a contract administrator can waive Legal review/);
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, base());
    await expect(updateRequest(priya, r.requestId, base({ legalRequired: false }))).rejects.toBeInstanceOf(ValidationError);
  });
  it("allows a contract administrator to waive it", async () => {
    const r = await createRequest(await actor(seed, "dana"), base({ legalRequired: false }));
    expect((await getContract(r.contractId)).legalStatus).toBe("NOT_REQUIRED");
  });
});

describe("#2 Changing terms re-runs routing and blocks stale approvals", () => {
  it("rejects invalid values", async () => {
    const r = await submitted();
    await expect(amendTermsInReview(await actor(seed, "dana"), r.contractId, { totalValue: -5 }, "x")).rejects.toBeInstanceOf(ValidationError);
    await expect(amendTermsInReview(await actor(seed, "dana"), r.contractId, { totalValue: Number.NaN }, "x")).rejects.toBeInstanceOf(ValidationError);
  });

  it("adds Finance and executive approval when the value crosses their thresholds after approval", async () => {
    const r = await submitted();
    await approveAll(r.contractId);
    const before = await tasksFor(r.contractId);
    expect(before.find((t) => t.stepKey === "finance")!.status).toBe("SKIPPED");
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");

    const res = await amendTermsInReview(await actor(seed, "dana"), r.contractId, { totalValue: 5_000_000 }, "Scope expanded");
    expect(res.added).toBeGreaterThanOrEqual(2);
    const after = await tasksFor(r.contractId);
    expect(after.some((t) => t.stepKey === "finance" && ["WAITING", "PENDING"].includes(t.status))).toBe(true);
    expect(after.some((t) => t.stepKey === "final" && ["WAITING", "PENDING"].includes(t.status))).toBe(true);
    expect((await getContract(r.contractId)).signatureStatus).toBe("NOT_READY");
    await approveAll(r.contractId);
    expect(await executionBlockers(db, await getContract(r.contractId))).toEqual([]);
  });

  it("blocks signing when terms differ from what was approved", async () => {
    const r = await submitted();
    await approveAll(r.contractId);
    await db.update(s.contract).set({ totalValue: "1" }).where(eq(s.contract.id, r.contractId)); // bypassing the service
    const codes = (await executionBlockers(db, await getContract(r.contractId))).map((b) => b.code);
    expect(codes).toContain("TERMS_CHANGED_AFTER_APPROVAL");
  });

  it("does not stall when routing changes while an earlier stage is in progress", async () => {
    const r = await submitted();
    await decideTask(await actor(seed, "marcus"), (await pendingTask(r.contractId, "dept")).id, "APPROVE");
    await amendTermsInReview(await actor(seed, "dana"), r.contractId, { totalValue: 30000 }, "Added training"); // now needs Finance (stage 2)
    await approveAll(r.contractId);
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");
    expect((await tasksFor(r.contractId)).some((t) => t.stepKey === "finance" && t.status === "APPROVED")).toBe(true);
  });
});

describe("#3 Voiding cannot race completion; completion can be retried", () => {
  it("refuses to void once every signer has signed, and records execution on retry", async () => {
    const r = await submitted({ totalValue: 20000 });
    await approveAll(r.contractId);
    const dana = await actor(seed, "dana");
    const { signatureRequestId } = await sendForSignature(dana, r.contractId, { signerUserId: seed.user.elaine });
    // Simulate "all signed, completion failed" — the state a storage outage would leave behind.
    await db.update(s.signatureSigner).set({ status: "SIGNED", signedAt: new Date() }).where(eq(s.signatureSigner.requestId, signatureRequestId));
    await db.update(s.signatureRequest).set({ status: "COMPLETING" }).where(eq(s.signatureRequest.id, signatureRequestId));
    await expect(voidSignatureRequest(dana, signatureRequestId, "change of plan")).rejects.toBeInstanceOf(StateError);
    const res = await retryCompletion(dana, signatureRequestId);
    expect(res.executed).toBe(true);
    expect((await getContract(r.contractId)).status).toBe("ACTIVE");
    await expect(retryCompletion(dana, signatureRequestId)).rejects.toBeInstanceOf(StateError); // no double execution
  });

  it("does not execute if the contract changed while signing completed", async () => {
    const r = await submitted();
    await approveAll(r.contractId);
    const dana = await actor(seed, "dana");
    const { signatureRequestId } = await sendForSignature(dana, r.contractId, { signerUserId: seed.user.elaine });
    await db.update(s.signatureRequest).set({ status: "COMPLETING" }).where(eq(s.signatureRequest.id, signatureRequestId));
    await db.update(s.contract).set({ signatureStatus: "READY" }).where(eq(s.contract.id, r.contractId)); // e.g. a concurrent void
    await expect(retryCompletion(dana, signatureRequestId)).rejects.toThrow(/contract changed/);
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");
  });
});

describe("#4 Without Legal review, a new agreement version re-opens every approval", () => {
  it("re-routes after a quiet swap and pins all approvals to the text", async () => {
    const dana = await actor(seed, "dana");
    const r = await createRequest(dana, base({ legalRequired: false, title: "No-legal contract" }));
    await uploadDocument(dana, { contractId: r.contractId, kind: "AGREEMENT", file: await agreementFile("No Legal v1") });
    await submitRequest(dana, r.requestId);
    await approveAll(r.contractId);
    expect((await getContract(r.contractId)).status).toBe("PENDING_SIGNATURE");

    const [doc] = await db.select().from(s.contractDocument).where(and(eq(s.contractDocument.contractId, r.contractId), eq(s.contractDocument.kind, "AGREEMENT")));
    const up = await uploadDocument(dana, { contractId: r.contractId, documentId: doc.id, file: await agreementFile("No Legal v2 — different text") });
    expect(up.reopened).toBeGreaterThan(0);
    const c = await getContract(r.contractId);
    expect(c.status).toBe("IN_REVIEW");
    expect((await tasksFor(r.contractId)).find((t) => t.stepKey === "dept" && t.status === "PENDING")).toBeTruthy();
  });
});

describe("#5 External execution cannot be backdated before approval", () => {
  it("rejects a signing date earlier than final approval", async () => {
    const r = await submitted();
    await approveAll(r.contractId);
    const file = { name: "signed.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF\n") };
    await expect(recordExternalExecution(await actor(seed, "dana"), r.contractId, { signerUserId: seed.user.elaine, signedOn: day(-30), file })).rejects.toThrow(/on or after final approval/);
  });
});

describe("#6 Intake parties and owners are checked", () => {
  it("rejects a contracting entity unrelated to the request", async () => {
    await expect(createRequest(await actor(seed, "priya"), base({ contractingEntityId: seed.org.COUNTY }))).rejects.toThrow(/cannot be the contracting entity/);
  });
  it("allows DOTComm administration on behalf of the department's own government", async () => {
    const r = await createRequest(await actor(seed, "kevin"), base({ requestingDeptId: seed.org["CTY-TRS"], administeringOrgId: seed.org["DOT-AA"] }));
    expect((await getContract(r.contractId)).contractingEntityId).toBe(seed.org.COUNTY);
  });
  it("rejects a read-only account as owner", async () => {
    await expect(createRequest(await actor(seed, "priya"), base({ ownerId: seed.user.owen }))).rejects.toThrow(/owner must be an active user/);
  });
});

describe("#7 Out-of-scope calls look like 404; quarantined text is never compared", () => {
  it("renewal decisions on contracts outside scope return not found", async () => {
    const [payroll] = await db.select().from(s.contract).where(eq(s.contract.title, "Payroll & HR cloud"));
    const [ren] = await db.select().from(s.renewal).where(eq(s.renewal.contractId, payroll.id));
    await expect(decideRenewal(await actor(seed, "nina"), ren.id, "TERMINATE", "x")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("legal issue calls on contracts outside scope return not found", async () => {
    const [cityGis] = await db.select().from(s.contract).where(eq(s.contract.title, "Enterprise GIS platform"));
    await expect(addLegalIssue(await actor(seed, "jonathan"), cityGis.id, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("compare refuses quarantined versions", async () => {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, base());
    const clean = await uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", title: "Notes", file: { name: "a.txt", type: "text/plain", bytes: Buffer.from("hello") } });
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const bad = await uploadDocument(priya, { contractId: r.contractId, documentId: clean.document.id, file: { name: "b.txt", type: "text/plain", bytes: Buffer.from(eicar) } });
    const res = await compareVersions(priya, clean.version.id, bad.version.id);
    expect(res.supported).toBe(false);
  });
});

describe("#8 Demo executions are not treated as real contracts", () => {
  it("still get labeled renewal alerts but never auto-renew", async () => {
    const r = await submitted({ title: "Demo auto-renew", autoRenew: true, renewalTermMonths: 12, noticeDays: 30 });
    await approveAll(r.contractId);
    const dana = await actor(seed, "dana");
    const { signatureRequestId } = await sendForSignature(dana, r.contractId, { signerUserId: seed.user.elaine });
    await simulateMockSigning(dana, signatureRequestId);
    const c = await getContract(r.contractId);
    expect(c.executionIsDemo).toBe(true);
    expect(c.signatureStatus).toBe("DEMO_EXECUTED");
    const { runRenewalReminders } = await import("@/lib/renewals");
    await runRenewalReminders(new Date(Date.now() + 340 * 86_400_000)); // inside the reminder window
    const alerts = await db.select().from(s.notification).where(eq(s.notification.link, `/contracts/${c.id}?tab=renewals`));
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((n) => n.title.startsWith("DEMO: "))).toBe(true);
    await runRenewalReminders(new Date(Date.now() + 400 * 86_400_000)); // past the end of the term
    const after = await getContract(r.contractId);
    expect(after.expirationDate).toBe(c.expirationDate); // not rolled forward
    expect(after.status).toBe("EXPIRED");
  });
});

describe("#9 Legal issues close once", () => {
  it("cannot be re-resolved", async () => {
    const r = await submitted({ title: "Issue test" });
    await approveAll(r.contractId).catch(() => {});
    const [c] = await db.select().from(s.contract).where(eq(s.contract.id, r.contractId));
    const jonathan = await actor(seed, "jonathan");
    // DOTComm contracts are reviewed by the County Attorney in the demo configuration.
    expect(c.legalReviewOrgId).toBe(seed.org["CTY-ATTY"]);
    const issue = await addLegalIssue(jonathan, r.contractId, { title: "Cap" });
    await resolveLegalIssue(jonathan, issue.id, "RESOLVED", "Agreed");
    await expect(resolveLegalIssue(jonathan, issue.id, "ACCEPTED_RISK", "changed mind")).rejects.toBeInstanceOf(StateError);
  });
});

describe("Database guards", () => {
  const pgError = (p: Promise<unknown>) => p.then(() => "no error", (e) => String((e as { cause?: Error }).cause?.message ?? e));
  it("TRUNCATE is blocked on append-only tables", async () => {
    expect(await pgError(db.execute(sql`truncate audit_log`))).toMatch(/TRUNCATE is not permitted/);
    expect(await pgError(db.execute(sql`truncate signing_authority cascade`))).toMatch(/TRUNCATE is not permitted/);
  });
  it("signing authority can only be revoked, never edited or deleted", async () => {
    const [a] = await db.select().from(s.signingAuthority).where(sql`revoked_at is null`).limit(1);
    expect(await pgError(db.execute(sql`update signing_authority set max_amount = 999999999 where id = ${a.id}`))).toMatch(/immutable/);
    expect(await pgError(db.execute(sql`delete from signing_authority where id = ${a.id}`))).toMatch(/cannot be deleted/);
    expect(await pgError(db.execute(sql`update signing_authority set revoked_at = now(), revoked_reason = 'test' where id = ${a.id}`))).toBe("no error");
    expect(await pgError(db.execute(sql`update signing_authority set revoked_at = null where id = ${a.id}`))).toMatch(/revoked signing authority cannot be changed/);
  });
  it("a contract can hold only one primary agreement", async () => {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, base());
    await uploadDocument(priya, { contractId: r.contractId, kind: "AGREEMENT", file: await agreementFile("A") });
    expect(await pgError(db.insert(s.contractDocument).values({ contractId: r.contractId, title: "B", kind: "AGREEMENT", createdById: seed.user.priya }))).toMatch(/document_one_agreement_uq/);
  });
  it("rejects .docx decompression bombs", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "a".repeat(60 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, base());
    await expect(uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", file: { name: "bomb.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes } })).rejects.toThrow(/unreasonable size/);
  });
});
