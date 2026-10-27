/**
 * DOTComm IT Contract Lifecycle Management — data model (Drizzle ORM / PostgreSQL)
 *
 * Conventions
 *  - Money: numeric(14,2), surfaced as strings by the driver; convert with toNumber() at the edge.
 *  - Calendar dates (effective, expiration, notice, authority windows) are `date` columns kept as
 *    'YYYY-MM-DD' strings so time zones never shift them. Instants are timestamptz.
 *  - Append-only tables (audit_log, approval_decision, signing_authority_check, signature_event,
 *    document_version) are protected by triggers in drizzle/0001_append_only.sql.
 *  - One organization hierarchy covers DOTComm, the City, the County, departments and offices.
 */
import { randomUUID } from "node:crypto";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const day = (name: string) => date(name, { mode: "string" });

// ───────────── Enums ─────────────
export const orgKind = pgEnum("org_kind", ["ENTERPRISE", "GOVERNMENT", "DEPARTMENT", "OFFICE"]);
export const vendorSecurityStatus = pgEnum("vendor_security_status", [
  "NOT_REVIEWED", "IN_REVIEW", "APPROVED", "APPROVED_WITH_CONDITIONS", "NOT_APPROVED",
]);
export const contractStatus = pgEnum("contract_status", [
  "DRAFT", "IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE", "ACTIVE", "EXPIRED", "TERMINATED", "CANCELLED", "ARCHIVED",
]);
export const approvalStatus = pgEnum("approval_status", ["NOT_STARTED", "PENDING", "APPROVED", "RETURNED", "REJECTED"]);
export const legalStatus = pgEnum("legal_status", [
  "NOT_REQUIRED", "PENDING_REVIEW", "IN_REVIEW", "CHANGES_REQUESTED", "UNDER_NEGOTIATION", "CLEARED",
]);
export const signatureStatus = pgEnum("signature_status", [
  "NOT_READY", "READY", "SENT", "PARTIALLY_SIGNED", "EXECUTED", "EXECUTED_EXTERNALLY", "DEMO_EXECUTED", "DECLINED", "VOIDED",
]);
export const riskLevel = pgEnum("risk_level", ["LOW", "MODERATE", "HIGH"]);
export const dataSensitivity = pgEnum("data_sensitivity", ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
export const agencyRole = pgEnum("agency_role", ["BENEFITING", "FINANCIAL"]);
export const relationshipType = pgEnum("relationship_type", ["SOW_UNDER", "AMENDS", "RENEWS", "REPLACES", "RELATED"]);
export const requestType = pgEnum("request_type", [
  "NEW_CONTRACT", "AMENDMENT", "RENEWAL", "EXTENSION", "ADDITIONAL_PURCHASE", "TERMINATION", "TRANSFER", "LEGAL_REVIEW",
]);
export const requestStatus = pgEnum("request_status", [
  "DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REJECTED", "WITHDRAWN", "COMPLETED",
]);
export const documentKind = pgEnum("document_kind", [
  "AGREEMENT", "REDLINE", "EXHIBIT", "SOW", "QUOTE", "EXECUTED", "SIGNATURE_CERTIFICATE", "SUPPORTING",
]);
export const scanStatus = pgEnum("scan_status", ["PENDING", "CLEAN", "INFECTED"]);
export const stepKind = pgEnum("step_kind", ["APPROVAL", "LEGAL_REVIEW"]);
export const assigneeScope = pgEnum("assignee_scope", [
  "REQUESTING_DEPT", "BENEFITING_AGENCY", "CONTRACTING_ENTITY", "ADMINISTERING_ORG", "LEGAL_AUTHORITY",
]);
export const workflowStatus = pgEnum("workflow_status", ["RUNNING", "COMPLETED", "RETURNED", "REJECTED", "CANCELLED"]);
export const taskStatus = pgEnum("task_status", [
  "WAITING", "PENDING", "APPROVED", "REJECTED", "RETURNED", "SKIPPED", "SUPERSEDED", "CANCELLED",
]);
export const decisionType = pgEnum("decision_type", [
  "APPROVE", "REJECT", "RETURN", "LEGAL_CLEAR", "LEGAL_CHANGES_REQUESTED",
]);
export const issueStatus = pgEnum("issue_status", ["OPEN", "RESOLVED", "ACCEPTED_RISK"]);
export const authoritySource = pgEnum("authority_source", ["DIRECT", "DELEGATED"]);
export const signatureRequestStatus = pgEnum("signature_request_status", [
  "SENT", "PARTIALLY_SIGNED", "COMPLETING", "COMPLETED", "DECLINED", "VOIDED",
]);
export const signerType = pgEnum("signer_type", ["AGENCY", "VENDOR"]);
export const signerStatus = pgEnum("signer_status", ["WAITING", "SENT", "SIGNED", "DECLINED"]);
export const renewalDecision = pgEnum("renewal_decision", [
  "PENDING", "RENEW", "RENEGOTIATE", "EXTEND", "REPLACE", "CONSOLIDATE", "TERMINATE",
]);
export const commitmentKind = pgEnum("commitment_kind", ["ONE_TIME", "RECURRING", "RATE_CARD"]);
export const obligationStatus = pgEnum("obligation_status", ["OPEN", "MET", "OVERDUE", "WAIVED"]);
export const actionItemStatus = pgEnum("action_item_status", ["OPEN", "DONE", "CANCELLED"]);
export const deliveryStatus = pgEnum("delivery_status", ["QUEUED", "SENT", "FAILED", "SUPPRESSED"]);

// ───────────── Organization & people ─────────────
export const organization = pgTable(
  "organization",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: orgKind("kind").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => organization.id),
    isLegalEntity: boolean("is_legal_entity").notNull().default(false),
    // Office that performs legal review when this org is the contracting entity (configurable)
    legalAuthorityId: text("legal_authority_id").references((): AnyPgColumn => organization.id),
    timeZone: text("time_zone").notNull().default("America/Chicago"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("organization_parent_idx").on(t.parentId)],
);

export const user = pgTable("app_user", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  title: text("title"),
  primaryOrgId: text("primary_org_id").references(() => organization.id),
  externalSubject: text("external_subject").unique(), // OIDC "sub" once SSO is configured
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const role = pgTable("role", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
});

export const userRoleAssignment = pgTable(
  "user_role_assignment",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull().references(() => role.key),
    orgId: text("org_id").notNull().references(() => organization.id),
    includeChildren: boolean("include_children").notNull().default(true),
    effectiveFrom: day("effective_from"),
    effectiveTo: day("effective_to"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ura_user_role_org_uq").on(t.userId, t.roleKey, t.orgId),
    index("ura_role_org_idx").on(t.roleKey, t.orgId),
  ],
);

export const approvalDelegation = pgTable("approval_delegation", {
  id: id(),
  fromUserId: text("from_user_id").notNull().references(() => user.id),
  toUserId: text("to_user_id").notNull().references(() => user.id),
  roleKey: text("role_key"), // null = every approval role the delegator holds
  startsOn: day("starts_on").notNull(),
  endsOn: day("ends_on").notNull(),
  reason: text("reason"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdById: text("created_by_id").notNull(),
  createdAt: createdAt(),
});

// ───────────── Vendors ─────────────
export const vendor = pgTable(
  "vendor",
  {
    id: id(),
    name: text("name").notNull(),
    erpSupplierId: text("erp_supplier_id").unique(), // reference to the ERP supplier master (system of record)
    classification: text("classification"),
    website: text("website"),
    address: text("address"),
    productsServices: text("products_services"),
    securityReviewStatus: vendorSecurityStatus("security_review_status").notNull().default("NOT_REVIEWED"),
    securityReviewedOn: day("security_reviewed_on"),
    insuranceExpiresOn: day("insurance_expires_on"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vendor_name_idx").on(t.name)],
);

export const vendorContact = pgTable("vendor_contact", {
  id: id(),
  vendorId: text("vendor_id").notNull().references(() => vendor.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isSigner: boolean("is_signer").notNull().default(false),
});

// ───────────── Contracts ─────────────
export type CustomFieldDef = { key: string; label: string; type: "text" | "number" | "date"; required?: boolean };

export const contractType = pgTable("contract_type", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isSubscription: boolean("is_subscription").notNull().default(false),
  requiresDeliverables: boolean("requires_deliverables").notNull().default(false),
  requiresParent: boolean("requires_parent").notNull().default(false),
  customFields: jsonb("custom_fields").$type<CustomFieldDef[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const contract = pgTable(
  "contract",
  {
    id: id(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    businessPurpose: text("business_purpose"),
    typeId: text("type_id").notNull().references(() => contractType.id),
    vendorId: text("vendor_id").references(() => vendor.id),
    status: contractStatus("status").notNull().default("DRAFT"),
    approvalStatus: approvalStatus("approval_status").notNull().default("NOT_STARTED"),
    legalStatus: legalStatus("legal_status").notNull().default("PENDING_REVIEW"),
    signatureStatus: signatureStatus("signature_status").notNull().default("NOT_READY"),

    // Parties and responsibilities. Ownership and administration never imply signing authority.
    contractingEntityId: text("contracting_entity_id").notNull().references(() => organization.id),
    administeringOrgId: text("administering_org_id").notNull().references(() => organization.id),
    requestingDeptId: text("requesting_dept_id").notNull().references(() => organization.id),
    legalReviewOrgId: text("legal_review_org_id").references(() => organization.id),
    ownerId: text("owner_id").notNull().references(() => user.id),
    serviceOwnerId: text("service_owner_id").references(() => user.id),
    purchasingNotes: text("purchasing_notes"),

    totalValue: money("total_value").notNull().default("0"),
    annualValue: money("annual_value"),
    fundingSource: text("funding_source"),
    riskLevel: riskLevel("risk_level").notNull().default("MODERATE"),
    dataSensitivity: dataSensitivity("data_sensitivity").notNull().default("INTERNAL"),
    legalRequired: boolean("legal_required").notNull().default(true),

    effectiveDate: day("effective_date"),
    expirationDate: day("expiration_date"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    renewalTermMonths: integer("renewal_term_months"),
    noticeDays: integer("notice_days"),
    priceEscalation: text("price_escalation"),

    parentContractId: text("parent_contract_id").references((): AnyPgColumn => contract.id),
    customFieldValues: jsonb("custom_field_values").$type<Record<string, unknown>>().notNull().default({}),
    confidential: boolean("confidential").notNull().default(false),
    executionIsDemo: boolean("execution_is_demo").notNull().default(false),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("contract_status_idx").on(t.status),
    index("contract_expiration_idx").on(t.expirationDate),
    index("contract_entity_idx").on(t.contractingEntityId),
    index("contract_admin_idx").on(t.administeringOrgId),
    index("contract_dept_idx").on(t.requestingDeptId),
    index("contract_vendor_idx").on(t.vendorId),
    index("contract_owner_idx").on(t.ownerId),
  ],
);

export const contractAgency = pgTable(
  "contract_agency",
  {
    id: id(),
    contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => organization.id),
    role: agencyRole("role").notNull(),
    allocationPct: numeric("allocation_pct", { precision: 5, scale: 2 }),
  },
  (t) => [
    uniqueIndex("contract_agency_uq").on(t.contractId, t.orgId, t.role),
    index("contract_agency_org_idx").on(t.orgId),
  ],
);

export const contractRelationship = pgTable(
  "contract_relationship",
  {
    id: id(),
    fromId: text("from_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
    toId: text("to_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
    type: relationshipType("type").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contract_rel_uq").on(t.fromId, t.toId, t.type)],
);

export const contractAmendment = pgTable("contract_amendment", {
  id: id(),
  baseContractId: text("base_contract_id").notNull().references(() => contract.id),
  amendmentContractId: text("amendment_contract_id").notNull().unique().references(() => contract.id),
  sequence: integer("sequence").notNull(),
  valueChange: money("value_change").notNull().default("0"),
  newExpirationDate: day("new_expiration_date"),
  previousValue: money("previous_value"),
  previousExpiration: day("previous_expiration"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────── Requests ─────────────
export const contractRequest = pgTable(
  "contract_request",
  {
    id: id(),
    number: text("number").notNull().unique(),
    type: requestType("type").notNull(),
    status: requestStatus("status").notNull().default("DRAFT"),
    requesterId: text("requester_id").notNull().references(() => user.id),
    contractId: text("contract_id").notNull().references(() => contract.id),
    justification: text("justification"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("request_requester_idx").on(t.requesterId), index("request_status_idx").on(t.status)],
);

// ───────────── Documents ─────────────
export const contractDocument = pgTable(
  "contract_document",
  {
    id: id(),
    contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: documentKind("kind").notNull(),
    confidential: boolean("confidential").notNull().default(false),
    createdById: text("created_by_id").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("document_contract_idx").on(t.contractId),
    // At most one primary agreement per contract; new text is a new version of it.
    uniqueIndex("document_one_agreement_uq").on(t.contractId).where(sql`${t.kind} = 'AGREEMENT'`),
  ],
);

export const documentVersion = pgTable(
  "document_version",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => contractDocument.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedById: text("uploaded_by_id").notNull().references(() => user.id),
    note: text("note"),
    isMaterialChange: boolean("is_material_change").notNull().default(false),
    hasTrackedChanges: boolean("has_tracked_changes"),
    extractedText: text("extracted_text"),
    scanStatus: scanStatus("scan_status").notNull().default("PENDING"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("document_version_uq").on(t.documentId, t.versionNo)],
);

// Encrypted document bytes for hosts without lasting disk (STORAGE_PROVIDER=db). Never updated.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)), // PGlite returns Uint8Array
});
export const storedObject = pgTable("stored_object", {
  key: text("key").primaryKey(),
  bytes: bytea("bytes").notNull(),
  createdAt: createdAt(),
});

// ───────────── Workflow & approvals ─────────────
export type RuleExpr = unknown; // JSON-logic subset, see src/lib/rules.ts

export const workflowDefinition = pgTable(
  "workflow_definition",
  {
    id: id(),
    key: text("key").notNull(), // stable identifier; versions share a key
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    requestTypes: requestType("request_types").array().notNull(),
    // Policy variables referenced by step conditions. Admin-configurable. Seed values are DEMO ONLY.
    variables: jsonb("variables").$type<Record<string, number | string | boolean>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("workflow_def_key_version_uq").on(t.key, t.version)],
);

export const workflowStepDefinition = pgTable(
  "workflow_step_definition",
  {
    id: id(),
    definitionId: text("definition_id").notNull().references(() => workflowDefinition.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    stage: integer("stage").notNull(), // same stage = parallel; stages run in sequence
    kind: stepKind("kind").notNull().default("APPROVAL"),
    roleKey: text("role_key").notNull(),
    scope: assigneeScope("scope").notNull(),
    condition: jsonb("condition").$type<RuleExpr | null>(),
    dueDays: integer("due_days").notNull().default(5),
    reapproveOnMaterialChange: boolean("reapprove_on_material_change").notNull().default(false),
  },
  (t) => [uniqueIndex("workflow_step_uq").on(t.definitionId, t.key)],
);

export const workflowInstance = pgTable(
  "workflow_instance",
  {
    id: id(),
    requestId: text("request_id").notNull().references(() => contractRequest.id),
    contractId: text("contract_id").notNull().references(() => contract.id),
    definitionId: text("definition_id").notNull().references(() => workflowDefinition.id),
    status: workflowStatus("status").notNull().default("RUNNING"),
    currentStage: integer("current_stage").notNull().default(1),
    // Snapshot of attributes the routing rules were evaluated against
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("workflow_instance_contract_idx").on(t.contractId)],
);

export const workflowTask = pgTable(
  "workflow_task",
  {
    id: id(),
    instanceId: text("instance_id").notNull().references(() => workflowInstance.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    name: text("name").notNull(),
    stage: integer("stage").notNull(),
    kind: stepKind("kind").notNull(),
    roleKey: text("role_key").notNull(),
    scopeOrgId: text("scope_org_id").references(() => organization.id),
    assigneeUserId: text("assignee_user_id").references(() => user.id), // explicit (reassigned / ad hoc)
    isAdHoc: boolean("is_ad_hoc").notNull().default(false),
    status: taskStatus("status").notNull(),
    skipReason: text("skip_reason"),
    conditionSnapshot: jsonb("condition_snapshot"),
    reapproveOnMaterialChange: boolean("reapprove_on_material_change").notNull().default(false),
    dueAt: timestamp("due_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    decidedById: text("decided_by_id").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_status_role_idx").on(t.status, t.roleKey),
    index("task_assignee_idx").on(t.assigneeUserId),
    index("task_instance_idx").on(t.instanceId),
  ],
);

// Append-only: each decision is pinned to the document version and rule configuration it was made against.
export const approvalDecision = pgTable("approval_decision", {
  id: id(),
  taskId: text("task_id").notNull().references(() => workflowTask.id),
  userId: text("user_id").notNull().references(() => user.id),
  onBehalfOfUserId: text("on_behalf_of_user_id").references(() => user.id),
  decision: decisionType("decision").notNull(),
  comment: text("comment"),
  documentVersionId: text("document_version_id"),
  documentSha256: text("document_sha256"),
  definitionId: text("definition_id").notNull(),
  definitionVersion: integer("definition_version").notNull(),
  contextHash: text("context_hash").notNull(),
  createdAt: createdAt(),
});

// ───────────── Legal ─────────────
export const legalIssue = pgTable("legal_issue", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
  clauseRef: text("clause_ref"),
  title: text("title").notNull(),
  detail: text("detail"),
  severity: riskLevel("severity").notNull().default("MODERATE"),
  status: issueStatus("status").notNull().default("OPEN"),
  raisedById: text("raised_by_id").notNull().references(() => user.id),
  resolution: text("resolution"),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const clauseTemplate = pgTable("clause_template", {
  id: id(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  body: text("body").notNull(),
  isStandard: boolean("is_standard").notNull().default(true),
  guidance: text("guidance"),
  updatedAt: updatedAt(),
});

// ───────────── Signing authority & signatures ─────────────
export const signingAuthority = pgTable(
  "signing_authority",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id),
    legalEntityId: text("legal_entity_id").notNull().references(() => organization.id),
    source: authoritySource("source").notNull(),
    delegatedFromUserId: text("delegated_from_user_id").references(() => user.id),
    maxAmount: money("max_amount"), // null = no dollar limit recorded
    contractTypeKeys: text("contract_type_keys").array().notNull().default([]), // empty = all types
    effectiveFrom: day("effective_from").notNull(),
    effectiveTo: day("effective_to"),
    authorizingReference: text("authorizing_reference").notNull(),
    authorizingNote: text("authorizing_note"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdById: text("created_by_id").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("signing_authority_user_entity_idx").on(t.userId, t.legalEntityId)],
);

export type AuthorityCheckReason = { code: string; message: string };

export const signingAuthorityCheck = pgTable("signing_authority_check", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id),
  signerId: text("signer_id").notNull().references(() => user.id),
  authorityId: text("authority_id").references(() => signingAuthority.id),
  passed: boolean("passed").notNull(),
  reasons: jsonb("reasons").$type<AuthorityCheckReason[]>().notNull(),
  phase: text("phase").notNull(), // PACKAGE | COMPLETION
  checkedById: text("checked_by_id").notNull().references(() => user.id),
  createdAt: createdAt(),
});

export const signatureRequest = pgTable("signature_request", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id),
  provider: text("provider").notNull(),
  isMock: boolean("is_mock").notNull(),
  providerEnvelopeId: text("provider_envelope_id"),
  status: signatureRequestStatus("status").notNull().default("SENT"),
  documentVersionId: text("document_version_id").notNull().references(() => documentVersion.id),
  documentSha256: text("document_sha256").notNull(),
  createdById: text("created_by_id").notNull().references(() => user.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const signatureSigner = pgTable("signature_signer", {
  id: id(),
  requestId: text("request_id").notNull().references(() => signatureRequest.id, { onDelete: "cascade" }),
  order: integer("signing_order").notNull(),
  signerType: signerType("signer_type").notNull(),
  userId: text("user_id").references(() => user.id),
  authorityId: text("authority_id").references(() => signingAuthority.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  status: signerStatus("status").notNull().default("WAITING"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
});

export const signatureEvent = pgTable("signature_event", {
  id: id(),
  requestId: text("request_id").notNull().references(() => signatureRequest.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  detail: jsonb("detail"),
  createdAt: createdAt(),
});

// ───────────── Lifecycle ─────────────
export const renewal = pgTable(
  "renewal",
  {
    id: id(),
    contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
    cycleExpiration: day("cycle_expiration").notNull(),
    noticeDeadline: day("notice_deadline"),
    ownerId: text("owner_id").notNull().references(() => user.id),
    decision: renewalDecision("decision").notNull().default("PENDING"),
    decisionNote: text("decision_note"),
    decidedById: text("decided_by_id").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("renewal_cycle_uq").on(t.contractId, t.cycleExpiration)],
);

export const subscriptionLicense = pgTable("subscription_license", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
  product: text("product").notNull(),
  plan: text("plan"),
  licensedQty: integer("licensed_qty").notNull(),
  assignedQty: integer("assigned_qty"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
  billingFrequency: text("billing_frequency").notNull().default("ANNUAL"),
  costCenter: text("cost_center"),
  usageAsOf: day("usage_as_of"),
  usageSource: text("usage_source").notNull().default("manual"),
});

// Contractual commitments — NOT expenditures. Actuals belong to the ERP (system of record).
export const financialCommitment = pgTable("financial_commitment", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
  kind: commitmentKind("kind").notNull(),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
  fiscalYear: integer("fiscal_year"),
  createdAt: createdAt(),
});

export const purchaseOrderRef = pgTable("purchase_order_ref", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  erpSupplierId: text("erp_supplier_id"),
  amount: money("amount"),
  source: text("source").notNull().default("manual"), // manual | erp
  createdAt: createdAt(),
});

export const obligation = pgTable("obligation", {
  id: id(),
  contractId: text("contract_id").notNull().references(() => contract.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  ownerId: text("owner_id").notNull().references(() => user.id),
  dueDate: day("due_date"),
  status: obligationStatus("status").notNull().default("OPEN"),
  notes: text("notes"),
});

// Non-approval work items (renewal decisions, follow-ups). Approvals live in workflow_task.
export const actionItem = pgTable("action_item", {
  id: id(),
  sourceKey: text("source_key").notNull().unique(), // idempotency key
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  contractId: text("contract_id").references(() => contract.id, { onDelete: "cascade" }),
  assigneeId: text("assignee_id").notNull().references(() => user.id),
  dueDate: day("due_date"),
  status: actionItemStatus("status").notNull().default("OPEN"),
  createdAt: createdAt(),
});

// ───────────── Notifications ─────────────
export const notification = pgTable(
  "notification",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.readAt)],
);

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: id(),
    notificationId: text("notification_id").notNull().references(() => notification.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // EMAIL
    status: deliveryStatus("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    payload: jsonb("payload"),
  },
  (t) => [index("delivery_queue_idx").on(t.status, t.nextAttemptAt)],
);

export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // notification kind or "*"
    email: boolean("email").notNull().default(true),
  },
  (t) => [uniqueIndex("notification_pref_uq").on(t.userId, t.kind)],
);

// ───────────── Audit, settings, counters, jobs ─────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    contractId: text("contract_id"),
    data: jsonb("data"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_contract_idx").on(t.contractId), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  note: text("note"),
  updatedAt: updatedAt(),
});

export const counter = pgTable("counter", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});

export const jobRun = pgTable("job_run", {
  id: id(),
  job: text("job").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  summary: jsonb("summary"),
});

// ───────────── Relations (for relational queries) ─────────────
export const organizationRelations = relations(organization, ({ one, many }) => ({
  parent: one(organization, { fields: [organization.parentId], references: [organization.id], relationName: "tree" }),
  children: many(organization, { relationName: "tree" }),
  legalAuthority: one(organization, {
    fields: [organization.legalAuthorityId],
    references: [organization.id],
    relationName: "legal",
  }),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  primaryOrg: one(organization, { fields: [user.primaryOrgId], references: [organization.id] }),
  roles: many(userRoleAssignment),
}));

export const userRoleAssignmentRelations = relations(userRoleAssignment, ({ one }) => ({
  user: one(user, { fields: [userRoleAssignment.userId], references: [user.id] }),
  org: one(organization, { fields: [userRoleAssignment.orgId], references: [organization.id] }),
  role: one(role, { fields: [userRoleAssignment.roleKey], references: [role.key] }),
}));

export const vendorRelations = relations(vendor, ({ many }) => ({
  contacts: many(vendorContact),
  contracts: many(contract),
}));
export const vendorContactRelations = relations(vendorContact, ({ one }) => ({
  vendor: one(vendor, { fields: [vendorContact.vendorId], references: [vendor.id] }),
}));

export const contractRelations = relations(contract, ({ one, many }) => ({
  type: one(contractType, { fields: [contract.typeId], references: [contractType.id] }),
  vendor: one(vendor, { fields: [contract.vendorId], references: [vendor.id] }),
  contractingEntity: one(organization, {
    fields: [contract.contractingEntityId],
    references: [organization.id],
    relationName: "entity",
  }),
  administeringOrg: one(organization, {
    fields: [contract.administeringOrgId],
    references: [organization.id],
    relationName: "admin",
  }),
  requestingDept: one(organization, {
    fields: [contract.requestingDeptId],
    references: [organization.id],
    relationName: "dept",
  }),
  legalReviewOrg: one(organization, {
    fields: [contract.legalReviewOrgId],
    references: [organization.id],
    relationName: "legalOrg",
  }),
  owner: one(user, { fields: [contract.ownerId], references: [user.id], relationName: "owner" }),
  serviceOwner: one(user, { fields: [contract.serviceOwnerId], references: [user.id], relationName: "svcOwner" }),
  parent: one(contract, { fields: [contract.parentContractId], references: [contract.id], relationName: "parent" }),
  children: many(contract, { relationName: "parent" }),
  agencies: many(contractAgency),
  requests: many(contractRequest),
  documents: many(contractDocument),
  workflows: many(workflowInstance),
  renewals: many(renewal),
  subscriptions: many(subscriptionLicense),
  commitments: many(financialCommitment),
  purchaseOrders: many(purchaseOrderRef),
  obligations: many(obligation),
  legalIssues: many(legalIssue),
  signatureRequests: many(signatureRequest),
}));

export const contractAgencyRelations = relations(contractAgency, ({ one }) => ({
  contract: one(contract, { fields: [contractAgency.contractId], references: [contract.id] }),
  org: one(organization, { fields: [contractAgency.orgId], references: [organization.id] }),
}));

export const contractRequestRelations = relations(contractRequest, ({ one, many }) => ({
  contract: one(contract, { fields: [contractRequest.contractId], references: [contract.id] }),
  requester: one(user, { fields: [contractRequest.requesterId], references: [user.id] }),
  workflows: many(workflowInstance),
}));

export const contractDocumentRelations = relations(contractDocument, ({ one, many }) => ({
  contract: one(contract, { fields: [contractDocument.contractId], references: [contract.id] }),
  versions: many(documentVersion),
}));
export const documentVersionRelations = relations(documentVersion, ({ one }) => ({
  document: one(contractDocument, { fields: [documentVersion.documentId], references: [contractDocument.id] }),
  uploadedBy: one(user, { fields: [documentVersion.uploadedById], references: [user.id] }),
}));

export const workflowDefinitionRelations = relations(workflowDefinition, ({ many }) => ({
  steps: many(workflowStepDefinition),
  instances: many(workflowInstance),
}));
export const workflowStepDefinitionRelations = relations(workflowStepDefinition, ({ one }) => ({
  definition: one(workflowDefinition, {
    fields: [workflowStepDefinition.definitionId],
    references: [workflowDefinition.id],
  }),
}));
export const workflowInstanceRelations = relations(workflowInstance, ({ one, many }) => ({
  definition: one(workflowDefinition, { fields: [workflowInstance.definitionId], references: [workflowDefinition.id] }),
  request: one(contractRequest, { fields: [workflowInstance.requestId], references: [contractRequest.id] }),
  contract: one(contract, { fields: [workflowInstance.contractId], references: [contract.id] }),
  tasks: many(workflowTask),
}));
export const workflowTaskRelations = relations(workflowTask, ({ one, many }) => ({
  instance: one(workflowInstance, { fields: [workflowTask.instanceId], references: [workflowInstance.id] }),
  scopeOrg: one(organization, { fields: [workflowTask.scopeOrgId], references: [organization.id] }),
  assignee: one(user, { fields: [workflowTask.assigneeUserId], references: [user.id], relationName: "assignee" }),
  decidedBy: one(user, { fields: [workflowTask.decidedById], references: [user.id], relationName: "decider" }),
  decisions: many(approvalDecision),
}));
export const approvalDecisionRelations = relations(approvalDecision, ({ one }) => ({
  task: one(workflowTask, { fields: [approvalDecision.taskId], references: [workflowTask.id] }),
  user: one(user, { fields: [approvalDecision.userId], references: [user.id], relationName: "decisionUser" }),
  onBehalfOf: one(user, {
    fields: [approvalDecision.onBehalfOfUserId],
    references: [user.id],
    relationName: "decisionBehalf",
  }),
}));

export const signingAuthorityRelations = relations(signingAuthority, ({ one }) => ({
  user: one(user, { fields: [signingAuthority.userId], references: [user.id], relationName: "signatory" }),
  legalEntity: one(organization, { fields: [signingAuthority.legalEntityId], references: [organization.id] }),
  delegatedFrom: one(user, {
    fields: [signingAuthority.delegatedFromUserId],
    references: [user.id],
    relationName: "delegator",
  }),
}));
export const signingAuthorityCheckRelations = relations(signingAuthorityCheck, ({ one }) => ({
  signer: one(user, { fields: [signingAuthorityCheck.signerId], references: [user.id] }),
  authority: one(signingAuthority, {
    fields: [signingAuthorityCheck.authorityId],
    references: [signingAuthority.id],
  }),
}));
export const signatureRequestRelations = relations(signatureRequest, ({ one, many }) => ({
  contract: one(contract, { fields: [signatureRequest.contractId], references: [contract.id] }),
  signers: many(signatureSigner),
  events: many(signatureEvent),
}));
export const signatureSignerRelations = relations(signatureSigner, ({ one }) => ({
  request: one(signatureRequest, { fields: [signatureSigner.requestId], references: [signatureRequest.id] }),
}));
export const signatureEventRelations = relations(signatureEvent, ({ one }) => ({
  request: one(signatureRequest, { fields: [signatureEvent.requestId], references: [signatureRequest.id] }),
}));

export const renewalRelations = relations(renewal, ({ one }) => ({
  contract: one(contract, { fields: [renewal.contractId], references: [contract.id] }),
  owner: one(user, { fields: [renewal.ownerId], references: [user.id] }),
}));
export const subscriptionLicenseRelations = relations(subscriptionLicense, ({ one }) => ({
  contract: one(contract, { fields: [subscriptionLicense.contractId], references: [contract.id] }),
}));
export const financialCommitmentRelations = relations(financialCommitment, ({ one }) => ({
  contract: one(contract, { fields: [financialCommitment.contractId], references: [contract.id] }),
}));
export const purchaseOrderRefRelations = relations(purchaseOrderRef, ({ one }) => ({
  contract: one(contract, { fields: [purchaseOrderRef.contractId], references: [contract.id] }),
}));
export const obligationRelations = relations(obligation, ({ one }) => ({
  contract: one(contract, { fields: [obligation.contractId], references: [contract.id] }),
  owner: one(user, { fields: [obligation.ownerId], references: [user.id] }),
}));
export const legalIssueRelations = relations(legalIssue, ({ one }) => ({
  contract: one(contract, { fields: [legalIssue.contractId], references: [contract.id] }),
  raisedBy: one(user, { fields: [legalIssue.raisedById], references: [user.id] }),
}));
export const actionItemRelations = relations(actionItem, ({ one }) => ({
  contract: one(contract, { fields: [actionItem.contractId], references: [contract.id] }),
  assignee: one(user, { fields: [actionItem.assigneeId], references: [user.id] }),
}));
export const notificationRelations = relations(notification, ({ many }) => ({
  deliveries: many(notificationDelivery),
}));
export const notificationDeliveryRelations = relations(notificationDelivery, ({ one }) => ({
  notification: one(notification, {
    fields: [notificationDelivery.notificationId],
    references: [notification.id],
  }),
}));
export const contractAmendmentRelations = relations(contractAmendment, ({ one }) => ({
  base: one(contract, { fields: [contractAmendment.baseContractId], references: [contract.id], relationName: "amendBase" }),
  amendment: one(contract, {
    fields: [contractAmendment.amendmentContractId],
    references: [contract.id],
    relationName: "amendContract",
  }),
}));
export const contractRelationshipRelations = relations(contractRelationship, ({ one }) => ({
  from: one(contract, { fields: [contractRelationship.fromId], references: [contract.id], relationName: "relFrom" }),
  to: one(contract, { fields: [contractRelationship.toId], references: [contract.id], relationName: "relTo" }),
}));
