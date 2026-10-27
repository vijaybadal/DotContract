# Known limitations and backlog

## Limitations in Phase 1

- **No production SSO, e-signature, email, S3 storage or antivirus.** Each has an interface and a
  labeled development implementation (INTEGRATIONS.md).
- **The malware scanner is a placeholder** that recognizes only the EICAR test string.
- **No in-browser redlining.** .docx versions keep tracked changes and are flagged; reviewers work in
  Word. Comparison is word-level text, without formatting.
- **Administration screens are partial.** Workflows and signing authority are editable in the UI;
  organizations, users and role assignments are loaded by script.
- **SaaS, vendors, financials and obligations are read views.** Data is recorded at intake or by import;
  editing screens are not built.
- **No legacy import yet.** The demo's "executed" contracts are seeded directly.
- **Amendments** are modeled (`contract_amendment`) and requests can reference a parent contract, but
  applying an executed amendment to the base contract's value and dates is not wired yet (Scenario 5).
- **Saved views, bulk actions, PDF reports, in-app notification preferences UI** are not built.
- **Envelope creation and the database transaction are not atomic** (see INTEGRATIONS.md).
- **Audit hash chain is not externally anchored.** Someone with database owner rights could rebuild it.
  Anchor the chain head daily to write-once storage.
- **Accessibility**: keyboard navigation, focus states, labels and contrast were designed for WCAG 2.2 AA,
  but no automated axe scan or screen-reader test has been run yet.
- **Container image** has not been built (DEPLOYMENT.md).
- **Vercel configuration** was tested locally against an empty PostgreSQL database with the same build
  script, storage, cron and access-code settings, but not on Vercel itself (Vercel and Neon were not
  reachable from the build environment).
- **StackBlitz demo mode** was tested with StackBlitz conditions simulated (no .env, PGlite, no native
  Tailwind, development mode), not inside StackBlitz itself. Its stylesheet is precompiled; re-run
  `npm run css:prebuilt` after UI changes.
- **Database document storage** (used on Vercel) suits demonstrations and modest volumes; production
  should use object storage.

## Backlog, in suggested order

### Phase 2 (pilot)
1. OIDC sign-in and role mapping (Decision 2)
2. Real e-signature adapter and webhook (Decision 7); outbox for envelope creation
3. Email adapter; notification preferences screen
4. Legacy contract import with validation and an exceptions queue
5. Amendment application (Scenario 5) and SOW roll-up under MSAs (Scenario 4 monitoring)
6. SaaS renewal flow (Scenario 3): renewal request pre-filled from the subscription, utilization review
7. Organization, user and role administration screens
8. Automated accessibility checks in CI; S3 storage; ClamAV

### Phase 3 (expand)
- Obligation editing, evidence upload and escalation rules
- Vendor performance and SLA scorecards; insurance and certification reminders
- ERP adapter for POs and invoices (after ERP selection)
- Configurable report builder, saved views
- AI-assisted metadata extraction and clause comparison — optional, admin-enabled, human-verified,
  never approving or signing (charter §11)
