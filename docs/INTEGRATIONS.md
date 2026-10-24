# Integrations

Every external system is behind an interface. Development implementations are labeled and refuse to
run in production unless explicitly enabled. Nothing here assumes credentials or licenses exist.

| Integration | Interface | Development | Production status |
| --- | --- | --- | --- |
| Single sign-on | `src/app/api/auth/oidc/*`, `src/lib/auth/session.ts` | Demo account picker (`AUTH_MODE=dev`) | Stub returns 501. Needs IdP registration (Decision 2). |
| E-signature | `src/lib/esign/provider.ts` | `MockESignProvider` (DEMO_EXECUTED only) | `DocuSignProvider` stub. Needs provider choice and account (Decision 7). |
| Email | `src/lib/email.ts` | Outbox (recorded, not sent) | `SmtpEmailAdapter` stub. |
| Document storage | `src/lib/storage.ts` | Local directory, AES-256-GCM per file | `S3Storage` stub. |
| Malware scanning | `src/lib/scan.ts` | Recognizes the EICAR test string only — **not antivirus** | Needs ClamAV or the County's scanning service. |
| ERP (POs, invoices, suppliers) | `purchase_order_ref.source`, `vendor.erp_supplier_id` | Manual entry | Pending the Oracle EBS replacement selection. |
| SaaS usage | `subscription_license.usage_source` | Manual entry | Vendor admin APIs, later. |

## Enterprise SSO (OIDC)

1. Register "DOTComm Contracts" with the identity provider (Entra ID, Okta or ADFS) as a confidential
   web client; redirect URI `https://<host>/api/auth/oidc/callback`.
2. Set `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (from the secrets store),
   `OIDC_REDIRECT_URI`.
3. Implement `login` (discovery, state + PKCE in an httpOnly cookie, redirect) and `callback` (validate
   state, exchange code, verify the ID token's issuer, audience, nonce and expiry with `jose`), then match
   `app_user.external_subject` (or email on first login) and call `startSession(user.id, "oidc")`.
4. Decide whether roles stay in the CLM or map from IdP groups (Decision 2).

Demo-login sessions are rejected automatically once `AUTH_MODE` is no longer `dev`.

## E-signature provider

Implement `ESignProvider`:

- `createEnvelope` — one document (the exact agreement version Legal cleared, SHA-256 included),
  recipients with routing order (vendor first, then the agency signatory), and a webhook callback
  reference (our `signature_request.id`).
- `voidEnvelope`, `fetchCompletedArtifacts` (executed PDF and certificate of completion).
- Webhook `/api/v1/esign/webhook`: verify the provider's HMAC signature, map the envelope to the
  request, then call `applySignerSigned()` per completed recipient. The CLM re-checks signing authority
  and records execution only when the provider reports completion.

Known gap: the envelope is created inside the database transaction; if the transaction fails after the
provider accepted the envelope, the envelope must be voided manually. Move to an outbox pattern when
the real provider is connected.

## Email

Notifications are written to `notification` and `notification_delivery` first, then sent by the job
runner, so a mail outage never blocks a workflow. Implement `EmailAdapter.send` with the City/County
relay or Microsoft Graph. Links use `APP_BASE_URL`.

## Storage

Production should use S3-compatible object storage with bucket versioning, server-side encryption
(KMS) and no public access. Implement `S3Storage.put/get`; keys are server-generated and never reused.
The application verifies each file's SHA-256 on every download.

## ERP

The CLM references ERP records; it never becomes the source of spend.

- `vendor.erp_supplier_id` → supplier master
- `purchase_order_ref` (`source = "erp"`) → purchase orders
- Planned adapter: nightly read of POs and invoice totals per supplier and PO, shown beside commitments.
  Build it against the ERP chosen in the current procurement rather than Oracle EBS.
