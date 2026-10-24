# Deployment

For a shared demonstration site without managing a server, see [VERCEL.md](VERCEL.md).

## Components

| Component | Notes |
| --- | --- |
| Web app | `node server.js` from the standalone build (`NEXT_OUTPUT=standalone npx next build`). Stateless; scale horizontally. |
| PostgreSQL 16 | Single source of record. Enable point-in-time recovery and daily backups. |
| Job runner | `npx tsx scripts/run-jobs.ts` hourly (Kubernetes CronJob, systemd timer or the `jobs` compose service). Idempotent; overlapping runs are safe. |
| Object storage | S3-compatible bucket with versioning and encryption (see INTEGRATIONS.md). |

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 32+ random characters; rotate to invalidate all sessions |
| `STORAGE_KEY` | 64 hex characters (256-bit) for the local encrypted storage adapter |
| `STORAGE_DIR` / `STORAGE_PROVIDER` | `local` (directory), `db` (encrypted in PostgreSQL; default on Vercel), or `s3` once implemented |
| `CRON_SECRET` | Required for `/api/cron/jobs` (hosts without a long-running job process) |
| `DEMO_ACCESS_CODE` | Optional: visitors enter it before the demo account picker |
| `SEED_DEMO` / `RESEED_DEMO` | Used by `npm run vercel-build` to load or reload synthetic demo data |
| `AUTH_MODE` | `oidc` in production; `dev` shows the demo account picker |
| `ALLOW_DEMO_LOGIN` | Must be `true` for `AUTH_MODE=dev` on a production build. Demonstration servers only. |
| `ESIGN_PROVIDER` / `ALLOW_MOCK_ESIGN` | The mock is refused in production unless `ALLOW_MOCK_ESIGN=true`. Demonstration servers only. |
| `EMAIL_PROVIDER` | `outbox` (record only) or `smtp` once implemented |
| `APP_BASE_URL` | Used in email links |

Secrets come from the approved secrets store, never from files in the image.

## First deployment

```bash
npx tsx scripts/migrate.ts      # applies drizzle/*.sql in order
# Production: load organizations, users, roles, workflows and signing authority from the
# Phase 0 deliverables. Do not run the demo seed.
```

## Database privileges

Run the application with a role that owns no tables and cannot disable triggers. The append-only and
revoke-only guards are triggers; an owner or superuser can bypass them, which the audit hash chain would
then reveal. Recommended: a migration role (owner) used only by `migrate.ts`, and an app role with
`SELECT, INSERT, UPDATE` on business tables and `SELECT, INSERT` on the append-only tables.

## Container files

`Dockerfile` and `docker-compose.yml` are provided. The standalone server bundle they depend on has been
built and served successfully against PostgreSQL, but the image itself has **not yet been built** (no
Docker daemon was available in the build environment). Build and scan it in CI before use.

## Health

`GET /api/health` returns `{"status":"ok","database":"ok"}` or 503.
