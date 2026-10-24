/**
 * Contract repository & intake services.
 */
import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  contract,
  contractAgency,
  contractRelationship,
  contractRequest,
  contractType,
  legalIssue,
  organization,
  subscriptionLicense,
  user,
  vendor,
} from "@/db/schema";
import { writeAudit } from "./audit";
import {
  assertCanViewContract,
  canEditContract,
  contractVisibilityFilter,
  getOrgIndex,
  hasAnyRole,
  hasRole,
  isContractAdminFor,
  isReadOnly,
  type Actor,
} from "./authz";
import { addDays, isValidISODate, todayIn } from "./dates";
import { ForbiddenError, NotFoundError, StateError, ValidationError } from "./errors";
import { nextNumber } from "./counter";
import { applyMaterialChange, startWorkflow } from "./workflow";

// ───────────── Intake schema ─────────────

const isoDate = z.string().refine((s) => s === "" || isValidISODate(s), "Use YYYY-MM-DD");
const optionalId = z.string().trim().optional().nullable().transform((v) => (v ? v : null));
const optionalNumber = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v == null ? null : Number(v)))
  .refine((v) => v == null || (Number.isFinite(v) && v >= 0), "Must be a non-negative number");
const optionalInt = optionalNumber.refine((v) => v == null || Number.isInteger(v), "Must be a whole number");

export const REQUEST_TYPES = ["NEW_CONTRACT", "AMENDMENT", "RENEWAL", "EXTENSION", "ADDITIONAL_PURCHASE", "TERMINATION", "TRANSFER", "LEGAL_REVIEW"] as const;

export const intakeSchema = z.object({
  requestType: z.enum(REQUEST_TYPES).default("NEW_CONTRACT"),
  title: z.string().trim().min(3, "Title is required").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  businessPurpose: z.string().trim().max(4000).optional().nullable(),
  justification: z.string().trim().max(4000).optional().nullable(),
  typeKey: z.string().trim().optional().nullable(),
  vendorId: optionalId,
  newVendorName: z.string().trim().max(200).optional().nullable(),
  contractingEntityId: optionalId,
  administeringOrgId: optionalId,
  requestingDeptId: optionalId,
  benefitingAgencyIds: z.array(z.string()).default([]),
  financialAllocations: z.array(z.object({ orgId: z.string(), pct: z.coerce.number().min(0).max(100) })).default([]),
  ownerId: optionalId,
  serviceOwnerId: optionalId,
  totalValue: optionalNumber,
  annualValue: optionalNumber,
  fundingSource: z.string().trim().max(200).optional().nullable(),
  effectiveDate: isoDate.optional().nullable(),
  expirationDate: isoDate.optional().nullable(),
  autoRenew: z.boolean().default(false),
  renewalTermMonths: optionalInt,
  noticeDays: optionalInt,
  priceEscalation: z.string().trim().max(500).optional().nullable(),
  riskLevel: z.enum(["LOW", "MODERATE", "HIGH"]).default("MODERATE"),
  dataSensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]).default("INTERNAL"),
  legalRequired: z.boolean().default(true),
  purchasingNotes: z.string().trim().max(2000).optional().nullable(),
  parentContractId: optionalId,
  confidential: z.boolean().default(false),
  customFieldValues: z.record(z.string(), z.unknown()).default({}),
  subscription: z
    .object({
      product: z.string().trim().max(200),
      plan: z.string().trim().max(200).optional().nullable(),
      licensedQty: z.coerce.number().int().min(0),
      unitCost: z.coerce.number().min(0),
      billingFrequency: z.string().default("ANNUAL"),
      costCenter: z.string().trim().max(100).optional().nullable(),
    })
    .optional()
    .nullable(),
});
export type IntakeInput = z.input<typeof intakeSchema>;
type Intake = z.output<typeof intakeSchema>;

export function parseIntake(raw: unknown): Intake {
  const r = intakeSchema.safeParse(raw);
  if (!r.success) {
    throw new ValidationError(
      "Please correct the highlighted fields.",
      r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

/** Completeness rules applied at submission (drafts may be partial). */
export async function submissionProblems(c: typeof contract.$inferSelect, r: typeof contractRequest.$inferSelect) {
  const p: { field: string; message: string }[] = [];
  const [type] = await db.select().from(contractType).where(eq(contractType.id, c.typeId));
  if (!c.vendorId) p.push({ field: "vendorId", message: "Select a vendor." });
  if (!c.businessPurpose?.trim()) p.push({ field: "businessPurpose", message: "Describe the business purpose." });
  if (!(Number(c.totalValue) >= 0)) p.push({ field: "totalValue", message: "Enter the estimated total value." });
  if (!c.fundingSource?.trim() && Number(c.totalValue) > 0) p.push({ field: "fundingSource", message: "Identify the funding source." });
  if (!c.effectiveDate) p.push({ field: "effectiveDate", message: "Enter the expected start date." });
  if (!c.expirationDate && type?.key !== "NDA") p.push({ field: "expirationDate", message: "Enter the expected end date." });
  if (c.effectiveDate && c.expirationDate && c.expirationDate <= c.effectiveDate) p.push({ field: "expirationDate", message: "End date must be after the start date." });
  if (c.autoRenew && !c.renewalTermMonths) p.push({ field: "renewalTermMonths", message: "Auto-renewing contracts need a renewal term." });
  for (const f of type?.customFields ?? []) {
    const val = (c.customFieldValues as Record<string, unknown>)[f.key];
    if (f.required && (val == null || String(val).trim() === "")) p.push({ field: `custom.${f.key}`, message: `${f.label} is required for ${type!.name}.` });
  }
  if (type?.requiresParent && !c.parentContractId) p.push({ field: "parentContractId", message: `${type.name} must reference a parent agreement.` });
  if (["AMENDMENT", "RENEWAL", "EXTENSION", "ADDITIONAL_PURCHASE", "TERMINATION", "TRANSFER"].includes(r.type) && !c.parentContractId) {
    p.push({ field: "parentContractId", message: "Select the existing contract this request changes." });
  }
  const fin = await db.select().from(contractAgency).where(and(eq(contractAgency.contractId, c.id), eq(contractAgency.role, "FINANCIAL")));
  if (fin.length) {
    const sum = fin.reduce((a, f) => a + Number(f.allocationPct ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) p.push({ field: "financialAllocations", message: `Cost allocations total ${sum}%; they must total 100%.` });
  }
  return p;
}

// ───────────── Create / update drafts ─────────────

async function resolveVendor(tx: Tx, actor: Actor, input: Intake): Promise<string | null> {
  if (input.vendorId) {
    const [v] = await tx.select({ id: vendor.id }).from(vendor).where(eq(vendor.id, input.vendorId));
    if (!v) throw new ValidationError("Selected vendor does not exist.");
    return v.id;
  }
  if (input.newVendorName?.trim()) {
    const [existing] = await tx.select({ id: vendor.id }).from(vendor).where(ilike(vendor.name, input.newVendorName.trim()));
    if (existing) return existing.id;
    const [v] = await tx.insert(vendor).values({ name: input.newVendorName.trim(), notes: "Added from a contract request; verify against the ERP supplier master." }).returning();
    await writeAudit(tx, { actorId: actor.id, action: "VENDOR_CREATED", entityType: "vendor", entityId: v.id, data: { name: v.name, source: "intake" } });
    return v.id;
  }
  return null;
}

async function resolveParties(tx: Tx, actor: Actor, input: Intake) {
  const idx = await getOrgIndex(tx);
  const deptId = input.requestingDeptId ?? actor.primaryOrgId;
  if (!deptId || !idx.get(deptId)) throw new ValidationError("Select the requesting department.");
  const entityId = input.contractingEntityId ?? idx.legalEntityOf(deptId)?.id;
  const entity = idx.get(entityId);
  if (!entity?.isLegalEntity) throw new ValidationError("The contracting entity must be a legal entity (e.g. City of Omaha, Douglas County, DOTComm).");
  const adminId = input.administeringOrgId ?? deptId;
  if (!idx.get(adminId)) throw new ValidationError("Select the administering organization.");
  for (const o of [...input.benefitingAgencyIds, ...input.financialAllocations.map((f) => f.orgId)]) {
    if (!idx.get(o)) throw new ValidationError("Unknown agency selected.");
  }
  return { idx, deptId, entityId: entity.id, adminId, legalReviewOrgId: entity.legalAuthorityId };
}

async function writeAgencies(tx: Tx, contractId: string, input: Intake) {
  await tx.delete(contractAgency).where(eq(contractAgency.contractId, contractId));
  const benefiting = [...new Set(input.benefitingAgencyIds)];
  for (const orgId of benefiting) await tx.insert(contractAgency).values({ contractId, orgId, role: "BENEFITING" });
  for (const f of input.financialAllocations) {
    await tx.insert(contractAgency).values({ contractId, orgId: f.orgId, role: "FINANCIAL", allocationPct: String(f.pct) }).onConflictDoNothing();
  }
}

async function typeIdFor(tx: Tx, key: string | null | undefined) {
  const [t] = await tx.select().from(contractType).where(eq(contractType.key, key || "OTHER"));
  if (!t) throw new ValidationError(`Unknown contract type ${key}.`);
  return t;
}

export async function createRequest(actor: Actor, raw: unknown) {
  const input = parseIntake(raw);
  return db.transaction(async (tx) => {
    const { idx, deptId, entityId, adminId, legalReviewOrgId } = await resolveParties(tx, actor, input);
    if (isReadOnly(actor)) throw new ForbiddenError("Read-only users cannot create requests.");
    if (!hasAnyRole(actor, ["REQUESTER", "CONTRACT_OWNER", "CLM_ADMIN"], idx, deptId) && !hasRole(actor, "SYSTEM_ADMIN", idx)) {
      throw new ForbiddenError("You can only submit requests for departments where you hold the Requester role.");
    }
    const type = await typeIdFor(tx, input.typeKey);
    const vendorId = await resolveVendor(tx, actor, input);
    if (input.parentContractId) {
      const [parent] = await tx.select().from(contract).where(eq(contract.id, input.parentContractId));
      if (!parent) throw new ValidationError("Parent contract not found.");
      await assertCanViewContract(actor, parent, tx);
    }
    const number = await nextNumber(tx, "CTR");
    const [c] = await tx
      .insert(contract)
      .values({
        number,
        title: input.title,
        description: input.description ?? null,
        businessPurpose: input.businessPurpose ?? null,
        typeId: type.id,
        vendorId,
        contractingEntityId: entityId,
        administeringOrgId: adminId,
        requestingDeptId: deptId,
        legalReviewOrgId: legalReviewOrgId ?? null,
        ownerId: input.ownerId ?? actor.id,
        serviceOwnerId: input.serviceOwnerId ?? null,
        purchasingNotes: input.purchasingNotes ?? null,
        totalValue: String(input.totalValue ?? 0),
        annualValue: input.annualValue == null ? null : String(input.annualValue),
        fundingSource: input.fundingSource ?? null,
        riskLevel: input.riskLevel,
        dataSensitivity: input.dataSensitivity,
        legalRequired: input.legalRequired,
        effectiveDate: input.effectiveDate || null,
        expirationDate: input.expirationDate || null,
        autoRenew: input.autoRenew,
        renewalTermMonths: input.renewalTermMonths,
        noticeDays: input.noticeDays,
        priceEscalation: input.priceEscalation ?? null,
        parentContractId: input.parentContractId,
        confidential: input.confidential,
        customFieldValues: input.customFieldValues,
        legalStatus: input.legalRequired ? "PENDING_REVIEW" : "NOT_REQUIRED",
      })
      .returning();
    await writeAgencies(tx, c.id, input);
    if (input.subscription?.product && type.isSubscription) {
      await tx.insert(subscriptionLicense).values({ contractId: c.id, ...input.subscription, unitCost: String(input.subscription.unitCost) });
    }
    if (input.parentContractId) {
      const relType = type.key === "SOW" ? "SOW_UNDER" : input.requestType === "AMENDMENT" ? "AMENDS" : input.requestType === "RENEWAL" ? "RENEWS" : "RELATED";
      await tx.insert(contractRelationship).values({ fromId: c.id, toId: input.parentContractId, type: relType });
    }
    const reqNumber = await nextNumber(tx, "REQ");
    const [r] = await tx
      .insert(contractRequest)
      .values({ number: reqNumber, type: input.requestType, requesterId: actor.id, contractId: c.id, justification: input.justification ?? input.businessPurpose ?? null })
      .returning();
    await writeAudit(tx, {
      actorId: actor.id,
      action: "REQUEST_CREATED",
      entityType: "contract_request",
      entityId: r.id,
      contractId: c.id,
      data: { request: r.number, contract: c.number, type: input.requestType, title: c.title },
    });
    return { requestId: r.id, contractId: c.id, requestNumber: r.number, contractNumber: c.number };
  });
}

const MATERIAL_FIELDS = ["totalValue", "annualValue", "effectiveDate", "expirationDate", "vendorId", "contractingEntityId", "dataSensitivity"] as const;

export async function updateRequest(actor: Actor, requestId: string, raw: unknown) {
  const input = parseIntake(raw);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(contractRequest).where(eq(contractRequest.id, requestId)).for("update");
    if (!r) throw new NotFoundError("Request");
    const [c] = await tx.select().from(contract).where(eq(contract.id, r.contractId)).for("update");
    await assertCanViewContract(actor, c, tx);
    const idx = await getOrgIndex(tx);
    if (!["DRAFT", "RETURNED"].includes(r.status)) throw new StateError("Only draft or returned requests can be edited.");
    if (!canEditContract(actor, c, idx, [r.requesterId])) throw new ForbiddenError("You cannot edit this request.");
    const { deptId, entityId, adminId, legalReviewOrgId } = await resolveParties(tx, actor, input);
    const type = await typeIdFor(tx, input.typeKey);
    const vendorId = await resolveVendor(tx, actor, input);
    const next = {
      title: input.title,
      description: input.description ?? null,
      businessPurpose: input.businessPurpose ?? null,
      typeId: type.id,
      vendorId,
      contractingEntityId: entityId,
      administeringOrgId: adminId,
      requestingDeptId: deptId,
      legalReviewOrgId: legalReviewOrgId ?? null,
      ownerId: input.ownerId ?? c.ownerId,
      serviceOwnerId: input.serviceOwnerId ?? null,
      purchasingNotes: input.purchasingNotes ?? null,
      totalValue: String(input.totalValue ?? 0),
      annualValue: input.annualValue == null ? null : String(input.annualValue),
      fundingSource: input.fundingSource ?? null,
      riskLevel: input.riskLevel,
      dataSensitivity: input.dataSensitivity,
      legalRequired: input.legalRequired,
      effectiveDate: input.effectiveDate || null,
      expirationDate: input.expirationDate || null,
      autoRenew: input.autoRenew,
      renewalTermMonths: input.renewalTermMonths,
      noticeDays: input.noticeDays,
      priceEscalation: input.priceEscalation ?? null,
      parentContractId: input.parentContractId,
      confidential: input.confidential,
      customFieldValues: input.customFieldValues,
    };
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(next)) {
      const before = (c as Record<string, unknown>)[k];
      const norm = (x: unknown) => (x == null ? null : typeof x === "object" ? JSON.stringify(x) : String(x));
      if (norm(before) !== norm(v) && !(k === "totalValue" && Number(before) === Number(v))) changed[k] = { from: before, to: v };
    }
    await tx.update(contract).set(next).where(eq(contract.id, c.id));
    await writeAgencies(tx, c.id, input);
    await tx.delete(subscriptionLicense).where(eq(subscriptionLicense.contractId, c.id));
    if (input.subscription?.product && type.isSubscription) {
      await tx.insert(subscriptionLicense).values({ contractId: c.id, ...input.subscription, unitCost: String(input.subscription.unitCost) });
    }
    await tx.update(contractRequest).set({ type: input.requestType, justification: input.justification ?? input.businessPurpose ?? null }).where(eq(contractRequest.id, r.id));
    if (Object.keys(changed).length) {
      await writeAudit(tx, { actorId: actor.id, action: "REQUEST_UPDATED", entityType: "contract_request", entityId: r.id, contractId: c.id, data: { changed } });
    }
    return { changed: Object.keys(changed) };
  });
}

/**
 * Edits to key terms while a request is in review (CLM administrator only) count as a material change
 * and re-open the steps that require re-approval.
 */
export async function amendTermsInReview(actor: Actor, contractId: string, patch: { totalValue?: number; expirationDate?: string }, reason: string) {
  if (!reason?.trim()) throw new ValidationError("Explain the change.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, contractId)).for("update");
    if (!c) throw new NotFoundError("Contract");
    const idx = await getOrgIndex(tx);
    if (!isContractAdminFor(actor, c, idx)) throw new ForbiddenError();
    if (!["IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE"].includes(c.status)) throw new StateError("Terms can only be amended here while the request is in review.");
    const set: Partial<typeof contract.$inferInsert> = {};
    if (patch.totalValue != null) set.totalValue = String(patch.totalValue);
    if (patch.expirationDate) {
      if (!isValidISODate(patch.expirationDate)) throw new ValidationError("Invalid date.");
      set.expirationDate = patch.expirationDate;
    }
    await tx.update(contract).set(set).where(eq(contract.id, c.id));
    await writeAudit(tx, { actorId: actor.id, action: "TERMS_AMENDED_IN_REVIEW", entityType: "contract", entityId: c.id, contractId: c.id, data: { patch, reason, before: { totalValue: c.totalValue, expirationDate: c.expirationDate } } });
    return applyMaterialChange(tx, actor, c.id, reason);
  });
}

export async function submitRequest(actor: Actor, requestId: string) {
  const [r] = await db.select().from(contractRequest).where(eq(contractRequest.id, requestId));
  if (!r) throw new NotFoundError("Request");
  const [c] = await db.select().from(contract).where(eq(contract.id, r.contractId));
  await assertCanViewContract(actor, c);
  const idx = await getOrgIndex();
  if (r.requesterId !== actor.id && !isContractAdminFor(actor, c, idx)) throw new ForbiddenError("Only the requester or a contract administrator can submit.");
  const problems = await submissionProblems(c, r);
  if (problems.length) throw new ValidationError("The request is incomplete.", problems);
  return db.transaction((tx) => startWorkflow(tx, actor, r.id));
}

export async function withdrawRequest(actor: Actor, requestId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(contractRequest).where(eq(contractRequest.id, requestId)).for("update");
    if (!r) throw new NotFoundError("Request");
    if (r.requesterId !== actor.id) throw new ForbiddenError("Only the requester can withdraw a request.");
    if (!["DRAFT", "RETURNED"].includes(r.status)) throw new StateError("Only drafts or returned requests can be withdrawn.");
    await tx.update(contractRequest).set({ status: "WITHDRAWN" }).where(eq(contractRequest.id, r.id));
    await tx.update(contract).set({ status: "CANCELLED" }).where(eq(contract.id, r.contractId));
    await writeAudit(tx, { actorId: actor.id, action: "REQUEST_WITHDRAWN", entityType: "contract_request", entityId: r.id, contractId: r.contractId, data: { reason } });
  });
}

// ───────────── Queries ─────────────

export type ContractFilters = {
  q?: string;
  status?: string;
  typeKey?: string;
  orgId?: string;
  vendorId?: string;
  expiringDays?: number;
  administeredOnBehalf?: boolean;
  autoRenew?: boolean;
  sort?: "expiration" | "value" | "updated" | "number";
  limit?: number;
  offset?: number;
};

export async function listContracts(actor: Actor, f: ContractFilters = {}) {
  const idx = await getOrgIndex();
  const where: (SQL | undefined)[] = [contractVisibilityFilter(actor, idx)];
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.push(
      or(
        sql`to_tsvector('english', ${contract.number} || ' ' || ${contract.title} || ' ' || coalesce(${contract.description}, '') || ' ' || coalesce(${contract.businessPurpose}, '')) @@ plainto_tsquery('english', ${q})`,
        ilike(contract.number, `%${q}%`),
        ilike(contract.title, `%${q}%`),
        ilike(vendor.name, `%${q}%`),
      ),
    );
  }
  if (f.status) where.push(f.status === "OPEN_REQUESTS" ? inArray(contract.status, ["DRAFT", "IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE"]) : eq(contract.status, f.status as never));
  else where.push(sql`${contract.status} <> 'CANCELLED'`);
  if (f.typeKey) where.push(eq(contractType.key, f.typeKey));
  if (f.vendorId) where.push(eq(contract.vendorId, f.vendorId));
  if (f.orgId) {
    const ids = [f.orgId, ...idx.descendants(f.orgId)];
    where.push(
      or(
        inArray(contract.contractingEntityId, ids),
        inArray(contract.requestingDeptId, ids),
        inArray(contract.administeringOrgId, ids),
        sql`exists (select 1 from contract_agency ca where ca.contract_id = ${contract.id} and ca.org_id in ${ids})`,
      ),
    );
  }
  if (f.expiringDays) {
    const today = todayIn();
    where.push(and(eq(contract.status, "ACTIVE"), isNotNull(contract.expirationDate), lte(contract.expirationDate, addDays(today, f.expiringDays))));
  }
  if (f.autoRenew) where.push(eq(contract.autoRenew, true));

  const order =
    f.sort === "value" ? [desc(contract.totalValue)] : f.sort === "updated" ? [desc(contract.updatedAt)] : f.sort === "number" ? [desc(contract.number)] : [sql`${contract.expirationDate} asc nulls last`, asc(contract.number)];

  const rows = await db
    .select({
      id: contract.id,
      number: contract.number,
      title: contract.title,
      status: contract.status,
      approvalStatus: contract.approvalStatus,
      legalStatus: contract.legalStatus,
      signatureStatus: contract.signatureStatus,
      totalValue: contract.totalValue,
      annualValue: contract.annualValue,
      effectiveDate: contract.effectiveDate,
      expirationDate: contract.expirationDate,
      autoRenew: contract.autoRenew,
      noticeDays: contract.noticeDays,
      executionIsDemo: contract.executionIsDemo,
      contractingEntityId: contract.contractingEntityId,
      administeringOrgId: contract.administeringOrgId,
      requestingDeptId: contract.requestingDeptId,
      ownerName: user.name,
      vendorName: vendor.name,
      vendorId: contract.vendorId,
      typeName: contractType.name,
      typeKey: contractType.key,
      updatedAt: contract.updatedAt,
    })
    .from(contract)
    .innerJoin(contractType, eq(contractType.id, contract.typeId))
    .innerJoin(user, eq(user.id, contract.ownerId))
    .leftJoin(vendor, eq(vendor.id, contract.vendorId))
    .where(and(...where.filter(Boolean)))
    .orderBy(...order)
    .limit(Math.min(f.limit ?? 500, 2000))
    .offset(f.offset ?? 0);
  const mapped = rows.map((r) => ({
    ...r,
    entityName: idx.name(r.contractingEntityId),
    adminName: idx.name(r.administeringOrgId),
    deptName: idx.path(r.requestingDeptId),
    administeredOnBehalf: idx.legalEntityOf(r.administeringOrgId)?.id !== r.contractingEntityId,
  }));
  return f.administeredOnBehalf ? mapped.filter((r) => r.administeredOnBehalf) : mapped;
}

export async function getContractDetail(actor: Actor, id: string) {
  const c = await db.query.contract.findFirst({
    where: eq(contract.id, id),
    with: {
      type: true,
      vendor: { with: { contacts: true } },
      owner: true,
      serviceOwner: true,
      agencies: { with: { org: true } },
      requests: { with: { requester: true }, orderBy: desc(contractRequest.createdAt) },
      parent: true,
      children: { with: { type: true } },
      subscriptions: true,
      commitments: true,
      purchaseOrders: true,
      obligations: { with: { owner: true } },
      legalIssues: { with: { raisedBy: true }, orderBy: desc(legalIssue.createdAt) },
      renewals: { with: { owner: true } },
      signatureRequests: { with: { signers: true, events: true } },
    },
  });
  if (!c) throw new NotFoundError("Contract");
  await assertCanViewContract(actor, c);
  const idx = await getOrgIndex();
  const requesterIds = c.requests.map((r) => r.requesterId);
  return {
    contract: c,
    orgs: {
      entity: idx.get(c.contractingEntityId)!,
      admin: idx.get(c.administeringOrgId)!,
      dept: idx.get(c.requestingDeptId)!,
      deptPath: idx.path(c.requestingDeptId),
      adminPath: idx.path(c.administeringOrgId),
      legal: idx.get(c.legalReviewOrgId),
    },
    administeredOnBehalf: idx.legalEntityOf(c.administeringOrgId)?.id !== c.contractingEntityId,
    can: {
      edit: canEditContract(actor, c, idx, requesterIds) && ["DRAFT"].includes(c.status),
      administer: isContractAdminFor(actor, c, idx),
      legal: c.legalReviewOrgId ? hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId) : false,
      upload: !isReadOnly(actor) && (isContractAdminFor(actor, c, idx) || c.ownerId === actor.id || c.serviceOwnerId === actor.id || requesterIds.includes(actor.id) || (c.legalReviewOrgId ? hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId) : false)),
      decideRenewal: !isReadOnly(actor) && (isContractAdminFor(actor, c, idx) || c.ownerId === actor.id || c.renewals.some((r) => r.ownerId === actor.id)),
    },
  };
}

export async function listRequests(actor: Actor, scope: "mine" | "all" = "mine") {
  const idx = await getOrgIndex();
  const vis = contractVisibilityFilter(actor, idx);
  const rows = await db
    .select({ r: contractRequest, c: contract, requesterName: user.name, typeName: contractType.name, vendorName: vendor.name })
    .from(contractRequest)
    .innerJoin(contract, eq(contract.id, contractRequest.contractId))
    .innerJoin(contractType, eq(contractType.id, contract.typeId))
    .innerJoin(user, eq(user.id, contractRequest.requesterId))
    .leftJoin(vendor, eq(vendor.id, contract.vendorId))
    .where(and(vis, scope === "mine" ? eq(contractRequest.requesterId, actor.id) : undefined))
    .orderBy(desc(contractRequest.updatedAt))
    .limit(500);
  return rows;
}

export async function getRequest(actor: Actor, requestId: string) {
  const r = await db.query.contractRequest.findFirst({
    where: eq(contractRequest.id, requestId),
    with: { requester: true, contract: { with: { type: true, vendor: true, agencies: true, subscriptions: true } } },
  });
  if (!r) throw new NotFoundError("Request");
  await assertCanViewContract(actor, r.contract);
  const idx = await getOrgIndex();
  return {
    request: r,
    canEdit: ["DRAFT", "RETURNED"].includes(r.status) && canEditContract(actor, { ...r.contract, status: "DRAFT" }, idx, [r.requesterId]),
    canSubmit: ["DRAFT", "RETURNED"].includes(r.status) && (r.requesterId === actor.id || isContractAdminFor(actor, r.contract, idx)),
  };
}

// ───────────── Legal issues ─────────────

export async function addLegalIssue(actor: Actor, contractId: string, input: { title: string; detail?: string; clauseRef?: string; severity?: "LOW" | "MODERATE" | "HIGH" }) {
  if (!input.title?.trim()) throw new ValidationError("Issue title is required.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
    if (!c) throw new NotFoundError("Contract");
    const idx = await getOrgIndex(tx);
    if (!c.legalReviewOrgId || !hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId)) throw new ForbiddenError("Only the reviewing legal office can log issues.");
    const [row] = await tx
      .insert(legalIssue)
      .values({ contractId, title: input.title.trim(), detail: input.detail ?? null, clauseRef: input.clauseRef ?? null, severity: input.severity ?? "MODERATE", raisedById: actor.id })
      .returning();
    await writeAudit(tx, { actorId: actor.id, action: "LEGAL_ISSUE_RAISED", entityType: "legal_issue", entityId: row.id, contractId, data: input });
    return row;
  });
}

export async function resolveLegalIssue(actor: Actor, issueId: string, status: "RESOLVED" | "ACCEPTED_RISK", resolution: string) {
  if (!resolution?.trim()) throw new ValidationError("Describe the resolution.");
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(legalIssue).where(eq(legalIssue.id, issueId));
    if (!i) throw new NotFoundError("Issue");
    const [c] = await tx.select().from(contract).where(eq(contract.id, i.contractId));
    const idx = await getOrgIndex(tx);
    if (!c.legalReviewOrgId || !hasRole(actor, "LEGAL_REVIEWER", idx, c.legalReviewOrgId)) throw new ForbiddenError();
    await tx.update(legalIssue).set({ status, resolution, resolvedAt: new Date() }).where(eq(legalIssue.id, i.id));
    await writeAudit(tx, { actorId: actor.id, action: `LEGAL_ISSUE_${status}`, entityType: "legal_issue", entityId: i.id, contractId: c.id, data: { resolution } });
  });
}

// ───────────── Reference data ─────────────

export async function referenceData() {
  const [orgs, types, vendors, users] = await Promise.all([
    db.select().from(organization).where(eq(organization.active, true)).orderBy(asc(organization.name)),
    db.select().from(contractType).where(eq(contractType.active, true)).orderBy(asc(contractType.sortOrder)),
    db.select({ id: vendor.id, name: vendor.name }).from(vendor).where(eq(vendor.active, true)).orderBy(asc(vendor.name)),
    db.select({ id: user.id, name: user.name, title: user.title, primaryOrgId: user.primaryOrgId }).from(user).where(eq(user.active, true)).orderBy(asc(user.name)),
  ]);
  return { orgs, types, vendors, users };
}
