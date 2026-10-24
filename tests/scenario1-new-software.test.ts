/**
 * Scenario 1 — New software contract (charter §12).
 * A DOTComm employee requests software; it routes through department, Purchasing, Finance,
 * Information Security and Legal; Legal uploads a redline; after final approval an authorized
 * signatory signs; the executed agreement is stored and renewal alerts are generated.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { createRequest, submitRequest, addLegalIssue, resolveLegalIssue } from "@/lib/contracts";
import { decideTask, legalAction, listEligibleTasks } from "@/lib/workflow";
import { uploadDocument } from "@/lib/documents";
import { sendForSignature, simulateMockSigning, executionBlockers } from "@/lib/signing";
import { runRenewalReminders } from "@/lib/renewals";
import { verifyAuditChain } from "@/lib/audit";
import { ForbiddenError, StateError, ValidationError } from "@/lib/errors";
import { actor, agreementFile, day, getContract, pendingTask, resetAndSeed, tasksFor, type Seeded } from "./helpers";

let seed: Seeded;
let contractId: string;
let requestId: string;

beforeAll(async () => {
  seed = await resetAndSeed();
});

describe("Scenario 1: new software contract, end to end", () => {
  it("captures the request and blocks incomplete submission", async () => {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, {
      title: "Data catalog platform",
      typeKey: "SAAS",
      requestingDeptId: seed.org["DOT-AA"],
      businessPurpose: "Catalog and lineage for the data foundation program.",
      totalValue: 180000,
    });
    contractId = r.contractId;
    requestId = r.requestId;
    expect(r.contractNumber).toMatch(/^CTR-\d{4}-\d{4}$/);
    expect(r.requestNumber).toMatch(/^REQ-\d{4}-\d{4}$/);

    const err = await submitRequest(priya, requestId).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const fields = (err.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["vendorId", "fundingSource", "effectiveDate", "expirationDate"]));
  });

  it("routes the submitted request according to configured rules", async () => {
    const priya = await actor(seed, "priya");
    const { updateRequest } = await import("@/lib/contracts");
    await updateRequest(priya, requestId, {
      title: "Data catalog platform",
      typeKey: "SAAS",
      vendorId: seed.vendor.clearbrook,
      requestingDeptId: seed.org["DOT-AA"],
      businessPurpose: "Catalog and lineage for the data foundation program.",
      totalValue: 180000,
      annualValue: 60000,
      fundingSource: "DOTComm operating budget",
      effectiveDate: day(10),
      expirationDate: day(10 + 365 * 3),
      autoRenew: true,
      renewalTermMonths: 12,
      noticeDays: 60,
      dataSensitivity: "CONFIDENTIAL",
    });
    await uploadDocument(priya, { contractId, kind: "AGREEMENT", title: "Vendor agreement", file: await agreementFile("Catalog Subscription") });
    await submitRequest(priya, requestId);

    const tasks = await tasksFor(contractId);
    const by = (k: string) => tasks.find((t) => t.stepKey === k)!;
    expect(by("dept").status).toBe("PENDING");
    expect(by("benefiting").status).toBe("SKIPPED"); // not cross-agency
    expect(by("purchasing").status).toBe("WAITING");
    expect(by("finance").status).toBe("WAITING"); // 180k ≥ demo threshold
    expect(by("security").status).toBe("WAITING"); // confidential data / SaaS
    expect(by("legal").status).toBe("WAITING");
    expect(by("final").status).toBe("WAITING"); // ≥ demo executive threshold
    expect((await getContract(contractId)).status).toBe("IN_REVIEW");
  });

  it("enforces who may approve", async () => {
    const t = await pendingTask(contractId, "dept");
    // requester cannot approve own request
    await expect(decideTask(await actor(seed, "priya"), t.id, "APPROVE")).rejects.toBeInstanceOf(ForbiddenError);
    // a department approver for a different department cannot approve
    await expect(decideTask(await actor(seed, "james"), t.id, "APPROVE")).rejects.toBeInstanceOf(ForbiddenError);
    // a later-stage approver cannot act on a waiting task
    const purchasing = (await tasksFor(contractId)).find((x) => x.stepKey === "purchasing")!;
    await expect(decideTask(await actor(seed, "raymond"), purchasing.id, "APPROVE")).rejects.toBeInstanceOf(ForbiddenError);
    // rejecting requires a comment
    await expect(decideTask(await actor(seed, "marcus"), t.id, "REJECT")).rejects.toBeInstanceOf(ValidationError);
    // the right approver sees it in My Tasks
    const mine = await listEligibleTasks(await actor(seed, "marcus"));
    expect(mine.map((m) => m.task.id)).toContain(t.id);
  });

  it("runs parallel reviews; the next stage starts only when all are done", async () => {
    await decideTask(await actor(seed, "marcus"), (await pendingTask(contractId, "dept")).id, "APPROVE", "Supports the data foundation roadmap.");
    let tasks = await tasksFor(contractId);
    expect(tasks.filter((t) => t.stage === 2 && t.status === "PENDING")).toHaveLength(3);

    await decideTask(await actor(seed, "raymond"), (await pendingTask(contractId, "purchasing")).id, "APPROVE");
    await decideTask(await actor(seed, "grace"), (await pendingTask(contractId, "finance")).id, "APPROVE");
    tasks = await tasksFor(contractId);
    expect(tasks.find((t) => t.stepKey === "legal")!.status).toBe("WAITING");
    await decideTask(await actor(seed, "aisha"), (await pendingTask(contractId, "security")).id, "APPROVE", "SOC 2 reviewed.");
    tasks = await tasksFor(contractId);
    expect(tasks.find((t) => t.stepKey === "legal")!.status).toBe("PENDING");
    expect((await getContract(contractId)).status).toBe("IN_LEGAL");
  });

  it("Legal reviews, uploads a redline, resolves issues and clears the exact version", async () => {
    const jonathan = await actor(seed, "jonathan");
    const legal = await pendingTask(contractId, "legal");
    // legal steps cannot be approved through the generic approval action
    await expect(decideTask(jonathan, legal.id, "APPROVE")).rejects.toBeInstanceOf(StateError);
    // a City lawyer cannot clear a DOTComm/County-reviewed agreement
    await expect(legalAction(await actor(seed, "maria"), legal.id, "START")).rejects.toBeInstanceOf(ForbiddenError);

    await legalAction(jonathan, legal.id, "START");
    const issue = await addLegalIssue(jonathan, contractId, { title: "Limitation of liability too low", severity: "HIGH" });
    const [agreementDoc] = await db.select().from(s.contractDocument).where(eq(s.contractDocument.contractId, contractId));
    const redline = await uploadDocument(jonathan, {
      contractId,
      documentId: agreementDoc.id,
      note: "County redline",
      file: await agreementFile("Catalog Subscription", [{ after: "7. Governing Law. This Agreement is governed by the laws of the State of Nebraska.", insert: "8. Public Records. Vendor acknowledges public records obligations." }]),
    });
    expect(redline.version.versionNo).toBe(2);
    expect(redline.version.hasTrackedChanges).toBe(true);

    await expect(legalAction(jonathan, legal.id, "CLEAR")).rejects.toThrow(/open legal issue/);
    await resolveLegalIssue(jonathan, issue.id, "RESOLVED", "Vendor accepted 2x annual fees cap.");
    await legalAction(jonathan, legal.id, "CLEAR", "Cleared v2.");
    const c = await getContract(contractId);
    expect(c.legalStatus).toBe("CLEARED");

    const [decision] = await db.select().from(s.approvalDecision).where(eq(s.approvalDecision.taskId, legal.id));
    expect(decision.decision).toBe("LEGAL_CLEAR");
    expect(decision.documentSha256).toBe(redline.version.sha256); // pinned to the version cleared
  });

  it("final approval makes the contract ready for signature", async () => {
    await decideTask(await actor(seed, "elaine"), (await pendingTask(contractId, "final")).id, "APPROVE");
    const c = await getContract(contractId);
    expect(c.status).toBe("PENDING_SIGNATURE");
    expect(c.approvalStatus).toBe("APPROVED");
    expect(c.signatureStatus).toBe("READY");
    expect(await executionBlockers(db, c)).toEqual([]);
  });

  it("only contract administrators can send for signature; authority is verified", async () => {
    await expect(sendForSignature(await actor(seed, "priya"), contractId, { signerUserId: seed.user.elaine })).rejects.toBeInstanceOf(ForbiddenError);
    const dana = await actor(seed, "dana");
    const res = await sendForSignature(dana, contractId, { signerUserId: seed.user.elaine, vendorSignerName: "Vendor Signer", vendorSignerEmail: "sign@clearbrook.example.com" });
    expect(res.isMock).toBe(true);
    expect((await getContract(contractId)).signatureStatus).toBe("SENT");
    // cannot send twice
    await expect(sendForSignature(dana, contractId, { signerUserId: seed.user.elaine })).rejects.toBeInstanceOf(StateError);

    const checks = await db.select().from(s.signingAuthorityCheck).where(eq(s.signingAuthorityCheck.contractId, contractId));
    expect(checks).toHaveLength(1);
    expect(checks[0].passed).toBe(true);
  });

  it("completes signing in order, stores the executed copy and starts renewal tracking", async () => {
    const dana = await actor(seed, "dana");
    const [req] = await db.select().from(s.signatureRequest).where(eq(s.signatureRequest.contractId, contractId));
    const first = await simulateMockSigning(dana, req.id); // vendor
    expect(first.executed).toBe(false);
    expect((await getContract(contractId)).signatureStatus).toBe("PARTIALLY_SIGNED");
    const second = await simulateMockSigning(dana, req.id); // agency signatory
    expect(second.executed).toBe(true);

    const c = await getContract(contractId);
    expect(c.status).toBe("ACTIVE");
    expect(c.signatureStatus).toBe("DEMO_EXECUTED"); // mock never presented as a legal execution
    expect(c.executionIsDemo).toBe(true);

    const docs = await db.select().from(s.contractDocument).where(eq(s.contractDocument.contractId, contractId));
    expect(docs.map((d) => d.kind)).toEqual(expect.arrayContaining(["EXECUTED", "SIGNATURE_CERTIFICATE"]));
    const checks = await db.select().from(s.signingAuthorityCheck).where(eq(s.signingAuthorityCheck.contractId, contractId));
    expect(checks.map((x) => x.phase)).toEqual(expect.arrayContaining(["PACKAGE", "COMPLETION"]));

    const [ren] = await db.select().from(s.renewal).where(eq(s.renewal.contractId, contractId));
    expect(ren.cycleExpiration).toBe(c.expirationDate);
    expect(ren.noticeDeadline).toBe(day(10 + 365 * 3 - 60));
  });

  it("generates the renewal alert once when the reminder window opens", async () => {
    const c = await getContract(contractId);
    const [ren] = await db.select().from(s.renewal).where(eq(s.renewal.contractId, contractId));
    const windowOpens = new Date(`${ren.noticeDeadline}T18:00:00Z`).getTime() - 85 * 86_400_000; // 85 days before → 90-day threshold
    await runRenewalReminders(new Date(windowOpens));
    await runRenewalReminders(new Date(windowOpens + 3_600_000)); // same day: no duplicate
    const notes = await db.select().from(s.notification).where(eq(s.notification.kind, "CANCELLATION_DEADLINE"));
    const mine = notes.filter((n) => n.link?.includes(c.id));
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((n) => n.dedupeKey)).size).toBe(mine.length);
    expect(mine.every((n) => n.dedupeKey.includes(":90:"))).toBe(true);
  });

  it("keeps an intact, tamper-evident audit chain", async () => {
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    const actions = (await db.select().from(s.auditLog).where(eq(s.auditLog.contractId, contractId))).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "REQUEST_CREATED",
        "WORKFLOW_STARTED",
        "TASK_APPROVED",
        "LEGAL_REVIEW_STARTED",
        "LEGAL_ISSUE_RAISED",
        "DOCUMENT_VERSION_UPLOADED",
        "LEGAL_CLEARED",
        "WORKFLOW_COMPLETED",
        "SIGNING_AUTHORITY_VERIFIED",
        "SIGNATURE_REQUEST_SENT",
        "CONTRACT_DEMO_EXECUTED",
      ]),
    );
  });
});
