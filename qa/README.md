# Automated product search regressions

```sh
npm ci
npm run test:product-search
```

The suite renders the actual admin Crystocraft Range / Corp Gifts and customer
Crystocraft Range / Corporate Gifts pages in JSDOM. Firebase, pricing feeds and
image/export widgets use local fixtures; the production search predicates,
React row keys, category/status filters, URL constraints, storage, visibility
screening and pagination run unchanged. No Firebase credentials are required;
network calls and data writes fail the test.

Coverage includes repeated/case-insensitive queries, clearing, no matches,
duplicate names/design codes/SKUs, searching beyond the first page, pagination
reset, delayed data loading with valid saved filters, obsolete saved categories,
restored searches on remount, new products entering a live search, status and
URL design/format constraints, and sensitive-customer image restrictions.
React errors (including duplicate-key warnings) fail the suite. Existing quote
variant identity/price and filter tests run in the same command.

`npm run build` runs this suite first through `prebuild`, so failed search checks
stop a normal application build/deploy, including Netlify Git deployments.
GitHub Actions runs both product-search and customer-merge-emulator on every
push and pull request, with a manual Run workflow option. Before any deployment,
both jobs must pass on the exact release SHA: `npm run release:ci -- --wait`.
Use [skip netlify] when pushing the CI candidate. Netlify's build command checks
CI before building; manual --no-build uploads require an immediate explicit
preflight. `npm run test:release-ci` tests failed/missing/stale/pending/error paths
and proves the actual build command cannot reach its build step on failed CI. See
`.github/workflows/product-search.yml`. Its first Ubuntu/Node20 run passed:
https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38706116158

The workflow was enabled through the connected GitHub app. The owner later
authorized adding `Workflows: Read and write` to the Mac's `portal-macbookpro`
fine-grained token; it is now saved alongside the existing code read/write
permission. The token's existing repository scope and expiry were preserved. The suite checks component behavior, not visual
layout, real login or Firebase rules; release verification below remains
required when publishing an app.

# CRM component maintenance

`npm run test:customer-workspace` includes `qa/crm-components.test.mjs`.
It renders real extracted viewers/cards/dialogs through fictional Firebase,
domain and AI boundaries. Coverage includes subscriptions/cleanup, summaries,
tombstones, individual transcription, paste/history actions, collapse keys,
brand/design links, merge preview and explicit invitation pricing. No live
data, mail, transcription or AI calls. Initialize the DOM before importing
React DOM/router; component runtime errors fail the tests.

The workspace emulator fixture retains the real collapse wrapper and dates,
so actual page task/summary checks cannot hide them behind null stubs.
See the [maintenance map](../docs/reference/MAINTENANCE-MAP.md).

Whole-source missing-name check with this Mac's existing lint install:

```sh
node .qa-eslint/node_modules/eslint/bin/eslint.js --no-inline-config -c qa/eslint.no-undef.mjs src netlify
```

This runs the no-undef configuration; unrelated inline suppressions for plugins
not installed in that lint environment are ignored.

# Portal applicant information requests

`npm run test:portal-followup` renders the real `PortalAccountFollowup` with only
the API isolated. It checks explicit reviewed sending, draft remount, latest
edited values, duplicate prevention, focused errors, recovery and history.
`node --test qa/portal-followup-emulator.mjs` requires loopback Firestore and runs
actual Admin SDK transactions plus the existing endpoint with isolated auth/mail.
It verifies exact recipient/payload, revision/lease/idempotency, uncertain results,
private rules and preserved account/pricing/CRM state. Both are wired into the
existing GitHub jobs. Run the latter inside `firebase emulators:exec --only
firestore --project crystocraft-rbac-test` with a real Java runtime.

`node qa/portal-followup-preview.mjs` serves the actual AccountEdit at
`http://127.0.0.1:5199/portal/accounts/fixture`, with fictional data and simulated
sending only. Verify draft/save/reopen/send/history and 375px layout; never use a
real applicant as a send-test fixture. [Implementation and release state](../docs/plans/V8.20-PORTAL-APPLICATION-FOLLOWUP.md).

# Image download filenames

`npm run test:product-images` also runs `qa/download-image.test.mjs` against the
actual attachment handler with a mocked upstream. Unicode product names (em
dash, Chinese, accents and emoji), ASCII fallback/UTF-8 headers, safe control and
quote handling, byte preservation, normalization and existing source/size/error
restrictions are covered. This command runs in prebuild and the required GitHub
product-search job. It does not replace a real browser candidate/production
download check when releasing the endpoint.

`qa/range-download-click.test.mjs` also runs in that command. It renders the real
customer Range detail page with offline data, verifies the native download
attribute and same-origin attachment links for WordPress/Firebase photos,
Unicode/display-name/caption handling, and checks clicks leave the product and
lightbox state intact without writing records. Candidate and production still
require ordinary Chrome clicks plus saved-file readbacks; a direct HTTP request
or the browser tool's media downloader does not close that check.

For ordinary Chrome click QA, check the per-site repeated-download prompt on a
new preview/pinned origin within the authorized download test. Use a dedicated
QA tab, verify the product page remains open, then decode/hash-check the completed
file. Background clicks/event observers can stall or omit browser prompts;
`downloadMedia`/HTTP success alone is not ordinary-click evidence. Native Chrome
controls require coordination if the owner is using the foreground window.

Full diagnosis, completed-file checklist, tool-stall workaround and evidence
boundaries: [OC image-download skill](../docs/skills/oc-image-downloads/SKILL.md).
In this Mac/Cua session, `downloadMedia` and `waitForEvent('download')` stalled
well beyond requested timeouts; do not repeat those calls as the ordinary-click
proof. Use the supported real tab/native click and bounded local file readback.
Record canonical-site role checks separately from a published artifact's pinned
Chrome origin. See the [completed customer release](../docs/plans/V8.20-RANGE-CUSTOMER-DOWNLOAD-CLICKS.md).

# PO receipt regressions

## Add items to an existing reservation

`node --test qa/order-reservation-add-emulator.mjs` runs in the existing required
customer-merge-emulator job. Loopback Firestore only; actual stock ledger,
reservation addition and rules. Fourteen cases include all three classes,
preservation, duplicate/concurrent additions, failure atomicity, legacy partials,
staff access, release and production-in.

`node qa/order-reservation-add-preview.mjs` serves the actual Crystal/Packaging
cards with isolated local stock and engine boundaries. Expand a reserved card,
add an unused item and confirm. The crystal fixture's original 3,600 / 2,040 / 400
must remain intact; adding 25 to the new crystal changes its reserved 15 → 40,
with on-hand 500 unchanged. No live auth, inventory, order or external API writes.

## PO identity and receipt posting

`node --test qa/po-receive.test.mjs` runs through `test:packing-po` in prebuild
and the product-search workflow job. The customer-merge-emulator job also runs
`node --test qa/po-receive-emulator.mjs` against loopback Firestore with the real
rules, SDK, PO engine and stock ledger. Coverage includes stale colour links,
ambiguous inventory codes, duplicate-SKU summation, concurrent retries, atomic
failure, opening/reserved balances, missing legacy postings, guarded correction,
commercial-term preservation, red-movement preservation and actual-ledger reversal.

`node qa/po-receive-preview.mjs` serves isolated actual PO screens for browser QA.
The default fixture reproduces six colours wrongly linked to red, with only 102
red posted. Review receipt must show red +0 and five additions totalling 314;
after correction, another review must report a matching ledger. The editor at
`/purchase-orders/p/edit?fresh=1` checks code/link/description changes. No live
auth, APIs or stock writes are used by these fixtures.

# Supplier quote saves

Supplier quote save regressions run with `npm run test:supplier-quote` and are
also included in `test:quote-pdf` for prebuild and GitHub CI. They exercise the
actual form with isolated Firebase/router boundaries: reordered attachment maps,
real conflicts, visible/focused save errors, concurrent approved terms, retry,
and exact three-decimal edits. No live records are read or written.

For a manual browser check, `node qa/supplier-quote-precision.mjs --serve` starts
an isolated form with an existing PDF and reordered transaction maps. Its visible
fixture control simulates a genuine concurrent attachment change.

# Rendering a PDF to look at it

> **Every release:** first follow
> [`RELEASE-WORKFLOW.md`](../docs/skills/RELEASE-WORKFLOW.md). Run
> `npm run release:ci -- --wait` before any deployment,
> `node --test qa/firebase-login-config.test.mjs`, the production build, and
> `node scripts/verify-deployed-login.mjs <release-https-url>` on candidate and
> production. Those commands do not authenticate users: fresh admin AND approved
> customer sign-ins, role/data/access/refresh checks and per-role evidence remain
> mandatory. Missing authorized account access is BLOCKED, never PASS.

This Mac has no permanent Node, so PDF layout used to be changed blind: parse
with esbuild, push, and let the owner find the breakage. That cost three bad
deploys on the catalogue in one evening — overlapping rows, then a worse mess,
then an orphaned heading — every one of which is obvious the moment you see a
rendered page.

This renders the real component headlessly and rasterises a page.

## One-time: get a Node

```
SCRATCH=<your scratch dir>
curl -sL https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.gz | tar xz -C "$SCRATCH"
mv "$SCRATCH"/node-v24.18.0-darwin-arm64 "$SCRATCH/node"
export PATH="$SCRATCH/node/bin:$PATH"
(cd qa && npm install pdf-lib)     # page extraction only
```

Nothing is installed into the project: `node_modules/` is already committed to
the repo's lockfile and needs no reinstall.

## Each run

```
ESB=$(ls -d node_modules/@esbuild/*/bin/esbuild | head -1)

# 1. bundle. --jsx=automatic or React is undefined at runtime; the font and
#    logo imports are Vite assets, so they need file loaders.
$ESB qa/render-catalogue.jsx --bundle --platform=node --format=cjs \
  --jsx=automatic --loader:.ttf=file --loader:.png=file --loader:.jpg=file \
  --outfile=/tmp/render.cjs

# 2. render, 3. pull one page out (qlmanage only ever rasterises page 1),
#    4. rasterise
node /tmp/render.cjs /tmp/out.pdf
node qa/extract-page.cjs /tmp/out.pdf 2 /tmp/page.pdf
qlmanage -t -s 1500 -o /tmp /tmp/page.pdf     # -> /tmp/page.pdf.png
```

Then open `/tmp/page.pdf.png`.

## Why the harness uses fake data

`render-catalogue.jsx` builds its own products rather than reading Firestore,
so it needs no credentials and can hold the cases that actually break: a card
with six price rows next to one with a single row, long labels, a retired note,
multi-brand row codes, and an odd trailing card. Real data mostly renders fine
and hides all of them.

## What this caught that esbuild could not

- `flex: 1` left on the text block after the card became a column, which made
  every child render on top of the image.
- `flexWrap` used as a grid: react-pdf does not size a wrapped line to its
  tallest child, so tall cards overlapped the line below.
- A section heading stranded at the foot of a page, which `minPresenceAhead`
  did not fix and binding the heading into the first row's `wrap={false}` did.

esbuild reported every one of those files as fine. It parses; it does not lay
out, and it does not resolve identifiers either.

# Catching an undefined identifier

`no-undef` is the single most valuable check in this project, because the bug
it catches has shipped three times: a name used but never imported. esbuild
parses straight past it. A full esbuild **bundle** does not catch it either —
a free variable is not an unresolved import. The browser throws at runtime, and
on 2026-07-21 that blocked Cindy from saving anything in the UC registry
(`listUc` was called in the save path and never imported).

```
SCRATCH=<your scratch dir>
export PATH="$SCRATCH/node/bin:$PATH"
mkdir -p "$SCRATCH/lint" && (cd "$SCRATCH/lint" && npm init -y && npm i eslint)
"$SCRATCH/lint/node_modules/.bin/eslint" \
  --config qa/eslint.no-undef.mjs --no-config-lookup src netlify
```

Expect zero errors. eslint is deliberately NOT a project dependency — nothing
is added to package.json for a check that runs from a scratch install.

# Checking every import resolves

A full bundle of the app catches unresolved imports across the whole graph,
which per-file parsing cannot:

```
ESB=$(ls -d node_modules/@esbuild/*/bin/esbuild | head -1)
$ESB src/main.jsx --bundle --outdir=/tmp/bundlecheck --loader:.js=jsx \
  --loader:.png=file --loader:.jpg=file --loader:.ttf=file --loader:.svg=file
```

Run both before pushing anything that touches imports.

# Quote PDF units

`npm run test:quote-pdf` checks the actual PDF component for every selectable unit,
per-tier quantity labels, legacy pcs fallback and unchanged monetary totals, then
renders a mixed-unit PDF using the real renderer and local brand fonts. It runs
in prebuild and GitHub Actions. To keep a local sample for visual inspection:

```sh
QUOTE_PDF_EVIDENCE=/tmp/quote-units.pdf npm run test:quote-pdf
pdftoppm -scale-to 1400 -png /tmp/quote-units.pdf /tmp/quote-units
```

### Excel quotation units

`npm run test:quote-excel` clicks the actual QuoteExport Excel download in an offline DOM, then opens the generated XLSX with ExcelJS. It checks all seven selected units, numeric quantities/prices, every tier, decimal/zero quantities, legacy pcs fallback and unchanged sheet structure. `QUOTE_EXCEL_EVIDENCE=/absolute/path.xlsx` saves the mixed-unit fixture for visual verification. These checks run before builds and in GitHub Actions.

### Proforma and sales invoice units

`npm run test:invoice-units` renders the real admin PI/SI and customer invoice print pages with offline Firestore reads. It clicks each actual Excel download, reopens the XLSX, and checks all seven units, numeric quantities/prices/amounts, charges, discounts, sales accounting adjustments, legacy pcs defaults, quote-to-order propagation, PI priced/unpriced CSV and customer ownership refusal. Historical ERP lines without unit evidence remain unspecified. `INVOICE_EVIDENCE_DIR=/absolute/directory` saves the actual generated HTML/XLSX fixtures. Runs before builds and in GitHub Actions.

### Packing list and purchase order units

`npm run test:packing-po` exercises actual packing/PO print pages, packing editor and save path with offline Firestore fixtures. Ten regressions cover all seven units, linked-order legacy recovery, ambiguous-code handling, mixed cartons and multiplication, unit persistence/selection/auto-packing, numeric Excel cells, separate quantity totals, carton/pallet weight and volume, private-field exclusion and English/Chinese PO totals/deposits. `PACKING_PO_EVIDENCE_DIR=/absolute/directory` saves real-component HTML/XLSX fixtures. Runs in prebuild and GitHub Actions.

Quote PDF coverage also checks tier remarks stay grouped with their own quantity/unit/price/amount, blank remark handling, separate product/quote notes, Chinese font selection and real multipage rendering with long/multiline remarks. `QUOTE_TIER_REMARKS_EVIDENCE=/absolute/path.pdf npm run test:quote-pdf` saves the rendered fixture.

Quote Excel tests also verify the Tier remarks column stays on the matching quantity/price row, is unmerged across tiers, wraps long/multiline/Chinese text, treats formula-like text literally, and leaves missing/whitespace-only remarks blank. `QUOTE_EXCEL_TIER_EVIDENCE=/absolute/path.xlsx npm run test:quote-excel` saves the rendered workbook fixture.

Invoice tier remarks: `qa/invoice-units.test.mjs` now covers quote first-tier remark snapshots through real order normalization into PI/SI/customer print and downloaded XLSX, multiline/Chinese wrapping, long literal text, blank remarks, retained quantities/units/prices and private-field exclusion. `INVOICE_EVIDENCE_DIR=/private/tmp/v818-evidence npm run test:invoice-units` emits offline fixtures without business-record writes.

Packing/PO tier remarks: the logistics suite also verifies quote-to-order carton snapshots, actual save retention, exact-ID-only recovery and blank overrides, single/mixed packing print/XLSX, editable remarks and bilingual PO line cleaning/print/XLSX. Evidence: `PACKING_PO_EVIDENCE_DIR=/private/tmp/v818-evidence npm run test:packing-po`.

AI writer: `npm run test:ai-writer` exercises the real rewrite handler and shared product editor with network boundaries mocked: malformed/truncated/multipart replies, fallback and friendly failure, authorization/input validation, 300-character enforcement, blog heading compatibility, single guidance field, preview acceptance/discard, preserved copy/instructions and retry. Runs in prebuild and GitHub Actions.

Bulk/blog AI: `qa/bulk-blog-ai.test.mjs` runs in `test:ai-writer`, prebuild and CI. Real handlers and screens are exercised with mocked network/database boundaries for structured complete replies, malformed/truncated fallback, blog section/product validation, retained drafts, product-selection reset, section retry, bulk preview preservation and approval/atomic backup. No live WordPress publication or product writes.

## Curated catalogue cover contrast

Run `npm run test:catalogue-cover` (also included in prebuild and GitHub Actions).
The suite mounts the actual catalogue form, shared cover and print page with
isolated Firebase boundaries. It checks white/black ink, full-opacity secondary
text and divider, saved/reloaded selection, legacy defaults, preserved overlay
settings and no-photo contrast. No live records are written.

The same command includes `qa/catalogue-layout.test.mjs` and actual builder
interactions: selection beyond six photos, layout/page-break persistence,
mixed-count page sharing, long/CJK/emoji/unbroken specifications, all-image/text
preservation, explicit zero-photo selection, impossible headings and print-style
unmount/last-page behavior. For real browser layout checks run
`node qa/catalogue-layout-preview.mjs`: overview, mixed, many, long, noimages,
broken and heading cases use isolated synthetic data with the actual print page.
`--real` optionally reads an existing ignored snapshot under qa/out/; it never
reads/writes live OC. Review bounds, image borders, copy readback, phone width,
continuation labels and print readiness. This fixture is separate from the
Range PDF renderer above. Release still requires exact-SHA CI and fresh two-role
candidate/production checks in RELEASE-WORKFLOW.md.

The `sizing` case adds actual builder controls at `?case=sizing&builder=1` and a
mixed-orientation preview. Its isolated Firebase replacement saves only local QA
data across reloads. Check Standard/Large/Full page choices, rapid changes to
different pictures, reorder/reopen persistence, full-page hero uniqueness,
portrait and landscape bounds/print rules, all-image/text preservation and actual
375px width (account for browser device scale). The image-size regression cases
are part of the same test command. No live catalogue item should be edited for QA.


## Dashboard ↔ customer task and note sync

`qa/customer-workspace-sync-emulator.mjs` mounts the **real Dashboard and
CustomerDetail pages** with shared workspace UI, live Firestore subscriptions,
revision-checked save transactions and real repository rules. Only unrelated
integrations (ERP, AI, assets, etc.) are stubbed in
`qa/customer-workspace-sync-fixture.mjs`. The suite requires a loopback emulator,
uses fictional customers and reads no project credentials or `.env` file.

Run with Node dependencies installed and Java 21 available:

```sh
npx firebase-tools@15.33.0 emulators:exec --only firestore --project crystocraft-rbac-test "npm run test:workspace-sync"
```

Twenty cases cover creation from either page, two-way text/date/status and note
edits, completion/archive/reopen in either direction, remount persistence, stale
edit rejection with draft retention, legacy conversation preservation, customer
isolation and anonymous/customer denial. Each case keeps both pages mounted for
its cross-view observations; remounts happen only for persistence checks.

The existing `.github/workflows/product-search.yml` emulator job runs this after
the RBAC, customer merge, Pipeline and Product Design suites on applicable pushes,
pull requests and manual runs. No CI secrets, production deploy or live fixtures
are needed. The normal build's fast workspace checks remain emulator-independent;
this integration suite runs explicitly in the job that starts Firestore.


The same command also runs eleven **Follow-ups Due** cases in UTC and
Australia/Sydney and America/Los_Angeles. The tile counts unfinished tasks due on or before today in Hong Kong,
with separate Overdue and Today subtotals and drilldown sections. Future/undated
tasks, completed tasks and notes are excluded; Waiting tasks due today or earlier
remain included. Rescheduling moves tasks between the two groups without changing
the total, and completion/reopening updates both the tile and open drilldown. Both native tasks and carried interaction follow-ups count,
without a summary-age cutoff. Tests verify the open drilldown, category/retail
filters, summary-period independence and rescheduling/reopening from either page.

The page bundle's calendar is fixed to 17 October 2026 13:30 UTC, which is
17 October in Hong Kong even when the device is already on 18 October in Sydney. Firestore SDK/network clocks and test polling remain real.
This avoids midnight flakiness while checking Hong Kong day boundaries. The timezone
runner is `qa/customer-workspace-followups-timezones.mjs`; it inherits the same
loopback-only emulator restriction. The production page uses the Hong Kong business date.


Calendar regression coverage (`qa/local-day.test.mjs`, part of the normal build
and GitHub Actions) tests one shared clock, timer/listener cleanup, focus,
pageshow, visibility return after sleep, backwards clock correction, Hong Kong midnight remaining stable across device DST
changes in Sydney and New York, and leap/year boundaries. Five real-page cases
advance only the app calendar (SDK/network timers stay real) through Hong Kong midnight,
wake events and a foreground watchdog tick. Tile counts, open groups, both page
labels and ordering update without remount/data writes, while filters, conversation
window and an unsaved editor survive. `test:workspace-sync` executes 20 full cases
plus 11 each in UTC, Sydney and Los Angeles (53 executions).

Browser proof uses `node qa/dashboard-summary-preview.mjs --midnight` on port5197:
fictional data, actual Dashboard/shared clock, visible “Cross midnight in two
seconds” control. Click Follow-ups Due, then that control: the real browser timer
changes the heading date and moves Today→Overdue / Tomorrow→Today without reload.
It never accesses live data. The clock control is only in this local QA fixture.


## OC-wide Hong Kong time audit

`npm run test:oc-time` runs seven cross-device timezone cases plus the 71 existing
WhatsApp parser/archive checks. It is part of prebuild and GitHub Actions. It
checks human timestamps, date-only preservation, timezone-less OC/ERP wall times,
explicit offsets, Hong Kong year/month boundaries, inclusive CSV ranges, the
30-calendar-day Dashboard window, AI evidence date labels, real quote PDF dates
and SO/PU year functions. A source policy guard blocks device-local date/time
formatters/calendar getters and UTC-derived today defaults outside `ocTime.js`.
Numeric locale formatting, UTC storage/wire timestamps, elapsed durations and
calendar-only UTC arithmetic are intentional. Historical records are not migrated.

### Scheduled jobs and Daily Drafts timing

`npm run test:scheduled-time` runs Python standard-library scheduler tests plus
Node marketing timing tests, included in `test:oc-time`, prebuild and Actions.
Fictional commands/temp checkpoints only: no mail, Firestore, AI or imports.
Covers HKT midnight vs 03:00, Sunday/year/leap/DST boundaries, four host zones,
sleep catch-up, duplicate/clock-rollback prevention, failure retry/shared email
lock, no run on install, elapsed outreach cooldowns and legacy timestamp parsing.


## Summary preview mobile layout

Run `node qa/summary-mobile-preview.mjs`, open `http://127.0.0.1:5199/audit`,
and click **Run mobile regression checks**. This bundles the actual Dashboard,
CustomerDetail, shared summary controls and Layout with fictional reads and
blocked writers; it uses no credentials or live API. All six combinations
(two pages × 320/375/414px) must PASS. Checks cover collapsed/expanded body and
main-scroll widths, unbroken names/URLs, full text and exact collapse restoration,
44px targets, keyboard focus, task/note controls and visible commitments. This
is a repeatable browser layout gate, not a jsdom measurement or physical-device
test. The normal workspace tests remain in prebuild/GitHub Actions.

## Shared Product Design navigation

`npm run test:design-projects` mounts the actual Projects, Gallery, Templates,
Generations, Workbench guide, product/template detail and edit pages, new product/template, and new/existing
spec sheet pages, customer brand profiles and project create/detail routes with
fictional reads and blocked writers. Loading and missing-record navigation is
also covered. A route-inventory test checks every registered `/design/*` page
has a mounted navigation fixture (the `/design` redirect is excluded).
It checks current-route selection, tool-to-tool navigation and Projects return.
For real browser layout: run `node qa/pd-navigation-preview.mjs`, open
`http://127.0.0.1:5200/audit` and Run desktop and mobile checks. All64 combinations
(sixteen routes ×320/375/414/1280px) must PASS. This checks alignment,44px targets,
open/close, all four tool links, selected route and return to Projects without
using credentials, production data or a physical-device claim.


## V8.19 Firebase swatches

`npm run test:crystal-swatches` tests manifest corruption, stable identities,
protected image proxy, byte-verified uploads, revision guards and resumable batch
failure. Both local emulators are required for `node qa/crystal-swatches-rules.test.mjs`;
run it alongside `qa/rbac-rules.test.mjs`. These suites use fictional records only.

`node qa/crystal-swatches-preview.mjs` serves the actual feature pages with a
fictional data boundary at `127.0.0.1:5201`; the ignored verified source backup
provides a photograph. `node qa/crystal-swatches-browser.mjs` checks four widths,
upload failure/retry, optional crop, draft default and exact sample selection.
Evidence is ignored under `qa/out/swatch-v819/`.

`node qa/verify-swatch-release.mjs HTTPS_URL` performs fresh authorized admin and
customer real-page sign-ins and read checks. The `--import` option is a real
production data operation through the reviewed OC migration screen, not QA fixture
creation: use only for the owner's authorized verified-backup migration.
The optional `qa/curl-release-probe-transport.mjs` changes only the network
transport of the existing configuration probe when Node HTTPS times out. It does
not replace the password-login gate. See the release evidence for exact IDs/state.

## Crystal Components — V8.19

npm run test:crystal-products runs customer-safe domain, exact snapshot and read-only
availability/protected-proxy regressions. qa/crystal-products-rules.test.mjs requires
both local emulators and covers publication, private mappings and drawing ownership;
run it with the existing RBAC and swatch suites. No live QA fixtures.

node qa/crystal-products-preview.mjs serves the real pages with fictional browser-only
data on 5202; node qa/crystal-products-browser.mjs checks six routes at four widths,
exact cart/submitted enquiry snapshots, drawing references, favourites and stock-link
review without changing a balance. qa/render-crystal-catalogue.jsx exercises the actual
PDF component (12 products, including a 24-variant product) for rendered visual review.
qa/verify-crystal-catalogue-release.mjs <https-url> performs fresh admin/customer checks
on candidate/current production, actual protected photos and PDF download, read-only
availability, exact local enquiry selection, role separation and refresh. It never sends
a live enquiry or saves a live QA product/drawing/stock record.

scripts/setup-crystal-catalogue.mjs is separate owner-requested business setup, not QA:
default prints the reviewed local manifest; --apply uses the real OC editor for only the
three reviewed own components. It never imports original stock or posts a ledger movement.


## V8.19 dashboard actions first

Run `node qa/dashboard-summary-preview.mjs` (fictional reads/writers) and
`node qa/dashboard-task-first-browser.mjs` for 320/375/414/1280 task-before-summary,
200-character preview, full-text review/manual-task-editor, collapsed settings and
period-independent task checks. `--before` captures metrics against the pre-change
bundle for comparison; do not rebuild that baseline after changing source.
The existing `summary-mobile-preview.mjs` + /audit covers both actual pages inside
Layout at three phone widths, including all channel summary toggles.
`npm run test:workspace-sync` retains real Firestore-emulator cross-page task,
note, legacy carry-over and due/midnight/timezone coverage.

For release, `node qa/verify-dashboard-task-first-release.mjs <https-url>` uses
the existing authorized local QA credentials for fresh admin/customer password
sign-ins. It reviews the actual dashboard, customer task/note editors (cancelled),
protected internal routing, catalogue/detail and refresh. No Save, Done, Archive,
AI regeneration, emails or live fixtures. Follow RELEASE-WORKFLOW.md on candidate
and production; the served-Firebase probe remains a separate configuration check.
