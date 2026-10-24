# Demo walk-through

Start from a freshly seeded database (`npm run db:reset`). Switch people from the avatar menu
("Switch demo user"). Each person sees only what their roles cover.

## Already in the demo data

| Contract | Where it is | Shows |
| --- | --- | --- |
| Body-worn camera evidence storage | Awaiting Police department and agency approval | City contract administered by DOTComm |
| Endpoint detection & response | Purchasing approved; Finance and Security pending | Parallel reviews |
| Historical records digitization services | In Legal; two open issues; v2 redline with tracked changes | Legal workspace, version compare |
| Core network switch refresh | Approved, awaiting signature | Signature package |
| Online property-tax payment portal | Approved, awaiting signature | Scenario 2 delegated authority |
| Zoning analysis GIS extension | Returned for changes | Return and resubmit |
| Low-code application platform | Draft | Wizard |

## Scenario 1 — new software contract (about 10 minutes)

1. **Priya Natarajan** › New contract request. SaaS, vendor Granite Help Desk Software, $150,000 over
   three years, confidential data. Upload any .docx as the agreement. Submit.
   The Workflow tab shows which steps the rules applied and which they skipped, and why.
2. **Marcus Hale** approves (Department). Try approving as Priya first: segregation of duties blocks it.
3. **Raymond Ortiz**, **Grace Mbeki**, **Aisha Rahman** approve in any order (parallel stage).
4. **Jonathan Pryce** › Legal review › Start review, log an issue, upload a redline as a new version,
   resolve the issue, Clear agreement. Clearing is refused while an issue is open.
5. **Elaine Cho** gives final approval.
6. **Dana Whitfield** › Signature tab. Choose herself as signatory: blocked, she has no authority.
   Choose Elaine Cho: sent. Simulate the vendor signature, then Elaine's. The contract is active, marked
   as a demo execution, and the Renewals tab shows the notice deadline.
7. **Owen Fitch** (auditor) › Audit history shows every step, including the blocked authority check.

## Scenario 2 — DOTComm signing for Douglas County

1. **Dana Whitfield** › Online property-tax payment portal › Signature. The signatory list offers Elaine
   Cho under *DEMO-County-Delegation-Memo-07* (County software contracts up to $250,000).
2. Overview shows the County Treasurer as benefiting agency, DOTComm Applications & Analytics as
   administrator and Douglas County as the contracting entity.
3. To see a block: Administration › Signing authority (as **Jonathan Pryce**) › revoke Harold Jensen's
   authority. Elaine's delegation then fails because the delegating official's authority no longer
   holds, and signing is blocked with that reason.

## Renewals

**Greg Novak** › Dashboard: the enterprise email suite auto-renews in about 35 days. Record a decision
on its Renewals tab. **Dana Whitfield** › Renewals › Run reminders now.
