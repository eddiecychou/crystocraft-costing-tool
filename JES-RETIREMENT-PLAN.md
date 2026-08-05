# Retiring JES — the plan

Companion to `V7.15_ERP_Inventory.md` (what the ERP contains) and
`PROJECT-PLAN.md` (what the app does). This is the route from here to
switching the old system off.

Written 2026-07-19. Everything factual below was measured against the mirror,
not assumed; the numbers are there so a future reader can re-check them.

---

## 0. STATUS — JES was frozen 2026-08-05. Read §0 before §1.

**The owner has instructed CuiLing, Cindy and XiangXia to stop entering or
updating anything in JES.** It is now a read-only archive, fully mirrored to
Supabase for reference. Everything from §1 onward was written while JES was
still live and describes a sequence that has now largely happened — it is kept
because the *reasoning* behind each decision is still the record of why things
are the way they are, but **the plan below is no longer a to-do list.**

Where the nine steps actually stand:

| Step | Status |
|---|---|
| 1 — Make the data current | **Done** (V7.17: incremental sync, 4h31m → 59min) |
| 2 — Find out what the team does | **Overtaken.** Answered by migrating, not by surveying |
| 3 — Stop double-entry | **Done** — SO/SI/PU are raised in the app |
| 4 — Production / job orders | **Done** — the document was dropped, not rebuilt (§4) |
| 5 — Purchasing | **Done** — PU migrated |
| 6 — Item master + BOM | **Decided**, entry outstanding — see below |
| 7 — Stock | **The remaining gap.** See below |
| 8 — Sales documents | **Done** — SO and SI both raised in the app |
| 9 — Switch off | **In progress** — the read-only period started 2026-08-05 |

**Step 6's open question is answered.** It asked whether the app should take
over *maintaining* products and BOMs, or whether JES's version should be frozen
as reference data with new products maintained only in the app. The freeze
settles it: **option two**, which this document already judged "much less work
and probably right." The two versions now diverge permanently and that is
intended. The outstanding work is data entry — the owner reports all BOMs
including crystals are ready to go into the app's own item model, after which
nothing operational reads `erp_item` / `erp_bom` except as a cross-check.

**Step 7 is the one genuinely unfinished job.** The app displays stock; it is
not yet where the movements are recorded, and the plan's own warning stands: a
cutover needs a physical stocktake, because an error in the opening balances
becomes permanent. It is also the step most exposed to the fact recorded in
`CLAUDE.md` — **JES stock was never maintained except for crystals**, so the
opening balances mostly have to come from XiangXia's metals spreadsheet and
ChunCi's B2C finished-goods spreadsheet, not from the mirror.

**What the freeze changes about risk.** Until now the danger was double-entry —
two systems disagreeing. From 2026-08-05 the danger inverts: the mirror is
frozen, so anything in the app still presenting JES data as current will drift
further from reality every day without ever looking wrong. `ErpLookup` already
labels itself "Read-only search of the legacy JES ERP archive… not live," which
is the right treatment; anything that doesn't say so needs to.

---

## 1. What retiring JES actually means

JES isn't one system, it's about six jobs it still does. Retiring it means
moving each job somewhere else, one at a time, until nothing real depends on
it. Then it goes read-only, then off — and the Supabase mirror stays as history.

The scope is much smaller than it first appears:

- 286 of its 494 tables are **empty**; 52 hold 98.5% of the data.
- It's a *jewellery* package (gold, diamonds, hallmarking, POS, consignment,
  customs). Most of it was never used here.
- **Accounting already lives elsewhere** — JES's GL has zero journal entries;
  the books are in PBIS.
- **Quoting already migrated** to the app in 2024 and nobody recorded it.

So this is finishing a migration that is partly done, not starting one.

## 2. What JES still owns

| Job | Status |
|---|---|
| **Item master + BOM** | JES only. Everything references it. |
| **Stock ledger** | JES only — 1.15 M movements. The app displays stock; it doesn't record it. **But only crystals are maintained: the team's real figures live in Excel** (§4). |
| **Sales orders** (the team's "PI") | Created in JES; the app imports a PDF of them. |
| **Invoices (SI)** | JES only, and feeds PBIS. |
| **Production / job orders** | JES only — see §4, this is the first one to move. |
| **Purchasing** | Both. Which the team actually uses is unknown until the screens arrive. |

## 3. The order, and the two rules behind it

**Rule 1 — nothing moves until the data is live.** Today the mirror updates when
someone runs a sync by hand. Every step below assumes the app sees today's
reality.

**Rule 2 — whatever has a downstream consumer moves last.** Invoices feed
Cindy's PBIS import, so invoices go near the end.

### Step 1 — Make the data current
Incremental sync. `sync.py` now creates the unique index the upsert needs;
`probe_lastupdate.py` must be run **on the LAN** to confirm `LastUpdate` changes
on edit. If it doesn't, incremental sync would silently skip edits — worse than
today's slow-but-correct full replace.

### Step 2 — Find out what the team actually does
The database says what is *stored*, not what is *used*. The screen snapshots are
the only way to know, and skipping this is the commonest way these projects
stall — you discover in month four that someone runs a report nobody mentioned.

### Step 3 — Stop double-entry
SO-import-by-number (built, waiting on fresh data). Nothing retires, but the app
stops keeping a re-typed copy of JES data and the team starts trusting it.

### Step 4 — Production (see §4 — moved to the front)

**Owner's sequence, confirmed 2026-07-19:** JES keeps issuing sales orders,
invoices and purchase orders while production moves first. Then sales orders and
purchase orders move together. **Invoices split off and go last.**

The reason invoices went last was that an app-generated invoice must reproduce
the JES→PBIS import file, and that file had never been seen. **Cindy supplied it
the same day** — see `PBIS-IMPORT-FORMAT.md`. It is header-level only, and the
app's data validates 32/32 against it. Invoices stay last (the books are the one
downstream consumer that must not break), but they are no longer *blocked*.

### Step 5 — Whichever of purchasing is thin, per the snapshots
For each, there is a moment where the team says *"from today we do this in the
app and stop touching JES for it."* That moment is the migration. Running both
systems in parallel is worse than either.

### Step 6 — Item master and BOM
The hard one, because everything points at it. Needs an owner decision: does the
app take over *maintaining* products and BOMs, or is the ERP's version frozen as
reference data with new products maintained only in the app? The second is much
less work and probably right — but the two then diverge permanently.

This step's real content is data cleanup: the costing is partly anchored to
superseded part codes (`FM-K(32).03-C`, used by 0 current BOMs, where every BOM
builds with `FM-K(32)-C`, 526). See `Settings → Component Codes`.

### Step 7 — Stock
The app becomes where movements are *recorded*, not just displayed. Needs a
physical stocktake at cutover: you are establishing opening balances, and an
error there becomes permanent.

### Step 8 — Sales documents
Sales orders, then invoices. **Invoices last** — an app-generated invoice has to
reproduce the JES→PBIS import file.

> **Unblocked 2026-07-19.** Cindy supplied both import files. The format is
> **header-level only — no line items**, so an app invoice does not need to
> reproduce JES's line structure, surcharge tables or tax field. Validated
> 32/32 against `uc_registry` on UC number, currency and total. Full column
> contract and the four remaining questions for Cindy in
> **`PBIS-IMPORT-FORMAT.md`**. This step can now be scoped rather than deferred.

### Step 9 — Switch off
Read-only for a period in case something surfaces, then decommission. The
Supabase archive remains as history.

---

## 4. Production job orders — recommend dropping the document, keeping two facts

Owner's position: job orders exist because JES's workflow demands them, they
cost significant time to key in, and they don't give much back. **The data
supports this.**

### What a job order carries (all 131,752 checked)

| Field | Populated | |
|---|---:|---|
| item, qty, customer, delivery date | 100% | **already on the sales order line** |
| production-in date | 99% | when it was actually finished |
| remarks | 3.7% | |
| **wastage** | **2 of 131,752** | |

A record reads: *"make 48 of D0019-001-GC1 for customer P34, deliver 8 May."*
Nearly all of that is a re-typed copy of the sales order line.

**The wastage number is the clincher.** Wastage is the main reason manufacturers
tolerate job-order paperwork — it is how you learn which products bleed
material. It has been filled in twice in twenty years. The analytical payoff
that would justify the effort is not being collected.

Scale check: ~1,120 material-issue movements since 2025 against 131 k job orders
historically. Production volume is now a fraction of what the process was built
for, so the effort is badly disproportionate to throughput.

### But job orders ARE load-bearing for stock

**100% of material issues and 100% of production-control records hang off a job
order.** It is the hook the stock ledger uses to know what was consumed and what
was produced.

So "cut out job orders" must not become "stop recording material issues" — that
would quietly corrupt stock, and JES is currently the only stock ledger.

### Recommendation: drop the document entirely — the app already does the work

The two facts worth keeping are **already recorded by the app**, on the order,
with timestamps. Nothing needs building, and no job order needs generating:

| App function (`orderStock.js`) | What it records |
|---|---|
| `reserveForOrder` | stock allocated to an order — quantities from the *same* MRP explosion as the Component Requirements report, so the two can never disagree |
| `produceForOrder` | production-in: consumes the reservation; `committed_at` **is** the production-in date |
| `releaseForOrder` | reverses a reservation (before production-in) |
| `reverseProduceForOrder` | reverses a production-in |

> **Correction (V7.16).** Earlier drafts of this table listed an `issueForOrder`.
> **No such function exists.** The model is two-stage, not four-verb: material
> consumption is not a separate step — it happens *inside* `produceForOrder`
> when the reservation is consumed. Anyone speccing against the old table would
> have built for a function that was never there.

Plus the order status flow: draft → confirmed → packing → ready → shipped →
delivered.

The app's stock model is also **better than the one being replaced**. On-hand is
a derived running balance over an append-only movement log (`stockLedger.js`),
never a mutable number edited in place. JES's own balance table, `itemwhbal`, is
exactly the mutable kind and has gone stale — 8,368 of its 8,599 non-zero rows
have a null `lastupdate`. That is the failure mode the app's design already
avoids.

So the job order is pure JES overhead: a document keyed to satisfy a workflow,
whose entire content is either duplicated from the sales order line or already
captured by the app against that line.

### Open question, now closed

The production-in date **is** recorded — 130,929 of 131,752 job orders carry
one — but **owner confirms nobody uses it**, for lead time or anything else. So
it is written and never read.

Dropping it also loses no history: every job order and production record already
sits in the Supabase mirror. Retiring JES stops *new* rows being created; it
does not delete the past. If lead-time analysis is ever wanted, the app's own
`committed_at` gives the same fact from the point of cutover, and the mirror
covers everything before it.

That was the last thing that could have made this harder than it looks. Nothing
now argues for keeping job orders.

### Two notes

- **This saves nothing until cutover.** JES will demand job orders while it
  runs. The saving arrives when production moves to the app — which is why
  production is step 4 rather than a late "whichever looks easy" item.
- **The team wants this.** Owner reports job orders and production-in are among
  the most time-consuming things they do, largely because the JES UI is slow and
  awkward. That matters more than it sounds: §5 lists team adoption as the main
  risk to every cutover, because people quietly keep using the old system when
  the new one is no better for them. Here the incentive runs the right way — the
  first function to migrate is the one they most want rid of. Good place to
  start, and a good way to build confidence for the harder steps.

### Finished-goods stock — settled: output is implicit

*(Was "one open question for step 7". Owner decided it, V7.16.)*

**Production consumes; it does not create a stock balance.** The app deducts
components, crystals and packaging, the order moves along its status flow, and
no finished-goods balance is ever written. JES's PI leg into FTBS simply stops
existing at cutover.

That is honest for build-to-order: the finished pieces exist for days, against a
named order, then ship. Holding them as a balance would be bookkeeping for its
own sake.

**B2C finished stock is a separate, unconnected thing**, treated as a trading
operation — stock is received, stock is sold, and nothing links it to a
production event. The app already supports exactly this shape (`receipt` /
`issue` in `stockLedger.js`; the crystals and packaging inventories are built
this way). So if B2C finished goods ever need to be in the app it is a new
collection over existing machinery — no production plumbing, no warehouse model.
**Not step 4's problem, and no longer step 7's either.**

### The gap map (measured, V7.16)

Which movements actually depend on a job order, from `itemtransaction` since
2025 — not assumed:

| Doc type | Movements | Hangs off a JO? |
|---|---:|---|
| MI (material issue) | 1,120 | **100%** |
| PI (production-in) | 1,244 | **100%** |
| IT (transfer) | 2,298 | no — refs an SO, or nothing |
| SI (sales issue) | 1,023 | no ref |
| IA (adjustment) | 838 | no ref |
| GN (goods in) | 103 | no — refs a `PU` |
| SR / PR (returns) | 23 | no ref |

So job orders are load-bearing for **2,364 of 6,649 movements — about a third**,
not all of them. "100% of material issues hang off a job order" is true, but it
is 100% of a subset. The cutover surface is smaller than it first looked.

> **Naming trap.** `PI` in the movement ledger means **production-in**. The
> team's "PI" is JES's **SO**. Same two letters, unrelated meanings.

MI and PI are also **paired double-entry warehouse transfers** — MI moves
material `FJOD → FWIP`, PI moves `FWIP → FTBS`. The app has no warehouse
dimension (one `stock_qty` per component) and, by the decision above,
deliberately never will for this purpose.

### The job-order flow IS the crystal flow — and crystals are the one trusted number

Found V7.16, after the owner explained that **the team keeps the real stock
figures in Excel, not in JES**. Only the crystal warehouse is maintained in JES;
metal parts are not, because keeping them current in a slow ERP is impractical.

The movement ledger agrees, and sharpens it. Every MI, and the consumption leg
of every PI, is item type **`ST`** — stones/crystals (codes like `1177182`):

| Doc | Type | Flow | Moves | Codes |
|---|---|---|---:|---:|
| MI | **ST** | FJOD → FWIP | 560 | 107 |
| PI | **ST** | FWIP consumed | 523 | 106 |
| PI | FG | → FTBS | 688 | 586 |

Metal parts (`SF`, 411 codes) barely move — 515 movements in FSTK, 33 on the PI
leg. Exactly as the owner described.

**So the one part of JES stock the team keeps accurate is the part that runs
entirely through job orders.**

> **Correction.** An earlier reading of this cycle took the large `IA` figure
> (FSTK adjustments −1.6 M units against GN receipts of +136 k) as evidence that
> JES stock was untrusted across the board, and concluded that stopping job
> orders broke nothing. That holds for **metals**. It is **wrong for crystals** —
> the adjustments are concentrated in FSTK, while the crystal flow through
> FJOD/FWIP is the disciplined part. Stopping job orders stops crystal tracking.

This does not change the decision — job orders still go — but it adds a
prerequisite:

**The production cutover must carry crystal stock over on the day.** The app
cannot start crystals from zero; it needs opening balances for those ~107–180
codes at the moment of the switch, or the one accurate stock record in the
business is stranded in a system nobody is updating. Machinery exists at both
ends: the app's crystal inventory is the same shape as the JES flow (reserve per
order → consume), and `inventoryClass.js` already has an `importStock` path.
What is needed is the balance extract and a reconciliation.

**Open, and it decides where opening balances come from:** for crystals, is JES
the real record, or does the Excel win there too? If the two have drifted, that
must be settled *before* cutover — opening balances become permanent the moment
anything is posted against them.

### The Excel spreadsheets are an undocumented system of record

Worth naming plainly, because §5 lists "a function nobody mentioned" as the
commonest way these projects stall — and this is one, found by conversation
rather than by reading the database.

Metals get *better* immediately on migration: the app's ledger is an append-only
running balance, which is what the team is approximating by hand in Excel.
Absorbing those spreadsheets deserves its own small piece of work.

### Prerequisites — built in V7.16

JES enforced recording through workflow: no job order, no material movement.
The app made it a button someone had to remember, and styled the failure state
more quietly than the success states. Four ways an order could reach *shipped*
with consumption silently unrecorded, all now closed:

| Was | Now |
|---|---|
| Gaps at reserve time (BOM parts absent from the ledger) were shown in the preview and **never persisted** — an order reserved with 3 of 5 components looked identical to one with 5 of 5 | `reserveForOrder` persists them to `component_gaps`; shown for as long as the reservation lives, and a gap outranks the stage on the chip |
| Status was a free dropdown with **no reference anywhere** to the stock fields | Moving to shipped/delivered with consumption unrecorded raises a confirm naming the actual reason. A confirm, not a block — simple sales legitimately consume nothing |
| The "nothing recorded" state rendered in `text-ink-40`, the quietest style on the page | Reads as red, with an icon |
| Three separate cards, no combined answer | One roll-up chip beside Status: not recorded / partly recorded / recorded |

The roll-up deliberately **does not nag**: a class nobody touched is not counted
as missing, because plenty of orders use no packaging or no crystals. Only work
that was *started and left unfinished*, or finished with known gaps, counts.

### Cutover checklist for step 4

Code is done. What remains is a date and three checks:

1. ~~**Does JES let you raise an SI when FTBS stock is insufficient?**~~
   **ANSWERED 2026-07-19, and it is the blocking case.** CuiLing:
   *「成品倉唔夠料，JES confirm唔到單。我要做adjustment，在成品倉加數量才能夠
   confirm invoice. 如果唔係，佢就係open status.」*

   **JES will not confirm an invoice without stock in FTBS.** The invoice sits at
   `open` until someone posts a manual adjustment adding quantity to the
   finished-goods warehouse.

   **This couples the production cutover to the sales cutover, and the plan did
   not account for it.** Once production-in stops, FTBS is never replenished, so
   every invoice needs a prior adjustment. Work does not disappear — **it moves
   from XiangXia to CuiLing**, which inverts the adoption argument that made
   production the safe first step.

   Measured, since 2025:

   | | |
   |---|---:|
   | SI movements out of FTBS | **924** |
   | IA adjustments into FTBS | **218** (all by user `ADM`) |
   | Distinct days those fall on | **20** |
   | Net quantity added | +1,648 |

   Two things follow. FTBS is **already** short often enough to need topping up
   about every two to three weeks — so this is an existing workaround, not a new
   one. And because it is done in **batches on 20 days a year, not per invoice**,
   the honest interim is a **periodic bulk top-up of FTBS**, not an adjustment
   per document.

   **Recommended interim:** XiangXia stops job orders and production-in entirely;
   someone posts a periodic bulk adjustment into FTBS purely so JES will confirm
   invoices, until sales documents migrate. State plainly that this is a
   workaround keeping a number JES needs and nobody trusts — FTBS is already
   bookkeeping rather than a real figure, since the team's real stock lives in
   Excel (§4).

   **Do not present production as "pure removal of work" to the team until this
   is settled.** For CuiLing it is not.
2. **Crystal opening balances** — extract at cutover, reconcile against the
   team's own figures, import via `inventoryClass.importStock`. Settle any
   JES-vs-Excel disagreement *first*.
3. **Tell the team two things**, not one: stop opening job orders *and* press
   Reserve → Production-in on the order in the app. JES enforced the second by
   refusing to move material without a job order; the app asks instead. The
   V7.16 prompts catch a miss, but they work best when the step is expected
   rather than met cold.

---

## 5. What could go wrong

- **A function nobody mentioned.** The commonest cause of stall. Mitigation: the
  screen snapshots, step 2.
- **The item master is load-bearing and already messy.** Every product, BOM,
  stock record and order line points at those codes.
- **Cutovers are irreversible in practice.** Once sales orders stop being
  entered in JES, going back means re-keying weeks of work. Each cutover must be
  a decision, not a drift.
- **The team, not the software.** They have used JES for twenty years. Every
  function that moves should be *better* for the person doing it, or they will
  quietly keep using JES.

## 6. How long

**Several months, not weeks**, and the shape depends on what the screens show.
Steps 1–3 are weeks. Steps 6 and 7 are the substance. Step 8 depends on Cindy.

Resist committing to a date before the screens have been seen.

## 7. What is needed from the owner

1. **Screen snapshots** — the whole plan's shape depends on them.
2. ~~**The JES→PBIS import file** — blocks invoicing.~~ **Received 2026-07-19.**
   Four follow-up questions for Cindy in `PBIS-IMPORT-FORMAT.md` (the `type`
   codes, who maintains the exchange rates, discount/charge semantics, and
   whether the name column is read on import).
3. **A decision on the item master** (step 6) when we get there.
4. **Someone to call each cutover** — when the team stops using JES for a
   function.
5. ~~**Confirmation on the production-in date** before production moves (§4).~~
   Confirmed — nobody uses it. And finished-goods stock is settled (§4).
6. **A cutover date for production** — the one remaining input for step 4. The
   code prerequisites are done; what is left is the day the team stops opening
   job orders in JES.
