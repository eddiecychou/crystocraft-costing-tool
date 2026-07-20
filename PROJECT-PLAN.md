# Crystocraft Corporate Gift Costing Tool — Project Plan

> **Canonical plan lives in Obsidian:** `Crystocraft/Operations/Costing Tool - Project Plan.md`
> and `Costing Tool - Issues & Bugs Log.md`. This in-repo copy is a convenience snapshot.

## Working across two Macs (2026-07-17)

This project is worked on from two Macs. **Do not rely on iCloud Drive to keep
them in sync** — an iCloud-synced `Documents/Coding/...` folder was found to be
silently corrupting `.git` internals (duplicate `main 2`/`main 3`/… ref and
index files dating back weeks, from iCloud racing with git writes). It hadn't
broken anything visibly until a `git fetch` finally tripped on it.

**The fix: git is the sync mechanism, not the folder.** Each Mac keeps its own
local clone **outside** `~/Documents` and `~/Desktop` (e.g. `~/Developer/`, since
iCloud's "Desktop & Documents Folders" sync only watches those two locations) —
`git pull` before starting work, `git push` when finishing. All project
markdown docs (this file included) are tracked in git, so documentation/context
travels automatically with the code — no separate sync step needed. The
`erp-sync/.env` credentials are the one deliberate exception: gitignored on
purpose, they live only on whichever Mac is physically on the Crystocraft LAN
(see `erp-sync/RUNBOOK-mac.md`).

Both Macs' canonical path is now **`~/Developer/costing-tool`**. Checklist for
resuming on a Mac you haven't used in a while (new Claude Code conversation —
it has no memory of prior sessions, so start here):

1. `cd ~/Developer/costing-tool && git status` — if that path doesn't exist yet
   on this Mac, see step 5.
2. If `status` shows anything modified/untracked that matters and isn't pushed
   yet, deal with it first (commit + push, or copy it out) — don't overwrite it.
3. `git pull` to get everything done on the other Mac.
4. If the old iCloud copy (`~/Documents/Coding/Crystocraft/Operation/Costing
   Tool`) still exists on this machine, ignore/remove it — it's stale and
   liable to iCloud-corrupt `.git` again; the real copy is in `~/Developer/`.
5. **First time on this Mac / folder missing:** `mkdir -p ~/Developer && git
   clone https://github.com/eddiecychou/crystocraft-costing-tool.git
   ~/Developer/costing-tool`, then `npm install`. For the ERP sync also:
   `cd erp-sync && python3 -m venv .venv && .venv/bin/pip install -r
   requirements.txt`, then recreate `.env` (not in git — copy the values from
   the other Mac or from your password manager, see `RUNBOOK-mac.md`).
6. If `git fsck --full` (run occasionally, cheap) ever reports errors, look for
   stray `<file> 2`/`<file> 3`-style duplicates nearby — that's iCloud
   contamination, safe to delete once you confirm the real file still works.

## Current Status — V7.15 CLOSED as of 2026-07-19

Commit chain `e3b160f`→`548958d` (25 commits), all deployed. V7.15's theme is
**integrating the app with the ERP with a view to retiring JES**. Owner's framing:
be able to query everything useful out of the ERP, map the Firebase data onto
Supabase as one source of truth, then take over the writing so the old system
can be switched off.

Full findings: **`V7.15_ERP_Inventory.md`** — this is the summary.

### 1. The scope is far smaller than it looked

Surveyed the whole mirror (`erp-sync/inventory.py`, read-only):

| | |
|---|---|
| Tables mirrored | 494 |
| **Empty** | **286** |
| Active in the last 3 months | **52** (98.5% of all rows) |
| Dormant 3 yr+ | 93 |

JES is a *jewellery* package (gold, diamonds, hallmarking, POS, consignment,
customs). This business uses six modules of it: **items/inventory, job
orders/production, sales, purchasing, customers/suppliers**. So this is not
"build an ERP" — it is closing gaps in an app that already covers most of them.

**Quoting has already been migrated** and nobody recorded it: `quotation` stops
at 2024-12-20. A precedent that the pattern works.

### 2. Accounting is out of scope — and the books are in PBIS

JES's GL was **never used**: `acjournal`, `acsettle`, `acperiodended`,
`acbudget` are all 0 rows; only vendor config remains, last touched 2004–2006,
one row stamped by user `demo`. Owner confirmed the books are kept in **PBIS**
(separate system, on Cindy's machine).

Cindy's journal reports were parsed (`erp-sync/parse_pbis.py`). The key finding:
**PBIS already carries the app's UC number** —
`SALES INVOICE SI250040 / UC4743/` — so the join across JES, `uc_registry` and
the books exists already. **152 of 152 UC numbers in the books are in the
registry; zero orphans**, an independent validation of the V7.14 migration.

The books run **~5 months behind** (median posting lag 153 days, max 373) — so
PBIS is history, not a live source of "what's paid".

Still unseen: the **JES→PBIS import file**. That is what an app-generated
invoice must reproduce, and it is the reason invoicing should not be the first
function migrated.

### 3. Document model (owner)

| Team says | JES doc | Generated in | In the app |
|---|---|---|---|
| **PI** | **SO** | JES | PDF uploaded, AI-parsed into Firestore |
| **Invoice** | **SI** | JES | referenced by number only |

An SI is often copied from an SO **but not always** — simple sales are invoiced
with no SO. Any invoice module must support both paths.

**The app re-parses data it already has.** SO lines exist as clean rows in
`erp_sales_order_line` (188 k). So `ShipmentForm` now cross-checks a parsed PI
against the ERP's own order and offers to adopt it — augmenting the parser, not
replacing it, since an order raised today isn't synced yet.

### 4. What shipped

- **ERP Lookup → Inventory**: stock on hand by warehouse and item type.
  Computed from the movement ledger, **not** `itemwhbal` — that table is a stale
  snapshot (8,368 of 8,599 non-zero rows have a null `lastupdate`). *Rule: prefer
  JES's ledgers over its balance tables until each balance table is proven.*
- **Customer / supplier detail panels**, with payment terms and methods resolved
  from their lookup tables.
- **Bank accounts** (`Settings → Bank Accounts`) — the ERP has **no bank master**
  (`raw.bank` is 2 rows from 2003–05; account-number columns 0-populated), so
  this is new app data. One default per currency enforced by a partial unique
  index; IBAN mod-97, SWIFT/BIC and sort-code/ABA validation at the API; an
  append-only change audit (`SECURITY DEFINER`, so the API can read history but
  not forge it). Wired into the quotation with a currency-mismatch warning and a
  snapshot onto the document.
- **BOM coverage check** on Range Costing — merges every ERP variant of a design
  and reports what isn't costed. Level 1 only: level 2 is raw alloy from when the
  factory made FM parts in house, and those are now bought finished.
- **Component code audit** (`Settings → Component Codes`) — see §5. Reports
  three states: not in the ERP; exists but **no current BOM uses it**
  (superseded — the interesting one, invisible to a plain existence check); or
  exists and is built with. "What do the BOMs use?" ranks replacements
  server-side (`erp_code_alternatives`) among components current BOMs actually
  use — the `.NN`-stripped code first (right ~34% of the time and exactly right
  when it hits), then longest shared prefix by usage.
- **Renamed to Operation Center**, with `V7.15 · <build time>` under the logo.
  Name and version live in `src/appInfo.js`; the build stamp is injected by Vite
  so "is my change live yet?" is answerable at a glance. The browser tab stays
  "Crystocraft Customer Portal" — the same deployment serves the customer
  storefront and those OG tags are customer-facing. `package.json` realigned to
  7.15.0, collapsing three numbering schemes into one.
- **Fix:** freight quotes saved but never displayed. `where` + `orderBy` needed a
  composite index that doesn't exist; `catch {}` turned the error into an empty
  list. Silent catches in `logistics.js` now log.

### 5. Open findings that need a decision

- **The costing may be anchored to superseded part codes.** `FM-K(32).03-C`
  ("鋅合金", zinc alloy) is used by **0** current BOMs; every BOM builds with
  `FM-K(32)-C` ("底座配件 chrome", 526 BOMs). These are the old in-house part
  codes from before the FM parts were bought finished. If so, some unit costs
  reflect what it cost to *make* a part, not what is now *paid* for it.
- ~~**Multi-invoice UC numbers** — UC4836 is `SI250128/137` in the registry,
  unparseable. How should these be recorded?~~ **Answered by owner 2026-07-19:
  they should not exist.** *"There will never be one UC, 2 invoices. Either it is
  an update — there will be a suffix at the UC, e.g. UC1234 updated by UC1234-a —
  or it is a wrong input/typo."* So `UC4836` is an error, not a pattern needing a
  design. Measured: only **5 of 3,691** rows have more than one invoice in
  `jes_si`. Rare — but it recurs, so an app owning the registry should **detect
  and reject** it rather than assume it cannot happen.
  **New requirement out of the same answer:** UC numbers take **update
  suffixes**, and **227 of 3,691 (6.1%)** are not plain `UC####` — 72 as
  `UC####(A)`, 31 as `UC####-#`, plus ~72 compound `UC####/UC####` forms that are
  a separate, still-unexplained thing. The app's allocator issues plain
  sequential numbers only, so it cannot yet express an update. See
  `PBIS-IMPORT-FORMAT.md`.
- **Packaging is not costed per product.** The ERP BOM carries the gift box,
  hang tag, tissue, silica gel; the app stocks packaging as a pool.

### 6. The retirement plan

`JES-RETIREMENT-PLAN.md` was written this cycle: nine steps from here to
switching JES off, in plain language, with the numbers included.

Its main decision: **drop production job orders**. Owner's instinct, confirmed
in the data — of 131,752 job orders, item/qty/customer/delivery are 100%
duplicated from the sales order line, and **wastage, the field that would
justify the paperwork, is filled on 2 of them**. The app already records
everything worth keeping (`reserveForOrder`, `issueForOrder`, `produceForOrder`
with `committed_at`), so nothing needs building. Owner confirms nobody uses the
production-in date, and the team will be glad to see the back of it.

Consequence: **production becomes the first function to migrate** rather than a
late item — highest keying cost, lowest data loss, doesn't feed PBIS, and the
team wants it. That last point matters, because team adoption is the main risk
to every cutover.

Caveat recorded there: 100% of material issues hang off a job order in JES, so
"drop job orders" must never become "stop recording material issues".

## V7.16 — in progress

### Step 4 (production) prerequisites — done 2026-07-19

Started off-LAN, so steps 1–3 below are untouched. Went at step 6 (production
off JES) instead, since it needs no fresh sync data.

**Gap map, measured from `itemtransaction`:** only **MI** (1,120/yr) and **PI**
(1,244/yr) hang off a job order — 2,364 of 6,649 movements, about a third, not
all. `IT`, `SI`, `IA`, `GN`, `SR`, `PR` don't touch one. Both are paired
double-entry warehouse transfers (`FJOD→FWIP`, `FWIP→FTBS`). Full table in
`JES-RETIREMENT-PLAN.md` §4.

**Owner decision: production output is implicit.** Build-to-order, so no
finished-goods balance is ever written; JES's PI leg into FTBS just stops at
cutover. B2C finished stock is a separate trading operation (receipt → sale) and
is explicitly out of scope. This also closes what §4 had left open for step 7.

**Doc correction:** §4's table listed an `issueForOrder` that **does not exist**.
The model is two-stage — consumption happens inside `produceForOrder`.

**Built.** JES enforced material recording through workflow; the app made it an
optional button and styled the failure state more quietly than success. Four
holes, all closed:

- `component_gaps` persisted at reserve time (`orderStock.js`) — previously the
  "N parts can't be reserved" warning vanished on click, so a part-reserved
  order looked identical to a complete one. **The correctness fix.**
- Confirm when moving to shipped/delivered with consumption unrecorded, naming
  the reason. A confirm, not a block.
- "not recorded" now reads as red with an icon, not `text-ink-40`.
- One roll-up chip beside Status (`orderStockStatus.js`, new) across all three
  stock classes. Doesn't nag: an untouched class isn't counted as missing.

Files: `src/orderStockStatus.js` (new), `orderStock.js`,
`components/OrderStockIssue.jsx`, `components/OrderInventoryIssue.jsx`,
`pages/ShipmentForm.jsx`. **Parsed with esbuild only — no Node on this Mac, so
none of it is build-tested or run.** Needs verifying on the deployed site:
reserve an order with a BOM part missing from the ledger, then check the gap
survives, the chip reads "partly recorded", and shipping it prompts.

### The crystal finding — and a correction

Owner then explained something the database alone would not have shown: **the
team keeps the real stock figures in Excel.** Only the crystal warehouse is
maintained in JES; metal parts are not, because keeping them current in a slow
ERP is impractical.

Checking that against the ledger sharpened it into the cycle's most important
finding: **every MI, and the consumption leg of every PI, is item type `ST` —
crystals** (107 codes). Metals (`SF`) barely move. So the job-order flow *is* the
crystal flow, and the one part of JES stock the team trusts is the part that runs
entirely through job orders.

**Correction to the entry above:** an earlier reading took the large `IA` figure
(FSTK −1.6 M against GN +136 k) as evidence JES stock was untrusted across the
board, and concluded stopping job orders broke nothing. True for metals, **wrong
for crystals** — the adjustments sit in FSTK, while the FJOD/FWIP crystal flow is
the disciplined part.

Consequence: **the production cutover must carry crystal opening balances over on
the day**, or the one accurate stock record in the business is stranded. Both
ends exist already (`inventoryClass.importStock`; the app's crystal card is the
same shape as the JES flow). Open question: for crystals, does JES or the Excel
win? Settle before cutover — opening balances become permanent immediately.

Also named: **the Excel spreadsheets are an undocumented system of record.** §5
of the retirement plan lists "a function nobody mentioned" as the commonest way
these projects stall; this is one, and it surfaced by conversation, not by
reading the database. Absorbing it deserves its own piece of work — metals get
better immediately, since the app's append-only running balance is what the team
is approximating by hand.

**Sequence confirmed with owner:** production first; then sales orders +
purchase orders together; **invoices last**, because the books are the one
downstream consumer that must not break.

### The PBIS import format arrived the same day

Cindy supplied `invoice to import.xls` and `PO to import.xls` — the file that
had been the longest pole in the plan. **`PBIS-IMPORT-FORMAT.md`** holds the
column contract; the two things that matter:

- **Header-level only, no line items.** An app invoice does not need to
  reproduce JES's line structure, surcharge tables or `sigstamount` tax field.
  PBIS wants a header and a total. That was the big unknown, and it is smaller
  than feared.
- **Validated 32/32** against `uc_registry` — every UC reference resolves, every
  currency matches, every total matches to the cent. The app already holds what
  the file needs; the UC number is the join, confirmed now from the input side
  as well as V7.15's output side.

**UC4933 — resolved 2026-07-20, and it was never a problem.** Flagged here
originally as "an invoice the app believes is void is going into the books".
Cindy: *"UC4933 is a void invoice. We record all UC registry in this file even it
is void/refund in the later day. Just that we do not import the void invoice into
pbis after checking."* The `.xls` is her unfiltered **working file**, not the
import — the void check happens between it and the CSV. `VOID` in the registry is
a legitimate state, not drift.

**UC4926** had an empty `jes_si` where the file has `SI260082` — that one was
genuine, and Cindy has since fixed it.

Four questions remain for Cindy (the purchase `type` codes FS/PP/RM, who
maintains the standing exchange rates, discount/charge semantics, and whether
the name column is read on import). None block scoping the work.

**Left for step 4:** a cutover date, plus the three checks in
`JES-RETIREMENT-PLAN.md` §4 "Cutover checklist" — chiefly whether JES blocks an
SI on insufficient FTBS stock, which is a five-minute test on the LAN.

### On the LAN, 2026-07-19 — steps 1 and 2 done

**Step 1 — `LastUpdate` probe. Incremental sync is CLEARED for four tables:**

| Table | Rows | Touched well after creation | Verdict |
|---|---:|---:|---|
| `ItemTransaction` | 1,156,048 | 18.3% | ✅ safe |
| `SalesOrder` | 5,631 | 54.8% | ✅ safe |
| `SalesInvoice` | 5,455 | 26.6% | ✅ safe |
| `Purchase` | 4,256 | 35.6% | ✅ safe |

⚠️ **`ItemTransaction` has 556 rows with no `LastUpdate` at all** — incremental
would never pick them up. They need one full pass; incremental is fine after.

**Manual test done, and it settles `Item` and `ItemDetail`.** Owner edited
`ITRemarks` on `U0383-165-GC1K` at 15:52:43. Revision 1 acts as the control:

| Revision | LastUpdate | Contains the edit? |
|---|---|---|
| **0** | 2026-07-19 15:52:43 | ✅ |
| 1 | 2026-07-16 13:59:28 | ❌ untouched |
| **2** | 2026-07-19 15:52:43 | ✅ |

JES did **both**: updated revision 0 in place *and* inserted revision 2. Either
alone suffices for incremental sync. `ItemDetail` moved too (15:52:49).

| Table | Verdict |
|---|---|
| `Item` (1.45 M) | ✅ **safe — proven directly** |
| `ItemDetail` (10.3 M) | ✅ **safe — proven directly** |
| `SalesOrderDetail` (188 k) | ✅ **safe** — cleared 2026-07-20, see below |

**Seven of seven cleared.** This was the single biggest unknown in V7.16.

`SalesOrderDetail` settled itself on 2026-07-20 without needing a staged test.
`SO260027` is dated **2026-07-17** but both its header and its detail line carry
`LastUpdate = 2026-07-20 09:32:04` — a real edit by `ZHENGCL`, three days after
the order date. The header row demonstrably existed since 07-17, so that is an
update rather than an insert, and the detail line shares the identical
timestamp: the same header-and-lines-together behaviour proven the day before
when the `U0383-165-GC1K` edit moved `Item` and `ItemDetail` six seconds apart.

Strong evidence rather than a controlled test — a first detail line could in
principle have been inserted at that instant — but it matches the proven pattern
and the header is unambiguous.

Checked while there, because revision 0 carrying current data could have broken
it: `erp_item` orders by `itrevision desc`, so it takes revision 2 — which does
hold the edit. **The matview is correct.** Every item lookup in the app depends
on that, so it was worth confirming rather than assuming.

Fixed a bug in `probe_lastupdate.py` while there: it probed `Item` on `ItemCode`,
which does not exist (the column is `ITCode`), and swallowed the failure as
"probe failed". Another case of column names lying.

**Mirror staleness at the time of check:** `salesorder` 2026-07-16 vs live
07-17; `itemtransaction` 2026-07-10 vs 07-17. A few days to a week behind.

**Step 2 — item images. The folder was never a mystery.**
`systemsetting.ssimagepath_notuse` holds `z:\jes\pictures\` — the `_notuse`
suffix is a lie. Mounted at `/Volumes/JES SHARE/JES/Pictures/COLOR`.
**Done: 22,557 objects · 957 MB in the private `erp-item-images` bucket, 0
failed. 24,214 item codes now resolve to a stored image.** Well under the
1.5–4.5 GB estimate. The missing 23% are genuinely absent from disk — the
sibling folders resolve only 59 of 6,856.

Three bugs in `sync_images.py`, the first two found by smoke-testing a single
file before committing to the full run, either of which would have failed all
22,557:

- new-style `sb_secret_` keys are only accepted via the `apikey` header (the
  script sent `Authorization: Bearer` only → "Invalid Compact JWS")
- Storage rejects `#` in an object key, raw or encoded (12 files, skipped and named)
- **the upload was 32× slower than necessary**: `urlopen` opens a fresh TCP+TLS
  connection per call, so a 45 KB file cost 1,188 ms against a 5 ms SMB read.
  Persistent connections + 12 workers took it from 0.8 to 25.3 files/sec —
  7.6 hours to 15 minutes.

Full detail in `erp-sync/IMAGE-SYNC-PLAN.md`.

### Step 3 — full sync, done 2026-07-19 21:17

`=== Finished cleanly ===`. All 494 tables, **0 errors**, `refresh_views.sql` ran
automatically. **Ran 16:08 → 21:17 — 5h 08m, not the ~2h estimated** from the
2026-07-16 run. Plan for five hours, not two, until incremental is switched on.

| Table | Rows | Mirror max `lastupdate` |
|---|---:|---|
| `item` | 1,447,399 | **2026-07-19 15:52:43** |
| `itemdetail` | 10,346,277 | **2026-07-19 15:52:49** |
| `itemtransaction` | 1,156,048 | 2026-07-17 08:26:28 |
| `salesorder` | 5,631 | 2026-07-17 16:12:42 |
| `salesinvoice` | 5,455 | 2026-07-13 16:59:19 |
| `purchase` | 4,256 | 2026-07-17 08:09:03 |

The first two carry the 15:52 timestamps of the `U0383-165-GC1K` probe edit, so
the mirror demonstrably reaches today. `itemtransaction` matches the live count
exactly (1,156,048 — the figure the probe read off SQL Server).

Views rebuilt: `erp_item` 44,466 · `erp_bom` 432,057 · `erp_stock` 34,241.

**This clears the last prerequisite for incremental sync** — the 556
`itemtransaction` rows with no `LastUpdate` have now had their full pass.
Step 4 (flip `Item`, `ItemDetail`, `ItemTransaction` to incremental in
`tables.yaml`) is unblocked, and on these timings it is worth doing first:
five hours per refresh is the thing making the mirror stale.

`JobOrderBOM` is the fourth giant and was never probed — do not flip it on the
assumption it behaves like the others.

### `Invoice_Check_lists.xls` has SEVEN sheets — the app imported one

Cindy sent her corrected registry on 2026-07-20. The correction itself was
negligible; the file's *structure* was the finding.

| Sheet | Rows | In the app? |
|---|---:|---|
| `INVOICE UC#` | 3,696 | ✅ this is `uc_registry` |
| `NO USE RECORD ONLY` | 1,488 | ❌ |
| **`INVOICE UA#(Mascot)`** | **301** | ❌ |
| **`DN&CN Register`** | **420** | ❌ |
| `Principal overpayment 2018` | 17 | ❌ |
| `Sanriowave MG-HK` | 28 | ❌ |
| `Sanriowave MG-Maylaysia` | 16 | ❌ |

`load_uc_archive.py` hard-codes `SHEET = "INVOICE UC#"`, so six sheets were never
seen. Two matter:

- **`INVOICE UA#(Mascot)`, 301 rows.** The `UA` series reverse-engineered from a
  single stray reference is a **full parallel register**, with `JES SI#` and
  `JES SO#` columns — always joinable, just unknown. This is where the ~340 M03
  invoices outside `uc_registry` live.
- **`DN&CN Register`, 420 rows.** Debit and credit notes. The PBIS CSV **cannot
  express a credit or reversal**, and Cindy adjusts those manually. So this is a
  document class neither the app nor the import format models — **and credit
  notes affect revenue, so it bears on the 31 March valuation.**

  **Cindy, 2026-07-20:** *"DN&CN they are in JES, I just didn't record them in
  this excel file... I enter DN & CN into pbis too. Since there are just 4 or 5 a
  year. So I do it manually."* Screen captures promised.

  Volume confirms her figure. The likely JES homes are `salesreturn` (177 rows,
  `SR######`) and `purchasereturn` (433 rows, `PR######`) — **FY2026 has exactly
  four sales returns**, `SR260001`–`SR260004`.

  ⚠️ **The mapping is not proven.** The Excel register numbers them `DN159`,
  `DN160`… against customers (`Mascot`, `Mascota`), while JES uses `SR`/`PR`. A
  debit note raised *against a customer* is not the same thing as a purchase
  return, so these may be two overlapping schemes rather than one. Cindy's screen
  captures will settle it — do not assume `DN ≡ PR` and `CN ≡ SR` before then.

  Note the 420-row register spans back to 2006, so historically this ran at ~20 a
  year against ~4 now. And **returns do post stock movements** (`SR` and `PR`
  appear in `itemtransaction`), so they are not purely an accounting artefact.

- **`UA` is being retired.** Cindy: *"I guess we no longer use UA... will use UC
  for Mascot order, too."* So the `UA` series is **history only** — no future
  handling needed, and `UC` becomes the universal key going forward after all.
  The 301 historical rows still sit outside the app.

**Pattern worth naming:** every time the actual artefact has been examined rather
than described, it contained more than the description — the `_notuse` columns
held the image path, the `.xls` turned out not to be the import format, and now a
one-sheet import turns out to be a seven-sheet workbook.

### What the "fix" actually changed, applied 2026-07-20

Diffed before touching anything; backup kept as `uc_registry_backup_20260720`.

| | |
|---|---|
| `UC2474` | `Viod` → `Void` (typo) |
| `UC4926` | blank → `SI260082` |
| `UC4949` | new row (Online Shop, EUR 50.53) |
| `uc_seq` | advanced to 4949 — next allocation `UC4950` |

Applied surgically rather than replacing 3,691 rows for three changes. The app
now matches the spreadsheet exactly: 0 differences, 0 added, 0 removed.

**`UC4933` needed no fix** — established 2026-07-20. It is correctly marked
`VOID`; the registry records every UC number including voided and refunded ones,
and the void is filtered out between the working `.xls` and the CSV that PBIS
ingests. The earlier reading of this as an unfixed error was wrong.

**The `uc_no` "duplicates" — resolved 2026-07-20. Nothing is wrong with them.**

Owner: the two entries are `UC1480/10` & `UC1480/10(B)`, and `UC1748/11` &
`UC1748/11(A)`.

**The year is part of the identifier, not a separate attribute.** The full UC
reference is `UC####` + `/YY` + an optional update suffix, and the app's
`uc_no` / `year` columns are a *decomposition of one value*. So `(uc_no, year)`
is not a workaround key — it **is** the natural key, and it is unique across all
3,692 rows.

An earlier note here called this "the suffix filed in the wrong column" and
proposed normalising the two rows. **Both wrong** — there is nothing to fix.

What *is* inconsistent is **where the suffix sits** within that identifier:

| Placement | Rows | Example |
|---|---:|---|
| Inside `uc_no`, before the year | **105** | `UC1547(A)` + `/10` → `UC1547(A)/10` |
| Inside `year`, after it | **2** | `UC1480` + `/10(B)` → `UC1480/10(B)` |

Both spellings describe the same idea. Only 2 rows use the second, so the app
should read either and write the dominant form.

⚠️ **New question this raises:** the `.xls` writes the full reference
(`UC4943/26`) but the import CSV truncates it to `UC4649` with no `/YY`. **How
does a suffixed UC appear in the CSV?** No suffixed reference occurs in the
87-row sample, so `UC1480/10(B)` → `UC1480`? `UC1480(B)`? Unknown, and the
exporter cannot guess.

⚠️ **Genuinely missing: `SI240240`.** HKD 3,432 to `C13` (Fee Ratibor),
13 Nov 2024, **`CONFIRMED` in JES** — and **no registry row anywhere**; no row
carries that total. Cindy's working file referenced it as `UC4657`, which belongs
to Rex Wong, so that reference was simply wrong. This is a real invoice in JES
and in the books with no UC number at all.

### Crystal migration — JES inventory can be retired (2026-07-20)

XiangXia: **the only stock in JES that is maintained and accurate is the
crystals.** Migrate those to the app and the inventory side of JES can be
switched off. Metals are already worthless there — the real figures are in her
Excel (§4 of the retirement plan).

**Source: the movement ledger, not `itemwhbal`.** For the 180 `ST` codes active
since 2025, the two agree on **162** and differ on **18** — and `itemwhbal` is
*lower* every time, exactly the lag a stale snapshot produces. Consistent with
V7.15 and with the project rule to prefer ledgers over balance tables.

**Prepared: `Desktop/ERP Migration/crystal_opening_balances.tsv`** — 180 codes,
`code / name / qty`, the format the Crystal Stock **Import Stock** button expects.

| | |
|---|---:|
| Codes | 180 (active since 2025) |
| With stock | 117 |
| At zero | 63 |
| Total units | 3,110,447 |

Scoped to codes moved since 2025 rather than the 433 with any non-zero ledger
balance — **338 of those have not moved since before 2020** and would arrive as
phantom SKUs on day one.

Two negatives (`5186188` −3, `5135900` −5) were **clamped to 0**; a negative
cannot be an opening balance.

**The 18 disagreeing codes are a spot-check list**, not a problem — a short
physical count instead of counting all 180 blind. Largest is `C01-1028-26-002`:
ledger 108,072 vs JES 69,752.

#### Bug found and fixed on first real use: numeric-only codes silently dropped

First paste attempt: 180 rows in the file, **only 121 rows parsed** — no error,
no warning. `parseStockPaste` (`src/inventoryClass.js`) required a code's first
cell to contain **both** a letter and a digit. All 59 missing rows were exactly
the **pure-digit** codes (`5186188`, `1177191`, `5135900`…), which are common
among JES-origin crystal SKUs.

**Fixed**: require a digit only — every real code has one, a letter is not
guaranteed. Verified against the full file: 180/180 now parse. This was a bug in
a *shared* importer (crystals and packaging both use it), so it would have
quietly dropped numeric SKUs on every future import, not just this one. Commit
`83ca410`, pushed and deployed.

**Imported: all 180 rows, 2026-07-20.** JES inventory's crystal side now has an
app equivalent. Still to confirm (not yet checked from this session — Firestore
needs a login): the total-units figure on the Crystal Stock tab reads
3,110,447, and the two clamped-to-zero codes (`5186188`, `5135900`) show 0 with
no negative artefact.

#### Two corrections to earlier notes in this file

1. **Goods receipt into the app already exists.** An earlier note claimed the app
   could not receive purchased stock and that XiangXia would need manual
   adjustments. **Wrong** — `src/poReceive.js` and `components/PoReceiveStock.jsx`
   receive PO lines into stock across all three classes, posting `receipt`
   movements tagged with the PU number, reversible. The claim came from grepping
   only `PurchaseOrderDetail.jsx` and `purchaseOrders.js` and concluding from
   absence.
2. **Crystal Stock is empty** (`0 of 0 items`), so the import has no collision
   risk with existing app data.

#### ⚠️ One latent trap in `poReceive.js`

`loadInventoryIndex` indexes metal, then crystals, then packaging, with
`// first wins on duplicate codes`. **So a code present in both Components and
Crystal Stock routes its receipts to metal, silently.** The incoming codes are
`C01-*`, `BDC-*` and numeric while components are `P-GL*`, so a clash is
unlikely — but it is worth checking after import, because the failure mode is
invisible: stock lands in the wrong class with no error.

Related vocabulary note: **"crystal" in the app means Swarovski stones.** The K9
crystal blanks (`P-GL0057…`) live under Components and are classed `metal`. That
split is functional — BOM-driven parts in Components, per-order picked stones in
Crystal Stock — but the word means two different things depending on who is
speaking, and JES adds a third (`ST` vs `SF`).

### Step 2 finally started: CuiLing's sales walkthrough (2026-07-20)

The screen captures the plan has called its main protection against discovering
an unknown function late. Five screens: SO add, SO list, SO after duplicate,
SI add, and the Document Loading dialog.

**The workflow, confirmed:** `SO (Add — or Duplicate) → Load Document → SI`. An
invoice is built by loading the sales order, which matches the model in §3 of the
retirement plan.

**⭐ Duplicate is the primary data-entry method — and it explains the UC errors.**
CuiLing's own annotation: 添加老客户新订单时直接复制以前的订单，这样客户的信息就
不需要重新输入了，只需要重新添加产品编码即可 — *"for a repeat customer, duplicate
a previous order so the customer details don't need re-entering; only the product
codes need changing."* The next screen is annotated 这是点复制后保留的信息，然后再
进行更改产品编码和UC，日期等新信息 — *"this is what's retained after copying; then
change the product code, UC, date etc."*

**So the UC is carried over by the copy and must be manually overwritten.** That
is the structural cause of every UC anomaly found this week — `UC4657` appearing
on two invoices, and `SI240240` carrying a reference belonging to Rex Wong.
They are not random typos; they are one specific, repeatable slip: duplicating an
order and forgetting to change the UC.

That matters for design. **An app that allocates the UC automatically on a new
order removes this whole error class** — it is one of the strongest arguments yet
for moving allocation off the spreadsheet.

**Built, same day (commit `8a9bff2`).** The order model had nowhere to even put
a UC — `normOrder` had `erp_pi_no`/`erp_so_no` but no `uc_no`, and `source`
collapsed anything that wasn't an in-app quote into `imported_pi`, with no
representation for an order the app originated itself. Added:

- `uc_no` on the order (free text, same as `erp_pi_no` — normally still typed in
  from Cindy's list, unchanged from today's practice) and a `duplicated` source.
- `allocateOrderUc` (`ucRegistry.js`) — allocates a fresh UC via the existing
  admin-gated `/api/uc` create op and returns the full `UC####/YY` form. Added
  `'App'` to `UC_SOURCES` so app-issued numbers are visible in the registry UI
  rather than falling into Other.
- **A Duplicate button on the Shipments list**, matching where CuiLing actually
  triggers it in JES. Copies customer, currency, incoterm, destination, notes,
  lines; resets `erp_pi_no`/`erp_so_no`/date/status/totals (they belong to the
  source document); **allocates a fresh UC instead of copying the source
  order's** — the one behaviour change that closes the error class.
- UC# as a third field on the order form, alongside PI Number and SO/Doc No.

This changes nothing about a regular new order — UC stays a hand-typed field,
same habit as today. Only Duplicate behaves differently, because Duplicate is
where the bug lives.

**Verified:** full `npm run build` clean (2137 modules), dev server boots with
no console errors, `/shipments` redirects to sign-in as expected. **Not
verified:** anything past the sign-in wall — the actual `/api/uc` call needs
admin auth, which was not entered. CuiLing or the owner should click through one
real Duplicate before relying on it.

#### ⚠️ First version was built into a component that never renders — fixed same evening

Owner: *"where is the duplicate? i can't find it."* Because it wasn't visible —
`Shipments.jsx`, the file the feature above was built into, is **dead code**:
imported once in `App.jsx`, never rendered as a JSX element anywhere. `/shipments`
redirects to `/shipping`, which renders a different component entirely —
`ShipmentsList` inside `Shipping.jsx`, a table, not a card list. Picked the file
by name matching what a "shipments list" ought to be called, without tracing the
actual route first — the same mistake as the `FGDestructionItemDetail` monitor
filter earlier tonight: pattern-matched on a name instead of checking what
actually runs.

**Fixed, commit `8883762`.** Moved the whole feature into the real
`ShipmentsList` — Duplicate is now a trailing icon column in the orders table,
with `uc_no` shown next to the customer name. `Shipments.jsx` reverted to its
pre-tonight state; it is still dead/unrouted code and a candidate for deletion,
left for the owner rather than removed silently. Rebuilt clean, same
verification limit as before — the click-through itself still needs a real
signed-in session.

**The UC lives in the SO `Reference` field**, in full `UC####/YY` form —
`raw.salesorder.soref`. Verified against the screenshots exactly
(`SO260024 → UC4944/26 → 7,613.94`, matching the registry to the cent).
**73 of 76 SOs since 2025 carry one**, so the SO→UC join is nearly complete and
directly usable.

Also visible in the live list: **`UC4920//26`** — a double-slash typo, exactly
one row (`SO260017`). Real, and the kind of thing an allocator prevents.

### ⚠️ JES's own exchange rates are NOT the PBIS rates — never source them

The SO screen carries an Exchange Rate field, and it disagrees wildly with
Cindy's audit table:

| Currency | JES `soexrate` (since 2025) | PBIS FY2026-27 |
|---|---|---|
| USD | **1** (39 orders) | **7.75** |
| EUR | 8.5 (13), 8.6 (5), **0.85** (1) | **9.00** |
| GBP | **7.5** (2) | **10.50** |
| AED | 3.67 | *(not in the table)* |

USD orders default to `1`, EUR varies across three values including a
reciprocal-looking `0.85`. **JES's rate field is unreliable and unrelated to the
books.** The PBIS export must take rates only from Cindy's audit table — this now
has three independent confirmations.

`AED` also appears, and is not in her rate table at all.

### Smaller observations worth keeping

- The Sales Invoice header has a **`Prefix` dropdown** (`SALES INVOICE`), so other
  document prefixes exist in that screen — but `sidoctype` is `SALESINVOICE` on
  all 5,455 rows, so **DN/CN do not live there.** Still unresolved pending
  Cindy's captures; `salesreturn`/`purchasereturn` carry a null doctype.
- The invoice has **`Gst Amt %`** (tax) and **`Change all warehouse to`** — the
  latter is how the FTBS deduction is targeted.
- The Document Loading dialog has a **`Production In Item`** checkbox, tying
  invoice creation to production-in.
- Statuses `OPEN` / `CONFIRMED` are visible throughout the SO list, consistent
  with the confirmation finding.

### New requirement: a 31 March stock valuation for the year-end audit

Cindy needs a snapshot **value** at the financial year end, in three parts:

| Part | Where it lives today | App readiness |
|---|---|---|
| **B2C finished goods** | Excel, managed by **ChunCi** — not in JES | ❌ outside both systems |
| **Done but not yet shipped** | nowhere — derivable from order state | 🟡 conditional, see below |
| **Components in the warehouse** | app ledgers (after the stocktake) | 🟡 quantities yes, value no |

**This partly reverses the "output is implicit" decision** (§4 of the retirement
plan). The audit needs a done-but-not-shipped figure, which is a finished-goods
value. The saving grace is that it does **not** require holding a finished-goods
balance — it can be *derived* from orders that have had production-in but are not
yet shipped, valued at BOM cost. Derivation rather than a stored balance keeps
the original decision intact.

⚠️ **Correction to the owner's proposed method.** The suggestion was to derive it
from sales invoices plus `uc_registry`. Those tell you what has been *invoiced* —
so their complement is "not yet invoiced", which is **not** the same as "produced
but not shipped". An order can be un-invoiced and not yet made. **Only the app's
production-in timestamp distinguishes them.**

**Consequence: XiangXia's trial period is load-bearing, not just habit-forming.**
If production-in is not recorded between now and the year end, the
done-but-not-shipped figure cannot be produced at all. That changes "try to use
the app as much as possible" into a requirement with an audit deadline attached.

**Gap to build: nothing in the app values stock.** The ingredients both exist —
quantities in the ledgers, `unit_cost` volume tiers on components — but nothing
multiplies them. A valuation report is well scoped and now has a date attached.

**Two things to settle with Cindy:**

1. **Which 31 March?** If it is 2026-03-31 this is historical reconstruction from
   JES and the Excels; if 2027-03-31 the app can be designed to produce it. Very
   different pieces of work.
2. **Which cost basis?** Component costs are stored as *volume tiers*
   (`min_qty` / `unit_cost`), so there is no single unit cost to read. Audit
   valuation usually wants actual purchase cost — that rule needs stating.

**Also new: ChunCi is a fourth person and a third spreadsheet.** The map is now
XiangXia (production, stock, item master, purchasing — keeps the metal stock
Excel), CuiLing (sales orders, invoices), Cindy (books, UC registry, PBIS),
ChunCi (B2C finished goods Excel).

### ⚠️ JES blocks invoicing without FTBS stock — production and sales are coupled

CuiLing, asked whether JES will raise an invoice when the finished-goods
warehouse is short: *「成品倉唔夠料，JES confirm唔到單。我要做adjustment，
在成品倉加數量才能夠confirm invoice.」* — **it will not confirm.** The invoice
stays `open` until someone manually adjusts stock into FTBS.

This was flagged as the one thing to check before setting a production cutover
date, and the answer is the bad one. Once production-in stops, FTBS is never
replenished, so **the work does not disappear — it moves from XiangXia to
CuiLing.** That inverts the argument that made production the safe first step
(migrate what the team most wants rid of).

| Since 2025 | |
|---|---:|
| SI movements out of FTBS | 924 |
| IA adjustments into FTBS | 218 (all user `ADM`) |
| Days those fall on | **20** |

FTBS is *already* short often enough to need topping up every two to three
weeks, and it is done in **batches, not per invoice**. So the interim is a
**periodic bulk top-up**, not an adjustment per document — a workaround to keep
a number JES demands and nobody trusts, given the real stock lives in Excel.

**Consequence for the meeting: production is not "pure removal of work".** For
CuiLing it adds some. Full detail in `JES-RETIREMENT-PLAN.md` §4 checklist.

### The UC registry was built and never adopted (found 2026-07-19)

Owner asked CuiLing and Cindy how UC numbers are allocated. Answer: **Cindy keeps
an Excel file and CuiLing fetches a number from it when a new order comes in.
Cindy still owns the registry.**

Checked against the data, and it is unambiguous:

| | |
|---|---|
| Rows in `uc_registry` | 3,691 |
| Rows **not** created by the migration | **0** |
| `migrated = true` | **3,691 (all)** |

V7.14 replaced the team's `Invoice_Check_lists.xls` with `/uc-registry`, and the
app **already allocates UC numbers server-side** (`uc_no` is a DB default,
never client-set — see `netlify/edge-functions/uc.js`). But **not one number has
ever been issued through it.** Every row is a one-time import of Cindy's
spreadsheet, so the app's copy is a snapshot that begins ageing immediately.

That explains the one genuine gap found in the PBIS reconciliation — `UC4926`
with a blank `jes_si`, since fixed. (`UC4933` looked like a second case but was
not: it is correctly marked `VOID`, and voids are filtered between the working
`.xls` and the CSV. See `PBIS-IMPORT-FORMAT.md`.)

**This is the adoption risk in `JES-RETIREMENT-PLAN.md` §5, already realised
once.** A feature shipped, the old spreadsheet kept running, and nobody noticed
for two cycles. It also means UC allocation must genuinely move into the app
before the app can issue invoices — and **the person to convince is Cindy, not
CuiLing.** Two systems both handing out UC numbers would collide.

### What CuiLing actually sends: a JES-generated PI, printed to PDF

So before she can stop using JES, **the app must generate the PI document**. It
can print quotes, packing lists and purchase orders; it cannot produce a sales
order or invoice document. That is the concrete build item for her area.

Worth noting the loop this closes: the app currently **AI-parses a PDF of that
PI** (`netlify/edge-functions/extract-pi.js`) to get data it would already hold
if it had generated the document. Generating the PI removes the parse entirely —
this is exactly the "stop double-entry" of step 3.

### Correction: Mascot is dormant, not finished

Yesterday's note concluded that because M03's last invoice was 2024-12-27, `UC`
was safe as a universal key going forward. **Owner: Mascot still has business,
"maybe one order per year."** So the `UA` series is dormant, not dead, and the
app cannot assume every sale carries a UC. ~340 of M03's 379 invoices sit outside
the registry.

## Where V7.16 starts

**On the LAN (the office Mac), in order:**

1. `cd erp-sync && .venv/bin/python probe_lastupdate.py` — then the manual check
   it prints: edit one record in JES, re-run, see whether `LastUpdate` moved.
   **This decides whether incremental sync is possible at all.** Record the
   answer per table here.
2. Find the item-image folder (`JES.ini` / the JES client — `systemsetting`'s
   path columns are all suffixed `_notuse`), then
   `sync_images.py --folder "<path>" --report`, check the numbers, `--upload`.
   See `IMAGE-SYNC-PLAN.md`.
3. Run the sync.

**Then, in dependency order:**

4. **Incremental sync** switched on for whichever tables the probe cleared.
5. **SO import by number** (built, `src/erpSoImport.js`) becomes useful once the
   mirror is current.
6. **Production off JES** — the first real retirement step (see above).
7. **Item master / BOM**, then **stock**, then **sales documents**. Invoicing
   last; it needs the PBIS import file.

**Waiting on people, not code:**

- **Screen snapshots** from the team — the gap map depends on them, and they
  are the main protection against discovering an unknown function late.
- **The JES→PBIS import file** from Cindy. What we have is PBIS *output*; the
  import format is still unseen and is what an app-generated invoice must match.
- The three decisions in §5.

**Housekeeping carried forward:**

- Run `Settings → Component Codes` across all components — if many sit on
  superseded alloy codes, that is a costing-accuracy problem, not just tidiness.
- A build pass on a Mac with Node (see Deployment notes).
- `render-service/engine/core.py` holds committed but **inert** customizer
  iridescence work — the `coating` path is never called, and produces no visible
  change on light crystals even when it is. Fix noted in commit `3bb9d31`.
- `/bank-audit` was a one-off; it can go once bank accounts are settled.

### Deployment notes

- No new env vars this cycle. New Supabase objects: `bank_accounts`,
  `bank_accounts_audit`, `erp_stock`, `erp_warehouse`, `erp_item_type`,
  `erp_component_usage`; `erp_item` gained image columns; `erp_customer` /
  `erp_supplier` were dropped and recreated with detail fields.
- **`refresh_views.sql` now refreshes `erp_stock` after `erp_item`** (it joins it).
- Almost nothing this cycle was build-tested — this Mac has no Node, so changes
  were parsed with `esbuild` and verified by the owner on the deployed site. A
  build pass on a Mac with Node is overdue.

## Current Status — V7.14 CLOSED as of 2026-07-17

**Deployed to Netlify (live `03b922b`).** Commit chain `57b5f3c`→`03b922b`
(18 commits). V7.14's theme was **getting the legacy ERP's data out of the ERP
and into this app** — a one-way archive of the whole JES database into Supabase,
a set of read-only lookups in the app on top of it, and then replacing the
team's cross-channel invoice-tracking spreadsheet with a real registry.

### 1. ERP → Supabase archive (`erp-sync/`, tagged V1.0)

Built and ran a one-way, **read-only** mirror of the legacy JES ERP into a new
Supabase Postgres project. See `erp-sync/ERP-SYNC-V1.0.md` for the full as-built
document; the essentials:

- **Environment (discovered on site):** SQL Server 2008 R2 on `192.168.10.251`
  (machine `SQDB08`), real database **`JES_UnitedArt`** (the `UNITEDART` in
  `JES.ini` is only JES's alias). The `sa` password in `JES.ini` is app-encoded
  and unusable; the read-only login was created by connecting as the Windows
  `administrator` over **NTLM**.
- **`erp_readonly`** SQL login (`db_datareader`, write-blocked — verified) is
  what the sync uses. Credentials live only in `erp-sync/.env` (git-ignored).
- **Pure-Python drivers** (`python-tds`) — deliberately no Homebrew/unixODBC, so
  the tool runs on the on-site M1 Mac (and would run on a Raspberry Pi unchanged).
- **Result: 494 tables · 18.7 M rows · ~2.9 GB** in Supabase `raw.*`. The 42 GB
  source shrank because `nchar` padding and SQL Server indexes aren't copied.
  Chinese text is clean throughout. `SystemAudit`/`LogonLog` deliberately skipped.
- **Two real bugs found and fixed during the first full run** (both in `sync.py`):
  a legacy Big5 `varchar` column with bytes invalid in cp950 blew up the client
  decoder and *wedged the connection*, cascading into 305 failed tables. Fixed by
  converting non-Unicode columns to `NVARCHAR` server-side, plus a per-table
  source reconnect so one bad table can never cascade again.
- Perf: write batch tuned 1000 → 5000 rows (~3.7× faster).

### 2. ERP Lookup in the app (Phases 1–5)

A new admin-only **ERP Lookup** page (`/erp-lookup`) reading the archive through
a curated SQL layer — the app never touches `raw.*` directly.

- **Access path:** browser → `/api/erp` Netlify edge function (verifies the
  caller's Firebase token **and** `role: 'admin'`) → Supabase via the secret key
  **server-side**. The Supabase key and the ERP data never reach the browser.
  Admin-gating the whole endpoint matters because item/invoice data carries
  costs, margins and supplier pricing.
- **Phase 1** — customer + supplier lookup.
- **Phase 2** — item master. `raw.item` is a revision-*history* table (1.4 M rows,
  ~44 k codes, ~32 revisions each), so `erp_item` is a **materialized view of the
  latest revision per code** (~44 k rows, trigram-indexed). Search went 7 s → ~350 ms.
- **Phase 3** — **BOM explosion**. `erp_bom` materialized view (current BOM =
  latest revision per parent, ~432 k of 10.3 M lines) plus `explode_bom(code)`, a
  recursive, cycle-guarded, depth-capped function returning the full multi-level
  tree with extended quantities. Surfaced as a tree modal.
- **Phase 4** — sales invoices + sales orders (header search + line-items modal).
- **Phase 5** — purchase orders (same shape, keyed to supplier).
- **Money breakdown fix:** the first version of the lines modal totalled only the
  line items, which does **not** reconcile with the header once discounts/freight
  /tax apply. Freight, delivery, packing and card charges turned out to be
  **surcharge lines in separate tables**, and tax is `sigstamount`. The modal now
  shows the true breakdown: `subtotal − discount + surcharges + tax = grand total`,
  then deposit and balance. Verified against real documents.
- Both matviews are refreshed automatically after each sync (`refresh_views.sql`,
  run by `sync.py` on a clean finish).

### 3. UC Invoice Registry — replaced the tracking spreadsheet

The team tracked every order across **ERP, Alibaba, Amazon, online shop and
retail** in a shared `Invoice_Check_lists.xls`, assigning a unique **UC#** to each.
That is now a real feature (`/uc-registry`).

- **One Supabase table, `public.uc_registry`** — the *whole* registry (all 3,691
  historical rows plus everything new). Initially built on Firestore, then
  **deliberately moved to Supabase** so live and history live in one SQL table,
  joinable to the ERP invoices, with proper search and reporting.
- **UC# allocation is a Postgres sequence** (`uc_seq`, via the `uc_no` column
  default) — atomic and collision-free, which the shared spreadsheet never was.
  Next number is **UC4949** (history ends at UC4948).
- **Migration reality check:** 2,059 rows had an outstanding balance, but dating
  back to 2016 — the `O/S Balance` column was never zeroed on payment. So only
  the **81 genuinely-recent (2025–26) outstanding items** are `open`; all older
  history is `closed`. This also stops stale balances polluting the AR totals.
- **Write path:** `/api/uc` edge function (list/create/update), same admin gate
  and server-side key as `/api/erp`.
- **Features:** outstanding-by-currency AR summary; search; filters for
  **source**, **status (Open/Closed/Void/All)** and **confirmed**; 500-row pages;
  **Void** status for cancelled/mistaken UC#s (keeps the number for audit, excluded
  from AR); a **date picker** that auto-fills the sheet-style `/YY` year; and a
  **search-as-you-type ERP invoice picker** (supports the real workflow: create the
  UC first, link the SI# later). A row's **JES SI# drills into the real ERP
  invoice** — lines, surcharges and full money breakdown.
- The separate "UC History" tab was removed once the registry held everything —
  keeping it would have recreated the two-places split the owner wanted gone.

### 4. Infrastructure / workflow

- **iCloud was silently corrupting this git repo.** Found duplicate
  `main 2`…`main 7` ref/index files dating back weeks, from iCloud racing with
  git writes; a `git fetch` finally tripped on it. Cleaned (`git fsck` now clean)
  and **the repo moved out of iCloud to `~/Developer/costing-tool`** on both Macs.
  Git — not a synced folder — is now the sync mechanism. See "Working across two
  Macs" at the top of this file.
- Git push from the on-site Mac is authenticated with a fine-grained PAT stored
  in the macOS keychain.

### Deployment requirements introduced this cycle

- **Netlify env vars:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the `sb_secret_…`
  server-side key — *not* the publishable one). `VITE_FIREBASE_PROJECT_ID` is
  reused for token verification; no new Firebase var is needed.
- Supabase project **JES** (`vpcwakkotlpfixqpzqmr`, ap-northeast-2, Pro plan),
  reached over the **session pooler** on port 5432 (the direct host is IPv6-only).
- The ERP sync itself must run from a machine **on the Crystocraft LAN and the
  internet at once** — currently the on-site Mac, run manually.

### Known gaps / where V7.15 could start

- **Incremental sync is not enabled.** All 494 tables are full-replace. The four
  giants all have a PK + `LastUpdate`, so they're ready for it, but two things
  must happen first: `ensure_target_table` creates no unique index, so the
  upsert's `ON CONFLICT` would fail; and `LastUpdate` needs verifying that it
  changes on every *edit*, not just insert. Until then, **transaction data
  (invoices/orders/POs) is only as fresh as the last manual sync** — the app
  labels it "as of last sync". This is the highest-value next step.
- **Nothing in this cycle was build-tested locally** — the on-site Mac has no
  Node, so every UI change was verified by the owner on the deployed site. Worth
  a pass with the build running.
- **The "Confirmed" flag** was carried over from the spreadsheet; its exact
  business meaning is pending the team's input (keep / rename / drop).
- **Dormant leftovers**, harmless but removable: the Firestore `uc_invoices`
  collection (81 imported docs) and its `firestore.rules` blocks, plus the
  `erp_uc_archive` table — all superseded by `uc_registry`.
- `erp-sync/.venv` has stale absolute paths from the folder move (`pip` shebang
  broken; `python -m pip` works). Recreating the venv would tidy it.

## Current Status — V7.13 CLOSED as of 2026-07-14

**Deployed to Netlify (live `7819bb0`).** Owner's stated focus for V7.13 was
"more inventory build" — this cycle moved component inventory off the ERP and
onto this app as the source of truth, across all three material classes, plus
a same-session bug-fix batch. **V7.14 begins fresh in a new conversation.**

### The inventory build (core of V7.13)

**Starting decision — TWO deduction mechanisms, not one.** Reviewed the
owner's live ERP export (`FSTK.XLS`, 255-line warehouse balance) and a manual
crystal in/out ledger (`捷克水晶进出仓明细2026.xls`, 26 colour-SKU sheets,
1,183 issue rows across ~3.5 years). Finding: 84% of crystal issues were
already batch-per-order-per-colour tied to a PI/SO; ~15% were samples,
exhibition pieces, and defects with **no order at all** — a per-product BOM
model structurally can't record that 15%, so it would drift from the ERP
within weeks. Decision, agreed with the owner:
- **Metal components** → per-unit BOM explosion (pre-existing; deterministic,
  forward-MRP-worthy).
- **Crystals & packaging** → **batch issue per order** against an append-only
  ledger, no per-product colour/type BOM. Full evidence and reasoning kept in
  `Inventory_Roadmap_V7.13_Spec.md` (in-repo).

**Foundation — the stock ledger (`src/stockLedger.js`).** On-hand became a
DERIVED running balance over append-only movements (`range_components/{id}
/movements` etc.), never a mutable number written in place — the previous
`stock_qty` field is now only ever a cached mirror, updated inside the same
Firestore transaction as every movement. `postMovement()` lazily seeds an
opening balance on first use (no separate migration script). Movement types:
receipt / issue / adjustment / stocktake, later extended with reserve /
release / produce (see below). Every write path that used to touch `stock_qty`
directly (inline stock editor, the component edit form, the bulk stock-list
importer) now posts a movement instead.

**Order-driven deduction — metal (step 2), then crystals + packaging.** A
manual, reversible "Issue" action per order (owner's explicit choice over
auto-on-confirm / auto-on-ship): metal reuses the existing MRP BOM explosion
so issued quantities always match the Requirements report; crystals and
packaging get a manual multi-line batch picker per order (mirrors the Excel
practice). Both idempotent and reversible, order-tagged so a SKU's ledger
shows which order consumed it.

**Three inventory classes, one engine.** Crystals (`src/crystals.js`) and
packaging (`src/packaging.js`) were built as their own Firestore collections
so they never enter the figurine MRP/BOM, then unified into a single generic
"simple inventory class" factory (`src/inventoryClass.js`) — net −401 lines,
zero data migration (every field name preserved via a per-class config
object). Metal (`range_components`) stayed a separate, richer implementation
(plating, supplier quotes, BOM links, MRP) — deliberately not folded in.

**Reserve → Production-in (two-stage model, all three classes).** The owner
clarified the real ERP workflow mid-cycle: components are **reserved** at
order confirmation + deposit (allocated, sitting on the production line,
on-hand unchanged) and only **produced-in / committed** later when actually
built into finished goods. This was wanted for crystals and packaging too, to
calculate correct vendor material requirements. Implementation:
- Ledger gained a second balance — **Reserved** — alongside on-hand, with
  **Available = On-hand − Reserved**. New movement types `reserve` / `release`
  / `produce`, all inside `stockLedger.js`'s `movementEffect()`.
- Generic order functions in `src/orderStock.js`: `reserveForOrder` /
  `produceForOrder` / `releaseForOrder` / `reverseProduceForOrder`, driven by
  a per-class config (`metalOrderConfig`, plus `crystalInventory.order` /
  `packagingInventory.order`). Legacy single-stage "issued" orders from the
  first metal build read as already-produced-in and reverse cleanly — no
  backfill needed.
- **Available**, not raw on-hand, now drives admin buildable
  (`buildableFromComponents`/`makeLeadWeeks` in `criticalComponents.js`), the
  customer figurine page, and the Component Requirements/MRP report — so a
  reserved order genuinely stops a new order from being promised the same
  stock, and the MRP report excludes already-reserved/committed orders from
  demand (this also closed the earlier "double-counts a reserved order's
  demand" gap).

**Visibility — Inventory Status page.** New `/inventory` screen
(`src/pages/InventoryStatus.jsx`) aggregating all three classes: On-hand /
Reserved / Available, sortable columns, a class filter, a "reorder only"
toggle, and CSV export for handing straight to purchasing. Each SKU now has
an editable **reorder point** (default: flag only when Available goes
negative) so hot/active items can be flagged before they run dry, not after.

**Closing the loop — PU receive-to-stock.** New `src/poReceive.js` +
`PoReceiveStock.jsx` card on the Purchase Order detail page: matches each PU
line to an inventory SKU (explicit component link first, then item code,
across all three classes), posts a `receipt` movement per line tagged with
the PU number, defaults received qty to ordered qty but is editable per line
for partial deliveries, idempotent + reversible. Completes **reorder list →
raise PU → goods arrive → Receive → stock rises**, with two-way traceability
between a PU and the SKUs it stocked.

### Same-session bug-fix batch (separate from the inventory build)

- **Customer catalogue lost your place.** Opening a product detail then going
  back reset the search/category/status filters and jumped to the top of the
  catalogue. Fixed on both storefronts (figurine + corporate): filters persist
  in `sessionStorage`, and the last-opened card scrolls back into view on
  return.
- **"Make admin" was a one-click trade-secret risk.** A stray click on Portal
  → Account could silently promote a customer to full admin (sees every
  cost/margin/supplier in the tool). Now requires typing `MAKE ADMIN` to
  confirm, restyled as a red danger action; "Revoke admin" now reverts to a
  normal **approved** customer (keeps shopping access, loses costing access)
  instead of dropping them to pending.
- **Packing list — pallet CBM/weight didn't match reality.** The team's Excel
  reference showed two different, intentionally-non-reconciling views: loose
  carton dimensions/weight (what the customer sees when they unpack) vs. the
  final wrapped-pallet dimensions/weight (what customs/the forwarder need,
  which is *larger* than the carton sum due to stacking gaps, plus the
  pallet's own timber weight). The app was only using the carton sum. Fixed
  with a two-view split: the carton table's totals row stays as loose-carton
  sums (reconciles down the columns); a new boxed **PALLET SUMMARY** section
  shows each pallet's wrapped dimensions, final weight (cartons + pallet
  weight), and final CBM (from the pallet's own measured L×W×H), with the
  carton subtotal alongside for cross-reference. Pallet weight defaults to
  8kg but is now editable per pallet (real pallets vary). Shared calc
  (`palletisedTotals()` in `src/packing.js`) keeps the editor and the printed
  PDF in agreement.
- **Carton numbering didn't match physical stacking.** Each carton card now
  has up/down move controls; moving a carton renumbers the whole list (CTN
  ranges recompute automatically) so the printed sequence can be made to
  match how the cartons are actually stacked on the pallet.

### Rules-paste log (manual Firebase Console pastes, all confirmed done)
`range_components/{id}/movements`, `crystals/{id}` + its `movements`,
`packaging/{id}` + its `movements`. The R1 reserve/release/produce movement
types and the PU-receive feature needed **no** rules changes (existing paths
already admin-ruled).

### Commit chain (in order)
`77cfa43` → `d8f5416` → `0fa8a2d` → `2837756` (roadmap spec) → `9313997`
(ledger step 1) → `81ea847` (metal issue step 2) → `551bab5` (crystals-1) →
`edf2355` (crystals-2) → `564b8c9` (packaging) → `716bd11` (DRY unify) →
`e1a91d5` (reserve/produce R1) → `09796b8` (Available-everywhere R2) →
`4c29477` (Inventory Status page) → `1ff96f4` (sort + reorder point) →
`78ea100` (Make-admin guard + pallet CBM/weight) → `717f86b` (catalogue
filter persistence) → `7c89b98` (pallet two-view split) → `b3620fe`
(editable pallet weight) → `af5a5dd` (carton reorder) → `7819bb0` (PU
receive-to-stock).

### What's verified vs. what still needs owner eyes
Every change in this cycle is build-clean and the pure logic (ledger
math, palletised totals, PU-line matching, requirements exclusion) is
headless-tested. Most UI was click-through-verified live by the owner
during the session; the **PU receive-to-stock feature was built and tested
headlessly while the owner was away and has not yet been exercised live** —
first thing to check next session.

### Deliberately not done in V7.13 (candidates for V7.14+)
- **Financial-truth milestone** — a valuation basis (weighted-avg/FIFO; "last
  actual paid" from the PU↔component link is *not* a valuation method) and a
  period-lock, the real prerequisite for retiring the ERP for accounting
  purposes (V7.13 only delivers *operational* truth).
- **Migration path** — one clean opening-balance stock-take, then a shadow-run
  reconciling this app's ledger against the ERP's `FSTK` for a full cycle,
  before anyone trusts this as the sole source of truth.
- Owner may also want to route their team's review/feedback from this session
  into a fresh bug/polish batch before starting new feature work.

Full decision-by-decision write-up (including the crystal-Excel evidence
counts) lives in `Inventory_Roadmap_V7.13_Spec.md` in this repo.

## Current Status — V7.12 CLOSED as of 2026-07-10

**Deployed to Netlify (live `315eff4`).** Never got a full write-up in this
in-repo file at the time — recorded here for continuity between V7.11 and
V7.13. Commit chain `d28a1ad`→`315eff4` (14 commits).

- **Supplier PO module** (centrepiece) — fast PO draft/print/parse tool: PDF
  parser (Gemini), PU number optional/typed-in-later (ERP stays the source of
  truth for the assigned number), PU↔component "last actual paid" link
  (deliberately decoupled from costing — quotes still drive cost), duplicate/
  reorder, supplier-page integration. MRP netting deliberately deferred.
- **Mobile scroll stuck/bouncing** on admin pages — `Layout.jsx`'s `h-screen`
  (100vh) didn't track the real mobile viewport as the address bar hid/showed
  during scroll; fixed with a `100dvh`/`100vh`-fallback utility +
  `overscroll-contain`.
- **Quote module fine-tuning** — editable Remarks (was read-only-if-set),
  AMOUNT column + grand TOTAL row on the PDF, QU P/O No. + Ref No. header
  fields, Issued By/Confirmed by signature blocks, a Preview PDF button, and
  a one-time company stamp/signature upload (Settings → Quote Branding) that
  auto-overlays on every future quote.

Full detail in memory `project-supplier-po-module.md` / Obsidian.

## Current Status — V7.11 CLOSED as of 2026-07-09

**Deployed to Netlify (live `4fc963d`).** CRM pipeline/fulfilment split + a
manual (non-AI) image editor with crop/rotate + a new **Production module**
(renamed from Shipping) carrying a light-MRP Component Requirements report +
a real bug hunt across PI save/reconciliation/packing/orders that turned up
and fixed several separate root causes. Commit chain on `main`: `6153ceb` →
`5363988` → `1e51845` → `149a3c5` → `8e37f83` → `1cbfcf6` → `a8c3e44` →
`97a3143` → `8ce7c3e` → `cc82008` → `be856c3` → `21a9473` → `85588bd` →
`7c27f03` → `1d3e4b9` → `d6ac1ff` → `ba9e600` → `4e9af3f` → `7ba449c` (docs)
→ `c6c9d76` → `399038e` → `4fc963d`.

**V7.12 begins fresh in a new conversation.** No open threads from V7.11 —
every fix in this batch was headlessly tested (pure-logic modules) or
build-verified; the handful of purely-visual pieces (crop drag feel, table
layout, order-picker UX) were confirmed live by the owner. Next likely focus:
**MRP Phase 2 — deduct component stock on order confirmation** (idempotency +
negative-stock decisions flagged, not yet made), or a fresh bug/feature batch
as raised.

### Post-close-out follow-ups (2026-07-09, `c6c9d76`→`4fc963d`)
Owner testing surfaced three more issues on the MRP order picker, all fixed
after the initial close-out:
- **New PIs missing from Orders list / MRP picker / Dashboard** (`c6c9d76`):
  `useOrders()` queried with `orderBy('createdAt', 'desc')`. Firestore's
  `orderBy` is *also a filter* — it silently excludes any doc where that
  field is absent or not yet resolved. A freshly-created order's
  `createdAt: serverTimestamp()` is a local placeholder until the write is
  server-acked, so a just-created PI could vanish from every screen backed by
  this hook even though it was saved and reconciled. Dropped the Firestore
  `orderBy`, sort client-side instead (same fix already applied to
  `loadCustomers` — this is a recurring trap, see
  [[lesson-firestore-orderby-is-a-filter]]).
- **No total-count indicator** (`399038e`): the picker's list gave no way to
  tell "only 6 loaded" from "all 19 loaded, scroll for more". Header now
  shows the total; also confirmed `/orders` Firestore rules are a plain
  `isAdmin()` check (not per-field), ruling out rules-level filtering.
- **Picker UX was genuinely confusing** (`4fc963d`): it crammed all 19 orders
  — 11 already shipped/delivered and irrelevant to production — into a ~6-row
  internal scroll box sorted by date, so the 8 that mattered were scattered
  and mostly below the fold (the one Ready order sat near the bottom), making
  it *look* like data was missing even though the count was correct. Fixed by
  defaulting the picker to **live-demand orders only** (Confirmed/Packing/
  Ready) with a "Show all (N)" toggle, and **removing the internal scroll box**
  entirely so rows render inline and the page scrolls. **Lesson:** a matching
  count is not the same as a usable screen — the owner's "this is chaotic"
  feedback, not the numbers, is what identified the real problem.

### CRM: sales pipeline vs. order fulfilment (Dashboard, CustomerDetail, EnquiryForm)
- **Root problem:** a customer with a live production order *and* a separate
  new-order enquiry only showed one of the two on the Dashboard — every
  customer was collapsed to their single "latest" enquiry before any stat
  card saw the data, so whichever thread wasn't newest was silently hidden.
  Separately, production status lived on a dated interaction-log entry, so
  "closing" a production job meant editing history — which a time-based log
  should never require.
- **Fix — Dashboard cards now read from the right source per concern:**
  **In Production** and **New Orders — 30 Days** are now **order-based**
  (`orders` collection, status Confirmed/Packing/Ready and PI date in the
  last 30 days respectively) instead of enquiry-based, so a customer can
  appear in both cards independently and closing a job = marking its order
  **Shipped** (in the Shipping/Production module) — no log editing, ever.
  **Pipeline** stays enquiry-based but is now deduped *within* each status
  class rather than globally, so parallel threads never hide one another.
  Follow-ups are task-driven (any thread with a due date surfaces, latest or
  not).
- **Interaction-log status redesign:** trimmed to a pure sales-pipeline
  vocabulary — **Open / Quoted / Confirmed / Lost / On Hold** — dropping
  **In Production** and **Completed** (those are fulfilment, now owned
  exclusively by the Order). Confirmed/legacy terminal states sort into a
  **History** section below still-active threads (active pinned on top,
  each group newest-first). Fixed a pre-existing bug where **Confirmed**
  rendered as a plain grey badge instead of green ("won").
- **Topic tags** (thread labels: General/New Order/Production/Support) were
  built, shipped, then removed same-session per owner feedback ("very
  distracting") — the active/history pinning and dashboard fix, which
  actually solved the reported problem, were kept.
- **Lesson:** a flat, date-sorted log conflates *when something happened*
  with *what state it's in* — resolving one thread's status must never be
  able to visually or structurally bury a different, still-open thread.
  Production/fulfilment state belongs on the entity it describes (the
  Order), not on a diary entry about it.

### Image editor: manual Adjust tab + crop/rotate (non-AI)
Built in response to the AI enhance/background tool being unpredictable,
slow (~30s edge-function ceiling), and overkill for small touch-ups —
deterministic pixel edits don't need AI at all.
- **Stage 1 — Adjustments** (`src/components/ManualAdjust.jsx`, new): live
  Brightness / Contrast / Saturation / Warmth / Sharpness sliders with
  before/after preview and Reset, rendered via canvas (`ctx.filter` for the
  first three, hand-written pixel passes for warmth + unsharp-mask
  sharpen — both covered by headless pixel-math tests). Wired as an
  **"Adjust (manual)"** tab alongside AI enhance in **both** image editors:
  the shared corp-gift/component `ImageGallery` and the figurine `RangeForm`
  (which has its own separate modal — would otherwise have been missed).
- **Stage 2 — Crop & rotate**: added `react-easy-crop` (interactive drag
  delegated to a proven library) + a new pure `src/imageCrop.js`
  (`getCroppedCanvas`, rotation/bounding-box math — headlessly tested) for
  aspect presets (Square/4:3/3:4/16:9/Original), 90° rotate, and a ±45°
  straighten slider. **Two follow-up bugs caught after initial ship:**
  the library's required CSS was never imported (cropper mounted unstyled,
  undraggable) — fixed with one import line; and a `fetch(src)` CORS block
  meant the editor couldn't load images at all — fixed by loading via a
  `crossOrigin` `<img>` (the same approach the AI path already used) with a
  same-origin `/api/image-proxy` fallback.
- **`image-proxy` allowlist widened** to `crystocraft.com` (WordPress) in
  addition to Firebase Storage — figurine photos imported from the
  catalogue blog live there and the proxy fallback was 403-ing on them.
- **Corp-gift component (BOM) images could never reach any of this** —
  `ComponentDetail.jsx`'s `ImageGallery` never had the `enhanceable` prop set
  (unlike the main product gallery), so those images had no edit button at
  all. Added.
- **Scroll position preserved across an image edit** (`ImageGallery.jsx`):
  captured on open, restored on close (Keep/Save-as-new/Discard/✕/backdrop),
  so replacing one image doesn't bounce the whole product page back to the
  top — lets you edit a gallery one image at a time.
- **Corp-gift product list** (`Products.jsx`) ported the figurine list's
  proven **id-based `scrollIntoView`** restore (was a fragile pixel
  `scrollTop`) — returning from a deep edit (e.g. Pricing) now lands back on
  the exact product card instead of the top of the list.

### Production module (renamed from Shipping) + Component Requirements (light MRP v1)
- **"Shipping" → "Production"** label rename (nav + page heading) — this
  module is now more production-planning than shipping-only. Route path
  `/shipping` and the internal `ShipmentForm` component name were
  deliberately left alone (invisible plumbing; renaming risks breaking
  links for no user benefit). Later, all remaining user-facing "Shipment"
  wording on the order page (title fallback, back link, save/delete
  buttons, error messages) was cleaned up to "Order" for the same reason —
  a half-renamed term is more confusing than an unrenamed one.
- **New "Requirements" tab** (`src/pages/ComponentRequirements.jsx` +
  pure engine `src/mrp.js`): select one or more confirmed PIs → explode
  each figurine line into its critical components (plating-aware, parsed
  from the item code) → aggregate gross requirement per component code
  across all lines/PIs → deduct current stock → shortage-to-order report,
  worst-first, with a shortages-only toggle and CSV export. **Read-only v1
  — no stock is mutated** (deduct-on-confirm is Phase 2, deferred by design
  per owner: no separate WIP-warehouse/reservation layer, matching the
  "revert to a single stock number, deduct on confirm" decision).
- **"Always needed" BOM scope** (`all_variants` flag, `criticalComponents.js`):
  fixed a real modelling gap — some figurine parts are fixed-finish but
  required on *every* variant (e.g. a gun-colour base), which the existing
  plating-inference logic wrongly treated as "only for that plating's SKU"
  and filtered out of other-plating orders. The new explicit scope overrides
  the inferred plating; centralized into `refScopePlating`/`refApplies` so
  MRP, `buildableFromComponents`, and `rangeCosting` all agree (previously
  each had its own copy of the plating filter).
- **"Not in product range" flagged loudly**: a PI line whose item code looks
  like a real figurine SKU but matches no product now surfaces in a **red**
  panel (code · qty · PI · description) instead of disappearing into the
  same quiet bucket as genuine non-figurine (corp-gift/charge) lines.
- **Reconciliation matcher bug (the real root cause of most of the above
  looking broken):** `matchRangeProduct` matched on the **design core only**
  and ignored `format_code`, so two different products sharing a design
  number (e.g. `D0355-001` "Mini Rose Freestand" vs `D0355-230` "Mini Rose
  with Crystal Bible") collapsed to one match key and picked a match
  arbitrarily — reconciliation had been silently linking some PI lines to
  the wrong product. Unified reconciliation with the same format-aware
  `matchProductCode` already used by the stock-list import and MRP (one
  matcher, no drift); `loadRangeProductsLite` was also missing
  `format_code` entirely, which would have silently defeated the fix.
  MRP itself is robust to this even for **already-saved** bad matches — it
  re-derives each line's product from the item code (unless the user
  explicitly confirmed a manual match).
- **"Re-match" button** on PI reconciliation: re-runs auto-match with the
  corrected matcher on an already-loaded PI, preserving any line the user
  classified manually — the one-click fix for PIs matched before this
  patch.
- **Blank product names in reconciliation + MRP:** range products have no
  dedicated name field — the display name is entered via **Description**
  (confirmed by RangeForm's own code comment: no separate name input
  exists). `loadRangeProductsLite` built its name from legacy
  `design_name`/`name` fields only, never checking `description`, so any
  recently-created product came back blank and reconciliation showed the
  confusing literal word **"matched"** instead of a name. Fixed in both
  `loadRangeProductsLite` (reconciliation) and a new shared `productLabel()`
  helper in `mrp.js` (the "Used by" column had the identical gap).
- **Orders tab** (was "Shipments"): rebuilt as a proper staff-facing table
  — Order Date · PI # · SO # · Customer · Currency · Order Value · Status —
  sorted by order date, row-click to open.
- **Order Value showing blank for some PIs:** the on-screen "Order Totals"
  card computes a subtotal/discount/total live from line items but never
  persisted it — `total_amount`/`subtotal` only got written when the PI
  extraction happened to capture a stated total from the PDF. Extracted the
  calculation into a shared `computeOrderTotals()` and both save paths now
  fall back to it when no PI-stated total exists. Existing blank orders
  need one re-save (open + Save Changes) to pick it up.
- **Packing list showing `NaN kg GW`:** `parseFloat('') ?? parseFloat(x) ?? 0`
  doesn't work as a fallback chain — `parseFloat` returns `NaN`, not
  `null`/`undefined`, so `??` never triggers and an unset "actual weight"
  (the normal not-yet-entered state) poisoned the whole shipment's running
  total. Fixed with explicit `Number.isFinite` checks at each step.

### PI Save button hanging forever
Reported as "button hangs but the PI **is** saved" — two distinct root
causes, found in sequence:
1. **First fix (real, but not the reported bug):** with `persistentLocalCache`,
   a Firestore write promise resolves only on server ack, though the write
   is durable in the local cache immediately — a network stall could hang
   the button forever even though the order was safely cached. Added a
   `raceWrite` helper (proceed after a 6s grace period; still surface a fast
   rejection as an error).
2. **Actual cause:** `/shipments/new` and `/shipments/:id` render the same
   `<ShipmentForm>` with no `key`, so React **reuses the component instance**
   across the create → edit navigation instead of remounting it — the
   `saving` state flag, which relied on unmount to reset, simply never
   cleared. Fixed with a `finally { setSaving(false) }`.
- **Lesson:** the first fix was a plausible, well-tested guess that didn't
  match the actual symptom closely enough — confirmed live by the owner as
  still broken, which is what surfaced the real (structural, not
  network-timing) cause. Worth remembering: "hangs but the data is saved"
  is more often a stuck UI state than a stuck promise.

---

## Current Status — V7.10 CLOSED as of 2026-07-08

**Deployed to Netlify (live `0ad1f23`).** A pre-launch bug batch + Portal account
management rework + customer email notification system + account activity tracking +
an expanded, tabbed Schema Audit + an image-enhancement reliability fix. Commit chain on
`main`: `2a2ab7f` → `2a3fb2f` → `6a6b1af` → `a1b308d` → `8ae50b4` → `09bd6f4` → `49594ec`
→ `b631b12` → `4edc8a2` → `00761a7` → `0ad1f23`.

**V7.11 begins fresh in a new conversation.** No open threads from V7.10 — all fixes
verified via build + headless smoke tests and confirmed live (email system tested
end-to-end by the owner). Next likely focus: **Supplier Module A-0** (spec held from
earlier sessions), or a fresh bug/feature batch as raised.

### Portal account management (`CustomerAccounts.jsx` rewrite + new `AccountEdit.jsx`)
- **Accounts list** is now a compact, clickable list showing the **linked CRM
  customer's name** (falls back to the account's own), the full **login email**,
  **country**, and a **Customer / Internal** category badge. Row → opens the edit page.
- **New edit page** `/portal/accounts/:id` holds all per-account settings that used to
  crowd the list row: link-to-customer, account category, currency, fixed FX, Figurine
  WS %, Corp markup, plus the lifecycle actions. Shows the account **UID** (for
  reconciling duplicates against Firebase Auth).
- **`account_type`** field on the `users` doc (`customer` | `internal`, default customer,
  no migration) + a **type filter** on the list.
- **New `suspended` status + Suspended tab.** Suspend moves a customer out of the active
  list (reversible via **Restore**, keeps their settings) instead of dumping them back
  into Pending.
- **Delete** lives only on the edit page and works for any **non-self** account
  **including admins** (self-delete guarded). Enables removing orphaned/duplicate `users`
  docs in-app. Firestore rules already allow admin delete.
- **Duplicate-email flag** on the list. Root cause of "duplicate accounts": `users` is
  keyed by Auth UID and Firebase blocks a second password signup on the same email, so a
  duplicate = an **orphaned `users` doc** (old Auth deleted but doc left, or a
  console-created stub). Reconcile by keeping the doc whose ID == the Auth UID.
- **Mobile:** the tab strip (Pending/Customers/Suspended/Admins) horizontal-scrolls.

### Auth self-heal (`App.jsx`)
- A signed-in Auth user with **no `users` doc** now auto-creates a pending-customer doc
  on sign-in (allowed by the self-create rule; stamped `self_healed: true`) so they appear
  in Pending for approval. Fixes "has a login but is invisible to admins." Note: an admin
  cannot create a doc for another UID (rule is self-only) — the user must sign in once.

### Signup pending-screen fix (`Login.jsx`)
- Removed the post-signup `signOut`; new signups stay signed-in as pending and land on the
  "Awaiting approval" screen instead of flashing back to the login form.

### Customer email notifications via Resend (new)
- **`netlify/edge-functions/send-email.js`** (`/api/send-email`) + **`src/notify.js`**
  (`notifyEmail`, fire-and-forget). Events: **enquiry** (customer confirmation with item
  table + admin alert), **account_approved** (customer), **signup** (customer + admin).
  Branded HTML templates, **reply-to routing** (customer mail → sales inbox; admin alerts →
  the customer). Triggers in `EnquiryPage.submit`, `Login.handleSignUp`, `AccountEdit`
  approve. Dormant until `RESEND_API_KEY` is set (returns `skipped`).
- **Env vars:** `RESEND_API_KEY` (secret), `MAIL_FROM` (`Crystocraft <noreply@crystocraft.com>`),
  `MAIL_ADMIN`, `MAIL_REPLY_TO` (optional), `PORTAL_URL`.
- **Domain `crystocraft.com` verified in Resend** (Tokyo region) via DKIM `resend._domainkey`
  + `send` MX/SPF at host DNS (existing mail untouched). **All 4 email types confirmed live.**

### Image enhancement timeout fix — two rounds (`enhanceImage.js` new, `ImageGallery.jsx`, `RangeForm.jsx`)
- The `Unexpected token 'h'… JSON` error is a **Netlify edge-function timeout** (not a
  token/quota limit) — `gemini-2.5-flash-image` is a slow, unpredictable job running against
  a hard **~30s edge-function ceiling**; when it loses that race, Netlify (not our code)
  returns a plain-text error that broke a blind `res.json()`.
- **Round 1** fixed only the corp-gift path (`ImageGallery.jsx`): downscale the source to
  max 1536px/JPEG q0.9 and send inline (skips the server-side Storage fetch) + defensive
  text-parse for a legible message.
- **Round 2** found the **figurine editor (`RangeForm.jsx`) had its own separate, unfixed
  copy** of the same handler — hence the bug "still happening often" even on a small
  (1000px/500KB) image, since that path still blind-parsed JSON and had no downscale.
  Extracted one shared **`enhanceProductImage()`** (`src/enhanceImage.js`) used by both
  `RangeForm` and `ImageGallery` so they can't drift apart again; added a **one-time retry
  on timeout** (the model is intermittently slow — a retry recovers most transient cases).
  Model output res (~1024px) is unchanged and Keep stores ≤1800px, so the **≥1000px
  standard is preserved**.
- **Ceiling not eliminated** — a hard architectural limit remains (Netlify edge functions
  cap at ~30s regardless of code). If timeouts recur often after this fix, the real cure is
  moving enhancement to a Netlify **background function** (up to 15 min budget, client
  polls for the result) or a small **Fly.io** service (long-running, no platform-imposed
  time limit) — not attempted this round.

### Mobile layout fixes
- `RangeCosting.jsx` crystal-BOM rows stack full-width on mobile (were clipped by
  `<main>`'s `overflow-x-hidden`, hiding the dropdowns).
- `Components.jsx` tab strip is horizontal-swipe only (`overflow-x-auto overflow-y-hidden`);
  list rows stack so component names aren't crushed by the fixed-width stock stepper.
- `CustomerAccounts.jsx` Pending/Customers/Suspended/Admins tab strip is horizontal-scroll
  only — was overflowing/clipping on narrow phones.

### Account activity log (`AccountEdit.jsx`, `Login.jsx`)
- New **Activity** card on `/portal/accounts/:id`: **Registered** date, **Last sign-in**,
  **Sign-in count**, and the account's full **enquiry history** (date, item count,
  estimated total, status) — the strongest signal for "should I follow up with this
  customer?". `Login.handleSignIn` stamps `last_login_at`/`login_count` on the `users` doc
  (self-update, fire-and-forget, never blocks login). No backfill — login tracking starts
  from this deploy; enquiry history is complete (pre-existing data).
- Known limits (accepted): no IP/device/session-duration (would need Admin SDK); "last
  sign-in" only reflects explicit logins, not session activity.

### Schema Audit — pre-launch checks, review lists, and a tabbed/collapsible redesign (`SchemaAudit.jsx`)
- **Missing-components check, split by consequence**: Last Stock with no components =
  **error** ("availability comes only from remaining part stock → shop shows it SOLD OUT");
  Made to Order with no components = **warning** ("sellable at a default lead time, but
  can't be costed"). Concept/Retired exempt. (Confirmed with owner: Last Stock availability
  IS component/part-stock-driven — this isn't a separate finished-units counter.)
- **Missing-images checks**: range products with no `gallery[]` AND no variant image
  (retired exempt) → warning; corp products with no `heroImage` (won't show a photo in
  listings) → warning.
- **"Last-stock-only components" review list** (info severity): components referenced
  *only* by Last Stock/Retired designs (excludes any also used by an MTO or concept
  product, and unused ones), each annotated with stock qty + lead time. Read-only —
  the hint explicitly warns that deleting these breaks the SOLD OUT signal, since
  last-stock availability is computed from component stock, not a separate counter.
- **Category tabs + collapsible groups**: the ~10 groups (was one long stacked list) are
  now organised under tabs — **Range Products, Range Components, Customers, Accounts,
  Corp Gifts, Orders** — each with an issue-count badge; only present categories show a
  tab. Each group card is **collapsed by default** (name/count/Copy only) and expands on
  click, so the page reads as concise instead of overwhelming.
- **Range Products split into separate cards** by lifecycle: **Range — Made to Order**,
  **Range — Last Stock**, plus **Range — Concept** / **Range — Retired** shown only when
  those exist — so findings route to the right staff by product type.
- **Per-group Copy button** on every card (in addition to the page-level "Copy report"):
  copies that group's **entire** issue list as plain text — including rows past the
  on-screen 100-row display cap — so a colleague gets the full list even when truncated
  on screen.

---

## Current Status — V7.7.1 as of 2026-06-24

**V7.7.1 deployed to Netlify (commit `5d04b7d`).** Live at https://ua-product-manager.netlify.app

### V7.7.1 — Crash fix + page error boundary (2026-06-24)
- 🔴 **White-screen crash opening any existing figurine card** (`5df607a`). The `formPlatings`
  `useMemo` added in V7.7 read `form.variants` while `form` is `null` (existing products load
  async); hooks run before the `if (!form) return` / `if (fetching) return <LoadingBar/>`
  guards, so it threw on first render — blank screen with **no loading bar**. New products were
  fine (`form` starts non-null). Fixed with `form?.variants`. **Third V7.7 regression** — all
  runtime-only, all shipped green (sandboxed CI can't run a live preview).
- 🟢 **Page-level error boundary** (`5d04b7d`, `src/components/ErrorBoundary.jsx`). Wrapped the
  `<Routes>` inside both the admin Layout (`home="/dashboard"`) and customer Storefront
  (`home="/shop/figurine"`). A render/lifecycle throw now shows a recoverable fallback card with
  the error message (nav intact) instead of unmounting to a white screen; resets on navigation
  via a `pathname` key. Caveat: does not catch async errors in handlers/promises.

**Lessons**: a thrown hook beats every guard — hooks run before any early `return`, so new
top-of-component hooks must tolerate not-yet-loaded state (`form?.x`). Build-passing ≠ working
for runtime crashes; a page error boundary is the cheapest net when CI has no live preview.

### V7.7 — Plating-specific critical components (2026-06-24)
Figurine metal parts that differ by plating (e.g. Gold `…-G` and Chrome `…-C` carry
**different ERP item codes, stock, and cost**) can now be wired to the specific plating
variant they belong to. Solves two problems: (1) component-level stock directed to the
relevant plating; (2) costing wires the right component cost to the right variant.

- **Data model (backward-compatible, no migration):** each ref in a product's
  `critical_components[]` gains an optional `plating_code`. Blank = applies to **all
  variants** (shared parts — bodies, NFC chips, boxes). Tagged = applies only to the
  matching plating variant. Existing untagged products behave exactly as before.
- **Costing (`rangeCosting.js`):** `componentsCostHKD` / `toolingHKD` now take the
  variant and filter refs by `plating_code`, so the per-variant cost table charges the
  correct plating's part and **tooling is no longer double-counted** across platings.
- **Stock & lead promise (`criticalComponents.js`):** `buildableFromComponents` and
  `makeLeadWeeks` are now plating-aware with **"soonest plating wins"** semantics — a
  zero-stock Chrome no longer poisons the Gold buildable/lead. Per-plating buildable is
  summed and **capped by the shared-parts ceiling** (shared body stock is finite). No
  plating tags ⇒ behaviour byte-identical to before.
- **Editor UI (`RangeForm.jsx`):** each selected component row has a **plating-scope
  dropdown** (All variants / Gold / Chrome / …) and a **clone (+) button** that defaults
  the copy to the first unused plating. Rows now carry a stable ephemeral `_uid` (form-
  only, stripped on save) used as React key + mutation target.
- **Costing breakdown (`RangeCosting.jsx`):** each row shows a plating badge.

**Bugs found & fixed in the same session** (post-first-push review, commit `a39e060`):
- 🔴 Stock/lead functions were NOT plating-aware in the first push (`6b8765b`) — a
  product with 500 Gold + 0 Chrome parts wrongly reported **0 buildable (bottleneck:
  Chrome)**. Now reports **100 buildable** (capped by the shared body). Costing itself
  was correct in the first push; only the production-signal functions lagged.
- 🟠 Clone/duplicate React-key collision (`refKey = id||code` matched two rows) → edits
  hit both rows + duplicate-key warnings. Fixed with the stable `_uid`.
- 🟠 Two refs for the same (component, plating) could double-count cost — clone now
  defaults to an unused plating to prevent it.

**Lessons** (full write-ups in the Obsidian Issues & Bugs Log):
- A "fix all surfaces" change must enumerate **every** consumer up front — costing,
  stock, lead, and UI are separate call sites; fixing the cost path while leaving the
  stock/lead path produces silent wrong numbers.
- Deriving a React key from business fields (`id||code`) breaks the moment one entity can
  appear in a list more than once; use a stable per-row id instead.
- Rolling a per-variant quantity into a single product promise needs an explicit rule
  (here: soonest plating wins, shared-capped) — don't let it default to an accidental min.

### V7.6 — Shipping/PI fixes, Quote margin, USD costing, Filter persistence (2026-06-24)
Bug-fix + polish pass on the Shipping (PI import) and Quote modules.
- **PI customer dropdown fixed** — `customers` collection keys on `company_name`, but
  ShipmentForm queried `orderBy('name')`; Firestore silently returns **zero docs** when no
  doc has the ordered field, so the dropdown was blank. Switched query/options/auto-match to
  `company_name`; dropped references to non-existent fields (`name_cn`, `default_incoterm`, `city`).
- **PI customer auto-link + inline "Add as new customer"** — fuzzy-match extracted name; if no
  match, one-click create a customer stub without leaving the import flow.
- **Marco Polo PI parses** — `gemini-2.5-flash` + `thinkingBudget: 0` (no 30s edge-fn timeout) +
  `maxOutputTokens: 16384`; discount/total rows no longer leak in as line items.
- **PI order totals** — subtotal/discount%/total card with computed-vs-stated subtotal check.
- **Quote margin = all-in** — tooling summed into `tooling_cost_hkd`; new All-in cost column =
  recurring + tooling/tier-qty; margin uses it per tier. (Re-add pre-V7.6 quote items to recompute.)
- **Figurine costing shown in USD** (engine still HKD, converted at view layer).
- **Product & Range list filters persist** across navigation via `sessionStorage` (`pf-*` / `rf-*`).

**Lessons** (full write-ups in the Obsidian Issues & Bugs Log):
- Firestore `orderBy(field)` is *also a filter* — drops docs missing the field, returns empty with no error.
- Thinking models + 30s serverless timeouts don't mix — disable thinking, don't down-tier the model.
- Convert currency at the view layer; amortise tooling into per-unit cost for correct per-tier margin.

---

## Current Status — V3.x as of 2026-06-23

**Live in production on Netlify (commit `5a95a13`, deployed 2026-06-23).**
Pre-costing stable checkpoint backed up on GitHub:
git tag `v3.1-pre-range-costing` (commit `c94f74b`) — `git reset --hard` to it to roll back
the costing work below.

### Bug fixes & UX improvements — deployed 2026-06-23 (this session)

- **Login fixed for all users** — root cause was a direct `netlify-cli deploy --prod --dir=dist`
  (local build) that bypassed Firestore's authorised domain list. Fixed by always deploying via
  `git push origin main` → Netlify GitHub integration. Lesson logged in the Issues & Bugs log.
- **Customer → PI Orders linkage** — CustomerDetail now has a **PI Orders** card that queries
  `orders` by `customer_id`, sorted newest first. Each row shows PI number, order date, currency
  and status badge, and links directly to `/shipments/:id`. **+ New PI** button opens ShipmentForm
  pre-filled with the customer (via `?customer_id=` URL param).
- **ShipmentForm customer pre-fill** — opening `/shipments/new?customer_id=...` now pre-selects
  the customer dropdown and resolves the name as soon as the customers list loads.
- **Bulk Category Editor — two bugs fixed:**
  - Filter dropdowns now show only categories that are actually present on products (no stale
    constants-list values like old "Figurines" mixed with current "Figurine").
  - Apply fields are now comboboxes (`<input list>`) accepting free-text entry — type a new
    name to bulk-rename a category across all selected products.
  - Filters auto-reset after a successful apply, so the product type filter works immediately
    without needing a manual clear (previously the stale `filterDesign` made it appear broken).
- **Corp Gift Products — mobile search layout** — filter row now stacks on mobile: search input
  takes its own full-width row, the two dropdowns share the row below side-by-side. No more
  squeezed search box on narrow screens.

### Range / Figurine Costing — BUILT & deployed (2026-06-22)
Cost a figurine from its critical components, mirroring corp gift. Opt-in per product —
products without a `costing` object keep their `ws_price_usd`; nothing recalculates
automatically.
- **Component-built cost** — `range_components` cost comes from a **supplier_quotes**
  subcollection (see next item). Product cost = Σ(component cost × qty) + extra lines.
- **Base + plating/crystal adders** — `costing.extra_lines` (assembly/packaging, all
  variants) + per-plating adder + per-crystal-colour adder; a multi-colour variant is
  costed at its dearest colour. Markup (per-product override, else pricing-group/default)
  → HKD sell price, using the corp-gift FX rates (`settings/exchange_rates`).
- **`rangeCosting.js`** — pure module mirroring `pricing.js`; volume-aware component cost,
  tooling amortised over qty, per-variant all-in cost → sell.
- **Costing page** `/range/:id/costing` (button in the figurine editor) — component cost
  breakdown, editable extra/plating/crystal adders, markup + quantity tiers, live
  per-variant cost & sell table, Save / Save & publish (writes `product.costing`).

### Supplier quotes with image + OCR on critical components — BUILT & deployed (2026-06-22)
The corp-gift supplier-quote flow, brought to figurine critical components.
- **`range_components/{id}/supplier_quotes`** subcollection — each quote has its own
  screenshots/PDF, AI-OCR-extracted unit cost, currency, MOQ, volume tiers and lead times.
  Reuses the existing `/api/process-quote` Gemini endpoint and image preprocessing.
- **Preferred quote** — star one; its cost is **denormalised onto the component doc**
  (`unit_cost`, `unit_cost_currency`, `volume_tiers`, tooling, `preferred_quote_id`) so
  `rangeCosting` reads cost with no subcollection fetch.
- **`RangeQuoteForm`** `/components/critical/:id/quotes/:quoteId` — drag-drop upload, OCR,
  volume tiers, preferred toggle, delete. The component editor lists quotes with a preferred
  star + attachment preview instead of a single manual cost.
- **Safe write** — saving the component editor writes descriptor fields only (merge), so it
  never clobbers quote-owned cost.

### Shipping & Logistics module — Phases 12.0 + 13.0 BUILT & deployed (2026-06-23)

First two slices of the Shipping module (full spec: Obsidian `Shipping___Logistics_Module_Spec.md`).

- **13.0 — Logistics vendor KB** (`/logistics`) — `logistics_vendors` CRUD with graded
  coverage tags (region + strong/OK/avoid + per-region modes), freight modes, incoterms,
  reliability rating (fragile-weighted), multi-contact, damage history. `freight_quotes`
  cost-history data layer (HKD-normalised) ready for bootstrap import (13.1). No standing
  rate cards (guardrail 7).
- **12.0 — Order/PI anchor + figurine PI import** (`/shipments`) — upload a figurine
  proforma invoice (PDF/image) → `extract-pi` Gemini edge function reads header + line
  items. Brand-agnostic SKU matcher (`stripBrand` core compare, like Crystal-Bible import)
  auto-links lines to `range_products`. Reconciliation screen classifies every line
  (Figurine / Corp Gift / Ad-hoc / Charge) with manual override; non-product = charge,
  excluded from packing. `orders` + `orders/{id}/lines` data layer. "Promote to catalogue"
  deferred per decision; corp-gift PI import out of scope v1 (Path A covers corp gift).
- **New collections** (admin-only Firestore rules added in console): `orders`,
  `packing_lists`, `logistics_vendors`, `freight_quotes`, `freight_rfqs`. New Storage paths
  `orders/*` + `freight_quotes/*` (pasted into Storage Rules tab). New edge function
  `extract-pi` registered in `netlify.toml`.
- **Next:** 13.1 WeChat freight-quote bootstrap, then 12.1 packing list (carton model).

### Catalogue Collections "Shop by" band — BUILT & deployed (2026-06-23)

Curated entry section above the product grid in both customer shops (Corp Gift + Figurine).

- **C0 — New In tag** — explicit `is_new` boolean on each product (checkbox in the editor),
  not date-based. Drives a green "New" badge + new-first sort. Immune to re-import/retire.
- **C1 — Admin CRUD** — `/catalogue-band` page. Per-catalogue switcher. Band settings
  (show/hide, columns, max tiles). Collection list with up/down reorder. Editor modal:
  title, subtitle, type (`filter` / `manual` / `smart`), filter value, manual product
  picker (search + tick + image), smart rule, accent palette, image mode, image upload,
  title colour (white/black), overlay colour (dark/light/none) + opacity slider.
- **C2 — Customer band** — `CollectionBand` component above the filter bar. Tiles are
  `aspect-square` (no label strip below); custom tiles: full-bleed `object-cover` image +
  configurable gradient scrim + label overlay; templated tiles: accent-tinted background +
  product image centred + label overlay. Tiles that resolve to zero products are hidden.
  Ragged-row rule: only show complete rows (< 1 full row → band hidden). Clicking a tile
  deep-links into the grid with an active collection chip + Clear button; category dropdown
  clears the collection.
- **Storage** — band images under `catalogues/band/…` (already in Storage rules allowlist).
  Tile + settings data in `settings/catalogue_band` (single doc, covered by existing
  `settings/*` Firestore rule — no new rule needed).
- **Live WYSIWYG preview** in the editor mirrors the customer tile exactly as you adjust
  overlay / title colour settings.
- **Visual fix (2026-06-23)** — all tiles are `aspect-square` on the card itself; label is
  an absolute overlay, not a strip below the image. Eliminates the height mismatch and the
  thin line that appeared under custom tiles against a lighter background.

### What's new since V3.0 (figurine / UX work, up to 2026-06-22)
- **WordPress image importer** (`/range/import-images`) — scans the catalogue blog pages
  via the `scrape-images` edge function and matches each photo to a figurine product by
  its item code, then bulk-adds matched photos to each product's gallery. Matching is
  **brand-letter agnostic** (a product stored as `D0002-230-C` still matches a photo named
  `U0002-230-CAB.jpg`) — compares on the `design-format-plating` core.
- **Variant image picker** — figurine variant images are picked from the shared gallery /
  uploaded / enlarged, with the image URL integrated into the picker (standalone "Image URL"
  field removed). Variant uploads/URLs auto-add to the gallery, deduped.
- **Range gallery click-to-enlarge** lightbox, matching corp-gift behaviour.
- **Corp-gift admin price fix** — admin product card always shows `price_hkd` (HKD); the
  legacy `sell_price` (old USD schema) is cleared on publish so stale values can't resurface.
- **Figurine list scroll restore** — returning from a product edit scrolls the last-opened
  card back into view instead of resetting to the top (`sessionStorage` `range-last-id`).
- **Mobile menu** — bottom bar keeps 4 primary tabs; "More" now opens a 4-column icon-grid
  sheet listing all 12 sections (grab handle + dimmed backdrop), reachable in one tap.

---

## Current Status — V3.0 as of 2026-06-06

**V3.0 is deployed to Netlify and live in production.**

### What's new in V3.0 (2026-06-06)
- **Blog / Content Generator** — AI-powered blog post writer with Spotlight (single product) and Roundup (multi-product) modes; publishes directly to WordPress as a draft via REST API
- **Blog: image compression pipeline** — all images compressed in-browser before upload (hero ≤400KB at 1200px wide, content ≤200KB); same-origin `/api/image-proxy` edge function bypasses Firebase Storage CORS
- **Blog: WordPress publishing** — uploads images to WP Media Library for SEO; sets featured image; creates Gutenberg blocks (heading, paragraph, image, gallery, spacer, button); all links open in new tab; white text on black buttons
- **Blog: per-section rewrite** — after AI generates content, each section has a "↺ Rewrite" button; type guidance (e.g. "more focused on banking clients") and AI rewrites just that section
- **Blog: product hyperlinks** — global CTA URL adds an enquiry button at post end; per-section/item URL links that block's heading and images only
- **Blog: customisable button text** — default "View Product →" / "Enquire Now →", overridable per post
- **Blog: SEO title** — AI no longer appends `| Crystocraft` (WordPress adds this automatically)
- **Blog: varied AI openings** — banned "Elevate", "Discover", "Introducing", "Transform", "Unleash" as openers
- **Product duplicate** — ⧉ Duplicate button copies product, all BOM components + their images, and product images
- **Product AI writer rewrite** — "↺ Rewrite with guidance" appears after generating marketing copy; same guided-rewrite UX as blog
- **Image gallery: orientation tags** — L/S/P toggle buttons on each image card; auto-detected on upload
- **Image gallery: image types** — Hero, Product Detail, Packaging, Lifestyle, Customisation, Client Ref
- **Volume price tiers on supplier quotes** — add multiple (min qty → unit cost) rows per supplier quote; pricing tier calculation auto-selects the correct component price for each order quantity; "Volume pricing active" badge shown
- **Mobile fixes** — product page header stacks vertically on mobile; blog CTA URL / Button Text fields stack on mobile; blog button removed from product page header to reduce overflow
- **Netlify secret scan** — public Firebase config keys exempted from scanner via `SECRETS_SCAN_OMIT_KEYS`
- **All blog edge functions registered** in `netlify.toml` for local `netlify dev` testing

### What's working end-to-end (V2.1 and earlier)
- Create and manage products with image galleries (hero image, type labels, lightbox)
- Build a BOM per product: add components, upload component images
- Record supplier quotes per component — AI extraction from WeChat/supplier screenshots via Gemini
- Mark a preferred supplier per component (enforced, single preferred only)
- Store supplier database with catalog PDFs/images
- Calculate pricing tiers with unit cost + tooling amortisation, margin colour coding, markup slider
- Build client quotes: pick products, set multiple qty/price tiers per product
- Export client quote to Excel (.xlsx) with embedded product photos, one row per pricing tier
- **Product Catalogue builder** — create branded A4 landscape catalogues with auto layout, drag-to-reorder images, cover page with background photo, print/PDF export
- **Supplier quote improvements** — searchable supplier combobox, delete quote, remove uploaded attachments
- **Drag-to-reorder** images in product and component image galleries
- **Pricing tiers shown on product cards** in the product list (HKD xx @ xxx pcs)
- **Rebranded** to "Crystocraft Product Management App"; Netlify site renamed to `ua-product-manager.netlify.app`; logo shown on login page; page title and OG tags updated
- Firebase security rules locked (Firestore + Storage)
- Deployed to Netlify with `GEMINI_API_KEY` set

### What's not done yet
- **Settings page** — exchange rates UI exists but is read-only placeholder; categories and user management not built
- **Client quote PDF export** — stubbed as "coming soon" in the Export modal
- **Dashboard** — no home screen; app opens directly to Products
- **Data migration** — products being entered manually

---

## 1. Problem Statement

Crystocraft's corporate gift business is growing rapidly, creating an explosion of new product concepts and supplier quotes that are currently tracked in per-client Excel sheets. Key pain points:

- No central product/concept database — the same product gets recreated across multiple client sheets
- Products are assembled from multiple components, each with 2–3 alternative supplier quotes — impossible to model cleanly in Excel
- Supplier quotes arrive as WeChat/WhatsApp screenshots, making data capture chaotic
- Hard to recall what products exist and their costs when responding to a new B2B enquiry
- Growing number of clients and concepts is consuming increasing mental energy

The core crystal figurine business (30+ years) is handled by an existing ERP and is out of scope for this tool.

---

## 2. Goals

1. Centralise all corporate gift products and concepts in one searchable database
2. Model each product as a Bill of Materials (BOM) — components + per-component supplier options
3. Capture supplier quotes with image attachments (screenshots, PDFs)
4. Use AI to extract cost/MOQ/lead time from supplier quote images
5. Calculate HKD sell prices across quantity tiers automatically
6. Generate clean client quote sheets quickly from the master product database
7. Support multi-user access (owner + 2 colleagues initially)

---

## 3. Scope

### In Scope (V1)
- Product/concept catalog with status tracking
- BOM per product (components + assembly notes)
- Supplier quotes per component with image upload + AI extraction
- Quantity-tier HKD pricing per product
- Client quote builder (select products → generate quote)
- User authentication (email/password, 3 users)
- Export client quote to Excel and PDF — both with embedded product photos, professional layout

### Out of Scope (V1)
- Crystocraft core crystal line (handled by ERP)
- CRM / sales pipeline tracking
- Inventory management
- WooCommerce / website integration
- Mobile native app

---

## 4. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React 18 + Vite + SWC | Same as Expense Tool; fast builds, consistent codebase |
| Routing | React Router v6 | Same as Expense Tool |
| Database | Cloud Firestore | `persistentLocalCache` for offline-first fast loads |
| Auth | Firebase Auth | Email/password + Google OAuth; same as Expense Tool |
| File Storage | Firebase Storage | Product images, component images, supplier quote attachments |
| AI Extraction | Gemini API (`gemini-2.5-flash` → `gemini-2.5-pro` fallback) | Vision OCR; handles Chinese text in WeChat/supplier screenshots |
| Serverless | Netlify Edge Functions (Deno) | Gemini API key stays server-side, never in browser |
| Export (Excel) | ExcelJS | `.xlsx` with embedded product photos; same library as Expense Tool |
| Export (PDF) | `@react-pdf/renderer` | Professional PDF quote with photos, branding, layout |
| Hosting | Netlify | Already have plan; CI/CD from Git |
| Styling | Tailwind CSS | Fast, clean UI |

---

## 5. Data Model

### `products`
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| name | string | Product/concept name — format: `[Category] – [Key Feature] – [Use Case]` |
| product_code | string | Corporate gift code e.g. `CG-DRINK-2601` — Phase 6 |
| erp_finished_code | string? | Optional — ERP SKU if product maps to an existing figurine SKU |
| category | string | e.g. Drinkware, Trophy, Stationery |
| status | enum | `concept` / `sampled` / `active` / `discontinued` |
| description | string | 2–3 sentences: material, size, customisation method, use case |
| assembly_notes | string | Factory assembly instructions |
| created_at | timestamp | |
| updated_at | timestamp | |

### `product_images` (subcollection of product)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| caption | string | Optional description |
| type | enum | `reference` / `sample` / `final` / `client_usage` |
| sort_order | number | Display order in gallery |
| uploaded_at | timestamp | |

### `components` (subcollection of product)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| name | string | e.g. "Crystal Body", "NFC Card", "Packaging Box" |
| spec | string | Material, size, finish etc. |
| unit | string | pcs / set / kg |
| sort_order | number | Display order in BOM |
| notes | string | |
| erp_code | string? | Optional — ERP reference code (e.g. `U0257-001-GAB`, `FM-PL120120H00-C`, `P-PB099-01-02`) |

### `component_images` (subcollection of component)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| caption | string | Optional description |
| type | enum | `spec` / `sample` / `drawing` / `reference` |
| sort_order | number | Display order |
| uploaded_at | timestamp | |

### `supplier_quotes` (subcollection of component)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| supplier_name | string | |
| unit_cost | number | Per piece cost |
| unit_cost_currency | enum | `RMB` / `HKD` / `USD` / `EUR` |
| moq | number | Minimum order quantity |
| tooling_sample_cost | number | One-time tooling/sample cost |
| tooling_sample_cost_currency | enum | `RMB` / `HKD` / `USD` / `EUR` |
| sampling_lead_time_days | number | Days from order to sample/prototype ready |
| tooling_lead_time_days | number | Days for tooling if custom mould required (0 if none) |
| production_lead_time_days | number | Baseline production lead time — free input, overridable per pricing tier |
| is_preferred | boolean | Mark preferred supplier |
| notes | string | |
| created_at | timestamp | |

### `quote_attachments` (subcollection of supplier_quote)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| file_type | string | image / pdf |
| ai_extracted | boolean | Whether AI was used to fill fields |
| uploaded_at | timestamp | |

### `pricing_tiers` (subcollection of product)
Tiers are fully flexible — any quantity can be added (100, 200, 300, 500, 1000, 2000, etc.) depending on the supplier's MOQ breakpoints. No fixed set of tiers.

| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| quantity | number | User-defined: 100 / 200 / 300 / 500 / 1000 / 2000 / etc. |
| total_cost_rmb | number | Auto-calculated from preferred supplier unit costs × qty |
| tooling_cost_rmb | number | One-time tooling/sample cost (amortised or shown separately) |
| price_hkd | number | Sell price — manually set or auto-suggested from markup |
| margin_pct | number | Auto-calculated: (price_hkd − cost_hkd) / price_hkd |
| production_lead_time_days | number | Optional override — if larger qty needs more time than baseline |

### `client_quotes`
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| client_name | string | |
| contact_name | string | |
| date | timestamp | |
| status | enum | `draft` / `sent` / `won` / `lost` |
| rmb_to_hkd_rate | number | Exchange rate used |
| notes | string | |

### `client_quote_items` (subcollection of client_quote)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| product_id | string | Reference to product |
| product_name | string | Snapshot at time of adding |
| product_category | string | Snapshot |
| product_description | string | Snapshot |
| hero_image | string | Firebase Storage URL snapshot |
| tiers | array | `[{ quantity: number, price_hkd: number }]` — multiple qty/price options per product |
| status | string | Product status snapshot |
| createdAt | timestamp | |

---

## 6. Application Pages

### 6.1 Product Catalog (`/products`)
- Grid/list of all products with search, filter by category/status
- Status badges: Concept · Sampled · Active · Discontinued
- Quick stats: number of components, number of suppliers, last updated

### 6.2 Product Detail (`/products/[id]`)
- Product info (name, category, status, description)
- BOM section: list of components, each expandable to show supplier quotes
- Per-component: add/edit supplier quotes, upload quote images, trigger AI extraction
- Pricing tiers table: qty → total cost RMB → HKD sell price → margin %
- Action: "Add to Client Quote"

### 6.3 Add / Edit Product (`/products/new`, `/products/[id]/edit`)
- Form: basic product info
- Then add components one by one
- Each component: add supplier quotes + attachments

### 6.4 Client Quotes (`/quotes`)
- List of all client quotes with status
- Create new quote: pick client, select products + quantities
- View/edit quote: adjust prices, add notes
- Export to Excel and PDF

### 6.5 Client Quote Detail (`/quotes/[id]`)
- Client info, date, exchange rate
- Table of selected products: image, name, spec summary, qty, unit price HKD, total
- "Your Brief" summary section
- Export buttons → Excel (`.xlsx`) and PDF — both include product photos and professional layout
  - **Excel**: product photo per row (embedded), item name, spec summary, qty tiers, unit price HKD
  - **PDF**: branded layout with Crystocraft logo, product image card per item, clean typography — suitable to send directly to client

### 6.6 Settings (`/settings`)
- Manage categories list
- Manage users (invite colleagues by email)
- Default RMB → HKD exchange rate

### 6.7 Login (`/login`)
- Email/password auth via Firebase

---

## 7. Architecture

```
Browser (React SPA)
│
├── Firebase Auth          — sign-in / sign-out / session state
├── Firestore              — all product, component, quote, pricing data
├── Firebase Storage       — product images, component images, supplier quote attachments
│
└── Netlify (edge/serverless)
    ├── /api/process-quote     — Edge Function (Deno): calls Gemini to extract supplier quote data
    └── /api/download-image    — Edge Function (Deno): CORS proxy for Firebase Storage URLs
```

Same architecture as Expense Tool — all API keys stay server-side in Netlify environment variables.

---

## 8. AI Supplier Quote Extraction

Uses the same two-image pipeline proven in the Expense Tool for maximum accuracy:

| Version | Format | Used for |
|---|---|---|
| Colour JPEG (93%) | `image/jpeg` | Firebase Storage, image display in app |
| Greyscale PNG (lossless) | `image/png` | Gemini API only — discarded after extraction |

**Preprocessing steps** (client-side, before sending to Gemini):
1. Resize to max 2400px
2. Convert to greyscale (removes colour noise, improves contrast on WeChat screenshots)
3. Auto-levels (stretch histogram to 0–255, clip 1% outliers)
4. Encode as lossless PNG

**Extraction flow:**
1. User uploads screenshot/image to the supplier quote form
2. Client preprocesses image (greyscale PNG) and POSTs to `/api/process-quote`
3. Edge function forwards to `gemini-2.5-flash` (falls back to `gemini-2.5-pro` on error)
4. Gemini extracts: supplier name, unit cost, currency, MOQ, tooling/sample cost, lead time, sample time
5. Extracted fields pre-fill the form — user reviews and corrects before saving
6. Original colour JPEG uploaded to Firebase Storage as the attachment record

**Supports:** WhatsApp screenshots, WeChat screenshots (Simplified Chinese handled), PDF quotes, email screenshots.

---

## 8. Pricing Calculation Logic

For each product:

```
Each component cost converted to HKD using exchange rates set in Settings:
  Component Cost HKD = unit_cost × exchange_rate_to_hkd

Total Component Cost HKD = Σ preferred supplier component cost HKD
Assembly Cost HKD = manually entered if applicable
Total Unit Cost HKD = Total Component Cost HKD + Assembly Cost HKD

Suggested HKD Sell Price = Total Unit Cost HKD × markup multiplier (user-defined, e.g. 1.4–2.0×)
Margin % = (Sell Price − Total Unit Cost HKD) / Sell Price
```

Exchange rates stored as a Firestore `settings` document (not hardcoded), so new currencies can be added without a code change. Initial set:
- RMB → HKD
- USD → HKD
- EUR → HKD

HKD is the base/display currency. Adding a new currency only requires adding a new rate entry in Settings.

Pricing tiers are user-defined per product (any qty: 100, 200, 300, 500, 1000, 2000…). User adds tiers matching the supplier's actual MOQ breakpoints. Sell price is auto-suggested but always overridable.

---

## 9. Build Phases

### Phase 1 — Foundation ✅ Complete
- [x] Vite + React 18 + Tailwind project setup
- [x] Firebase Auth (login page, protected routes)
- [x] Firestore data model (products, components, supplier quotes, pricing tiers, client quotes)
- [x] Product list page with search + category/status filters
- [x] Add/edit product form
- [x] Component BOM management (add/edit/delete components)

### Phase 2 — Supplier Quotes ✅ Complete
- [x] Add/edit supplier quotes per component
- [x] Firebase Storage integration for image uploads
- [x] Gemini AI extraction from supplier quote screenshots (two-image pipeline: greyscale PNG → Gemini, colour JPEG → Storage)
- [x] Mark preferred supplier per component (enforced at save — clears all other `is_preferred` flags)
- [x] Supplier database (name, address, phone, WeChat ID)
- [x] Supplier catalog storage (PDFs + images, thumbnails, lightbox)
- [x] Component image gallery (upload, hero star, type labels, 2-column grid, lightbox)

### Phase 3 — Pricing ✅ Complete
- [x] Pricing tiers table per product (flexible qty tiers)
- [x] Auto-calculate unit cost + tooling cost from preferred suppliers
- [x] Tooling/unit amortisation per tier (`toolingCostHKD / quantity`)
- [x] All-in cost, sell price (inline editable), margin % with colour coding
- [x] Markup slider (1×–4×) with live suggested price
- [x] Warning banners for missing preferred suppliers (orange/red with links)
- [x] Exchange rates from Firestore `settings/exchange_rates` with hardcoded fallback

### Phase 4 — Client Quotes ✅ Complete
- [x] Client quote list + create new quote
- [x] Product picker modal (search, multi-select)
- [x] Multiple pricing tiers per item in quote (e.g. 200 pcs @ HKD 120 AND 500 pcs @ HKD 100)
- [x] Inline tier editing (qty + price per row), add/remove tiers per product
- [x] Status dropdown (draft / sent / won / lost)
- [x] Export to Excel with embedded product photos (ExcelJS) — one row per tier per product
- [ ] Export to PDF (`@react-pdf/renderer`) — stubbed as "coming soon"

### Phase 5 — Polish & Deployment ✅ Complete (V1.0 → V2.0)
### Phase 5.1 — UX Improvements ✅ Complete (V2.1)
- [x] Netlify deployment — pushed to Git, connected Netlify, `GEMINI_API_KEY` set
- [x] Firebase security rules locked (Firestore + Storage, all paths)
- [x] Supplier quote improvements: searchable combobox, delete quote, remove attachments
- [x] Drag-to-reorder images in product and component galleries (sort_order persisted to Firestore)
- [x] Pricing tiers displayed on product list cards
- [x] Rebranded to "Crystocraft Product Management App" — login logo, sidebar, page title, OG tags, Netlify site name (`ua-product-manager.netlify.app`)

### Phase 6 — Product Catalogue ✅ Complete (V2.0)
New feature: branded A4 landscape PDF catalogue generator.

- [x] Catalogue list page (`/catalogues`) — create, edit, preview, delete
- [x] Catalogue builder (`/catalogues/[id]`) — add products, drag to reorder items
- [x] Auto layout from image count per product:
  - 1–3 images → quarter page (4 products per A4 in 2×2 grid)
  - 4 images → half page (2 products per A4 side by side)
  - 5–6 images → full page (1 product per A4)
- [x] Per-product image sequencer: drag to reorder selected images; first = hero (★); max 6
- [x] Quarter-page layout variants: single (image left/text right), double (text left/2 images right), triple (3 images horizontal top/text bottom)
- [x] Half-page layout variants: 4-image (2×2 grid top 65%/text 35%), 3-image (vertical images left/text right)
- [x] Full-page layout: hero + up to 3 sub-row left pane (62%), text + up to 2 images right pane (38%)
- [x] Cover page: background image upload (Firebase Storage), black/white overlay + opacity slider (0–90%), text at lower-right
- [x] Gold dividers throughout at `rgba(200, 169, 81, 0.3)`
- [x] Page summary widget in builder: shows quarter/half/full page counts and blank slots
- [x] Print/PDF export: A4 landscape, correct pagination, `print-color-adjust: exact` for backgrounds
- [x] Marketing description field per product in catalogue (separate from product description)
- [x] Firebase Storage rules: `catalogues/{catalogueId}/{allPaths=**}` added

**Print tip:** Use Chrome incognito to avoid RSS/feed browser extension icons appearing in PDF output.

### Phase 7 — Next Steps
- [ ] Settings page: exchange rates — editable UI + `/api/fx-latest` edge function to fetch live rates (CNY/USD/EUR→HKD)
- [ ] Settings page: category management, user management
- [ ] Dashboard / home screen (products by status, quotes by status, recent activity)
- [ ] Client quote PDF export — implement with `@react-pdf/renderer`
- [ ] Data migration: manual entry of top 20–30 active corporate gift products from `CorpGiftCosting-20260523.xlsx`
- [ ] Product coding: `product_code` field (`CG-[CAT]-[YY][NN]`)

### Phase 6 — Product Coding & ERP References
- [ ] Add `product_code` field (`CG-[CAT]-[YY][NN]`) to products — user-confirmed (not fully auto-generated, to avoid Firestore race conditions); display on product list, detail, pricing, and both exports
- [ ] Add optional `erp_finished_code` field to products (for figurines that map directly to an ERP SKU)
- [ ] Add optional `erp_code` field to components (reference to ERP `U/FM/P` codes, no validation required)
- [ ] Component coding (`CMP-[TYPE]-[DETAIL]`) — defer until enough data exists to see which components recur across 3+ products; do not build UI yet

### Future — Gift Selector (Separate Project)
The `gift-selector.md` describes a **separate customer-facing project** for Crystocraft.com — a B2B gift quiz with rules-based product matching and lead capture. It has its own stack (Next.js, PostgreSQL, WooCommerce API) and should be planned independently. The only integration point with the costing tool is that concept templates / the product catalog could eventually be sourced from Firestore in a future phase.

---

## 10. Environment Variables

### Frontend (`.env.local` / Netlify site variables)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```
Safe to expose — Firebase security enforced by Auth rules, not key secrecy.

### Backend (Netlify environment variables — server only)
```
GEMINI_API_KEY=
```
Only accessed inside the Deno edge function, never sent to the browser.

---

## 11. Key Implementation Notes (Learned from Expense Tool)

- **Firestore persistence**: Use `persistentLocalCache` + `persistentMultipleTabManager` — serves data from IndexedDB instantly on repeat loads
- **Real-time listeners**: Use `onSnapshot` everywhere (not `getDocs`) — auto-pushes changes back to UI, clean up with `return unsubscribe` in `useEffect`
- **File upload UX**: Single image → auto-extract immediately; multiple images → show list with Remove buttons first, then single "Extract" button with progress counter
- **File IDs**: Use a stable numeric `_id` counter (not filename) so Remove works correctly when multiple files share generic names (e.g. `image.jpg` from mobile)
- **Image preprocessing**: Run `preprocessForGemini` client-side before POSTing to edge function — do not send raw colour image to Gemini
- **Gemini fallback**: Try `gemini-2.5-flash` first, retry once after 3 seconds on high-demand errors, then fall back to `gemini-2.5-pro`
- **ConfirmDialog**: Use custom in-app modal for all destructive actions (delete product, delete component, delete quote) — browser `confirm()` shows "Block this pop-up" on mobile Chrome
- **CORS proxy**: Firebase Storage URLs require the `/api/download-image` edge function proxy for downloading images (e.g. for Excel export with embedded images)
- **Auth domains**: Add Netlify branch preview URLs to Firebase → Authentication → Authorized domains before testing
- **Mobile date inputs**: Add `-webkit-appearance: none` + `min-height: 36px` + `line-height: 1.4` to prevent collapsing on iOS WebKit

---

## 12. Migration from Excel

After V1 is live, migrate existing products from the 3 Excel files:

| Source File | What to migrate |
|---|---|
| `CorpGiftCosting-20260523.xlsx` | All unique products → master product catalog |
| `Parts-Costing-260521.xlsx` | Reference only (core crystal line, stays in ERP) |
| `Stock-WSPrice-20250527.xlsx` | Reference only |

Migration approach: manual entry for top 20–30 active corporate gift products first, then add concepts progressively as they are discussed with new clients.

---

## Range / Figurine Costing — BUILT (design record)

> ✅ **Shipped 2026-06-22** (see Current Status at the top for the as-built summary).
> Kept as the design record. Pre-build checkpoint: git tag `v3.1-pre-range-costing`
> (commit `c94f74b`); `git reset --hard` to it to roll back.
>
> **One change vs the plan below:** component cost was NOT stored as flat fields on
> `range_components`. Instead each component got a **`supplier_quotes` subcollection**
> (image + OCR, multiple quotes, preferred). The preferred quote's cost is denormalised
> onto the component doc as the same fields (`unit_cost`, `unit_cost_currency`,
> `volume_tiers`, `tooling_sample_cost`), so steps 2–4 below are unchanged.

**Goal:** cost a figurine the way corp gift is costed, but built from the existing
**critical component** model. Opt-in per product — products left untouched keep their
existing `ws_price_usd`; nothing recalculates automatically.

**Decisions locked with the user (2026-06-22):**
1. Cost source = **components + extra lines.** Each critical component carries a cost;
   product cost = Σ(component cost × qty) + extra lines (plating, crystal, assembly, packaging).
2. Variant precision = **base + plating/crystal adders.** One base cost plus a per-plating
   adder (Gold vs Chrome) and a per-crystal-colour adder. Accurate per-variant without
   re-entering each SKU.
3. Currency/output = **HKD cost → markup → sell (match corp gift).** Uses FX rates from
   `settings/exchange_rates` and the existing pricing-group markups.

**Build steps (4 files, all additive — no migration):**
1. **`range_components` gain cost fields** (`criticalComponents.js` + `RangeComponentForm.jsx`):
   `unit_cost`, `unit_cost_currency` (RMB/USD/EUR/HKD), optional `volume_tiers`
   (`[{ min_qty, unit_cost }]`, same shape as corp-gift quotes), optional `tooling_sample_cost`.
   One shared body's cost then feeds every product that references it (as its stock already does).
2. **Range product `costing` object** (written by the new page only):
   - `extra_lines: [{ label, cost, currency }]` — base lines applied to all variants
   - `plating_costs: { [plating_code]: { cost, currency } }` — per-plating adder
   - `crystal_costs: { [crystal_code]: { cost, currency } }` — per-crystal adder
   - `markup` (optional per-product override; else pricing-group / `DEFAULT_MARKUP`)
   - `tiers: [{ quantity, lead_time_days }]` — optional volume breakpoints
3. **New pure module `rangeCosting.js`** (mirrors `pricing.js`):
   `rangeVariantCostHKD(product, lib, rates, variant, orderQty)` =
   Σ(component cost at qty × qty_per_unit) + Σ extra lines + plating adder + crystal adder,
   all → HKD; tooling amortised over qty; × markup → sell price.
4. **New page `RangeCosting.jsx`** at `/range/:id/costing` (mirrors `PricingTiers.jsx`):
   component cost breakdown → editable extra/plating/crystal adders → quantity tiers →
   per-variant resolved cost + sell-price table → Publish. "Costing" button added to the
   figurine editor.

**Rollback note:** if anything regresses (range list, corp-gift pricing, or build),
revert to tag `v3.1-pre-range-costing`. All changes are additive; the only schema additions
are new optional fields on `range_components` and a new `costing` field on `range_products`,
neither of which is read by existing code paths.

---

## 13. Future Phases (Post-V1)

- **Crystocraft New Product Costing Sheet** — a separate, simpler tool for calculating WS price for new figurines before entering the ERP (replaces Parts-Costing Excel)
- **Image gallery per product** — reference photos, sample photos, client usage photos
- **WhatsApp/WeChat message parser** — paste raw message text, AI extracts quote data
- **Client brief intake form** — shareable link for clients to submit requirements, auto-matches to products
- **Analytics** — which products are most quoted, win rate per client, margin trends
- **CRM light** — track follow-ups and status per client enquiry
- **Catalogue Collections & Merchandising** — ✅ C0/C1/C2 **BUILT 2026-06-23**. C3 (seasonal date windows + `new_in` smart tile in the band) and C4 (best_sellers + account row) remain future phases. Full spec: `Crystocraft/Operations/Catalogue_Collections_Spec.md`.
