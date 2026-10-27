# Running the demo on StackBlitz

StackBlitz runs the whole app inside your browser tab: the web server, and an in-browser PostgreSQL
database (PGlite). There is nothing to install and no account to configure. The app detects StackBlitz
and switches into demo mode on its own.

**What to expect**

- Each visitor gets a **private copy** with fresh synthetic demo data. Nothing is shared between people.
- The app runs in the StackBlitz editor tab. Keep that tab open: closing it stops the app, including any
  preview you opened in a new tab.
- Data lasts while the editor tab is open. Reloading the project or closing the tab starts over.
- First start takes a few minutes (installing packages, then building pages as you open them).
- It's for walkthroughs and evaluation. For a site a team uses together, see [VERCEL.md](VERCEL.md).

> **Public by default.** Projects opened from a public GitHub repository, and free StackBlitz projects,
> can be seen by anyone with the link. That's acceptable here only because every person, vendor, amount
> and signing authority in the demo is invented. Never add real contracts or credentials.

## Option A — From GitHub (recommended)

1. Put the code in a GitHub repository. From the unzipped `dotcomm-clm` folder:

   ```bash
   git init && git add -A && git commit -m "DOTComm CLM Phase 1"
   git branch -M main
   git remote add origin https://github.com/<you>/dotcomm-clm.git
   git push -u origin main
   ```

   A **public** repository opens on any StackBlitz plan. A **private** repository needs a paid StackBlitz
   membership and your GitHub account connected to StackBlitz.

2. Open this address, preferably in Chrome or Edge (StackBlitz works best in Chromium browsers):

   ```
   https://stackblitz.com/github/<you>/dotcomm-clm
   ```

3. Wait for it to start. The terminal at the bottom shows the steps:
   - package install (a few minutes the first time)
   - `[clm] loading synthetic demo data…` then `[clm] demo data loaded`
   - `Ready` — the preview pane opens on the sign-in page.

4. Click **Open in New Tab** (the arrow icon above the preview). The app works best full-size, and a
   full tab avoids browsers that block cookies inside embedded previews.

5. Pick a demo account (try **Priya Natarajan**) and follow [DEMO.md](DEMO.md). The first visit to each
   page takes a few seconds while it builds; after that it's quick.

**Shareable link:** send `https://stackblitz.com/github/<you>/dotcomm-clm`. Everyone who opens it gets
their own fresh copy. To hand someone an editable copy instead, use
`https://stackblitz.com/fork/github/<you>/dotcomm-clm`.

## Option B — Upload the folder (no GitHub)

1. Go to stackblitz.com, sign in, and create a new **Node.js** project (a blank WebContainer project).
2. Delete the starter files.
3. Drag the **contents** of the unzipped `dotcomm-clm` folder (not the zip, and not the folder itself)
   into the file tree on the left. Make sure `package.json` and `.stackblitzrc` end up at the top level.
   Hidden files such as `.stackblitzrc` can be missed by some file browsers: if it's absent, create it
   with the contents shown below.
4. Save the project, then reload it. StackBlitz installs packages and starts the app (steps 3–5 above).

`.stackblitzrc` (already in the repository):

```json
{
  "installDependencies": true,
  "startCommand": "npm run dev",
  "env": { "CLM_STACKBLITZ": "1", "NEXT_TELEMETRY_DISABLED": "1" }
}
```

## Using the demo

- **Start over**: reload the project. Or, in the terminal: Ctrl+C, then `rm -rf .pglite-data storage`,
  then `npm run dev`.
- **Reminders and escalations** don't run on a schedule here. Sign in as **Dana Whitfield** and press
  **Run reminders now** on the Renewals page.
- **Uploads** are limited to 10 MB in this mode.
- **Several tabs at once** work, but the in-browser database handles one request at a time, so heavy use
  can feel slower than the hosted version.

## How demo mode works

| On StackBlitz | What the app does |
| --- | --- |
| Can't run a PostgreSQL server | Uses PGlite (PostgreSQL compiled to WebAssembly) in-process; the same migrations, triggers and constraints apply |
| No setup step | On start, `src/instrumentation-node.ts` applies migrations and loads the demo data into the empty database |
| No `.env` file | Demo-only settings are filled in automatically (`src/lib/runtime.ts`); they are public and protect nothing |
| Tailwind's native compiler can't run in the browser | Uses the precompiled stylesheet `src/app/globals.prebuilt.css` |
| The preview is shown inside StackBlitz's editor | Allows framing by StackBlitz domains only, and marks cookies `SameSite=None; Secure` |

Demo mode turns on when `CLM_STACKBLITZ=1` (set by `.stackblitzrc`) or when the app detects it is running
in a WebContainer. Nothing changes on any other host.

**If you change the UI**, regenerate the precompiled stylesheet on your own computer before pushing:
`npm run css:prebuilt`.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| Terminal stops with an install error | Reload the project; StackBlitz occasionally times out fetching packages |
| Page has no styling | `globals.prebuilt.css` is missing or stale. Run `npm run css:prebuilt` locally and push |
| Stuck on the sign-in page after choosing an account | Your browser blocked the preview's cookie: use **Open in New Tab** |
| "Invalid Server Actions request" | Open in a new tab; if it persists, report the preview's domain so it can be added to `allowedOrigins` in `next.config.ts` |
| `[clm] loading synthetic demo data` never finishes | Stop the terminal, run `rm -rf .pglite-data`, then `npm run dev` |

## What was tested

Demo mode was tested on a regular computer with StackBlitz conditions simulated: no `.env` file, an
empty in-browser database, Tailwind's native compiler removed, and development mode. The full automated
suite (80 tests) passes on PGlite, and the browser test completes the whole request-to-signature flow.
It has **not yet been run inside StackBlitz itself**, so the first launch is the remaining check —
the items most likely to need a tweak are listed in the troubleshooting table.
