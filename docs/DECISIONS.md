# Decisions needed before production

These come from the build plan's Phase 0. Each one maps to a specific place in the system, so the
answer can be entered as configuration rather than code.

| # | Decision | Owner | Where it goes in the CLM |
| --- | --- | --- | --- |
| 1 | Hosting environment | DOTComm leadership, Security | DEPLOYMENT.md; storage adapter; backups |
| 2 | Identity provider, and whether roles come from IdP groups or the CLM | Security, Identity | OIDC routes; `user_role_assignment` |
| 3 | Pilot scope (DOTComm only, or one City and one County department too) | Executive sponsor | Organizations and roles loaded |
| 4 | Owning team and support model | DOTComm leadership | — |
| 5 | Approval matrix per entity (who approves what, thresholds) | Purchasing, Finance, City and County legal | Workflow steps, rules and `policy` values (ADMIN.md) |
| 6 | Signing authorities and delegations, with authorizing documents | City Law Department, County Attorney | Signing authority registry |
| 7 | E-signature provider already licensed by City or County | Purchasing | `ESignProvider` implementation |
| 8 | Source of the legacy contract inventory and who cleans it | Contract administrators | Import (backlog item) |
| 9 | Build vs. ERP-native contract module, after ERP RFP responses | ERP steering group | Phase 3 scope |
| 10 | Records retention periods for contracts and documents | City and County records officers, Legal | `retention.*` settings (not yet set by design) |
| 11 | Which legal office reviews DOTComm's own contracts | DOTComm, County Attorney, City Law | `organization.legal_authority_id` for DOTComm (demo data assumes the County Attorney) |

## Assumptions made in Phase 1 (change them freely)

- July–June fiscal year for commitment reporting.
- America/Chicago is the time zone for all three entities.
- The vendor signs first, then the agency signatory.
- A requester can never approve their own request; delegates acting for the requester cannot either.
- Legal review is required unless a contract administrator waives it.
