# Independent security review — findings and resolution

An adversarial code review of the authorization, workflow, signing and document code was run by a
separate reviewer that had not written the code. Every confirmed finding was fixed and has a regression
test in `tests/review-regressions.test.ts`.

| # | Finding | Severity | Resolution |
| --- | --- | --- | --- |
| 1 | A requester could set `legalRequired=false` and skip Legal review entirely | High | Only a contract administrator for the administering organization can waive Legal review; enforced in `resolveParties`. |
| 2 | Changing value or term after approval did not re-run routing; values were not validated | High | Material changes rebuild the routing context, add newly applicable steps, re-open flagged steps, and validate values. Signing is blocked if terms differ from the approved context. |
| 3 | Voiding could race signature completion; a failed completion left the contract stuck | High | New `COMPLETING` state set with the last signature; completion re-checks request and contract under row locks; voiding refused once completing; administrators can retry completion. |
| 4 | Without Legal review, a new agreement version could replace approved text unnoticed | High | When Legal is waived, any new agreement version re-opens every approval, and every approval must match the current text's SHA-256. |
| 5 | External execution could be backdated to use authority that has since expired | Medium | The signing date must be on or after final approval. |
| 6 | Intake did not check contracting entity or owners; read-only was not enforced everywhere | Medium | Contracting entity limited to the requesting department's or administering organization's government (administrators may override); owners must be active, non-read-only users; read-only enforced centrally in server actions and the API. |
| 7 | Some calls revealed out-of-scope contracts (403 vs 404); confidential document details, quarantined text, authority probing and audit payloads were too widely visible | Medium | Scope checked before role checks; confidential document metadata redacted; comparison requires clean scans; authority checks limited to administrators and auditors; change-history report limited to administrators and auditors. |
| 8 | Demo (mock) executions were counted in financial reports and could auto-renew | Medium | Demo executions are excluded from dashboard totals and financial reports and never auto-renew; renewal alerts are labeled "DEMO". |
| 9 | A resolved legal issue could be re-resolved | Low | Only open issues can be resolved. |

Hardening from the reviewer's suspected issues, also fixed:

- Material-change handling could stall a workflow → rewritten; regression test included.
- Demo-login sessions remained valid after switching to SSO → rejected when `AUTH_MODE` is not `dev`.
- Append-only tables could be truncated → `BEFORE TRUNCATE` triggers on all of them.
- Signing authority could be edited or deleted in the database → revoke-only trigger.
- Two agreements could be created by concurrent uploads → partial unique index.
- .docx decompression bombs → size cap before inflation.

Open items (accepted for Phase 1, tracked in LIMITATIONS.md): external anchoring of the audit chain,
atomic envelope creation, logout does not revoke the signed session token before expiry (8 hours).
