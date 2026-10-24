/**
 * Signing authority & execution.
 *
 * Authority is a recorded fact (who may sign for which legal entity, up to what amount, for which
 * contract types, during which dates, under what authorizing reference) — never inferred from being
 * a contract owner, administrator or approver. Every check is appended to signing_authority_check.
 *
 * Execution is enabled only when: the approval workflow completed, Legal cleared the exact agreement
 * version being signed (when Legal review is required), the file passed the malware scan, and the
 * named signatory holds valid authority. Authority is re-checked when signing completes.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type Conn } from "@/db";
import {
  approvalDecision,
  contract,
  contractRequest,
  contractType,
  documentVersion,
  signatureEvent,
  signatureRequest,
  signatureSigner,
  signingAuthority,
  signingAuthorityCheck,
  user,
  vendor,
  workflowInstance,
  workflowTask,
  type AuthorityCheckReason,
} from "@/db/schema";
import { currentAgreementVersion } from "./agreement";
import { sha256, writeAudit } from "./audit";
import { assertCanViewContract, canManageSigningAuthority, getOrgIndex, isContractAdminFor, type Actor } from "./authz";
import { formatDate, isValidISODate, todayIn } from "./dates";
import { uploadDocument, type IncomingFile } from "./documents";
import { AppError, ForbiddenError, NotFoundError, StateError, ValidationError } from "./errors";
import { getESignProvider } from "./esign";
import { formatMoney, toNumber } from "./money";
import { notify } from "./notifications";
import { contractAdmins } from "./people";
import { ensureRenewalCycle } from "./renewals";
import { getStorage } from "./storage";

type Authority = typeof signingAuthority.$inferSelect;
type ContractRow = typeof contract.$inferSelect;

export type AuthorityResult = {
  passed: boolean;
  authority: Authority | null;
  reasons: AuthorityCheckReason[];
};

function evaluateOne(a: Authority, amount: number, typeKey: string, onDate: string): AuthorityCheckReason[] {
  const r: AuthorityCheckReason[] = [];
  if (a.revokedAt) r.push({ code: "AUTHORITY_REVOKED", message: `Authority ${a.authorizingReference} was revoked${a.revokedReason ? `: ${a.revokedReason}` : ""}.` });
  if (a.effectiveFrom > onDate) r.push({ code: "AUTHORITY_NOT_YET_EFFECTIVE", message: `Authority ${a.authorizingReference} starts ${formatDate(a.effectiveFrom)}.` });
  if (a.effectiveTo && a.effectiveTo < onDate) r.push({ code: "AUTHORITY_EXPIRED", message: `Authority ${a.authorizingReference} expired ${formatDate(a.effectiveTo)}.` });
  if (a.maxAmount != null && amount > toNumber(a.maxAmount)) {
    r.push({ code: "AMOUNT_EXCEEDS_LIMIT", message: `Contract value ${formatMoney(amount)} exceeds the ${formatMoney(a.maxAmount)} limit of ${a.authorizingReference}.` });
  }
  if (a.contractTypeKeys.length && !a.contractTypeKeys.includes(typeKey)) {
    r.push({ code: "TYPE_NOT_COVERED", message: `Authority ${a.authorizingReference} covers ${a.contractTypeKeys.join(", ")} only.` });
  }
  return r;
}

async function evaluateUser(
  conn: Conn,
  userId: string,
  legalEntityId: string,
  amount: number,
  typeKey: string,
  onDate: string,
  depth = 0,
): Promise<AuthorityResult> {
  const [u] = await conn.select().from(user).where(eq(user.id, userId));
  if (!u?.active) return { passed: false, authority: null, reasons: [{ code: "SIGNER_INACTIVE", message: "The signer's account is inactive." }] };
  const auths = await conn
    .select()
    .from(signingAuthority)
    .where(and(eq(signingAuthority.userId, userId), eq(signingAuthority.legalEntityId, legalEntityId)));
  if (!auths.length) {
    return { passed: false, authority: null, reasons: [{ code: "NO_AUTHORITY_FOR_ENTITY", message: `${u.name} has no recorded signing authority for this contracting entity.` }] };
  }
  let best: AuthorityResult | null = null;
  for (const a of auths) {
    const reasons = evaluateOne(a, amount, typeKey, onDate);
    if (!reasons.length && a.source === "DELEGATED") {
      if (!a.delegatedFromUserId || depth >= 3) {
        reasons.push({ code: "DELEGATOR_AUTHORITY_INVALID", message: "Delegation chain is missing or too deep." });
      } else {
        const up = await evaluateUser(conn, a.delegatedFromUserId, legalEntityId, amount, typeKey, onDate, depth + 1);
        if (!up.passed) {
          reasons.push({
            code: "DELEGATOR_AUTHORITY_INVALID",
            message: `The delegating official's authority does not cover this contract: ${up.reasons.map((x) => x.message).join(" ")}`,
          });
        }
      }
    }
    const res = { passed: reasons.length === 0, authority: a, reasons };
    if (res.passed) return res;
    if (!best || reasons.length < best.reasons.length) best = res;
  }
  return best!;
}

export async function checkAuthority(conn: Conn, c: ContractRow, signerUserId: string, onDate?: string): Promise<AuthorityResult> {
  const [type] = await conn.select().from(contractType).where(eq(contractType.id, c.typeId));
  const idx = await getOrgIndex(conn);
  const tz = idx.get(c.contractingEntityId)?.timeZone ?? "America/Chicago";
  return evaluateUser(conn, signerUserId, c.contractingEntityId, toNumber(c.totalValue), type.key, onDate ?? todayIn(tz));
}

/** Users who could validly sign this contract today. */
export async function authorizedSignatories(conn: Conn, c: ContractRow) {
  const candidates = await conn
    .selectDistinct({ userId: signingAuthority.userId, name: user.name, title: user.title, email: user.email })
    .from(signingAuthority)
    .innerJoin(user, eq(user.id, signingAuthority.userId))
    .where(eq(signingAuthority.legalEntityId, c.contractingEntityId));
  const out: { userId: string; name: string; title: string | null; email: string; authority: Authority }[] = [];
  for (const cand of candidates) {
    const r = await checkAuthority(conn, c, cand.userId);
    if (r.passed && r.authority) out.push({ ...cand, authority: r.authority });
  }
  return out;
}

async function recordCheck(c: ContractRow, signerId: string, result: AuthorityResult, phase: string, actorId: string, onDate?: string) {
  await db.transaction(async (tx) => {
    await tx.insert(signingAuthorityCheck).values({
      contractId: c.id,
      signerId,
      authorityId: result.authority?.id ?? null,
      passed: result.passed,
      reasons: result.reasons,
      phase,
      checkedById: actorId,
    });
    await writeAudit(tx, {
      actorId,
      action: result.passed ? "SIGNING_AUTHORITY_VERIFIED" : "SIGNING_AUTHORITY_BLOCKED",
      entityType: "contract",
      entityId: c.id,
      contractId: c.id,
      data: { signerId, phase, onDate: onDate ?? null, authority: result.authority?.authorizingReference ?? null, reasons: result.reasons },
    });
  });
}

export type Blocker = { code: string; message: string };

/** Everything that must be true before a contract can be sent for signature or recorded as executed. */
export async function executionBlockers(conn: Conn, c: ContractRow): Promise<Blocker[]> {
  const b: Blocker[] = [];
  if (c.status !== "PENDING_SIGNATURE") b.push({ code: "NOT_PENDING_SIGNATURE", message: `Contract status is ${c.status.replace(/_/g, " ").toLowerCase()}, not pending signature.` });
  else if (c.signatureStatus !== "READY") b.push({ code: "SIGNATURE_IN_PROGRESS", message: "A signature request is already in progress for this contract." });
  const [inst] = await conn
    .select()
    .from(workflowInstance)
    .where(eq(workflowInstance.contractId, c.id))
    .orderBy(desc(workflowInstance.startedAt))
    .limit(1);
  if (!inst || inst.status !== "COMPLETED") b.push({ code: "APPROVALS_INCOMPLETE", message: "Required approvals are not complete." });
  const agreement = await currentAgreementVersion(conn, c.id);
  if (!agreement) b.push({ code: "NO_AGREEMENT", message: "No agreement document has been uploaded." });
  else if (agreement.scanStatus !== "CLEAN") b.push({ code: "AGREEMENT_NOT_SCANNED", message: "The agreement has not passed the malware scan." });

  if (inst) {
    // Terms must be the ones the approvals were routed and granted against.
    const approved = (inst.context as { contract?: { totalValue?: number; expirationDate?: string | null } }).contract ?? {};
    if (approved.totalValue != null && Math.abs(approved.totalValue - toNumber(c.totalValue)) > 0.005) {
      b.push({ code: "TERMS_CHANGED_AFTER_APPROVAL", message: `The value changed after approval (${formatMoney(approved.totalValue)} approved, ${formatMoney(c.totalValue)} now). Route the change for re-approval.` });
    }
    if (approved.expirationDate !== undefined && approved.expirationDate !== c.expirationDate) {
      b.push({ code: "TERMS_CHANGED_AFTER_APPROVAL", message: "The term changed after approval. Route the change for re-approval." });
    }
  }
  if (inst && agreement) {
    const tasks = await conn.select().from(workflowTask).where(eq(workflowTask.instanceId, inst.id));
    // With Legal review, Legal's clearance of the exact text vouches for edits made during negotiation, so only
    // steps flagged for re-approval must match. Without Legal, every approval must be of the current text.
    const pinned = tasks.filter((t) => t.status === "APPROVED" && (t.reapproveOnMaterialChange || !c.legalRequired));
    if (pinned.length) {
      const decisions = await conn
        .select()
        .from(approvalDecision)
        .where(inArray(approvalDecision.taskId, pinned.map((t) => t.id)));
      for (const t of pinned) {
        const d = decisions.filter((x) => x.taskId === t.id).sort((x, y) => +y.createdAt - +x.createdAt)[0];
        if (d && d.documentSha256 && d.documentSha256 !== agreement.sha256) {
          b.push({ code: "APPROVAL_VERSION_MISMATCH", message: `"${t.name}" approved an earlier agreement version. Re-approval is required for version ${agreement.versionNo}.` });
        }
      }
    }
  }
  if (c.legalRequired) {
    if (c.legalStatus !== "CLEARED") b.push({ code: "LEGAL_NOT_CLEARED", message: "Legal has not cleared the agreement." });
    else if (agreement && inst) {
      const [clear] = await conn
        .select({ sha: approvalDecision.documentSha256 })
        .from(approvalDecision)
        .innerJoin(workflowTask, eq(workflowTask.id, approvalDecision.taskId))
        .where(and(eq(workflowTask.instanceId, inst.id), eq(approvalDecision.decision, "LEGAL_CLEAR")))
        .orderBy(desc(approvalDecision.createdAt))
        .limit(1);
      if (!clear || clear.sha !== agreement.sha256) {
        b.push({ code: "LEGAL_VERSION_MISMATCH", message: `Legal cleared a different version than the current agreement (v${agreement.versionNo}).` });
      }
    }
  }
  return b;
}

export class AuthorityBlockedError extends AppError {
  constructor(public reasons: AuthorityCheckReason[], public alternatives: { userId: string; name: string; title: string | null }[]) {
    super("Signing is blocked: the selected signatory does not hold valid authority for this contract.", 409, "AUTHORITY_BLOCKED", { reasons, alternatives });
  }
}

async function loadContractForAdmin(actor: Actor, contractId: string, conn: Conn = db) {
  const [c] = await conn.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw new NotFoundError("Contract");
  await assertCanViewContract(actor, c, conn);
  const idx = await getOrgIndex(conn);
  if (!isContractAdminFor(actor, c, idx)) throw new ForbiddenError("Only contract administrators can manage signatures.");
  return c;
}

export type SendInput = {
  signerUserId: string;
  vendorSignerName?: string;
  vendorSignerEmail?: string;
  message?: string;
};

export async function sendForSignature(actor: Actor, contractId: string, input: SendInput) {
  const c = await loadContractForAdmin(actor, contractId);
  const blockers = await executionBlockers(db, c);
  if (blockers.length) throw new StateError("This contract is not ready for signature.", blockers);
  if (input.vendorSignerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.vendorSignerEmail)) throw new ValidationError("Vendor signer email is invalid.");

  const result = await checkAuthority(db, c, input.signerUserId);
  await recordCheck(c, input.signerUserId, result, "PACKAGE", actor.id);
  if (!result.passed) {
    const alternatives = (await authorizedSignatories(db, c)).map((s) => ({ userId: s.userId, name: s.name, title: s.title }));
    throw new AuthorityBlockedError(result.reasons, alternatives);
  }

  const agreement = (await currentAgreementVersion(db, c.id))!;
  const [ver] = await db.select().from(documentVersion).where(eq(documentVersion.id, agreement.versionId));
  const bytes = await getStorage().get(ver.storageKey);
  if (sha256(bytes) !== ver.sha256) throw new StateError("Agreement file failed its integrity check.");
  const [signer] = await db.select().from(user).where(eq(user.id, input.signerUserId));
  const [v] = c.vendorId ? await db.select().from(vendor).where(eq(vendor.id, c.vendorId)) : [];

  const signers = [
    ...(input.vendorSignerName && input.vendorSignerEmail
      ? [{ order: 1, name: input.vendorSignerName, email: input.vendorSignerEmail, role: "VENDOR" as const }]
      : []),
    { order: input.vendorSignerName ? 2 : 1, name: signer.name, email: signer.email, role: "AGENCY" as const },
  ];
  const provider = getESignProvider();
  const docInput = { fileName: ver.fileName, bytes, sha256: ver.sha256 };

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(contract).where(eq(contract.id, c.id)).for("update");
    if (locked.signatureStatus !== "READY") throw new StateError("A signature request is already in progress for this contract.");
    const [req] = await tx
      .insert(signatureRequest)
      .values({ contractId: c.id, provider: provider.name, isMock: provider.isMock, documentVersionId: ver.id, documentSha256: ver.sha256, createdById: actor.id })
      .returning();
    const { envelopeId } = await provider.createEnvelope({
      subject: `${c.number}: ${c.title}`,
      message: input.message ?? `Please sign ${c.title}${v ? ` with ${v.name}` : ""}.`,
      document: docInput,
      signers,
      callbackRef: req.id,
    });
    await tx.update(signatureRequest).set({ providerEnvelopeId: envelopeId }).where(eq(signatureRequest.id, req.id));
    for (const s of signers) {
      await tx.insert(signatureSigner).values({
        requestId: req.id,
        order: s.order,
        signerType: s.role,
        userId: s.role === "AGENCY" ? signer.id : null,
        authorityId: s.role === "AGENCY" ? result.authority!.id : null,
        name: s.name,
        email: s.email,
        status: s.order === 1 ? "SENT" : "WAITING",
      });
    }
    await tx.insert(signatureEvent).values({ requestId: req.id, event: "ENVELOPE_SENT", detail: { envelopeId, provider: provider.name, mock: provider.isMock } });
    await tx.update(contract).set({ signatureStatus: "SENT" }).where(eq(contract.id, c.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "SIGNATURE_REQUEST_SENT",
      entityType: "signature_request",
      entityId: req.id,
      contractId: c.id,
      data: {
        provider: provider.name,
        mock: provider.isMock,
        envelopeId,
        signatory: signer.name,
        authority: result.authority!.authorizingReference,
        agreementSha256: ver.sha256,
        signers: signers.map((s) => `${s.order}. ${s.name} (${s.role})`),
      },
    });
    await notify(tx, {
      userIds: [signer.id],
      kind: "SIGNATURE_REQUESTED",
      title: `Signature requested: ${c.number} ${c.title}`,
      body: provider.isMock ? "DEMO: simulated signature request (mock provider)." : `You will receive the signing request from ${provider.name}.`,
      link: `/contracts/${c.id}?tab=signature`,
      dedupeKey: `sig-requested:${req.id}`,
    });
    return { signatureRequestId: req.id, envelopeId, isMock: provider.isMock };
  });
}

/**
 * Applies a provider status update (from the provider webhook, or the dev mock's "simulate" action).
 * When every signer has signed, re-verifies authority and records execution.
 */
export async function applySignerSigned(actorId: string, signatureRequestId: string, signerId: string) {
  const outcome = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId)).for("update");
    if (!req) throw new NotFoundError("Signature request");
    if (!["SENT", "PARTIALLY_SIGNED"].includes(req.status)) throw new StateError(`Signature request is ${req.status.toLowerCase()}.`);
    const signers = await tx.select().from(signatureSigner).where(eq(signatureSigner.requestId, req.id));
    const s = signers.find((x) => x.id === signerId);
    if (!s) throw new NotFoundError("Signer");
    if (s.status !== "SENT") throw new StateError("This signer is not the current signer in the signing order.");
    await tx.update(signatureSigner).set({ status: "SIGNED", signedAt: new Date() }).where(eq(signatureSigner.id, s.id));
    await tx.insert(signatureEvent).values({ requestId: req.id, event: "SIGNER_SIGNED", detail: { signer: s.name, order: s.order, mock: req.isMock } });
    const next = signers.filter((x) => x.status === "WAITING").sort((a, b) => a.order - b.order)[0];
    if (next) {
      await tx.update(signatureSigner).set({ status: "SENT" }).where(eq(signatureSigner.id, next.id));
      await tx.update(signatureRequest).set({ status: "PARTIALLY_SIGNED" }).where(eq(signatureRequest.id, req.id));
      await tx.update(contract).set({ signatureStatus: "PARTIALLY_SIGNED" }).where(eq(contract.id, req.contractId));
      await writeAudit(tx, { actorId, action: "SIGNER_SIGNED", entityType: "signature_request", entityId: req.id, contractId: req.contractId, data: { signer: s.name, mock: req.isMock } });
      return { complete: false as const };
    }
    // Every signer is done. Hold the request in COMPLETING (it can no longer be voided) until execution is recorded.
    await tx.update(signatureRequest).set({ status: "COMPLETING" }).where(eq(signatureRequest.id, req.id));
    await tx.update(contract).set({ signatureStatus: "PARTIALLY_SIGNED" }).where(eq(contract.id, req.contractId));
    await writeAudit(tx, { actorId, action: "SIGNER_SIGNED", entityType: "signature_request", entityId: req.id, contractId: req.contractId, data: { signer: s.name, mock: req.isMock, allSigned: true } });
    return { complete: true as const, req };
  });
  if (!outcome.complete) return { executed: false };
  return completeExecution(actorId, outcome.req.id);
}

/** Re-runs execution recording for a request whose signers all signed but completion failed (e.g. storage outage). */
export async function retryCompletion(actor: Actor, signatureRequestId: string) {
  const [req] = await db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  if (!req) throw new NotFoundError("Signature request");
  await loadContractForAdmin(actor, req.contractId);
  if (req.status !== "COMPLETING") throw new StateError("This signature request is not waiting to be completed.");
  return completeExecution(actor.id, req.id);
}

/** Locks the request and contract and confirms nothing changed (void, material change) since signing finished. */
async function lockForCompletion(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], requestId: string) {
  const [req] = await tx.select().from(signatureRequest).where(eq(signatureRequest.id, requestId)).for("update");
  const [c] = await tx.select().from(contract).where(eq(contract.id, req.contractId)).for("update");
  if (req.status !== "COMPLETING") throw new StateError(`Signature request is ${req.status.toLowerCase()}; execution was not recorded.`);
  if (c.status !== "PENDING_SIGNATURE" || !["SENT", "PARTIALLY_SIGNED"].includes(c.signatureStatus)) {
    throw new StateError("The contract changed while signing completed; execution was not recorded.");
  }
  return { req, c };
}

async function completeExecution(actorId: string, requestId: string) {
  const [req] = await db.select().from(signatureRequest).where(eq(signatureRequest.id, requestId));
  const [c] = await db.select().from(contract).where(eq(contract.id, req.contractId));
  const [agencySigner] = await db
    .select()
    .from(signatureSigner)
    .where(and(eq(signatureSigner.requestId, req.id), eq(signatureSigner.signerType, "AGENCY")));
  // Authority must still be valid at the moment of completion.
  const result = await checkAuthority(db, c, agencySigner.userId!);
  await recordCheck(c, agencySigner.userId!, result, "COMPLETION", actorId);
  if (!result.passed) {
    await db.transaction(async (tx) => {
      await lockForCompletion(tx, req.id);
      await tx.update(signatureRequest).set({ status: "VOIDED" }).where(eq(signatureRequest.id, req.id));
      await tx.insert(signatureEvent).values({ requestId: req.id, event: "VOIDED_AUTHORITY_LAPSED", detail: { reasons: result.reasons } });
      await tx.update(contract).set({ signatureStatus: "READY" }).where(eq(contract.id, c.id));
      const admins = await contractAdmins(tx, c.administeringOrgId);
      await notify(tx, {
        userIds: admins.map((a) => a.id),
        kind: "SIGNATURE_BLOCKED",
        title: `Execution blocked for ${c.number}: signing authority lapsed`,
        body: result.reasons.map((r) => r.message).join(" "),
        link: `/contracts/${c.id}?tab=signature`,
        dedupeKey: `sig-lapsed:${req.id}`,
      });
    });
    return { executed: false, blocked: result.reasons };
  }

  const provider = getESignProvider();
  const [ver] = await db.select().from(documentVersion).where(eq(documentVersion.id, req.documentVersionId));
  const original = await getStorage().get(ver.storageKey);
  const artifacts = await provider.fetchCompletedArtifacts(req.providerEnvelopeId!, { fileName: ver.fileName, bytes: original, sha256: ver.sha256 });
  const systemActor: Actor = { id: actorId, name: "system", email: "", title: null, primaryOrgId: null, assignments: [] };

  return db.transaction(async (tx) => {
    const { c: locked } = await lockForCompletion(tx, req.id);
    const execDoc = await uploadDocument(
      systemActor,
      {
        contractId: c.id,
        kind: "EXECUTED",
        title: req.isMock ? "DEMO — not legally executed" : "Executed agreement",
        file: { name: artifacts.executed.fileName, type: artifacts.executed.mimeType, bytes: artifacts.executed.bytes },
        system: true,
      },
      tx,
    );
    await uploadDocument(
      systemActor,
      {
        contractId: c.id,
        kind: "SIGNATURE_CERTIFICATE",
        title: req.isMock ? "DEMO signature certificate" : "Certificate of completion",
        file: { name: artifacts.certificate.fileName, type: artifacts.certificate.mimeType, bytes: artifacts.certificate.bytes },
        system: true,
      },
      tx,
    );
    await tx.update(signatureRequest).set({ status: "COMPLETED", completedAt: new Date() }).where(eq(signatureRequest.id, req.id));
    await tx.insert(signatureEvent).values({ requestId: req.id, event: "ENVELOPE_COMPLETED", detail: { executedVersionId: execDoc.version.id, mock: req.isMock } });
    const [updated] = await tx
      .update(contract)
      .set({
        status: "ACTIVE",
        signatureStatus: req.isMock ? "DEMO_EXECUTED" : "EXECUTED",
        executionIsDemo: req.isMock,
        executedAt: new Date(),
      })
      .where(eq(contract.id, locked.id))
      .returning();
    await tx
      .update(contractRequest)
      .set({ status: "COMPLETED" })
      .where(and(eq(contractRequest.contractId, c.id), eq(contractRequest.status, "APPROVED")));
    await ensureRenewalCycle(tx, updated);
    await writeAudit(tx, {
      actorId,
      action: req.isMock ? "CONTRACT_DEMO_EXECUTED" : "CONTRACT_EXECUTED",
      entityType: "contract",
      entityId: c.id,
      contractId: c.id,
      data: {
        signatureRequest: req.id,
        provider: req.provider,
        mock: req.isMock,
        authority: result.authority?.authorizingReference,
        note: req.isMock ? "Completed through the development mock. NOT a legal execution." : null,
      },
    });
    const requesters = await tx.select({ id: contractRequest.requesterId }).from(contractRequest).where(eq(contractRequest.contractId, c.id));
    await notify(tx, {
      userIds: [c.ownerId, ...requesters.map((r) => r.id)],
      kind: "CONTRACT_EXECUTED",
      title: `${req.isMock ? "DEMO execution recorded" : "Executed"}: ${c.number} ${c.title}`,
      body: `The contract is now active. Renewal tracking has started${c.expirationDate ? ` for expiration ${formatDate(c.expirationDate)}` : ""}.`,
      link: `/contracts/${c.id}`,
      dedupeKey: `executed:${req.id}`,
    });
    return { executed: true, demo: req.isMock };
  });
}

/** Development only: advance the current signer on a mock envelope. */
export async function simulateMockSigning(actor: Actor, signatureRequestId: string) {
  const [req] = await db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  if (!req) throw new NotFoundError("Signature request");
  await loadContractForAdmin(actor, req.contractId);
  if (!req.isMock) throw new ForbiddenError("Simulation is only available for the development mock provider.");
  const signers = await db.select().from(signatureSigner).where(eq(signatureSigner.requestId, req.id));
  const current = signers.find((s) => s.status === "SENT");
  if (!current) throw new StateError("No signer is awaiting signature.");
  return applySignerSigned(actor.id, req.id, current.id);
}

export async function voidSignatureRequest(actor: Actor, signatureRequestId: string, reason: string) {
  if (!reason?.trim()) throw new ValidationError("A reason is required to void a signature request.");
  const [req] = await db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  if (!req) throw new NotFoundError("Signature request");
  await loadContractForAdmin(actor, req.contractId);
  if (!["SENT", "PARTIALLY_SIGNED"].includes(req.status)) throw new StateError("Only in-progress signature requests can be voided.");
  if (!req.isMock) await getESignProvider().voidEnvelope(req.providerEnvelopeId!, reason);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(signatureRequest).where(eq(signatureRequest.id, req.id)).for("update");
    if (!["SENT", "PARTIALLY_SIGNED"].includes(locked.status)) throw new StateError("Signing finished or the request changed; it can no longer be voided.");
    await tx.update(signatureRequest).set({ status: "VOIDED" }).where(eq(signatureRequest.id, req.id));
    await tx.insert(signatureEvent).values({ requestId: req.id, event: "VOIDED", detail: { reason, by: actor.name } });
    await tx.update(contract).set({ signatureStatus: "READY" }).where(eq(contract.id, req.contractId));
    await writeAudit(tx, { actorId: actor.id, action: "SIGNATURE_REQUEST_VOIDED", entityType: "signature_request", entityId: req.id, contractId: req.contractId, data: { reason } });
  });
}

export type ExternalExecutionInput = { signerUserId: string; signedOn: string; vendorSignerName?: string; file: IncomingFile; note?: string };

/** Records an agreement signed outside the CLM (wet ink or another system). Authority is checked as of the signing date. */
export async function recordExternalExecution(actor: Actor, contractId: string, input: ExternalExecutionInput) {
  const c = await loadContractForAdmin(actor, contractId);
  if (!isValidISODate(input.signedOn)) throw new ValidationError("Enter the date the agreement was signed.");
  if (input.signedOn > todayIn()) throw new ValidationError("The signing date cannot be in the future.");
  const blockers = await executionBlockers(db, c);
  if (blockers.length) throw new StateError("This contract is not ready to be recorded as executed.", blockers);
  const [inst] = await db.select().from(workflowInstance).where(eq(workflowInstance.contractId, c.id)).orderBy(desc(workflowInstance.startedAt)).limit(1);
  const tz = (await getOrgIndex()).get(c.contractingEntityId)?.timeZone ?? "America/Chicago";
  const approvedOn = inst?.completedAt ? todayIn(tz, inst.completedAt) : null;
  if (!approvedOn || input.signedOn < approvedOn) {
    throw new ValidationError(`The signing date must be on or after final approval (${formatDate(approvedOn)}). An agreement signed before approval cannot be recorded here.`);
  }
  const result = await checkAuthority(db, c, input.signerUserId, input.signedOn);
  await recordCheck(c, input.signerUserId, result, "EXTERNAL", actor.id, input.signedOn);
  if (!result.passed) {
    const alternatives = (await authorizedSignatories(db, c)).map((s) => ({ userId: s.userId, name: s.name, title: s.title }));
    throw new AuthorityBlockedError(result.reasons, alternatives);
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(contract).where(eq(contract.id, c.id)).for("update");
    if (locked.signatureStatus !== "READY") throw new StateError("A signature request is in progress; void it before recording an external execution.");
    const doc = await uploadDocument(actor, { contractId: c.id, kind: "EXECUTED", title: "Executed agreement (signed outside the CLM)", file: input.file, note: input.note, system: true }, tx);
    if (doc.scan.status !== "CLEAN") throw new StateError("The executed copy failed the malware scan.");
    const [updated] = await tx
      .update(contract)
      .set({ status: "ACTIVE", signatureStatus: "EXECUTED_EXTERNALLY", executionIsDemo: false, executedAt: new Date(`${input.signedOn}T12:00:00Z`) })
      .where(eq(contract.id, c.id))
      .returning();
    await tx.update(contractRequest).set({ status: "COMPLETED" }).where(and(eq(contractRequest.contractId, c.id), eq(contractRequest.status, "APPROVED")));
    await ensureRenewalCycle(tx, updated);
    const [signer] = await tx.select().from(user).where(eq(user.id, input.signerUserId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "CONTRACT_EXECUTED_EXTERNALLY",
      entityType: "contract",
      entityId: c.id,
      contractId: c.id,
      data: { signatory: signer.name, signedOn: input.signedOn, vendorSigner: input.vendorSignerName ?? null, authority: result.authority!.authorizingReference, executedSha256: doc.version.sha256 },
    });
    return { executed: true };
  });
}

// ───────────── Authority registry administration ─────────────

export type AuthorityInput = {
  userId: string;
  legalEntityId: string;
  source: "DIRECT" | "DELEGATED";
  delegatedFromUserId?: string | null;
  maxAmount?: number | null;
  contractTypeKeys?: string[];
  effectiveFrom: string;
  effectiveTo?: string | null;
  authorizingReference: string;
  authorizingNote?: string | null;
};

export async function createAuthority(actor: Actor, input: AuthorityInput) {
  const idx = await getOrgIndex();
  if (!canManageSigningAuthority(actor, input.legalEntityId, idx)) throw new ForbiddenError("You cannot record signing authority for this entity.");
  if (input.userId === actor.id) throw new ForbiddenError("Segregation of duties: you cannot record signing authority for yourself.");
  if (!idx.get(input.legalEntityId)?.isLegalEntity) throw new ValidationError("Signing authority must be recorded against a legal entity.");
  if (!input.authorizingReference?.trim()) throw new ValidationError("Cite the authorizing document (resolution, ordinance, delegation memo).");
  if (!isValidISODate(input.effectiveFrom)) throw new ValidationError("Effective-from date is required.");
  if (input.effectiveTo && (!isValidISODate(input.effectiveTo) || input.effectiveTo < input.effectiveFrom)) throw new ValidationError("Effective-to must be on or after effective-from.");
  if (input.source === "DELEGATED" && !input.delegatedFromUserId) throw new ValidationError("A delegation must name the delegating official.");
  if (input.source === "DELEGATED" && input.delegatedFromUserId === input.userId) throw new ValidationError("A user cannot delegate to themselves.");
  if (input.maxAmount != null && input.maxAmount < 0) throw new ValidationError("Limit cannot be negative.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(signingAuthority)
      .values({
        userId: input.userId,
        legalEntityId: input.legalEntityId,
        source: input.source,
        delegatedFromUserId: input.source === "DELEGATED" ? input.delegatedFromUserId : null,
        maxAmount: input.maxAmount == null ? null : String(input.maxAmount),
        contractTypeKeys: input.contractTypeKeys ?? [],
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        authorizingReference: input.authorizingReference.trim(),
        authorizingNote: input.authorizingNote ?? null,
        createdById: actor.id,
      })
      .returning();
    await writeAudit(tx, { actorId: actor.id, action: "SIGNING_AUTHORITY_RECORDED", entityType: "signing_authority", entityId: row.id, data: { ...input } });
    return row;
  });
}

export async function revokeAuthority(actor: Actor, authorityId: string, reason: string) {
  if (!reason?.trim()) throw new ValidationError("A reason is required.");
  const [a] = await db.select().from(signingAuthority).where(eq(signingAuthority.id, authorityId));
  if (!a) throw new NotFoundError("Signing authority");
  const idx = await getOrgIndex();
  if (!canManageSigningAuthority(actor, a.legalEntityId, idx)) throw new ForbiddenError();
  if (a.revokedAt) throw new StateError("Already revoked.");
  await db.transaction(async (tx) => {
    await tx.update(signingAuthority).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(signingAuthority.id, a.id));
    await writeAudit(tx, { actorId: actor.id, action: "SIGNING_AUTHORITY_REVOKED", entityType: "signing_authority", entityId: a.id, data: { reason } });
  });
}

export function authorityStatus(a: Authority, today = todayIn()): "ACTIVE" | "EXPIRED" | "FUTURE" | "REVOKED" {
  if (a.revokedAt) return "REVOKED";
  if (a.effectiveFrom > today) return "FUTURE";
  if (a.effectiveTo && a.effectiveTo < today) return "EXPIRED";
  return "ACTIVE";
}

