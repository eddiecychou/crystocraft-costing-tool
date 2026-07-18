# Retiring JES — the plan

Companion to `V7.15_ERP_Inventory.md` (what the ERP contains) and
`PROJECT-PLAN.md` (what the app does). This is the route from here to
switching the old system off.

Written 2026-07-19. Everything factual below was measured against the mirror,
not assumed; the numbers are there so a future reader can re-check them.

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
| **Stock ledger** | JES only — 1.15 M movements. The app displays stock; it doesn't record it. |
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
Sales orders, then invoices. **Invoices last** — get the JES→PBIS import file
from Cindy first, because an app-generated invoice has to reproduce it.

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
| `reserveForOrder` | stock committed to an order |
| `issueForOrder` | components consumed — quantities from the *same* MRP explosion as the Component Requirements report, so the two can never disagree |
| `produceForOrder` | production-in; `committed_at` **is** the production-in date |
| `releaseForOrder` | reverses a reservation |

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

### One open question for step 7, not for this

The app's stock functions operate on component-level inventory
(`range_components`, crystals, packaging). The ERP also carries **finished-goods
stock** — FSTK holds 3,671 items. Whether the app needs to own an FG pool, or
whether finished goods are transient because you build to order, is a stock
question to settle in step 7. It does not affect the case for dropping job
orders.

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
2. **The JES→PBIS import file** — blocks invoicing.
3. **A decision on the item master** (step 6) when we get there.
4. **Someone to call each cutover** — when the team stops using JES for a
   function.
5. **Confirmation on the production-in date** before production moves (§4).
