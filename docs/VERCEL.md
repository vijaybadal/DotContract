# Deploying the demo to Vercel + Neon

About 15 minutes. You need a Vercel account and a GitHub account (or Node.js on your computer for
the CLI route). The result is a shared demonstration site with synthetic data.

> **Plan check.** Vercel's free Hobby plan is limited to non-commercial personal use, and Vercel counts
> work by a paid employee as commercial. For a DOTComm demo, use a Pro team or confirm with Vercel
> Support. See [Fair use: commercial usage](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).

> **Data check.** This is a demonstration host. Use only the synthetic demo data. Real contracts, vendor
> pricing or signing authorities belong on DOTComm-approved hosting (Decision 1 in DECISIONS.md).

## 1. Generate four secrets

On any computer with OpenSSL (macOS, Linux, Git Bash on Windows):

```bash
openssl rand -base64 36   # SESSION_SECRET
openssl rand -hex 32      # STORAGE_KEY (must be exactly 64 hex characters)
openssl rand -base64 24   # CRON_SECRET
```

Pick an **access code** to share with your audience, e.g. `omaha-clm-demo`.

## 2. Get the code onto Vercel

**Option A — GitHub (recommended: every push redeploys).** Create an empty **private** repository, then
from the unzipped folder:

```bash
cd dotcomm-clm
git init && git add -A && git commit -m "DOTComm CLM Phase 1"
git branch -M main
git remote add origin https://github.com/<you>/dotcomm-clm.git
git push -u origin main
```

In Vercel: **Add New… › Project › Import** the repository. Vercel detects Next.js; leave the build
settings as they are (`vercel.json` supplies the build command) and click **Deploy**. This first deploy
builds without a database, so the site won't work yet — steps 3–5 fix that.

**Option B — Vercel CLI (no GitHub).** From the unzipped folder: `npx vercel` and answer the prompts
(it creates the project and uploads the code). Continue with step 3, then run `npx vercel --prod`.

## 3. Add the database

Project › **Storage** › **Create Database** › **Neon** (Serverless Postgres). Choose the region closest to
the functions (default Vercel region is Washington, D.C. — pick AWS US East 1), the free plan is enough,
and connect it to **all environments**. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`
automatically.

## 4. Set environment variables

Project › **Settings** › **Environment Variables** (Production, and Preview if you want previews):

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | from step 1 |
| `STORAGE_KEY` | from step 1 |
| `CRON_SECRET` | from step 1 |
| `DEMO_ACCESS_CODE` | your access code (strongly recommended) |
| `AUTH_MODE` | `dev` |
| `ALLOW_DEMO_LOGIN` | `true` |
| `ESIGN_PROVIDER` | `mock` |
| `ALLOW_MOCK_ESIGN` | `true` |
| `SEED_DEMO` | `true` |

Not needed: storage settings (Vercel automatically stores documents encrypted in the database) and
`APP_BASE_URL` (taken from the production domain).

## 5. Deploy

**Deployments › Redeploy** (or push to `main`, or `npx vercel --prod`). The build log should show:

```
vercel-build: migrations applied.
vercel-build: synthetic demo data loaded.
```

Later deploys print `demo data already present; leaving it as is.`

## 6. Check it

- `https://<your-project>.vercel.app/api/health` → `{"status":"ok","database":"ok"}`
- Open the site, enter the access code, pick a demo account, and follow [DEMO.md](DEMO.md).

## Running a demo

- **Reset to fresh demo data**: add `RESEED_DEMO=true`, redeploy, then **delete the variable** (otherwise
  every deploy wipes the data).
- **Reminders** run once a day at about 7 a.m. Central (the Hobby plan allows daily jobs only; Pro can run
  them hourly — change `schedule` in `vercel.json` to `0 * * * *`). Contract administrators can also
  press **Run reminders now** on the Renewals page.
- **Uploads** are limited to 4 MB per file on Vercel (the platform caps requests at 4.5 MB).

## How the app adapts to Vercel

| Vercel constraint | What the app does |
| --- | --- |
| No lasting disk | Documents are encrypted (AES-256-GCM) and stored in the `stored_object` table; append-only |
| No background process | `vercel.json` cron calls `/api/cron/jobs` with `CRON_SECRET` |
| Many short-lived function instances | Small connection pool against Neon's pooled endpoint |
| No separate setup step | `npm run vercel-build` migrates (direct connection) and seeds when empty |
| 4.5 MB request limit | Upload cap set to 4 MB automatically |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build fails at `vercel-build` with a connection error | The Neon integration isn't connected to this environment (Storage tab) |
| `STORAGE_KEY must be 64 hex characters` | Regenerate with `openssl rand -hex 32`; no quotes or spaces |
| Sign-in page shows "Sign in with single sign-on" | `AUTH_MODE=dev` or `ALLOW_DEMO_LOGIN=true` is missing |
| "No e-signature provider is configured" when sending | `ALLOW_MOCK_ESIGN=true` is missing |
| Cron shows 401 in logs | `CRON_SECRET` is missing or shorter than 16 characters |
