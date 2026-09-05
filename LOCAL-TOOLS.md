# Local tooling already available

Read this before telling the user how to install something, or before assuming
a tool isn't there. This file is the record of what's already set up on this
Mac's shell — check here first.

## Node

A real Node is on `PATH` already (not just the scratch-fetch CLAUDE.md
describes for quick syntax checks) — `node -v` returns a recent version
without any setup. `npx` works directly, no scratch-directory dance needed.

Confirmed 2026-08-26: `node -v` → v26.7.0, `npx` on PATH at
`/opt/homebrew/bin/npx`. A separate `~/node-scratch/node-v24.18.0-darwin-arm64`
also exists from an earlier session — either works, no need to re-fetch.

## Firebase CLI

Available via `npx firebase-tools` — no global install, already logged in as
`eddie.cy.chou@gmail.com`. Deploy Firestore rules after any `firestore.rules`
change:

```bash
cd ~/Developer/costing-tool   # firebase.json lives here — must run from repo root
npx firebase-tools deploy --only firestore:rules --project crystocraft-costing
```

A successful deploy that changed nothing prints "latest version of
firestore.rules already up to date, skipping upload" — that's not an error,
it means the live rules already matched.

**Storage rules deploy too now** (`storage.rules`, wired into `firebase.json`
2026-08-27 — it used to be a manual-paste-into-console-only file, which
caused at least one real bug: a missing rule silently rejecting an upload
with no helpful error). Deploy both together:

```bash
npx firebase-tools deploy --only firestore:rules,storage --project crystocraft-costing
```

The target name is `storage`, not `storage:rules` — that fails with
"Could not find rules for the following storage targets: rules" (there's no
Storage deploy target actually named that, unlike Firestore where
`firestore:rules` is correct). Learned this the hard way; don't re-guess it.

## Google Analytics 4 (read access)

Set up 2026-08-27 so Claude can pull real portal usage data instead of
guessing from app-level instrumentation alone (that session's actual
trigger: diagnosing why Login Activity showed nothing for real logins).
The Firebase service account (`firebase-adminsdk-fbsvc@crystocraft-
costing.iam.gserviceaccount.com` — same one `firebase-service-account.json`
already holds) is a Viewer on **GA4 property `547709480`** (the portal's
site, measurement ID `G-HRTV0QWTNG` in `index.html`), and the "Google
Analytics Data API" is enabled on the `crystocraft-costing` Cloud project.

Query it with the same service account file, `analytics.readonly` scope,
against the Data API's `runReport` endpoint:

```js
import { readFileSync } from 'fs'
import { GoogleAuth } from 'google-auth-library'
const sa = JSON.parse(readFileSync('/Users/eddie/Developer/costing-tool/firebase-service-account.json'))
const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] })
const client = await auth.getClient()
const res = await client.request({
  url: 'https://analyticsdata.googleapis.com/v1beta/properties/547709480:runReport',
  method: 'POST',
  data: {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
  },
})
```

Run it the same way as the other one-off admin scripts in this repo's
history: copy into a `.mjs` file inside `~/Developer/costing-tool` (so
`node_modules` resolves — `google-auth-library` is already a transitive
dep via `firebase-admin`), run with `node`, then delete the script. Swap
`dimensions`/`metrics` for whatever the question actually needs — see the
[GA4 Data API reference](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
for the full metric/dimension list (`activeUsers`, `sessions`, `screenPageViews`,
`eventCount`, `newUsers`, etc., dimensioned by `date`, `pagePath`,
`sessionSource`, `deviceCategory`, and more).

If a query ever fails with "Google Analytics Data API has not been used in
project... or it is disabled": it almost never means what it says once
you've confirmed the API's toggle in the Cloud Console shows "Disable API"
(i.e. already on) — that exact error came back for several minutes after
the owner had already enabled it, until it simply propagated. Don't
conclude it's broken from one retry.

Logged in account can see two projects: `crystocraft-costing` (this app,
default per `.firebaserc`) and `crystocraft-expenses` (separate project, not
otherwise referenced from this repo — don't assume it's related unless the
user brings it up).

## Fly.io CLI

`flyctl` (also aliased `fly`) is a real installed binary at `~/.fly/bin/`, not
on `PATH` by default — add it per-session:

```bash
export PATH="$HOME/.fly/bin:$PATH"
```

Logged in as `eddie.cy.chou@gmail.com`. Runs the customizer render service —
`render-service/fly.toml` deploys to the Fly app `crystocraft-customizer-render`
(confirmed live via `flyctl apps list`, last deploy 2026-08-10). Deploy with:

```bash
cd ~/Developer/costing-tool/render-service
flyctl deploy
```

## GitHub

No `gh` CLI installed — but plain `git push`/`git pull` against
`github.com/eddiecychou/crystocraft-costing-tool` already works with no
prompt, via a credential cached in the macOS keychain (`osxkeychain` helper).
Don't suggest installing `gh` or setting up a token; just use `git` directly.

## Netlify

**Not logged in** via CLI (`npx netlify-cli status` → "Not logged in") — don't
assume `netlify deploy` or `netlify env` commands will work without first
walking through `netlify login`. Deploys happen automatically instead: this
repo is linked to a specific Netlify site (`.netlify/state.json`, gitignored,
siteId `4a234708-a213-477f-91a5-97cdc939c1db`) via its GitHub integration — a
`git push` to `main` is what triggers the deploy, not a CLI command. This
matches CLAUDE.md's "pushing deploys via Netlify" convention; no separate
Netlify action is normally needed.

## The dev server serves edge functions now — don't mistake a 404 for a bug

`.claude/start-dev.sh` runs `npx netlify-cli dev --offline` (not plain
`vite`) so the Browser-tool preview actually serves `netlify/edge-functions/
*.js` at `/api/*`, same as production. Before 2026-08-26 it ran plain `vite`,
which has no route for `/api/*` at all — every edge function call 404'd, not
just the one that happened to get noticed ("WooCommerce sync failed (404)"
turned out to be this, not a WooCommerce or app bug).

`--offline` is required: without it, `netlify dev` tries to pull the site's
env vars from the Netlify account and fails outright since the CLI isn't
logged in (see Netlify section below). `--offline` skips that and injects
`.env.local` directly instead — confirmed working: `/api/fx-rates` (no
secrets needed) returns real live rates; `/api/woo-sync` returns a real,
meaningful "WooCommerce credentials not configured" error rather than a 404,
because `WC_BASE_URL`/`WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET` are presumably
Netlify-dashboard-only secrets, not in `.env.local` — that's expected, not a
bug, and doesn't mean the live site is broken.

First boot is slower ("Setting up the Edge Functions environment... may take
a couple of minutes") — give it real time before concluding a function is
broken, don't retry immediately.

If a genuinely new edge-function secret is needed for local testing, add it
to `.env.local` the same way the existing ones are (never to `netlify.toml`
or committed anywhere) — see `.env.local`'s existing entries for the pattern.

## Logging into the app itself for real browser testing

There's a dedicated QA admin account so Claude can click through changes in
the actual app instead of only syntax-checking and asking the owner to test —
"you always say you can't see what's in the Operation Center" (owner,
2026-08-26). Credentials in `.env.local` (gitignored):

```
QA_ADMIN_EMAIL=claude-qa@crystocraft.com
QA_ADMIN_PASSWORD=...
```

Its Firestore doc is `users/VnbkhRPUxnWStsrEVvGK5gHptrl2`, `role: admin`,
labeled `"Claude QA — automated smoke-testing account, not a person"` so it's
identifiable in any admin user list. Use it via the Browser tool
(`preview_start` with the `crystocraft-costing` launch config, then fill the
sign-in form and submit) to actually verify a change before reporting it
done, not just esbuild-parse it.

**Password set 2026-09-06, login verified working.** The Firebase console for
this project only offers email "Reset password" and the `claude-qa@` mailbox
doesn't exist, so it was set via the Admin SDK: a Firebase service-account key
lives (gitignored, kept on purpose) in the repo root as
`crystocraft-costing-firebase-adminsdk-*.json`, and a one-off `firebase-admin`
script called `getAuth().updateUser('VnbkhRPUxnWStsrEVvGK5gHptrl2',
{ password })`. Use the modular `firebase-admin/app` + `firebase-admin/auth`
imports and run from the repo root. Same method to rotate the password, or for
any other one-off admin action. The key file is on this Mac only — it is not
git-synced to the other Mac (regenerate one there if ever needed).

**This is a real admin login against the live Firebase project — there is no
emulator, no fake data.** Use it for read-only verification: navigating,
clicking, filtering, screenshotting, confirming something renders/saves
correctly. Don't send real emails, trigger real WooCommerce/ERP syncs, or
delete/edit real customer records with it unless the owner specifically asks
to test that action. Say plainly what was actually clicked through in the
browser versus what was only syntax-checked.

## Updating this file

When a new tool gets set up in a session (installed, logged in, confirmed
working), add it here rather than re-discovering it next time. Keep entries
short: what the tool is, how to invoke it, and any gotcha (wrong directory,
needs login, etc). This file is checked into git so it survives across the
two-Mac sync same as everything else in CLAUDE.md's reading list.
