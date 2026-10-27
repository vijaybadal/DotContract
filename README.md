# DOTComm Contracts — IT Contract Lifecycle Management

Phase 1 ("thin slice") of the DOTComm IT Contract Lifecycle Management system for DOTComm, the City of
Omaha and Douglas County. It runs the core path end to end:

**Request → Department and agency approval → Purchasing / Finance / Security review → Legal review and
redlines → Final approval → Signing-authority check → Signature → Active contract → Renewal alerts**

Everything in this repository's demo data is **synthetic**: people, vendors, amounts, approval
thresholds and signing authorities are invented and are not City, County or DOTComm policy.

## What works today

| Area | Status |
| --- | --- |
| Organizations, roles, agency-scoped access | Working. City, County and DOTComm hierarchy; roles scoped to an organization and its children; every query and action checked on the server. |
| Contract repository | Working. Search (PostgreSQL full text), filters, CSV export, 11-tab contract record, lifecycle rail. |
| Request wizard | Working. Five steps, drafts, validation, category-specific fields, SaaS seats, cost sharing. |
| Approval engine | Working. Versioned, admin-editable workflows; sequential stages, parallel steps, rule-based routing, delegation, reassignment, ad hoc approvers, return/reject, reminders and escalation, material-change re-approval. |
| Legal review | Working. Legal workspace, issue log, clause library, .docx versions with tracked changes preserved and detected, word-level version comparison. |
| Signing authority | Working. Registry with entity, dollar limit, contract types, dates, authorizing document, delegation chains; checked when the package is built and again at completion; blocked attempts recorded. |
| E-signature | Adapter interface plus a **development mock** (clearly marked, never counted as a legal execution). DocuSign adapter is a documented stub. Externally signed agreements can be recorded. |
| Renewals | Working. Notice deadlines, 180/120/90/60/30-day reminders (configurable, deduplicated, time-zone correct), auto-renew roll-forward, renewal decisions. |
| Dashboard and reports | Working. Role-scoped dashboard; nine CSV reports. |
| Audit | Working. Append-only, hash-chained audit log; database triggers block edits and deletes. |
| SaaS, vendors, financials, obligations | Read views over recorded data. Editing screens are Phase 2–3 (see [docs/LIMITATIONS.md](docs/LIMITATIONS.md)). |

## Quick start (local)

Requirements: Node.js 22, PostgreSQL 16.

```bash
cp .env.example .env          # set SESSION_SECRET (32+ chars) and STORAGE_KEY (64 hex chars)
npm ci
createdb clm                  # or point DATABASE_URL at any empty database
npm run db:reset              # migrate + load synthetic demo data
npm run dev                   # http://localhost:3000
```

Pick any demonstration account on the sign-in page. Suggested walk-through: [docs/DEMO.md](docs/DEMO.md).

Run scheduled work (reminders, escalations, email outbox) hourly in production; locally on demand:

```bash
npm run jobs
```

Shared demo on Vercel + Neon (about 15 minutes, no server to manage): [docs/VERCEL.md](docs/VERCEL.md).

Zero-setup demo in the browser on StackBlitz (each visitor gets a private copy): [docs/STACKBLITZ.md](docs/STACKBLITZ.md).

With Docker (not yet run in CI — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

```bash
docker compose up --build
```

## Tests

```bash
npm test          # 80 unit + integration tests against a real PostgreSQL test database (clm_test)
npm run smoke     # 16–19 HTTP checks against a running server: auth, CSRF, scoping, exports, headers
npm run e2e       # browser test of the full thin slice; needs CHROME_PATH and a freshly seeded server
```

The integration tests cover Scenario 1 (new software contract) and Scenario 2 (DOTComm administering for
a County department with delegated signing authority) end to end, plus authorization, agency scoping,
segregation of duties, document security, append-only enforcement, audit tamper detection, invalid state
transitions, renewal date math and the regressions from the independent security review.

## Repository map

| Path | What it holds |
| --- | --- |
| `src/db/schema.ts` | Data model (40 tables). ERD in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). |
| `drizzle/` | SQL migrations, including append-only triggers and integrity guards. |
| `src/lib/` | Domain services: `authz`, `workflow`, `rules`, `signing`, `documents`, `renewals`, `contracts`, `audit`, `notifications`, `reports`. |
| `src/lib/esign/` | E-signature provider interface, development mock, DocuSign stub. |
| `src/app/(app)/` | Screens (22 pages). |
| `src/app/api/v1/` | REST API; OpenAPI document at `/api/v1/openapi.json`. |
| `src/app/actions.ts` | Server actions used by the UI (same services as the API). |
| `src/db/seed.ts` | Synthetic demo data; in-flight requests are driven through the real services. |
| `tests/`, `e2e/`, `scripts/smoke.ts` | Automated tests. |
| `docs/` | Architecture, administration, integrations, decisions, limitations, security review. |

## Documentation

- [Architecture and data model](docs/ARCHITECTURE.md)
- [Administrator guide](docs/ADMIN.md) — workflows and routing rules, signing authority, roles, jobs
- [Integrations](docs/INTEGRATIONS.md) — SSO, e-signature, email, storage, malware scanning, ERP
- [Deployment](docs/DEPLOYMENT.md) · [Vercel + Neon demo](docs/VERCEL.md) · [StackBlitz demo](docs/STACKBLITZ.md)
- [Decisions needed before production](docs/DECISIONS.md)
- [Known limitations and backlog](docs/LIMITATIONS.md)
- [Security review and fixes](docs/SECURITY-REVIEW.md)
- [ADR-001: Drizzle ORM instead of Prisma](docs/ADR-001-orm.md)
- [Demo walk-through](docs/DEMO.md)

## Safety defaults

- Demo sign-in and the e-signature mock are refused on a production build unless explicitly enabled
  with `ALLOW_DEMO_LOGIN=true` / `ALLOW_MOCK_ESIGN=true` (demonstration servers only).
- No approval threshold, retention period or signing authority is assumed; all are configuration.
- Commitments are never shown as spending; actuals belong to the ERP.
