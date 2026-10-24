# Administrator guide

## Roles and scope

A role is held **for an organization**, and by default for everything beneath it
(e.g. `LEGAL_REVIEWER` for "County Attorney — Civil Division", `FINANCE_REVIEWER` for "Douglas County").
A person can hold many roles in many organizations. `SYSTEM_ADMIN` and `AUDITOR` held at DOTComm
(the enterprise organization) are platform-wide.

| Role | Can |
| --- | --- |
| Requester | Create and submit requests for departments in scope |
| Contract owner / service owner | Edit drafts they own, upload documents, record renewal decisions |
| Department approver, Agency executive, DOTComm management | Approve steps routed to their organization |
| Purchasing, Finance, Information security reviewer | Approve review steps for the contracting entity |
| Legal reviewer | Run the Legal workspace for their legal office |
| Contract administrator (`CLM_ADMIN`) | Prepare signature packages, reassign tasks, add approvers, change terms in review, waive Legal review. At DOTComm level: edit workflows |
| Signing authority administrator | Record and revoke signing authority for a legal entity (never for themselves) |
| Auditor | Read everything, change nothing |
| System administrator | Everything |

Phase 1 manages users, organizations and role assignments through the seed/import scripts
(`src/db/seed.ts` shows the shape). An editing screen is on the backlog.

## Approval workflows

Administration › Approval workflows. A workflow has ordered **stages**; steps in the same stage run in
parallel, and a stage starts only when the previous one is fully decided.

Each step defines:

- **Role** and **whose role** — the organization whose role-holders must act:
  requesting department, benefiting agency (one task per agency), contracting entity, administering
  organization, or the legal reviewing authority configured on the contracting entity.
- **Applies when** — a routing rule (below). Blank means always.
- **Due in** — days before reminders escalate to contract administrators.
- **Re-approve on material change** — re-open this step when the agreement or key terms change after it
  was approved.

Publishing creates a new version. Requests already in progress keep the version they started with, and
every decision records the version it was made under. Use **Preview routing** to see which steps a
real contract would get before publishing.

### Routing rules

Rules are JSON using a safe subset of JSON-logic: `and`, `or`, `!`, `==`, `!=`, `>`, `>=`, `<`, `<=`,
`in`, `if`, `var`. Values available to `var`:

| Path | Meaning |
| --- | --- |
| `contract.totalValue`, `contract.annualValue` | Dollars |
| `contract.typeKey`, `contract.isSubscription` | Category key (e.g. `SAAS`) |
| `contract.termMonths`, `contract.effectiveDate`, `contract.expirationDate` | Term |
| `contract.riskLevel` | `LOW`, `MODERATE`, `HIGH` |
| `contract.dataSensitivity` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED` |
| `contract.fundingSource`, `contract.legalRequired`, `contract.autoRenew` | |
| `parties.contractingEntity`, `parties.administeringOrg`, `parties.requestingDept` | Organization codes |
| `parties.administeredOnBehalf` | Administrator belongs to a different legal entity than the contracting entity |
| `parties.crossAgency`, `parties.benefitingAgencyCount` | Multi-agency contracts |
| `vendor.securityReviewStatus`, `vendor.securityApproved` | Vendor security review |
| `request.type` | `NEW_CONTRACT`, `AMENDMENT`, … |
| `policy.<name>` | Policy values defined on the workflow (thresholds) |

Examples:

```json
{ ">=": [{ "var": "contract.totalValue" }, { "var": "policy.financeReviewThreshold" }] }
{ "or": [{ "in": [{ "var": "contract.dataSensitivity" }, ["CONFIDENTIAL", "RESTRICTED"]] }, { "var": "contract.isSubscription" }] }
{ "and": [{ "==": [{ "var": "parties.contractingEntity" }, "COUNTY"] }, { ">": [{ "var": "contract.termMonths" }, 36] }] }
```

A step whose rule applies but cannot be routed (for example, no legal authority configured) blocks
submission with a clear message rather than being skipped silently.

**The seeded thresholds ($25,000 Finance, $100,000 executive) are placeholders.** Replace them with
the adopted approval matrix (Decision 5 in [DECISIONS.md](DECISIONS.md)).

## Signing authority

Administration › Signing authority. Record authority only from adopted ordinances, resolutions,
statutes or written delegations confirmed by Legal.

- **Direct** authority is granted by policy. **Delegated** authority names the delegating official and
  is valid only while that official's own authority covers the contract.
- **Limit** blank means no dollar limit is recorded; **categories** empty means all.
- Records cannot be edited or deleted (enforced by the database). To correct one, revoke it with a
  reason and record a new one.
- Execution is blocked unless the named signatory's authority covers the contracting entity, value,
  category and date. It is checked when the package is sent and again when signing completes.

## Other controls

- **Waiving Legal review**: only a contract administrator for the administering organization can untick
  "Legal review required". Without Legal review, any new agreement version re-opens every approval.
- **Changing terms during review** (Workflow tab): re-runs routing against the new value and term, adds
  newly required steps and re-opens steps flagged for re-approval.
- **Approval delegation**: an approver can be covered by another person for a date range
  (`approval_delegation`); decisions record both people. A requester can never approve their own request.

## Scheduled jobs

Run `npm run jobs` (or `POST /api/v1/jobs/run` as an administrator) every hour. It is idempotent:

1. Renewal reminders at 180/120/90/60/30 days before each notice deadline (setting
   `renewal.reminderDays`), renewal decision tasks, expiry and auto-renewal roll-forward.
2. Task reminders every 2 days and escalation 2 days after the due date (settings
   `tasks.reminderEveryDays`, `tasks.escalateAfterDaysOverdue`).
3. Email delivery with retry and backoff (up to five attempts).

Results appear under Administration › Audit log.

## Audit

Administration › Audit log verifies the full hash chain on every visit. A broken chain names the first
altered entry. For stronger tamper evidence, export the latest chain hash daily to write-once storage
(backlog item).
