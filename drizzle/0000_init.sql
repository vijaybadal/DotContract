CREATE TYPE "public"."action_item_status" AS ENUM('OPEN', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."agency_role" AS ENUM('BENEFITING', 'FINANCIAL');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('NOT_STARTED', 'PENDING', 'APPROVED', 'RETURNED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."assignee_scope" AS ENUM('REQUESTING_DEPT', 'BENEFITING_AGENCY', 'CONTRACTING_ENTITY', 'ADMINISTERING_ORG', 'LEGAL_AUTHORITY');--> statement-breakpoint
CREATE TYPE "public"."authority_source" AS ENUM('DIRECT', 'DELEGATED');--> statement-breakpoint
CREATE TYPE "public"."commitment_kind" AS ENUM('ONE_TIME', 'RECURRING', 'RATE_CARD');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('DRAFT', 'IN_REVIEW', 'IN_LEGAL', 'PENDING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."data_sensitivity" AS ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('APPROVE', 'REJECT', 'RETURN', 'LEGAL_CLEAR', 'LEGAL_CHANGES_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('AGREEMENT', 'REDLINE', 'EXHIBIT', 'SOW', 'QUOTE', 'EXECUTED', 'SIGNATURE_CERTIFICATE', 'SUPPORTING');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'RESOLVED', 'ACCEPTED_RISK');--> statement-breakpoint
CREATE TYPE "public"."legal_status" AS ENUM('NOT_REQUIRED', 'PENDING_REVIEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'UNDER_NEGOTIATION', 'CLEARED');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('OPEN', 'MET', 'OVERDUE', 'WAIVED');--> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('ENTERPRISE', 'GOVERNMENT', 'DEPARTMENT', 'OFFICE');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('SOW_UNDER', 'AMENDS', 'RENEWS', 'REPLACES', 'RELATED');--> statement-breakpoint
CREATE TYPE "public"."renewal_decision" AS ENUM('PENDING', 'RENEW', 'RENEGOTIATE', 'EXTEND', 'REPLACE', 'CONSOLIDATE', 'TERMINATE');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('NEW_CONTRACT', 'AMENDMENT', 'RENEWAL', 'EXTENSION', 'ADDITIONAL_PURCHASE', 'TERMINATION', 'TRANSFER', 'LEGAL_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MODERATE', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED');--> statement-breakpoint
CREATE TYPE "public"."signature_request_status" AS ENUM('SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('NOT_READY', 'READY', 'SENT', 'PARTIALLY_SIGNED', 'EXECUTED', 'EXECUTED_EXTERNALLY', 'DEMO_EXECUTED', 'DECLINED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."signer_status" AS ENUM('WAITING', 'SENT', 'SIGNED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."signer_type" AS ENUM('AGENCY', 'VENDOR');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('APPROVAL', 'LEGAL_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'SUPERSEDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."vendor_security_status" AS ENUM('NOT_REVIEWED', 'IN_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'NOT_APPROVED');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('RUNNING', 'COMPLETED', 'RETURNED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "action_item" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"contract_id" text,
	"assignee_id" text NOT NULL,
	"due_date" date,
	"status" "action_item_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_item_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"on_behalf_of_user_id" text,
	"decision" "decision_type" NOT NULL,
	"comment" text,
	"document_version_id" text,
	"document_sha256" text,
	"definition_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"context_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_delegation" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"role_key" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"contract_id" text,
	"data" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clause_template" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"is_standard" boolean DEFAULT true NOT NULL,
	"guidance" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clause_template_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"business_purpose" text,
	"type_id" text NOT NULL,
	"vendor_id" text,
	"status" "contract_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"legal_status" "legal_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"signature_status" "signature_status" DEFAULT 'NOT_READY' NOT NULL,
	"contracting_entity_id" text NOT NULL,
	"administering_org_id" text NOT NULL,
	"requesting_dept_id" text NOT NULL,
	"legal_review_org_id" text,
	"owner_id" text NOT NULL,
	"service_owner_id" text,
	"purchasing_notes" text,
	"total_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"annual_value" numeric(14, 2),
	"funding_source" text,
	"risk_level" "risk_level" DEFAULT 'MODERATE' NOT NULL,
	"data_sensitivity" "data_sensitivity" DEFAULT 'INTERNAL' NOT NULL,
	"legal_required" boolean DEFAULT true NOT NULL,
	"effective_date" date,
	"expiration_date" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_term_months" integer,
	"notice_days" integer,
	"price_escalation" text,
	"parent_contract_id" text,
	"custom_field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"execution_is_demo" boolean DEFAULT false NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contract_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "contract_agency" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" "agency_role" NOT NULL,
	"allocation_pct" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "contract_amendment" (
	"id" text PRIMARY KEY NOT NULL,
	"base_contract_id" text NOT NULL,
	"amendment_contract_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"value_change" numeric(14, 2) DEFAULT '0' NOT NULL,
	"new_expiration_date" date,
	"previous_value" numeric(14, 2),
	"previous_expiration" date,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_amendment_amendment_contract_id_unique" UNIQUE("amendment_contract_id")
);
--> statement-breakpoint
CREATE TABLE "contract_document" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_relationship" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"type" "relationship_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_request" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'DRAFT' NOT NULL,
	"requester_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"justification" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_request_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "contract_type" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"requires_deliverables" boolean DEFAULT false NOT NULL,
	"requires_parent" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "contract_type_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "counter" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"note" text,
	"is_material_change" boolean DEFAULT false NOT NULL,
	"has_tracked_changes" boolean,
	"extracted_text" text,
	"scan_status" "scan_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_commitment" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"kind" "commitment_kind" NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"fiscal_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "legal_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"clause_ref" text,
	"title" text NOT NULL,
	"detail" text,
	"severity" "risk_level" DEFAULT 'MODERATE' NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"raised_by_id" text NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" "delivery_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"email" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"owner_id" text NOT NULL,
	"due_date" date,
	"status" "obligation_status" DEFAULT 'OPEN' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "org_kind" NOT NULL,
	"parent_id" text,
	"is_legal_entity" boolean DEFAULT false NOT NULL,
	"legal_authority_id" text,
	"time_zone" text DEFAULT 'America/Chicago' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"po_number" text NOT NULL,
	"erp_supplier_id" text,
	"amount" numeric(14, 2),
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewal" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"cycle_expiration" date NOT NULL,
	"notice_deadline" date,
	"owner_id" text NOT NULL,
	"decision" "renewal_decision" DEFAULT 'PENDING' NOT NULL,
	"decision_note" text,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "role_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "signature_event" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"event" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_request" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"provider" text NOT NULL,
	"is_mock" boolean NOT NULL,
	"provider_envelope_id" text,
	"status" "signature_request_status" DEFAULT 'SENT' NOT NULL,
	"document_version_id" text NOT NULL,
	"document_sha256" text NOT NULL,
	"created_by_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signature_signer" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"signing_order" integer NOT NULL,
	"signer_type" "signer_type" NOT NULL,
	"user_id" text,
	"authority_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" "signer_status" DEFAULT 'WAITING' NOT NULL,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signing_authority" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"legal_entity_id" text NOT NULL,
	"source" "authority_source" NOT NULL,
	"delegated_from_user_id" text,
	"max_amount" numeric(14, 2),
	"contract_type_keys" text[] DEFAULT '{}' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"authorizing_reference" text NOT NULL,
	"authorizing_note" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_authority_check" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"signer_id" text NOT NULL,
	"authority_id" text,
	"passed" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"phase" text NOT NULL,
	"checked_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_license" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"product" text NOT NULL,
	"plan" text,
	"licensed_qty" integer NOT NULL,
	"assigned_qty" integer,
	"unit_cost" numeric(12, 2) NOT NULL,
	"billing_frequency" text DEFAULT 'ANNUAL' NOT NULL,
	"cost_center" text,
	"usage_as_of" date,
	"usage_source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"primary_org_id" text,
	"external_subject" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email"),
	CONSTRAINT "app_user_external_subject_unique" UNIQUE("external_subject")
);
--> statement-breakpoint
CREATE TABLE "user_role_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_key" text NOT NULL,
	"org_id" text NOT NULL,
	"include_children" boolean DEFAULT true NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"erp_supplier_id" text,
	"classification" text,
	"website" text,
	"address" text,
	"products_services" text,
	"security_review_status" "vendor_security_status" DEFAULT 'NOT_REVIEWED' NOT NULL,
	"security_reviewed_on" date,
	"insurance_expires_on" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_erp_supplier_id_unique" UNIQUE("erp_supplier_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"is_signer" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"request_types" "request_type"[] NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"status" "workflow_status" DEFAULT 'RUNNING' NOT NULL,
	"current_stage" integer DEFAULT 1 NOT NULL,
	"context" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_step_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"stage" integer NOT NULL,
	"kind" "step_kind" DEFAULT 'APPROVAL' NOT NULL,
	"role_key" text NOT NULL,
	"scope" "assignee_scope" NOT NULL,
	"condition" jsonb,
	"due_days" integer DEFAULT 5 NOT NULL,
	"reapprove_on_material_change" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_task" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"step_key" text NOT NULL,
	"name" text NOT NULL,
	"stage" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"role_key" text NOT NULL,
	"scope_org_id" text,
	"assignee_user_id" text,
	"is_ad_hoc" boolean DEFAULT false NOT NULL,
	"status" "task_status" NOT NULL,
	"skip_reason" text,
	"condition_snapshot" jsonb,
	"reapprove_on_material_change" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_task_id_workflow_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_on_behalf_of_user_id_app_user_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_from_user_id_app_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_to_user_id_app_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_type_id_contract_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."contract_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_contracting_entity_id_organization_id_fk" FOREIGN KEY ("contracting_entity_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_administering_org_id_organization_id_fk" FOREIGN KEY ("administering_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_requesting_dept_id_organization_id_fk" FOREIGN KEY ("requesting_dept_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_legal_review_org_id_organization_id_fk" FOREIGN KEY ("legal_review_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_service_owner_id_app_user_id_fk" FOREIGN KEY ("service_owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_parent_contract_id_contract_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_agency" ADD CONSTRAINT "contract_agency_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_agency" ADD CONSTRAINT "contract_agency_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendment" ADD CONSTRAINT "contract_amendment_base_contract_id_contract_id_fk" FOREIGN KEY ("base_contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendment" ADD CONSTRAINT "contract_amendment_amendment_contract_id_contract_id_fk" FOREIGN KEY ("amendment_contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_document" ADD CONSTRAINT "contract_document_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_document" ADD CONSTRAINT "contract_document_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_relationship" ADD CONSTRAINT "contract_relationship_from_id_contract_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_relationship" ADD CONSTRAINT "contract_relationship_to_id_contract_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_request" ADD CONSTRAINT "contract_request_requester_id_app_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_request" ADD CONSTRAINT "contract_request_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_contract_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."contract_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_uploaded_by_id_app_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_commitment" ADD CONSTRAINT "financial_commitment_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_issue" ADD CONSTRAINT "legal_issue_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_issue" ADD CONSTRAINT "legal_issue_raised_by_id_app_user_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_parent_id_organization_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_legal_authority_id_organization_id_fk" FOREIGN KEY ("legal_authority_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_ref" ADD CONSTRAINT "purchase_order_ref_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal" ADD CONSTRAINT "renewal_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal" ADD CONSTRAINT "renewal_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal" ADD CONSTRAINT "renewal_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_event" ADD CONSTRAINT "signature_event_request_id_signature_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_document_version_id_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signer" ADD CONSTRAINT "signature_signer_request_id_signature_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signer" ADD CONSTRAINT "signature_signer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signer" ADD CONSTRAINT "signature_signer_authority_id_signing_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."signing_authority"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority" ADD CONSTRAINT "signing_authority_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority" ADD CONSTRAINT "signing_authority_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority" ADD CONSTRAINT "signing_authority_delegated_from_user_id_app_user_id_fk" FOREIGN KEY ("delegated_from_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority" ADD CONSTRAINT "signing_authority_created_by_id_app_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority_check" ADD CONSTRAINT "signing_authority_check_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority_check" ADD CONSTRAINT "signing_authority_check_signer_id_app_user_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority_check" ADD CONSTRAINT "signing_authority_check_authority_id_signing_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."signing_authority"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_authority_check" ADD CONSTRAINT "signing_authority_check_checked_by_id_app_user_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_license" ADD CONSTRAINT "subscription_license_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_primary_org_id_organization_id_fk" FOREIGN KEY ("primary_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_role_key_role_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_request_id_contract_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."contract_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_definition_id_workflow_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_definition" ADD CONSTRAINT "workflow_step_definition_definition_id_workflow_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_instance_id_workflow_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_scope_org_id_organization_id_fk" FOREIGN KEY ("scope_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_assignee_user_id_app_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_decided_by_id_app_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_contract_idx" ON "audit_log" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "contract_status_idx" ON "contract" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contract_expiration_idx" ON "contract" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX "contract_entity_idx" ON "contract" USING btree ("contracting_entity_id");--> statement-breakpoint
CREATE INDEX "contract_admin_idx" ON "contract" USING btree ("administering_org_id");--> statement-breakpoint
CREATE INDEX "contract_dept_idx" ON "contract" USING btree ("requesting_dept_id");--> statement-breakpoint
CREATE INDEX "contract_vendor_idx" ON "contract" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "contract_owner_idx" ON "contract" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_agency_uq" ON "contract_agency" USING btree ("contract_id","org_id","role");--> statement-breakpoint
CREATE INDEX "contract_agency_org_idx" ON "contract_agency" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "document_contract_idx" ON "contract_document" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_rel_uq" ON "contract_relationship" USING btree ("from_id","to_id","type");--> statement-breakpoint
CREATE INDEX "request_requester_idx" ON "contract_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "request_status_idx" ON "contract_request" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_uq" ON "document_version" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "delivery_queue_idx" ON "notification_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_pref_uq" ON "notification_preference" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "organization_parent_idx" ON "organization" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_cycle_uq" ON "renewal" USING btree ("contract_id","cycle_expiration");--> statement-breakpoint
CREATE INDEX "signing_authority_user_entity_idx" ON "signing_authority" USING btree ("user_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ura_user_role_org_uq" ON "user_role_assignment" USING btree ("user_id","role_key","org_id");--> statement-breakpoint
CREATE INDEX "ura_role_org_idx" ON "user_role_assignment" USING btree ("role_key","org_id");--> statement-breakpoint
CREATE INDEX "vendor_name_idx" ON "vendor" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_def_key_version_uq" ON "workflow_definition" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "workflow_instance_contract_idx" ON "workflow_instance" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_uq" ON "workflow_step_definition" USING btree ("definition_id","key");--> statement-breakpoint
CREATE INDEX "task_status_role_idx" ON "workflow_task" USING btree ("status","role_key");--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "workflow_task" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "task_instance_idx" ON "workflow_task" USING btree ("instance_id");