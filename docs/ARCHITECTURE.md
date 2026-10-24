# Architecture

One modular Next.js application (TypeScript) on PostgreSQL. Every outside system sits behind an
interface with a labeled development implementation.

```mermaid
flowchart LR
  U[City, County and DOTComm users] -->|SSO / demo login| W[Web UI - Next.js pages]
  A[Other systems] -->|session cookie| API[REST API /api/v1]
  W --> SA[Server actions]
  SA --> S[Domain services src/lib]
  API --> S
  S --> AZ[Authorization - authz.ts]
  S --> WF[Workflow engine - workflow.ts + rules.ts]
  S --> SG[Signing authority + execution - signing.ts]
  S --> DOC[Documents - documents.ts]
  S --> RN[Renewals - renewals.ts]
  S --> AU[Audit chain - audit.ts]
  S --> PG[(PostgreSQL)]
  DOC --> ST[[Storage adapter: local AES-256-GCM / S3]]
  DOC --> SC[[Malware scanner adapter]]
  SG --> ES[[E-signature adapter: mock / DocuSign]]
  J[Hourly jobs: npm run jobs] --> RN
  J --> WF
  J --> EM[[Email adapter: outbox / SMTP]]
```

## Layers

| Layer | Responsibility | Rule |
| --- | --- | --- |
| Pages (`src/app/(app)`) | Render data, collect input | Never decide permissions; hide controls only as a convenience. |
| Server actions / API routes | Authenticate, call one service function, map errors | Read-only accounts are refused here for every mutation. |
| Services (`src/lib`) | All business rules and authorization | Every function takes an `Actor` and checks scope and role itself. Out-of-scope records raise "not found". |
| Database | Integrity of record | Append-only triggers, revoke-only signing authority, unique constraints, foreign keys. |

## Key design decisions

- **Ownership never implies signing authority.** Signatories come only from `signing_authority`
  (entity, limit, contract types, dates, authorizing reference). Delegations are valid only while the
  delegating official's own authority covers the contract. Checks are written to
  `signing_authority_check` whether they pass or fail.
- **Approvals are pinned.** Each `approval_decision` records the agreement's SHA-256, the workflow
  definition version and a hash of the routing context. Signing is blocked if the agreement or terms
  differ from what was approved (see `executionBlockers` in `signing.ts`).
- **Workflows are data.** Definitions are versioned; editing publishes a new version and running
  requests keep theirs. Routing rules use a safe JSON-logic subset (`rules.ts`) — no code execution.
- **Calendar dates are strings.** Effective, expiration and notice dates are `date` columns handled as
  `YYYY-MM-DD`; "today" is computed in the contracting entity's time zone.
- **Commitments are not spending.** `financial_commitment` records contractual obligations; purchase
  orders and invoices are references to the ERP, the system of record.
- **The mock is never a legal execution.** Mock completions produce `DEMO_EXECUTED`, banners on the
  contract, "DEMO" documents, no auto-renewal, and exclusion from financial reports.

## Contract lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> IN_REVIEW: submit (rules route the approvals)
  IN_REVIEW --> IN_LEGAL: Legal stage starts
  IN_LEGAL --> IN_REVIEW: Legal clears; later stages
  IN_REVIEW --> DRAFT: returned for changes
  IN_LEGAL --> DRAFT: Legal requests changes
  IN_REVIEW --> CANCELLED: rejected / withdrawn
  IN_REVIEW --> PENDING_SIGNATURE: all approvals complete
  PENDING_SIGNATURE --> IN_REVIEW: material change re-opens approvals
  PENDING_SIGNATURE --> ACTIVE: executed (authority re-checked)
  ACTIVE --> ACTIVE: auto-renewal rolls the term
  ACTIVE --> EXPIRED: term ends
```

## Data model (core entities)

```mermaid
erDiagram
  organization ||--o{ organization : parent
  organization ||--o{ user_role_assignment : scopes
  app_user ||--o{ user_role_assignment : holds
  organization ||--o{ contract : "contracting entity / administrator / requester"
  vendor ||--o{ contract : supplies
  contract_type ||--o{ contract : classifies
  contract ||--o{ contract_agency : "benefiting / financial (with %)"
  contract ||--o{ contract_relationship : "SOW under, amends, renews"
  contract ||--o{ contract_request : "requested through"
  contract ||--o{ contract_document : has
  contract_document ||--o{ document_version : "immutable versions"
  contract_request ||--o{ workflow_instance : "submitted as"
  workflow_definition ||--o{ workflow_step_definition : defines
  workflow_definition ||--o{ workflow_instance : "version used"
  workflow_instance ||--o{ workflow_task : contains
  workflow_task ||--o{ approval_decision : "append-only"
  app_user ||--o{ signing_authority : "may sign for"
  organization ||--o{ signing_authority : "legal entity"
  contract ||--o{ signing_authority_check : "append-only"
  contract ||--o{ signature_request : "sent as"
  signature_request ||--o{ signature_signer : "signing order"
  signature_request ||--o{ signature_event : "append-only"
  contract ||--o{ renewal : "one per term"
  contract ||--o{ subscription_license : seats
  contract ||--o{ financial_commitment : commitments
  contract ||--o{ obligation : obligations
  contract ||--o{ legal_issue : "clause exceptions"
  app_user ||--o{ notification : receives
  notification ||--o{ notification_delivery : "email + retries"
```

Other tables: `role`, `approval_delegation`, `vendor_contact`, `contract_amendment`,
`purchase_order_ref`, `action_item`, `clause_template`, `notification_preference`, `audit_log`,
`app_setting`, `counter`, `job_run`. Full definitions: `src/db/schema.ts`; migrations in `drizzle/`.

## Module inventory against the charter

| Charter module | Phase 1 |
| --- | --- |
| A Executive dashboard | Built (role-scoped) |
| B Repository | Built; saved views and bulk import are backlog |
| C Contract types | Built (14 categories, custom fields per category) |
| D Intake | Built (8 request types) |
| E Workflow engine | Built |
| F Legal review | Built (versioned .docx workflow; no in-browser redlining by design) |
| G E-signature | Adapter + mock + external execution; production provider pending Decision 7 |
| H Renewals | Built |
| I SaaS | Read views and utilization; editing is backlog |
| J Financials | Commitments and allocations; ERP feed pending the ERP selection |
| K Vendors | Directory and profiles; performance scoring is backlog |
| L Obligations | Read view; editing and escalation are backlog |
| M Reports | Nine CSV reports |
