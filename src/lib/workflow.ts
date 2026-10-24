/**
 * Workflow & approval engine.
 *
 * - A WorkflowDefinition (versioned, admin-configurable) holds ordered stages of steps. Steps in the
 *   same stage run in parallel; stages run in sequence.
 * - On submission the engine snapshots the request's attributes (the "context"), evaluates each
 *   step's condition against it, resolves the organization whose role-holders must act, and creates
 *   tasks. Non-applicable steps are recorded as SKIPPED with the reason.
 * - Every decision is appended to approval_decision, pinned to the agreement version and the
 *   definition version/context it was made against.
 * - A material change re-opens steps flagged reapproveOnMaterialChange.
 */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db, type Conn, type Tx } from "@/db";
import {
  contract,
  contractAgency,
  contractRequest,
  contractType,
  vendor,
  workflowDefinition,
  workflowInstance,
  workflowStepDefinition,
  workflowTask,
  approvalDecision,
  legalIssue,
} from "@/db/schema";
import { currentAgreementVersion } from "./agreement";
import { writeAudit, sha256, stableStringify } from "./audit";
import { getOrgIndex, hasRole, isContractAdminFor, loadActor, type Actor, type OrgIndex } from "./authz";
import { monthsBetween, todayIn } from "./dates";
import { ForbiddenError, NotFoundError, StateError, ValidationError } from "./errors";
import { toNumber } from "./money";
import { notify } from "./notifications";
import { contractAdmins, delegatorsFor, usersWithRole } from "./people";
import { applies, describe, type Rule } from "./rules";
import { getSetting } from "./settings";

export type Task = typeof workflowTask.$inferSelect;
export type Instance = typeof workflowInstance.$inferSelect;
type ContractRow = typeof contract.$inferSelect;

const OPEN_TASK: Task["status"][] = ["WAITING", "PENDING"];

// ───────────── Definition selection & context ─────────────

export async function selectDefinition(conn: Conn, requestType: string) {
  const defs = await conn
    .select()
    .from(workflowDefinition)
    .where(eq(workflowDefinition.active, true))
    .orderBy(desc(workflowDefinition.version));
  const def = defs.find((d) => (d.requestTypes as string[]).includes(requestType));
  if (!def) throw new StateError(`No active workflow is configured for request type ${requestType}. Ask a CLM administrator.`);
  const steps = await conn
    .select()
    .from(workflowStepDefinition)
    .where(eq(workflowStepDefinition.definitionId, def.id))
    .orderBy(asc(workflowStepDefinition.stage));
  return { def, steps };
}

export async function buildContext(conn: Conn, c: ContractRow, requestType: string, variables: Record<string, unknown>) {
  const idx = await getOrgIndex(conn);
  const [type] = await conn.select().from(contractType).where(eq(contractType.id, c.typeId));
  const [v] = c.vendorId ? await conn.select().from(vendor).where(eq(vendor.id, c.vendorId)) : [];
  const agencies = await conn.select().from(contractAgency).where(eq(contractAgency.contractId, c.id));
  const benefiting = agencies.filter((a) => a.role === "BENEFITING").map((a) => a.orgId);
  const adminEntity = idx.legalEntityOf(c.administeringOrgId)?.id;
  const deptEntity = idx.legalEntityOf(c.requestingDeptId)?.id;
  const benefitingEntities = new Set(benefiting.map((o) => idx.legalEntityOf(o)?.id));
  return {
    request: { type: requestType },
    contract: {
      number: c.number,
      typeKey: type?.key ?? null,
      isSubscription: type?.isSubscription ?? false,
      totalValue: toNumber(c.totalValue),
      annualValue: toNumber(c.annualValue ?? c.totalValue),
      termMonths: c.effectiveDate && c.expirationDate ? monthsBetween(c.effectiveDate, c.expirationDate) : null,
      riskLevel: c.riskLevel,
      dataSensitivity: c.dataSensitivity,
      fundingSource: c.fundingSource,
      legalRequired: c.legalRequired,
      autoRenew: c.autoRenew,
    },
    parties: {
      contractingEntity: idx.get(c.contractingEntityId)?.code ?? null,
      administeringOrg: idx.get(c.administeringOrgId)?.code ?? null,
      requestingDept: idx.get(c.requestingDeptId)?.code ?? null,
      administeredOnBehalf: adminEntity !== c.contractingEntityId,
      crossAgency: adminEntity !== deptEntity || [...benefitingEntities].some((e) => e && e !== c.contractingEntityId),
      benefitingAgencyCount: benefiting.length,
    },
    vendor: {
      securityReviewStatus: v?.securityReviewStatus ?? "NOT_REVIEWED",
      securityApproved: v ? ["APPROVED", "APPROVED_WITH_CONDITIONS"].includes(v.securityReviewStatus) : false,
    },
    policy: variables,
  };
}

function scopeOrgsFor(
  scope: string,
  c: ContractRow,
  benefiting: string[],
  idx: OrgIndex,
): { orgIds: string[]; missing?: string } {
  switch (scope) {
    case "REQUESTING_DEPT":
      return { orgIds: [c.requestingDeptId] };
    case "CONTRACTING_ENTITY":
      return { orgIds: [c.contractingEntityId] };
    case "ADMINISTERING_ORG":
      return { orgIds: [c.administeringOrgId] };
    case "LEGAL_AUTHORITY": {
      const o = c.legalReviewOrgId ?? idx.get(c.contractingEntityId)?.legalAuthorityId;
      return o ? { orgIds: [o] } : { orgIds: [], missing: "No legal reviewing authority is configured for the contracting entity" };
    }
    case "BENEFITING_AGENCY":
      return benefiting.length ? { orgIds: benefiting } : { orgIds: [], missing: "No benefiting agency recorded" };
  }
  return { orgIds: [], missing: `Unknown scope ${scope}` };
}

// ───────────── Start ─────────────

export async function startWorkflow(tx: Tx, actor: Actor, requestId: string) {
  const [req] = await tx.select().from(contractRequest).where(eq(contractRequest.id, requestId)).for("update");
  if (!req) throw new NotFoundError("Request");
  if (!["DRAFT", "RETURNED"].includes(req.status)) throw new StateError(`Request is ${req.status}; it cannot be submitted.`);
  const [c] = await tx.select().from(contract).where(eq(contract.id, req.contractId)).for("update");
  const running = await tx
    .select({ id: workflowInstance.id })
    .from(workflowInstance)
    .where(and(eq(workflowInstance.contractId, c.id), eq(workflowInstance.status, "RUNNING")));
  if (running.length) throw new StateError("A workflow is already running for this contract.");

  const idx = await getOrgIndex(tx);
  const { def, steps } = await selectDefinition(tx, req.type);
  const context = await buildContext(tx, c, req.type, def.variables);
  const benefiting = (await tx.select().from(contractAgency).where(eq(contractAgency.contractId, c.id)))
    .filter((a) => a.role === "BENEFITING")
    .map((a) => a.orgId);

  const [inst] = await tx
    .insert(workflowInstance)
    .values({ requestId: req.id, contractId: c.id, definitionId: def.id, context, currentStage: 0 })
    .returning();

  let applicable = 0;
  for (const s of steps) {
    let ok: boolean;
    try {
      ok = applies(s.condition as Rule, context);
    } catch (e) {
      throw new StateError(`Routing rule for step "${s.name}" is invalid: ${(e as Error).message}`);
    }
    const base = {
      instanceId: inst.id,
      stepKey: s.key,
      name: s.name,
      stage: s.stage,
      kind: s.kind,
      roleKey: s.roleKey,
      conditionSnapshot: s.condition ?? null,
      reapproveOnMaterialChange: s.reapproveOnMaterialChange,
    };
    if (!ok) {
      await tx.insert(workflowTask).values({ ...base, status: "SKIPPED", skipReason: `Rule not met: ${describe(s.condition as Rule)}` });
      continue;
    }
    const { orgIds, missing } = scopeOrgsFor(s.scope, c, benefiting, idx);
    if (!orgIds.length) {
      // A required step that cannot be routed is a configuration problem: block rather than silently skip.
      throw new StateError(`Step "${s.name}" applies but cannot be routed: ${missing}.`);
    }
    for (const orgId of orgIds) {
      await tx.insert(workflowTask).values({
        ...base,
        name: orgIds.length > 1 ? `${s.name} — ${idx.name(orgId)}` : s.name,
        scopeOrgId: orgId,
        status: "WAITING",
      });
      applicable++;
    }
  }
  if (!applicable) throw new StateError("No approval steps apply to this request; check the workflow configuration.");

  await tx.update(contractRequest).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(contractRequest.id, req.id));
  await tx
    .update(contract)
    .set({
      status: "IN_REVIEW",
      approvalStatus: "PENDING",
      legalStatus: c.legalRequired ? "PENDING_REVIEW" : "NOT_REQUIRED",
      signatureStatus: "NOT_READY",
    })
    .where(eq(contract.id, c.id));
  await writeAudit(tx, {
    actorId: actor.id,
    action: "WORKFLOW_STARTED",
    entityType: "workflow_instance",
    entityId: inst.id,
    contractId: c.id,
    data: { request: req.number, definition: `${def.key} v${def.version}`, context },
  });
  await activateNextStage(tx, inst.id, actor.id);
  return inst.id;
}

// ───────────── Stage progression ─────────────

async function activateNextStage(tx: Tx, instanceId: string, actorId: string | null) {
  const [inst] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  const tasks = await tx.select().from(workflowTask).where(eq(workflowTask.instanceId, instanceId));
  const waiting = tasks.filter((t) => t.status === "WAITING");
  if (!waiting.length) return completeWorkflow(tx, inst, actorId);

  const stage = Math.min(...waiting.map((t) => t.stage));
  const toActivate = waiting.filter((t) => t.stage === stage);
  const now = new Date();
  const [c] = await tx.select().from(contract).where(eq(contract.id, inst.contractId));
  const stepDefs = await tx.select().from(workflowStepDefinition).where(eq(workflowStepDefinition.definitionId, inst.definitionId));

  for (const t of toActivate) {
    const dueDays = stepDefs.find((s) => s.key === t.stepKey)?.dueDays ?? 5;
    await tx
      .update(workflowTask)
      .set({ status: "PENDING", activatedAt: now, dueAt: new Date(now.getTime() + dueDays * 86_400_000) })
      .where(eq(workflowTask.id, t.id));
    const recipients = t.assigneeUserId
      ? [{ id: t.assigneeUserId }]
      : await usersWithRole(tx, t.roleKey, t.scopeOrgId);
    if (!recipients.length) {
      const admins = await contractAdmins(tx, c.administeringOrgId);
      await notify(tx, {
        userIds: admins.map((a) => a.id),
        kind: "ROUTING_GAP",
        title: `No one can act on "${t.name}" for ${c.number}`,
        body: `No active user holds ${t.roleKey} for this organization. Reassign the task or update role assignments.`,
        link: `/contracts/${c.id}?tab=workflow`,
        dedupeKey: `routing-gap:${t.id}`,
      });
    }
    await notify(tx, {
      userIds: recipients.map((r) => r.id),
      kind: t.kind === "LEGAL_REVIEW" ? "LEGAL_ASSIGNMENT" : "APPROVAL_ASSIGNMENT",
      title: `${t.kind === "LEGAL_REVIEW" ? "Legal review" : "Approval"} needed: ${c.number} ${c.title}`,
      body: `Step: ${t.name}. Due in ${dueDays} days.`,
      link: t.kind === "LEGAL_REVIEW" ? `/contracts/${c.id}?tab=legal` : `/tasks`,
      dedupeKey: `task-activated:${t.id}`,
    });
  }

  const hasLegal = toActivate.some((t) => t.kind === "LEGAL_REVIEW");
  await tx.update(workflowInstance).set({ currentStage: stage }).where(eq(workflowInstance.id, instanceId));
  await tx
    .update(contract)
    .set({ status: hasLegal ? "IN_LEGAL" : "IN_REVIEW" })
    .where(eq(contract.id, inst.contractId));
}

async function completeWorkflow(tx: Tx, inst: Instance, actorId: string | null) {
  await tx
    .update(workflowInstance)
    .set({ status: "COMPLETED", completedAt: new Date() })
    .where(eq(workflowInstance.id, inst.id));
  await tx.update(contractRequest).set({ status: "APPROVED" }).where(eq(contractRequest.id, inst.requestId));
  const [c] = await tx
    .update(contract)
    .set({ status: "PENDING_SIGNATURE", approvalStatus: "APPROVED", signatureStatus: "READY" })
    .where(eq(contract.id, inst.contractId))
    .returning();
  await writeAudit(tx, {
    actorId,
    action: "WORKFLOW_COMPLETED",
    entityType: "workflow_instance",
    entityId: inst.id,
    contractId: c.id,
    data: { result: "All required approvals obtained; ready for signature package" },
  });
  const admins = await contractAdmins(tx, c.administeringOrgId);
  await notify(tx, {
    userIds: [c.ownerId, ...admins.map((a) => a.id)],
    kind: "READY_FOR_SIGNATURE",
    title: `Approved and ready for signature: ${c.number}`,
    body: `${c.title} completed all required approvals. Prepare the signature package with an authorized signatory.`,
    link: `/contracts/${c.id}?tab=signature`,
    dedupeKey: `ready-signature:${inst.id}`,
  });
}

// ───────────── Who may act ─────────────

export type ActEligibility = { allowed: boolean; onBehalfOfUserId?: string; reason?: string };

export async function eligibility(conn: Conn, actor: Actor, task: Task, requesterId: string, idx?: OrgIndex): Promise<ActEligibility> {
  idx ??= await getOrgIndex(conn);
  if (task.status !== "PENDING") return { allowed: false, reason: `Task is ${task.status.toLowerCase()}` };
  const sodRequester = await getSetting("sod.requesterCannotApprove", conn);

  const directlyEligible = (who: Actor) =>
    task.assigneeUserId ? task.assigneeUserId === who.id : hasRole(who, task.roleKey, idx!, task.scopeOrgId);

  let result: ActEligibility = { allowed: false, reason: "You do not hold the required role for this step" };
  if (directlyEligible(actor)) result = { allowed: true };
  else {
    for (const d of await delegatorsFor(conn, actor.id, task.roleKey)) {
      const delegator = await loadActor(d.fromUserId, conn).catch(() => null);
      if (delegator && directlyEligible(delegator)) {
        result = { allowed: true, onBehalfOfUserId: delegator.id };
        break;
      }
    }
  }
  if (result.allowed && sodRequester && (actor.id === requesterId || result.onBehalfOfUserId === requesterId)) {
    return { allowed: false, reason: "Segregation of duties: the requester cannot approve their own request" };
  }
  return result;
}

async function loadTaskForUpdate(tx: Tx, taskId: string) {
  const [task] = await tx.select().from(workflowTask).where(eq(workflowTask.id, taskId)).for("update");
  if (!task) throw new NotFoundError("Task");
  const [inst] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, task.instanceId)).for("update");
  const [req] = await tx.select().from(contractRequest).where(eq(contractRequest.id, inst.requestId));
  const [c] = await tx.select().from(contract).where(eq(contract.id, inst.contractId)).for("update");
  const [def] = await tx.select().from(workflowDefinition).where(eq(workflowDefinition.id, inst.definitionId));
  return { task, inst, req, c, def };
}

async function recordDecision(
  tx: Tx,
  actor: Actor,
  ctx: Awaited<ReturnType<typeof loadTaskForUpdate>>,
  decision: (typeof approvalDecision.$inferInsert)["decision"],
  comment: string | undefined,
  onBehalfOfUserId?: string,
) {
  const agreement = await currentAgreementVersion(tx, ctx.c.id);
  await tx.insert(approvalDecision).values({
    taskId: ctx.task.id,
    userId: actor.id,
    onBehalfOfUserId: onBehalfOfUserId ?? null,
    decision,
    comment: comment ?? null,
    documentVersionId: agreement?.versionId ?? null,
    documentSha256: agreement?.sha256 ?? null,
    definitionId: ctx.def.id,
    definitionVersion: ctx.def.version,
    contextHash: sha256(stableStringify(ctx.inst.context)),
  });
  return agreement;
}

// ───────────── Approval decisions ─────────────

export type Decision = "APPROVE" | "REJECT" | "RETURN";

export async function decideTask(actor: Actor, taskId: string, decision: Decision, comment?: string) {
  if ((decision === "REJECT" || decision === "RETURN") && !comment?.trim()) {
    throw new ValidationError("A comment is required when rejecting or returning a request.");
  }
  return db.transaction(async (tx) => {
    const ctx = await loadTaskForUpdate(tx, taskId);
    if (ctx.inst.status !== "RUNNING") throw new StateError("This workflow is no longer running.");
    if (ctx.task.kind !== "APPROVAL") throw new StateError("Legal review steps are completed from the Legal Review workspace.");
    const el = await eligibility(tx, actor, ctx.task, ctx.req.requesterId);
    if (!el.allowed) throw new ForbiddenError(el.reason);

    const agreement = await recordDecision(tx, actor, ctx, decision, comment, el.onBehalfOfUserId);
    const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
    await tx
      .update(workflowTask)
      .set({ status, decidedById: actor.id, decidedAt: new Date(), comment: comment ?? null })
      .where(eq(workflowTask.id, ctx.task.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: `TASK_${status}`,
      entityType: "workflow_task",
      entityId: ctx.task.id,
      contractId: ctx.c.id,
      data: {
        step: ctx.task.name,
        comment: comment ?? null,
        onBehalfOf: el.onBehalfOfUserId ?? null,
        agreementVersion: agreement ? `${agreement.fileName} v${agreement.versionNo}` : null,
        agreementSha256: agreement?.sha256 ?? null,
      },
    });

    if (decision === "APPROVE") await advanceIfStageDone(tx, ctx.inst.id, ctx.task.stage, actor.id);
    else await closeWorkflow(tx, actor, ctx, decision === "REJECT" ? "REJECTED" : "RETURNED", comment!);
    return { status };
  });
}

async function advanceIfStageDone(tx: Tx, instanceId: string, stage: number, actorId: string) {
  const open = await tx
    .select({ id: workflowTask.id })
    .from(workflowTask)
    .where(and(eq(workflowTask.instanceId, instanceId), eq(workflowTask.stage, stage), eq(workflowTask.status, "PENDING")));
  if (!open.length) await activateNextStage(tx, instanceId, actorId);
}

async function closeWorkflow(
  tx: Tx,
  actor: Actor,
  ctx: Awaited<ReturnType<typeof loadTaskForUpdate>>,
  outcome: "REJECTED" | "RETURNED",
  comment: string,
) {
  await tx
    .update(workflowTask)
    .set({ status: "CANCELLED", skipReason: `Workflow ${outcome.toLowerCase()} at "${ctx.task.name}"` })
    .where(and(eq(workflowTask.instanceId, ctx.inst.id), inArray(workflowTask.status, OPEN_TASK)));
  await tx.update(workflowInstance).set({ status: outcome, completedAt: new Date() }).where(eq(workflowInstance.id, ctx.inst.id));
  await tx.update(contractRequest).set({ status: outcome }).where(eq(contractRequest.id, ctx.req.id));
  await tx
    .update(contract)
    .set(
      outcome === "REJECTED"
        ? { status: "CANCELLED", approvalStatus: "REJECTED", signatureStatus: "NOT_READY" }
        : { status: "DRAFT", approvalStatus: "RETURNED", signatureStatus: "NOT_READY" },
    )
    .where(eq(contract.id, ctx.c.id));
  await writeAudit(tx, {
    actorId: actor.id,
    action: `WORKFLOW_${outcome}`,
    entityType: "workflow_instance",
    entityId: ctx.inst.id,
    contractId: ctx.c.id,
    data: { at: ctx.task.name, comment },
  });
  await notify(tx, {
    userIds: [ctx.req.requesterId, ctx.c.ownerId],
    kind: outcome === "RETURNED" ? "RETURNED_FOR_CHANGES" : "REQUEST_REJECTED",
    title: `${ctx.req.number} was ${outcome === "RETURNED" ? "returned for changes" : "rejected"}`,
    body: `${ctx.task.name} (${actor.name}): ${comment}`,
    link: `/requests/${ctx.req.id}`,
    dedupeKey: `wf-${outcome}:${ctx.inst.id}`,
  });
}

// ───────────── Legal review ─────────────

export type LegalAction = "START" | "NEGOTIATE" | "REQUEST_CHANGES" | "CLEAR";

export async function legalAction(actor: Actor, taskId: string, action: LegalAction, comment?: string) {
  return db.transaction(async (tx) => {
    const ctx = await loadTaskForUpdate(tx, taskId);
    if (ctx.inst.status !== "RUNNING") throw new StateError("This workflow is no longer running.");
    if (ctx.task.kind !== "LEGAL_REVIEW") throw new StateError("Not a legal review step.");
    const el = await eligibility(tx, actor, ctx.task, ctx.req.requesterId);
    if (!el.allowed) throw new ForbiddenError(el.reason);

    const audit = (act: string, data: Record<string, unknown> = {}) =>
      writeAudit(tx, { actorId: actor.id, action: act, entityType: "workflow_task", entityId: ctx.task.id, contractId: ctx.c.id, data: { comment: comment ?? null, ...data } });

    switch (action) {
      case "START":
        await tx.update(contract).set({ legalStatus: "IN_REVIEW" }).where(eq(contract.id, ctx.c.id));
        await audit("LEGAL_REVIEW_STARTED");
        return { legalStatus: "IN_REVIEW" };
      case "NEGOTIATE":
        await tx.update(contract).set({ legalStatus: "UNDER_NEGOTIATION" }).where(eq(contract.id, ctx.c.id));
        await audit("LEGAL_UNDER_NEGOTIATION");
        return { legalStatus: "UNDER_NEGOTIATION" };
      case "REQUEST_CHANGES": {
        if (!comment?.trim()) throw new ValidationError("Describe the changes Legal is requesting.");
        await recordDecision(tx, actor, ctx, "LEGAL_CHANGES_REQUESTED", comment, el.onBehalfOfUserId);
        await tx
          .update(workflowTask)
          .set({ status: "RETURNED", decidedById: actor.id, decidedAt: new Date(), comment })
          .where(eq(workflowTask.id, ctx.task.id));
        await closeWorkflow(tx, actor, ctx, "RETURNED", comment);
        await tx.update(contract).set({ legalStatus: "CHANGES_REQUESTED" }).where(eq(contract.id, ctx.c.id));
        await audit("LEGAL_CHANGES_REQUESTED");
        return { legalStatus: "CHANGES_REQUESTED" };
      }
      case "CLEAR": {
        const agreement = await currentAgreementVersion(tx, ctx.c.id);
        if (!agreement) throw new StateError("Upload the agreement before Legal can clear it.");
        if (agreement.scanStatus !== "CLEAN") throw new StateError("The current agreement version has not passed the malware scan.");
        const openIssues = await tx
          .select({ id: legalIssue.id, title: legalIssue.title })
          .from(legalIssue)
          .where(and(eq(legalIssue.contractId, ctx.c.id), eq(legalIssue.status, "OPEN")));
        if (openIssues.length) {
          throw new StateError(`Resolve or accept the ${openIssues.length} open legal issue(s) before clearing.`, openIssues);
        }
        await recordDecision(tx, actor, ctx, "LEGAL_CLEAR", comment, el.onBehalfOfUserId);
        await tx
          .update(workflowTask)
          .set({ status: "APPROVED", decidedById: actor.id, decidedAt: new Date(), comment: comment ?? null })
          .where(eq(workflowTask.id, ctx.task.id));
        await tx.update(contract).set({ legalStatus: "CLEARED" }).where(eq(contract.id, ctx.c.id));
        await audit("LEGAL_CLEARED", { agreementVersion: `${agreement.fileName} v${agreement.versionNo}`, sha256: agreement.sha256 });
        await advanceIfStageDone(tx, ctx.inst.id, ctx.task.stage, actor.id);
        return { legalStatus: "CLEARED" };
      }
    }
  });
}

// ───────────── Reassignment & ad hoc approvers ─────────────

export async function reassignTask(actor: Actor, taskId: string, toUserId: string, reason: string) {
  if (!reason?.trim()) throw new ValidationError("A reason is required to reassign a task.");
  return db.transaction(async (tx) => {
    const ctx = await loadTaskForUpdate(tx, taskId);
    if (ctx.task.status !== "PENDING") throw new StateError("Only pending tasks can be reassigned.");
    const idx = await getOrgIndex(tx);
    const el = await eligibility(tx, actor, ctx.task, ctx.req.requesterId, idx);
    if (!el.allowed && !isContractAdminFor(actor, ctx.c, idx)) throw new ForbiddenError("Only an eligible approver or contract administrator can reassign.");
    const target = await loadActor(toUserId, tx);
    if (!ctx.task.isAdHoc && !hasRole(target, ctx.task.roleKey, idx, ctx.task.scopeOrgId)) {
      throw new ValidationError(`${target.name} does not hold ${ctx.task.roleKey} for ${idx.name(ctx.task.scopeOrgId)}.`);
    }
    if (target.id === ctx.req.requesterId) throw new ValidationError("A task cannot be assigned to the requester.");
    await tx.update(workflowTask).set({ assigneeUserId: target.id }).where(eq(workflowTask.id, ctx.task.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "TASK_REASSIGNED",
      entityType: "workflow_task",
      entityId: ctx.task.id,
      contractId: ctx.c.id,
      data: { to: target.name, reason },
    });
    await notify(tx, {
      userIds: [target.id],
      kind: "APPROVAL_ASSIGNMENT",
      title: `Task reassigned to you: ${ctx.c.number}`,
      body: `${ctx.task.name}. Reason: ${reason}`,
      link: ctx.task.kind === "LEGAL_REVIEW" ? `/contracts/${ctx.c.id}?tab=legal` : "/tasks",
      dedupeKey: `reassigned:${ctx.task.id}:${target.id}:${Date.now()}`,
    });
  });
}

export async function addAdHocApprover(actor: Actor, instanceId: string, userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [inst] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId)).for("update");
    if (!inst || inst.status !== "RUNNING") throw new StateError("Ad hoc approvers can only be added to a running workflow.");
    const [c] = await tx.select().from(contract).where(eq(contract.id, inst.contractId));
    const [req] = await tx.select().from(contractRequest).where(eq(contractRequest.id, inst.requestId));
    const idx = await getOrgIndex(tx);
    if (!isContractAdminFor(actor, c, idx) && c.ownerId !== actor.id) throw new ForbiddenError("Only the contract owner or administrator can add approvers.");
    if (userId === req.requesterId) throw new ValidationError("The requester cannot be added as an approver.");
    const target = await loadActor(userId, tx);
    const [t] = await tx
      .insert(workflowTask)
      .values({
        instanceId,
        stepKey: `adhoc-${Date.now()}`,
        name: name?.trim() || `Ad hoc approval — ${target.name}`,
        stage: inst.currentStage,
        kind: "APPROVAL",
        roleKey: "AD_HOC",
        assigneeUserId: target.id,
        isAdHoc: true,
        status: "PENDING",
        activatedAt: new Date(),
        dueAt: new Date(Date.now() + 5 * 86_400_000),
      })
      .returning();
    await writeAudit(tx, { actorId: actor.id, action: "ADHOC_APPROVER_ADDED", entityType: "workflow_task", entityId: t.id, contractId: c.id, data: { approver: target.name } });
    await notify(tx, {
      userIds: [target.id],
      kind: "APPROVAL_ASSIGNMENT",
      title: `Approval requested: ${c.number} ${c.title}`,
      body: t.name,
      link: "/tasks",
      dedupeKey: `adhoc:${t.id}`,
    });
    return t.id;
  });
}

// ───────────── Material change → re-approval ─────────────

/**
 * Re-opens steps flagged for re-approval when the agreement or key terms change materially after they
 * were approved. Allowed until a signature package is sent.
 */
export async function applyMaterialChange(tx: Tx, actor: Actor, contractId: string, reason: string) {
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId)).for("update");
  if (["SENT", "PARTIALLY_SIGNED", "EXECUTED", "EXECUTED_EXTERNALLY", "DEMO_EXECUTED"].includes(c.signatureStatus)) {
    throw new StateError("The agreement is already out for signature or executed. Void the signature request or start an amendment.");
  }
  const [inst] = await tx
    .select()
    .from(workflowInstance)
    .where(and(eq(workflowInstance.contractId, contractId), inArray(workflowInstance.status, ["RUNNING", "COMPLETED"])))
    .orderBy(desc(workflowInstance.startedAt))
    .limit(1);
  if (!inst) return { reopened: 0 };
  const tasks = await tx.select().from(workflowTask).where(eq(workflowTask.instanceId, inst.id));
  const toRedo = tasks.filter((t) => t.reapproveOnMaterialChange && t.status === "APPROVED");
  if (!toRedo.length) return { reopened: 0 };
  const fromStage = Math.min(...toRedo.map((t) => t.stage));

  for (const t of toRedo) {
    await tx.update(workflowTask).set({ status: "SUPERSEDED", skipReason: `Material change: ${reason}` }).where(eq(workflowTask.id, t.id));
    await tx.insert(workflowTask).values({
      instanceId: inst.id,
      stepKey: t.stepKey,
      name: t.name,
      stage: t.stage,
      kind: t.kind,
      roleKey: t.roleKey,
      scopeOrgId: t.scopeOrgId,
      assigneeUserId: t.assigneeUserId,
      isAdHoc: t.isAdHoc,
      conditionSnapshot: t.conditionSnapshot,
      reapproveOnMaterialChange: true,
      status: "WAITING",
    });
  }
  // Anything already active in a later stage waits for the re-approval to come back around.
  await tx
    .update(workflowTask)
    .set({ status: "WAITING", activatedAt: null, dueAt: null })
    .where(and(eq(workflowTask.instanceId, inst.id), eq(workflowTask.status, "PENDING"), ne(workflowTask.stage, fromStage)));

  const reopensLegal = toRedo.some((t) => t.kind === "LEGAL_REVIEW");
  await tx.update(workflowInstance).set({ status: "RUNNING", completedAt: null }).where(eq(workflowInstance.id, inst.id));
  await tx.update(contractRequest).set({ status: "SUBMITTED" }).where(eq(contractRequest.id, inst.requestId));
  await tx
    .update(contract)
    .set({
      status: "IN_REVIEW",
      approvalStatus: "PENDING",
      signatureStatus: "NOT_READY",
      ...(reopensLegal ? { legalStatus: "IN_REVIEW" as const } : {}),
    })
    .where(eq(contract.id, contractId));
  await writeAudit(tx, {
    actorId: actor.id,
    action: "MATERIAL_CHANGE_REAPPROVAL",
    entityType: "workflow_instance",
    entityId: inst.id,
    contractId,
    data: { reason, reopenedSteps: toRedo.map((t) => t.name) },
  });
  // Activate the earliest re-opened stage (unless something earlier is still pending).
  const pendingEarlier = tasks.some((t) => t.status === "PENDING" && t.stage < fromStage);
  if (!pendingEarlier) await activateNextStage(tx, inst.id, actor.id);
  return { reopened: toRedo.length };
}

// ───────────── Queries ─────────────

export async function listEligibleTasks(actor: Actor) {
  const idx = await getOrgIndex();
  const rows = await db
    .select({ task: workflowTask, contract, request: contractRequest })
    .from(workflowTask)
    .innerJoin(workflowInstance, eq(workflowInstance.id, workflowTask.instanceId))
    .innerJoin(contract, eq(contract.id, workflowInstance.contractId))
    .innerJoin(contractRequest, eq(contractRequest.id, workflowInstance.requestId))
    .where(and(eq(workflowTask.status, "PENDING"), eq(workflowInstance.status, "RUNNING")))
    .orderBy(asc(workflowTask.dueAt));
  const out: (typeof rows[number] & { onBehalfOfUserId?: string })[] = [];
  for (const r of rows) {
    const el = await eligibility(db, actor, r.task, r.request.requesterId, idx);
    if (el.allowed) out.push({ ...r, onBehalfOfUserId: el.onBehalfOfUserId });
  }
  return out;
}

export async function workflowHistory(contractId: string) {
  const instances = await db.query.workflowInstance.findMany({
    where: eq(workflowInstance.contractId, contractId),
    orderBy: desc(workflowInstance.startedAt),
    with: {
      definition: true,
      request: true,
      tasks: {
        orderBy: [asc(workflowTask.stage), asc(workflowTask.createdAt)],
        with: { assignee: true, decidedBy: true, scopeOrg: true, decisions: { with: { user: true, onBehalfOf: true } } },
      },
    },
  });
  return instances;
}

/** Reminders for pending tasks and escalation of overdue ones (idempotent per day). */
export async function runTaskReminders(now = new Date()) {
  const remindEvery = await getSetting("tasks.reminderEveryDays");
  const escalateAfter = await getSetting("tasks.escalateAfterDaysOverdue");
  const rows = await db
    .select({ task: workflowTask, c: contract })
    .from(workflowTask)
    .innerJoin(workflowInstance, eq(workflowInstance.id, workflowTask.instanceId))
    .innerJoin(contract, eq(contract.id, workflowInstance.contractId))
    .where(and(eq(workflowTask.status, "PENDING"), eq(workflowInstance.status, "RUNNING")));
  let reminded = 0;
  let escalated = 0;
  const today = todayIn("America/Chicago", now);
  for (const { task, c } of rows) {
    await db.transaction(async (tx) => {
      const recipients = task.assigneeUserId ? [{ id: task.assigneeUserId }] : await usersWithRole(tx, task.roleKey, task.scopeOrgId);
      const due = task.dueAt;
      if (due && now > due) {
        const daysOver = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
        if (daysOver >= escalateAfter && !task.escalatedAt) {
          const admins = await contractAdmins(tx, c.administeringOrgId);
          await notify(tx, {
            userIds: [...admins.map((a) => a.id), c.ownerId],
            kind: "TASK_ESCALATION",
            title: `Overdue ${daysOver} days: ${task.name} (${c.number})`,
            body: "This approval is past due. Reassign it or follow up with the approver.",
            link: `/contracts/${c.id}?tab=workflow`,
            dedupeKey: `escalate:${task.id}`,
          });
          await tx.update(workflowTask).set({ escalatedAt: now }).where(eq(workflowTask.id, task.id));
          escalated++;
        }
      }
      const last = task.lastReminderAt ?? task.activatedAt;
      if (last && now.getTime() - last.getTime() >= remindEvery * 86_400_000) {
        await notify(tx, {
          userIds: recipients.map((r) => r.id),
          kind: "TASK_REMINDER",
          title: `Reminder: ${task.name} for ${c.number}`,
          body: due ? `Due ${due.toISOString().slice(0, 10)}.` : undefined,
          link: task.kind === "LEGAL_REVIEW" ? `/contracts/${c.id}?tab=legal` : "/tasks",
          dedupeKey: `remind:${task.id}:${today}`,
        });
        await tx.update(workflowTask).set({ lastReminderAt: now }).where(eq(workflowTask.id, task.id));
        reminded++;
      }
    });
  }
  return { reminded, escalated };
}

export function dueLabel(due: Date | null) {
  if (!due) return "";
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "due today";
  return `due in ${days}d`;
}
