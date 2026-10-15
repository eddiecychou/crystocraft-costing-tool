# Automated product search regressions

```sh
npm ci
npm run test:product-search
```

The suite renders the actual admin Figurine Gifts / Corp Gifts and customer
Figurine Gifts / Corporate Gifts pages in JSDOM. Firebase, pricing feeds and
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
GitHub Actions also runs the suite on relevant source/QA/dependency/workflow
pushes and pull requests, with a manual Run workflow option. See
`.github/workflows/product-search.yml`. Its first Ubuntu/Node20 run passed:
https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38706116158

The workflow was enabled through the connected GitHub app. The owner later
authorized adding `Workflows: Read and write` to the Mac's `portal-macbookpro`
fine-grained token; it is now saved alongside the existing code read/write
permission. The token's existing repository scope and expiry were preserved. The suite checks component behavior, not visual
layout, real login or Firebase rules; release verification below remains
required when publishing an app.

# Rendering a PDF to look at it

> **Every release:** first follow
> [`RELEASE-WORKFLOW.md`](../docs/skills/RELEASE-WORKFLOW.md). Run
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
