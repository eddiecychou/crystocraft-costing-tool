# OC code and Firebase size — recorded snapshot, 1 November 2026

This preserves the measured breakdown discussed before the CRM cleanup. It is a
historical baseline, not a fresh live audit or a current billing estimate.

## Scope and totals

- Code checkout: `ee3e32c8545f4b9b6bd4262c8447493e9d212db0` (portal follow-up
  documentation closeout, before the CRM extraction and later fixes).
- Application boundary: **75,421 code lines in 474 files** under src/, netlify/,
  firestore.rules and storage.rules. cloc 2.11 excludes blank/comment lines;
  shared files are assigned once. A line is not a function or a measure of risk.
- Wider tracked code: **106,573 code lines in 840 files**, including tests,
  scripts, renderer/prototype code and tracked reference/design bundles outside
  the application boundary. This is a different denominator.
- Firebase audit: **1 Nov 2026, 01:43:32–01:46:52 AEDT** / **31 Oct,
  22:43:32–22:46:52 HKT**, project crystocraft-costing, default database in asia-east2.
- Firestore reported data **plus indexes**: **364,933,230 bytes (364.93 MB)**,
  metric timestamp 01:43 AEDT. This is database-wide, not per module.
- Root records: **6,774 across 54 top-level collections**. Nested histories,
  images, quote records and movements are additional scopes, listed separately.
- Live-object inventory: **14,485 files, 4,946,390,207 bytes (4.946 GB)** in
  crystocraft-costing.firebasestorage.app, grouped by path prefix below.

## Module responsibilities, code and stored files

Code lines exclude comments/blanks. MB is decimal (1 MB = 1,000,000 bytes).
Root records exclude nested subcollections; file MB is Cloud Storage, not
Firestore database/index size. A zero in file MB does not mean a module has no
Firestore data. Code/data assignment is an audit convention, not an access boundary.

| Module and main functions | Code lines | Source files | Root records | Stored files | File MB |
|---|---:|---:|---:|---:|---:|
| **Crystocraft Range** — Own-product families, variants, BOM costing and customer catalogue | 5,392 | 22 | 317 | 553 | 86.37 |
| **Corporate Gifts and pricing** — Corporate gift products, pricing tiers and customer prices | 2,365 | 20 | 147 | 816 | 145.02 |
| **Crystal Components, Fabric and customizer** — Crystal components, Strass clearance, Fabric enquiries, swatches and legacy customizer | 1,756 | 30 | 162 | 481 | 37.56 |
| **Product Design** — Projects, brand analysis, prompt templates, AI generations and specification sheets | 4,838 | 50 | 39 | 38 | 24.59 |
| **Suppliers, BOM components and purchase orders** — Suppliers, quotations, components/BOM, sourcing evidence, purchase orders and stock receiving | 7,888 | 37 | 1,026 | 674 | 2,352.07 |
| **Inventory and stock availability** — Crystal/finished goods/packaging stock, movements and stock availability | 1,705 | 19 | 887 | 0 | 0.00 |
| **Sales quotes and enquiries** — Customer quotes, enquiries, product selection and quote exports | 3,733 | 14 | 39 | 13 | 1.69 |
| **Production, orders, shipping and logistics** — Orders, reservations, production, shipment/PI, packing lists, freight and logistics | 5,921 | 23 | 163 | 84 | 9.41 |
| **Invoices, credit notes, banks and ERP** — Sales invoices, deposits, outstanding balances, credit notes, UC registry and ERP/bank lookups | 7,298 | 31 | 86 | 0 | 0.00 |
| **Customer CRM, dashboard and correspondence** — Customer records, dashboard to-dos, pipelines, correspondence import and AI summaries | 6,648 | 46 | 425 | 11,071 | 2,108.55 |
| **Marketing, campaigns, blog and Daily Drafts** — Lead lists, Daily Drafts, campaigns, blog writing, marketing copy and tags | 8,260 | 45 | 3,156 | 739 | 167.10 |
| **Catalogue layouts and brand proposals** — Catalogue layouts, image sizing, portrait pages, long specifications, PDF exports and customer brand proposals | 2,995 | 16 | 9 | 14 | 13.45 |
| **Customer portal, accounts and approvals** — Customer storefront, registration/login, invitations, approvals, follow-up and account settings | 5,129 | 38 | 112 | 0 | 0.00 |
| **WooCommerce** — WooCommerce catalogue/order/refund import and stock reconciliation | 2,721 | 9 | 9 | 0 | 0.00 |
| **SEO control plane** — WordPress SEO state, review batches, validation and write verification | 1,405 | 10 | 143 | 0 | 0.00 |
| **Shared platform, media, permissions and settings** — Navigation, authentication foundation, permissions/rules, settings, translations and shared media tooling | 7,367 | 64 | 54 | 2 | 0.56 |
| **Total** | **75,421** | **474** | **6,774** | **14,485** | **4,946.39** |

Portable data: [module breakdown with exact bytes and collection/prefix mapping](OC-SIZE-2026-11-01-MODULES.csv)
and [root and selected collection-group document counts](OC-SIZE-2026-11-01-FIREBASE-COUNTS.csv).
No document bodies, individual customer records, credentials or media URLs are included.

## How to interpret the data

The largest recorded file areas are supplier/sourcing files (about 2.35 GB),
customer correspondence/assets (about 2.11 GB), then marketing/lead files
(about 167 MB). They are inputs to a retention review, not evidence that files
are duplicated, obsolete or safe to delete. Code cleanup and file retention
are separate tracks.

Nested examples: 5,989 email_threads, 3,471 movements, 2,440 customer_prices,
1,546 lines, 1,434 images, 420 supplier_quotes and 363 enquiries. These are
collection-group counts spanning multiple parents; do not add them blindly to
root counts, or treat them as current business quantities. The groups sampled
are not a guarantee that every possible nested collection name was inventoried.
The later history repair's date-ordered query returned 358 entries. It is a
different query and snapshot from the 363-document unfiltered group count;
orderBy can omit entries without date. Do not infer five deleted records or
claim five undated records without a same-snapshot field audit.

Monitoring reported 4,946,833,091 live-object bytes and 14,479 objects at its
own sample times, plus 565,433 soft-deleted bytes. Its small differences from
the object listing reflect different samples; do not combine them as one exact
instant. No backup/PITR storage series was returned; absence of a series is
not proof of zero storage or a backup/recovery guarantee.

There is no measured Firestore bytes-per-module figure in this audit. Document
counts and Storage prefix bytes answer different questions; per-module database
bytes must not be invented from record counts or allocated proportionally.
The Firebase figures exclude Supabase/JES, Netlify, Fly.io and WordPress storage.

Later extraction moved ownership without a line-count reduction target. Before
comparing a fresh audit, pin its SHA/time, reuse the same counting boundary,
update classification for new CRM files and retain shared files only once.
Use aggregate/read-only results; do not commit raw customer or message contents.
See the [maintenance plan](../plans/OC-MAINTENANCE-CLEANUP-PLAN.md) for priorities.
