/**
 * Enterprise SSO entry point (OIDC authorization-code flow with PKCE).
 *
 * Not implemented in Phase 1 because no identity provider is available to test against. To enable:
 *  1. Register the app with the City/County IdP (Entra ID, Okta, ADFS) and set OIDC_ISSUER,
 *     OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (from the secrets store) and OIDC_REDIRECT_URI.
 *  2. Here: discover the issuer, create state + PKCE verifier (httpOnly cookie), redirect.
 *  3. /api/auth/oidc/callback: validate state, exchange the code, verify the ID token with jose
 *     (issuer, audience, nonce, expiry), match app_user.external_subject (or email on first login),
 *     then call startSession(user.id, "oidc").
 * Role assignments stay in the CLM unless Decision 2 (docs/DECISIONS.md) maps them from IdP groups.
 */
export function GET() {
  return new Response(
    "Single sign-on is not configured on this server. See docs/INTEGRATIONS.md (Enterprise SSO).",
    { status: 501, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
