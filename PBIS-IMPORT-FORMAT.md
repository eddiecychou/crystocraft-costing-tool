# The JES → PBIS import format

Received from Cindy 2026-07-19: `invoice to import.xls` and `PO to import.xls`.

This file was **the longest pole in `JES-RETIREMENT-PLAN.md`**. Step 8 (invoices)
was deliberately last because an app-generated invoice has to reproduce whatever
PBIS ingests, and until now we had only PBIS *output* (`parse_pbis.py` reads the
`.RPT` journal listing). This is the input side.

## The real import is CSV — the `.xls` is only how it reached us

Cindy, on why the always-zero columns are there at all: *"normally is 0, but they
needed to be there when I import as **.csv**."*

**PBIS ingests a CSV.** The two `.xls` workbooks are her working copies, not the
artefact PBIS reads. So the deliverable is a **CSV generator, not an Excel
writer** — and the import is **positional**: every column must be present even
when empty, or every field after it shifts.

That reframes an assumption in the column table below. The `.xls` stores the
issue date as an **Excel serial** (`46196`), but a CSV has no serials — the date
must be written as *some* text format, and which one is now an open question
(see 5). The same applies to encoding: the sheets carry Chinese in the name
columns, so the CSV's encoding is not a detail to guess at (see 6).

## The headline: header-level only

**Twelve columns, one row per document. No line items.**

An app-generated invoice does **not** need to reproduce JES's line structure,
its separate surcharge tables, or its `sigstamount` tax field. PBIS wants a
header and a total. That removes the largest unknown from the invoicing step —
the fear was that the books depended on line-level detail, and they do not.

## Column contract

Real `.xls` (BIFF/OLE, saved from Excel for Mac). One sheet, named for the batch
(`invoice jul10`, `PO jul10`). Row 0 is the header; row 1 onward is data.

| Col | Header (invoice / purchase) | Example | Notes |
|---:|---|---|---|
| 0 | *(blank)* | `SI` / `PI` | Document class. **`PI` here means purchase** — see the naming trap below |
| 1 | Sales Invoice No. / Purchase Order No. | `SI260085  ` | Space-padded; trim before comparing |
| 2 | Issue Date | `46196` | **Excel serial**, epoch 1899-12-30 |
| 3 | Total | `2800.0` | Document total in its own currency |
| 4 | Customer / Supplier | `P27` | **JES code**, not a name — the app must map to these |
| 5 | Currency | `HKD` | |
| 6 | Exch | `7.75` | **Standing rate, not daily** — see open questions |
| 7 | Discount / Discount% | `0.0` | 0.0 across all 55 sample rows |
| 8 | **Ref. / Reference** | `UC4943/26` | **Invoices: the app's UC number.** Purchases: free text |
| 9 | charge | `0.0` | 0.0 across all 55 sample rows |
| 10 | discount amt | `0.0` | 0.0 across all 55 sample rows |
| 11 | type | `FS` / `PP` / `RM` | Purchases only; `0.0` on invoices |
| 12 | Customer / Supplier Name | | Present in the sheet, unused in the samples |

Sample sizes: 32 invoice rows, 23 purchase rows.

## Validation against the app's own data

Every invoice row was checked against `public.uc_registry`:

| | |
|---|---|
| UC references resolved | **32 / 32** |
| Currency matches | **32 / 32** |
| Total matches to the cent | **32 / 32** |

So the app already holds everything this file needs, and the UC number is the
join — the same conclusion V7.15 reached from the PBIS *output* side, now
confirmed from the input side.

Note `uc_registry.uc_no` stores the prefix (`UC4943`, not `4943`).

### Two discrepancies — both registry drift, neither a format problem

- ⚠️ **UC4933 — the registry says `VOID`, the books are posting it.** The file
  carries `SI260070`, EUR 487.63, Peter Lammer (P34); the registry row has the
  same customer and the same total to the cent but `jes_si = 'VOID'`. Either it
  was voided and reissued without the registry being updated, or the registry is
  wrong. **An invoice the app believes is void is going into the books.** Needs a
  human decision.
- **UC4926** — registry `jes_si` is empty where the file has `SI260082`
  (USD 2012.6, Regalo Original A29; customer and total both match). An unfilled
  field, nothing more.

Both are exactly the drift that disappears once the app is the system of record.

## Naming trap: `PI` now has three meanings

| Context | `PI` means |
|---|---|
| The team | JES's **SO** (sales order) |
| `raw.itemtransaction` | **Production-in** (`FWIP → FTBS`) |
| **This file, column 0** | **Purchase** |

Write the meaning down wherever `PI` appears in code or spec.

## The purchase `type` codes — answered by the owner, 2026-07-19

| Code | Means |
|---|---|
| `PP` | **Purchase Part** |
| `RM` | **Crystal** |
| `PA` | **Packing** |
| `FS` | **POS**, or other non-figurine product |

An earlier draft guessed `RM` was "raw material". **Wrong** — it is crystals.
`PA` does not appear in this batch at all, so the format supports four codes and
the sample shows three (`PP` 15, `FS` 4, `RM` 4).

Note these four map almost exactly onto the app's own stock classes:
`PP` → components, `RM` → `crystalInventory`, `PA` → `packagingInventory`,
`FS` → the B2C trading operation that §4 of the retirement plan puts out of
scope for production.

### The code is NOT derivable from JES's item type — but the supplier predicts it

Cross-checked every PO line in the sample against `raw.purchasedetail`:

| PBIS type | JES item types on the lines |
|---|---|
| `PP` | `SF` × 51 |
| `FS` | `SF` × 5 |
| `RM` | `ST` × 4, **`SF` × 9** |

So `SF` (semi-finished) appears under all three codes, and `RM` is mostly *not*
`ST`. The item master cannot tell you the PBIS type.

Looking at what the `RM` orders actually contain shows the owner's definition is
right and **JES's typing is what's inconsistent**:

```
PU260040  [ST] BDC-8232-0014-001   Bohemia glass 8232/14(BL) double hole
PU260041  [SF] P-GL0057-BL         32mm 心形 K9水晶 - 藍色
PU260033  [SF] MISC                5kg crystal AB round beads 0.8mm
PU260034  [SF] MISC                Rhinestone Fabric
```

All crystals. Some typed `ST`, some `SF`, some dumped in `MISC`. **The PBIS type
is a better classification of what was bought than JES's own item type** — worth
remembering when the item master moves (step 6).

**Supplier predicts the type cleanly: 14 suppliers in the sample, 0 with more
than one type.** So a generator can derive `type` from a supplier→type mapping
rather than asking the user. Sample is 23 orders across 14 suppliers, so treat
that as a strong hypothesis to confirm against a wider batch, not a proven rule —
and a new supplier will always need classifying by hand.

## Open questions for Cindy

1. ~~**What does `type` mean on purchases?**~~ **Answered above by the owner.**
2. ~~**Where do the exchange rates come from, and who maintains them?**~~
   **Answered 2026-07-19: they are the rates Cindy is using for this year's
   audit.** Fixed for the financial year, set by Cindy — not market rates, which
   is why they are round numbers (EUR 9.0, GBP 10.5) with USD at the 7.75 peg.
   See the warning below; this is the most dangerous field in the file.
3. ~~**How do discount and charge behave when populated?**~~ **Answered by Cindy
   2026-07-19:** *"normally is 0, but they needed to be there when I import as
   .csv."* So they are not semantically interesting — they are **structurally
   required**. The import is positional: every column must be present even when
   empty, or the fields after it shift. See the CSV note below, which is the
   more important half of that answer.
4. **Is the `Customer Name` column (12) read on import, or cosmetic?**
5. **What date format does the CSV use?** The `.xls` holds an Excel serial, which
   cannot survive into a CSV. `dd/mm/yyyy`? `yyyymmdd`? PBIS's own `.RPT` output
   uses `dd/mm/yyyy`, so that is the guess — but it is a guess, and a wrong date
   format either fails the import or, worse, silently transposes day and month.
6. **What encoding and dialect does the CSV need?** Comma or tab; quoting rules;
   and critically **UTF-8 or Big5** — the sheets carry Chinese in the name
   columns, and the ERP mirror already proved this business has legacy Big5 data
   (see the V7.14 sync bug in `ERP-SYNC-V1.0.md`).
7. **Does the CSV carry the header row**, or start straight at data?

**The cheapest way to close 5–7: ask Cindy for one real `.csv` she has actually
imported.** One file answers all three and removes the guesswork entirely — the
same way the `.xls` pair answered far more than a description would have.

## ⚠️ The exchange rate is a trap — do NOT use the app's own rates

The `Exch` column carries **Cindy's audit rates for the financial year**, fixed
for the year. The app already has two *different* sources of exchange rate, and
using either would silently misstate the books:

| Source | Purpose | RMB | USD | EUR | GBP | CAD |
|---|---|---|---|---|---|---|
| **PBIS import (Cindy's audit rates)** | **the books** | **1.14** | **7.75** | **9.00** | **10.50** | **5.66** |
| `src/currency.js` `DEFAULT_RATES` | app pricing | 1.09 | 7.78 | 8.60 | — | — |
| `netlify/edge-functions/fx-rates.js` | live market feed | *daily* | *daily* | *daily* | — | — |

EUR is **4.7% apart** and RMB **4.6% apart**. A PBIS file generated with the
app's rates would be wrong by roughly that much on every non-HKD document —
large enough to matter to an audit, small enough that nobody notices for months.

Three consequences for whoever builds the exporter:

1. **The PBIS export needs its own rate table, keyed by financial year**,
   maintained deliberately and sourced from Cindy. It must not read
   `settings/exchange_rates`, and it must never call `fx-rates.js`.
2. **The rates change each year.** An export run in a new financial year with
   last year's table is wrong in the same quiet way.
3. **GBP and CAD are not in the app's `DEFAULT_RATES` at all** but do appear in
   the invoice file (GBP 10.5, CAD 5.66) — so the table cannot simply be copied
   from what the app already has.

The safest design is to store the rate **on the document at the time it is
raised**, the way `Exch` already appears per row here, rather than looking it up
at export time.

## Also observed

- The purchase `Reference` column is inconsistent hand-keyed free text:
  `20260710.0`, `DATE260325`, `DATED20260425`, and `DATE2026015` — which looks
  like a typo for `20260515`. **No UC join on the purchase side.**
- Numeric-looking references arrive as floats (`20260710.0`), so anything reading
  this must not assume the column is text.
- Dates are Excel serials, so a reader needs `datetime.date(1899,12,30) + days`.

## What this unblocks

Invoicing was last in the retirement plan *because of this file*. With the format
known and the app's data validated 32/32 against it, the invoicing step can now
be scoped properly rather than deferred. The remaining work is a generator that
emits these twelve columns, plus the customer/supplier code mapping and the
exchange-rate table from question 2.

**Not yet built.** This document is the contract, not an implementation.
