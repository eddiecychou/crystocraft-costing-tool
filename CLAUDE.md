# Crystocraft Operation Center — orientation

Read this first in a new conversation. It is the map, not the content.

## What this is

An internal operations app for Crystocraft (United Art Metals Factory Ltd),
React + Vite + Firebase, deployed on Netlify. It began as a costing tool and now
covers catalogue, component/BOM costing, supplier quotes, client quotes, CRM,
production, inventory, shipping, a customer portal, and read-only access to the
legacy JES ERP.

**Current focus: retiring the legacy JES ERP.** The app is becoming the system
of record, one function at a time.

## The documents, in reading order

| File | What it holds |
|---|---|
| `PROJECT-PLAN.md` | The running record. Newest cycle first. **"Where V7.16 starts" is the current entry point.** |
| `JES-RETIREMENT-PLAN.md` | The nine-step route to switching JES off, in plain language |
| `V7.15_ERP_Inventory.md` | What the ERP actually contains — measured, not assumed |
| `erp-sync/ERP-SYNC-V1.0.md` | How the ERP mirror works |
| `erp-sync/IMAGE-SYNC-PLAN.md` | Item images: prepared, needs the LAN |
| `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md` | Customizer — **on hold** |

## Environment quirks that will otherwise waste your time

**Two Macs, and git is the sync mechanism** — not a shared folder. iCloud was
found corrupting `.git`; the repo lives in `~/Developer/costing-tool` on both.
`git pull` before starting, `git push` when done. See the top of `PROJECT-PLAN.md`.

**This Mac has no Node.** No `npm`, no `npx`, no dev server, no build. Changes
are syntax-checked with the native esbuild binary:

```
ESB=$(ls -d node_modules/@esbuild/*/bin/esbuild | head -1)
$ESB src/pages/Foo.jsx --loader:.jsx=jsx --format=esm --outfile=/dev/null
```

That proves it *parses*, not that it *works*. The owner verifies on the deployed
site. Say so plainly in commit messages rather than implying it was tested.

**Python environments do work:**
- `erp-sync/.venv` — psycopg2, python-tds, dotenv. Use it for anything touching
  the ERP mirror.
- `render-service/.venv` — numpy, PIL, for the customizer engine.

**Supabase is reachable from anywhere** (`SUPABASE_DB_URL` in `erp-sync/.env`).
**The SQL Server is LAN-only** — `192.168.10.251`, office Mac only. Check before
planning work that needs it.

## Data facts worth not rediscovering

- **The ERP mirror is all `text`.** Every one of 7,510 columns. Casting happens
  in the curated views (`erp-sync/api_views.sql`). Every new view must cast.
- **Prefer JES's ledgers over its balance tables.** `itemwhbal` looks like stock
  on hand and is a stale snapshot; the movement ledger `itemtransaction` is
  correct. The same pattern has appeared more than once.
- **Column names lie.** `lastupdateby` contains the substring "date" and holds
  usernames. Validate values, not names.
- Accounting is **not** in JES — the books are in PBIS, on Cindy's machine.
- The team's "PI" is JES's **SO**; "invoice" is **SI**.

## Conventions

- Work commits straight to `main`; pushing deploys via Netlify.
- Curated ERP views live in `erp-sync/api_views.sql`, applied by running the file
  against Supabase. The browser never queries Supabase directly — everything goes
  through the admin-gated `/api/erp`, `/api/uc`, `/api/bank` edge functions.
- App name and version: `src/appInfo.js`. Bump on a cycle close.
- Secrets: `erp-sync/.env` and `.env.local`, both gitignored.
