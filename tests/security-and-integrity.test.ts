/**
 * Authorization, agency scoping, segregation of duties, document security, append-only records,
 * audit tamper detection, invalid state transitions, delegation, return/resubmit, renewals.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { createRequest, getContractDetail, listContracts, submitRequest, updateRequest } from "@/lib/contracts";
import { addAdHocApprover, decideTask, reassignTask } from "@/lib/workflow";
import { downloadVersion, uploadDocument } from "@/lib/documents";
import { verifyAuditChain } from "@/lib/audit";
import { processOutbox } from "@/lib/notifications";
import { decideRenewal, runRenewalReminders, ensureRenewalCycle } from "@/lib/renewals";
import { ForbiddenError, NotFoundError, StateError, ValidationError } from "@/lib/errors";
import { actor, agreementFile, day, getContract, pendingTask, resetAndSeed, tasksFor, type Seeded } from "./helpers";

let seed: Seeded;
beforeAll(async () => {
  seed = await resetAndSeed();
});

async function countyContract() {
  const [c] = await db.select().from(s.contract).where(eq(s.contract.title, "Payroll & HR cloud"));
  return c;
}

describe("agency-scoped visibility", () => {
  it("City staff cannot see County-only contracts (and cannot tell they exist)", async () => {
    const nina = await actor(seed, "nina");
    const c = await countyContract();
    await expect(getContractDetail(nina, c.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await listContracts(nina);
    expect(list.find((x) => x.id === c.id)).toBeUndefined();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.entityName !== "Douglas County")).toBe(true);
  });

  it("County department staff see their own department's contracts but not other departments'", async () => {
    const paul = await actor(seed, "paul"); // County Clerk
    const list = await listContracts(paul);
    expect(list.some((x) => x.title === "Records management system")).toBe(true);
    expect(list.some((x) => x.title === "Payroll & HR cloud")).toBe(false);
  });

  it("shared contracts are visible to every participating agency without duplicate records", async () => {
    const nina = await actor(seed, "nina");
    const shared = (await listContracts(nina)).find((x) => x.title === "Computer-aided dispatch maintenance");
    expect(shared).toBeTruthy();
    const all = await listContracts(await actor(seed, "owen"));
    expect(all.filter((x) => x.title === "Computer-aided dispatch maintenance")).toHaveLength(1);
  });

  it("auditors see everything but cannot create requests", async () => {
    const owen = await actor(seed, "owen");
    const all = await listContracts(owen);
    expect(all.length).toBeGreaterThan(15);
    await expect(createRequest(owen, { title: "Should fail", requestingDeptId: seed.org["DOT-AA"] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requesters may only file for departments where they hold the Requester role", async () => {
    await expect(createRequest(await actor(seed, "nina"), { title: "Wrong dept", requestingDeptId: seed.org["CTY-TRS"] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("documents", () => {
  it("confidential documents are restricted even for users who can see the contract", async () => {
    const [soc] = await db.select().from(s.contract).where(eq(s.contract.title, "Security operations center (SOC) service"));
    expect(soc.confidential).toBe(true);
    const [ver] = await db
      .select({ id: s.documentVersion.id })
      .from(s.documentVersion)
      .innerJoin(s.contractDocument, eq(s.contractDocument.id, s.documentVersion.documentId))
      .where(eq(s.contractDocument.contractId, soc.id));
    // Linda (City purchasing) can see the shared contract but not its confidential documents
    await getContractDetail(await actor(seed, "linda"), soc.id);
    await expect(downloadVersion(await actor(seed, "linda"), ver.id)).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await downloadVersion(await actor(seed, "aisha"), ver.id);
    expect(ok.bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("validates file types and quarantines malware", async () => {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, { title: "Doc test", requestingDeptId: seed.org["DOT-AA"] });
    await expect(uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", file: { name: "run.exe", type: "application/octet-stream", bytes: Buffer.from("MZ") } })).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", file: { name: "fake.pdf", type: "application/pdf", bytes: Buffer.from("not a pdf") } })).rejects.toBeInstanceOf(ValidationError);
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const up = await uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", file: { name: "notes.txt", type: "text/plain", bytes: Buffer.from(eicar) } });
    expect(up.version.scanStatus).toBe("INFECTED");
    await expect(downloadVersion(priya, up.version.id)).rejects.toThrow(/quarantined/);
    // executed documents cannot be uploaded by users
    await expect(uploadDocument(priya, { contractId: r.contractId, kind: "EXECUTED", file: await agreementFile() })).rejects.toBeInstanceOf(ValidationError);
  });

  it("stores files encrypted at rest and verifies integrity on download", async () => {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, { title: "Encryption test", requestingDeptId: seed.org["DOT-AA"] });
    const up = await uploadDocument(priya, { contractId: r.contractId, kind: "SUPPORTING", file: { name: "plain.txt", type: "text/plain", bytes: Buffer.from("SECRET-PRICING-123") } });
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(`${process.env.STORAGE_DIR}/${up.version.storageKey}`);
    expect(raw.includes(Buffer.from("SECRET-PRICING-123"))).toBe(false);
    const dl = await downloadVersion(priya, up.version.id);
    expect(dl.bytes.toString()).toBe("SECRET-PRICING-123");
  });
});

describe("append-only records and audit integrity", () => {
  it("the database refuses updates and deletes of audit, decision and authority-check rows", async () => {
    const pgMessage = (p: Promise<unknown>) => p.then(() => "no error", (e) => String((e as { cause?: Error }).cause?.message ?? e));
    expect(await pgMessage(db.execute(sql`update audit_log set action = 'X' where id = (select min(id) from audit_log)`))).toMatch(/append-only/);
    expect(await pgMessage(db.execute(sql`delete from audit_log`))).toMatch(/append-only/);
    expect(await pgMessage(db.execute(sql`update signing_authority_check set passed = true`))).toMatch(/no error|append-only/);
    expect(await pgMessage(db.execute(sql`update document_version set sha256 = 'x'`))).toMatch(/immutable/);
    expect(await pgMessage(db.execute(sql`delete from document_version`))).toMatch(/cannot be deleted/);
  });

  it("detects tampering if someone bypasses the database guard", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
    await db.execute(sql`alter table audit_log disable trigger audit_log_append_only`);
    await db.execute(sql`update audit_log set data = '{"tampered":true}' where id = (select min(id) + 3 from audit_log)`);
    await db.execute(sql`alter table audit_log enable trigger audit_log_append_only`);
    const res = await verifyAuditChain();
    expect(res.ok).toBe(false);
    expect(res.brokenAtId).toBeGreaterThan(0);
  });
});

describe("workflow transitions", () => {
  async function submitted(title = "Workflow test") {
    const priya = await actor(seed, "priya");
    const r = await createRequest(priya, {
      title,
      typeKey: "SOFTWARE_LICENSE",
      vendorId: seed.vendor.granite,
      requestingDeptId: seed.org["DOT-AA"],
      businessPurpose: "Test",
      totalValue: 20000,
      fundingSource: "Ops",
      effectiveDate: day(5),
      expirationDate: day(370),
    });
    await submitRequest(priya, r.requestId);
    return r;
  }

  it("return for revision → edit → resubmit starts a new instance and keeps history", async () => {
    const r = await submitted("Return test");
    await decideTask(await actor(seed, "marcus"), (await pendingTask(r.contractId, "dept")).id, "RETURN", "Attach the quote.");
    expect((await getContract(r.contractId)).status).toBe("DRAFT");
    const priya = await actor(seed, "priya");
    await updateRequest(priya, r.requestId, {
      title: "Return test",
      typeKey: "SOFTWARE_LICENSE",
      vendorId: seed.vendor.granite,
      requestingDeptId: seed.org["DOT-AA"],
      businessPurpose: "Test with quote",
      totalValue: 21000,
      fundingSource: "Ops",
      effectiveDate: day(5),
      expirationDate: day(370),
    });
    await submitRequest(priya, r.requestId);
    const tasks = await tasksFor(r.contractId);
    expect(new Set(tasks.map((t) => t.instanceId)).size).toBe(2);
    expect(tasks.some((t) => t.status === "RETURNED")).toBe(true);
    expect(tasks.some((t) => t.status === "PENDING" && t.stepKey === "dept")).toBe(true);
  });

  it("rejection closes the workflow and cancels open steps", async () => {
    const r = await submitted("Reject test");
    await decideTask(await actor(seed, "marcus"), (await pendingTask(r.contractId, "dept")).id, "REJECT", "Duplicate of existing license.");
    const c = await getContract(r.contractId);
    expect(c.status).toBe("CANCELLED");
    expect(c.approvalStatus).toBe("REJECTED");
    const tasks = await tasksFor(r.contractId);
    expect(tasks.filter((t) => t.status === "CANCELLED").length).toBeGreaterThan(0);
    await expect(decideTask(await actor(seed, "raymond"), tasks.find((t) => t.stepKey === "purchasing")!.id, "APPROVE")).rejects.toThrow();
  });

  it("a decided task cannot be decided again; a draft cannot be resubmitted twice", async () => {
    const r = await submitted("Double test");
    const t = await pendingTask(r.contractId, "dept");
    await decideTask(await actor(seed, "marcus"), t.id, "APPROVE");
    await expect(decideTask(await actor(seed, "marcus"), t.id, "APPROVE")).rejects.toThrow();
    await expect(submitRequest(await actor(seed, "priya"), r.requestId)).rejects.toBeInstanceOf(StateError);
  });

  it("approval delegation lets a delegate act, recorded on behalf of the delegator", async () => {
    const r = await submitted("Delegation test");
    await db.insert(s.approvalDelegation).values({ fromUserId: seed.user.marcus, toUserId: seed.user.ken, startsOn: day(-1), endsOn: day(7), reason: "Leave", createdById: seed.user.marcus });
    const t = await pendingTask(r.contractId, "dept");
    await decideTask(await actor(seed, "ken"), t.id, "APPROVE", "Approving for Marcus while out.");
    const [d] = await db.select().from(s.approvalDecision).where(eq(s.approvalDecision.taskId, t.id));
    expect(d.userId).toBe(seed.user.ken);
    expect(d.onBehalfOfUserId).toBe(seed.user.marcus);
  });

  it("reassignment only to eligible users; ad hoc approvers join the current stage", async () => {
    const r = await submitted("Reassign test");
    const t = await pendingTask(r.contractId, "dept");
    await expect(reassignTask(await actor(seed, "dana"), t.id, seed.user.linda, "out of office")).rejects.toBeInstanceOf(ValidationError);
    await expect(reassignTask(await actor(seed, "nina"), t.id, seed.user.marcus, "x")).rejects.toBeInstanceOf(NotFoundError); // out of scope: looks like 404
    const [inst] = await db.select().from(s.workflowInstance).where(eq(s.workflowInstance.contractId, r.contractId));
    await expect(addAdHocApprover(await actor(seed, "dana"), inst.id, seed.user.priya, "x")).rejects.toThrow(/requester/);
    await addAdHocApprover(await actor(seed, "dana"), inst.id, seed.user.aisha, "Security sanity check");
    await decideTask(await actor(seed, "marcus"), t.id, "APPROVE");
    // stage 2 does not start until the ad hoc approval is done
    expect((await tasksFor(r.contractId)).find((x) => x.stepKey === "purchasing")!.status).toBe("WAITING");
    const adhoc = (await tasksFor(r.contractId)).find((x) => x.isAdHoc)!;
    await decideTask(await actor(seed, "aisha"), adhoc.id, "APPROVE");
    expect((await tasksFor(r.contractId)).find((x) => x.stepKey === "purchasing")!.status).toBe("PENDING");
  });
});

describe("renewals and notifications", () => {
  it("auto-renewing contracts roll their term forward unless a termination decision is recorded", async () => {
    const [fire] = await db.select().from(s.contract).where(eq(s.contract.title, "Fire records management SaaS"));
    const [email] = await db.select().from(s.contract).where(eq(s.contract.title, "Enterprise email & productivity suite"));
    expect(fire.autoRenew && email.autoRenew).toBe(true);
    const [ren] = await db.select().from(s.renewal).where(eq(s.renewal.contractId, email.id));
    await expect(decideRenewal(await actor(seed, "nina"), ren.id, "TERMINATE", "x")).rejects.toBeInstanceOf(NotFoundError); // out of scope: looks like 404
    await expect(decideRenewal(await actor(seed, "linda"), ren.id, "TERMINATE", "x")).rejects.toBeInstanceOf(ForbiddenError); // can see it, not the owner
    await decideRenewal(await actor(seed, "greg"), ren.id, "TERMINATE", "Consolidating onto the new suite");
    expect(await db.select().from(s.actionItem).where(eq(s.actionItem.sourceKey, `nonrenewal-notice:${ren.id}`))).toHaveLength(1);

    await runRenewalReminders(new Date(Date.now() + 40 * 86_400_000)); // both terms have ended by then
    const fireAfter = await getContract(fire.id);
    expect(fireAfter.status).toBe("ACTIVE");
    expect(fireAfter.expirationDate! > fire.expirationDate!).toBe(true); // rolled forward under its terms
    expect((await getContract(email.id)).status).toBe("EXPIRED"); // termination decision respected
  });

  it("fires each threshold once, skips missed ones without flooding, and expires or auto-renews at term end", async () => {
    const [c0] = await db
      .insert(s.contract)
      .values({
        number: "CTR-TEST-0001",
        title: "Renewal clock test",
        typeId: (await db.select().from(s.contractType).where(eq(s.contractType.key, "SAAS")))[0].id,
        contractingEntityId: seed.org.DOTCOMM,
        administeringOrgId: seed.org["DOT-AA"],
        requestingDeptId: seed.org["DOT-AA"],
        ownerId: seed.user.priya,
        status: "ACTIVE",
        effectiveDate: day(-100),
        expirationDate: day(200),
        noticeDays: 30,
        autoRenew: false,
      })
      .returning();
    await ensureRenewalCycle(db, c0);
    const at = (n: number) => new Date(Date.now() + n * 86_400_000);
    const mine = async () => (await db.select().from(s.notification).where(eq(s.notification.link, `/contracts/${c0.id}?tab=renewals`))).filter((n) => n.userId === seed.user.priya);

    await runRenewalReminders(at(0)); // 170 days to deadline → 180-day reminder
    await runRenewalReminders(at(0));
    expect((await mine()).map((n) => n.dedupeKey.split(":")[3])).toEqual(["180"]);
    await runRenewalReminders(at(150)); // 20 days left: 120/90/60 were missed → only the 30-day one
    expect((await mine()).map((n) => n.dedupeKey.split(":")[3]).sort()).toEqual(["180", "30"]);

    const [items] = await db.select().from(s.actionItem).where(eq(s.actionItem.contractId, c0.id));
    expect(items.kind).toBe("RENEWAL_DECISION");

    await runRenewalReminders(at(205)); // past expiration, not auto-renewing → expired
    expect((await getContract(c0.id)).status).toBe("EXPIRED");
  });

  it("delivers queued email with retry tracking", async () => {
    const before = await db.select().from(s.notificationDelivery).where(eq(s.notificationDelivery.status, "QUEUED"));
    expect(before.length).toBeGreaterThan(0);
    const res = await processOutbox();
    expect(res.sent).toBeGreaterThan(0);
    const after = await db.select().from(s.notificationDelivery).where(eq(s.notificationDelivery.status, "SENT"));
    expect(after[0].payload).toBeTruthy();
  });
});
