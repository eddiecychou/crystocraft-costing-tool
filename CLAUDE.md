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
| `PROJECT-PLAN.md` | The running record. Newest cycle first. **"Where V8.5 starts" is the current entry point.** |
| `JES-RETIREMENT-PLAN.md` | The nine-step route to switching JES off, in plain language |
| `V7.15_ERP_Inventory.md` | What the ERP actually contains — measured, not assumed |
| `PBIS-IMPORT-FORMAT.md` | The JES→PBIS import contract — what an app-generated invoice must reproduce |
| `erp-sync/ERP-SYNC-V1.0.md` | How the ERP mirror works |
| `erp-sync/IMAGE-SYNC-PLAN.md` | Item images: prepared, needs the LAN |
| `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md` | Customizer engine design — build history, superseded by current status below |
| `Crystal_Fabric_Studio_Spec.md` | Swatch library + Physical Design Workbench build history (all closed under V7.21). Workbench paused mid-build: templates/canvas/zones/zone-rendering done, mode-unification and photo-compositing (workstreams 3/5) not started — see doc's own §5j. V7.22 fixed four real bugs in the render engine/admin tool itself (stone size, colour, caching, auth) without touching workstreams 3/5 — see `PROJECT-PLAN.md`'s V7.22 §2 and "Where V7.23 starts" |

## Environment quirks that will otherwise waste your time

**Two Macs, and git is the sync mechanism** — not a shared folder. iCloud was
found corrupting `.git`; the repo lives in `~/Developer/costing-tool` on both.
`git pull` before starting, `git push` when done. See the top of `PROJECT-PLAN.md`.

**This Mac has no permanent Node**, but one can be fetched into the scratch
directory in about ten seconds, and `node_modules/` is already installed:

```
curl -sL https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.gz | tar xz -C "$SCRATCH"
export PATH="$SCRATCH/node-v24.18.0-darwin-arm64/bin:$PATH"
```

Without it, changes are only syntax-checked with the native esbuild binary:

```
ESB=$(ls -d node_modules/@esbuild/*/bin/esbuild | head -1)
$ESB src/pages/Foo.jsx --loader:.jsx=jsx --format=esm --outfile=/dev/null
```

**That proves it PARSES and nothing else.** It does not resolve identifiers — a
missing import reports clean and is a blank page at runtime — and it says
nothing about layout. Both have shipped broken this way. Fetch Node and
actually run the thing whenever the change is checkable: `qa/README.md` renders
a catalogue PDF page to a PNG you can look at, and the same pattern suits
anything else with real output. Say plainly in commit messages what was
verified and what was not.

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
- The team's "PI" is JES's **SO**; "invoice" is **SI**. **"PI" has a third
  meaning**: in `itemtransaction` it is production-in, and in the PBIS import it
  is a purchase. Check which one is meant before building against it.
- **JES stock is not maintained except for crystals.** The team's real figures
  live in Excel — XiangXia's for metals, ChunCi's for B2C finished goods. Three
  of the four people who use JES keep a spreadsheet it does not know about.
- **An invoice requires a UC number, not a sales order.** `salesinvoice` has no
  SO column at all; its `siref` holds the UC, and 0 of 516 invoices since 2024
  lack one. Retail sales are invoiced with no order behind them.
- **Never take an exchange rate from JES.** Its own rate fields are unusable
  (USD orders default to `1`), and the books use Cindy's audit-year table, which
  cannot be sanity-checked against market rates — GBP was 14.00 in 2024-25.
  Copy her table verbatim; never compute.
- The `_notuse` suffix on `systemsetting` columns is a lie — they hold the live
  image paths. Same family as `lastupdateby` holding usernames.

## Conventions

- Work commits straight to `main`; pushing deploys via Netlify.
- Curated ERP views live in `erp-sync/api_views.sql`, applied by running the file
  against Supabase. The browser never queries Supabase directly — everything goes
  through the admin-gated `/api/erp`, `/api/uc`, `/api/bank` edge functions.
- App name and version: `src/appInfo.js`. Bump on a cycle close.
- Secrets: `erp-sync/.env` and `.env.local`, both gitignored.
