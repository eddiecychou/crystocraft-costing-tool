# The JES → PBIS import format

Received from Cindy 2026-07-19: `invoice to import.xls` and `PO to import.xls`.

This file was **the longest pole in `JES-RETIREMENT-PLAN.md`**. Step 8 (invoices)
was deliberately last because an app-generated invoice has to reproduce whatever
PBIS ingests, and until now we had only PBIS *output* (`parse_pbis.py` reads the
`.RPT` journal listing). This is the input side.

## THE SPEC: the CSV is what PBIS actually ingests

Cindy supplied a real imported file — `nov24 to mar25 inv.csv`, 87 invoice rows,
Nov 2024 to Mar 2025. **This is the authoritative format.** The `.xls` workbooks
are her working copies; the column table further down describes those and is
kept only for context.

Her note on the always-zero columns: *"normally is 0, but they needed to be there
when I import as .csv."* The import is **positional** — every field must be
present even when empty, or everything after it shifts.

### File-level

| | |
|---|---|
| Encoding | **UTF-8 with BOM** (`EF BB BF`) — the BOM is present, so emit it |
| Line endings | **CRLF** |
| Header row | **None.** The file starts at data |
| Delimiter | Comma, no quoting used in the sample |
| Fields per row | **10, on all 87 rows** |

### Fields (invoice CSV)

| # | Field | Example | Convention |
|---:|---|---|---|
| 0 | Doc class | `SI` | |
| 1 | Invoice no. | `SI240238` + spaces | **Left-justified, space-padded to exactly 20 chars** |
| 2 | Issue date | `1/11/2024`, `27/3/2025` | **`d/m/yyyy`, NOT zero-padded** |
| 3 | Total | `774`, `144.4`, `397.61` | Plain decimal; no thousands separator, no forced `.00` |
| 4 | Customer | `O07` | JES code |
| 5 | Currency | `HKD` | |
| 6 | Exch | `7.750000` | **Always 6 decimal places** |
| 7 | Ref | `UC4649` | **No `/YY` suffix** — unlike the `.xls`, which has `UC4943/26` |
| 8 | charge | `0` | `0` on all 87 rows |
| 9 | discount amt | `0`, `50`, `20` | Non-zero on 8 rows — see below |

**Ten fields, not the thirteen in the `.xls`.** The CSV drops the `Discount`
column, the `type` column and the trailing name column. Note this is the
**invoice** CSV — the purchase CSV is still unseen, and since purchases carry a
real `type` (`PP`/`RM`/`PA`/`FS`) its field list is probably different. Do not
assume it is these ten.

### charge / discount, finally with populated examples

8 of 87 rows are non-zero. Every one is field 9, always HKD, and always a round
figure — `50` seven times, `20` once. Field 8 is `0` throughout.

Because only one of the two is ever populated, **the data cannot prove which
field is "charge" and which is "discount amt"** — that mapping comes from the
`.xls` header order and should be confirmed before it is relied on.

## The headline: header-level only

**One row per document. No line items.**

An app-generated invoice does **not** need to reproduce JES's line structure,
its separate surcharge tables, or its `sigstamount` tax field. PBIS wants a
header and a total. That removes the largest unknown from the invoicing step —
the fear was that the books depended on line-level detail, and they do not.

## For context only: the `.xls` working copies

Not the import format — see the CSV spec at the top. Kept because the `.xls`
carries column *headers*, which the headerless CSV does not, and that is where
the field names come from.

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

### Second validation: 87 rows from the real CSV (Nov 24 – Mar 25)

| | |
|---|---|
| UC references resolved | **86 / 87** |
| Currency matches | **87 / 87** |

The exceptions are each interesting, and none is a format problem:

- **`UA2168` — a second reference series. Answered by Cindy 2026-07-19:**
  *"UA is order issued to Mascot previously. (I guess it's because we are selling
  semi-finish product to them, so we use UA instead of UC.)"* Note she marks the
  reason as a guess; the existence of the series is not in doubt.

  Traced it: the row is `SI240274`, customer **`M03` = Mascot International Inc**.
  M03 has **379 invoices** in the ERP, of which **only 40 appear in
  `uc_registry`** — so roughly 340 invoices to this customer sit outside the
  registry entirely. **`uc_registry` holds 3,691 rows and every one is
  `UC`-prefixed; there are zero `UA` rows.**

  **The mitigating fact: M03's last invoice is 2024-12-27** — the very row in this
  CSV. The relationship appears to have ended, and 228 invoices have been raised
  since 2025-01-01 with no `UA` among them.

  So **UC is safe as the join going forward**, but it is *not* a complete key to
  history. Anything that reconciles the books against the registry across older
  periods will show ~340 M03 invoices as unmatched, and that is correct rather
  than broken. Worth confirming with the team that M03 is genuinely finished
  before relying on "UC covers everything".
- **UC4657 covers two invoices** — `SI240240` (3,432) and `SI240248` (4,290).
  The registry holds 4,290, so the other invoice appears as a "total mismatch"
  when it is nothing of the kind. **This is a concrete second example of the
  multi-invoice UC question left open in `JES-RETIREMENT-PLAN.md` §5** (which
  cited `UC4836 = SI250128/137`). It is not rare, and the registry's one-row-per-
  UC shape cannot represent it.
- **`SI240249`** — registry total empty where the CSV has 9,700.
- **`SI250038`** — registry 51.52 against CSV 51.72, a 20-cent difference.

So of four apparent discrepancies, **one is a design gap** (multi-invoice UC),
one is an unknown reference series, and two are ordinary registry drift.

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
5. ~~**What date format does the CSV use?**~~ **Answered: `d/m/yyyy`, not
   zero-padded.**
6. ~~**What encoding and dialect?**~~ **Answered: UTF-8 with BOM, CRLF, comma.**
7. ~~**Does the CSV carry the header row?**~~ **Answered: no.**
8. **Which of fields 8 and 9 is "charge" and which is "discount amt"?** Only one
   is ever populated, so the data cannot say.
9. ~~**What is the `UA` reference series?**~~ **Answered: orders to Mascot
   (M03).** ~340 of its 379 invoices sit outside `uc_registry`, but the
   relationship ended 2024-12-27. See the validation section.
10. ~~**Is GBP 14.00 correct for the 2024/25 audit year?**~~ **Answered: yes,
    that was the PBIS rate for that year.**
11. **Send one purchase `.csv` too.** We have the invoice CSV and both `.xls`
    files, but not a purchase CSV — and purchases carry a real `type` code, so
    their field list is probably not the invoice's ten.

## ⚠️ The exchange rate is a trap — do NOT use the app's own rates

The `Exch` column carries **Cindy's audit rates for the financial year**, fixed
for the year. The app already has two *different* sources of exchange rate, and
using either would silently misstate the books:

| Source | Purpose | RMB | USD | EUR | GBP | CAD | MXN |
|---|---|---|---|---|---|---|---|
| **PBIS, FY 2026 batch** | **the books** | **1.14** | **7.75** | **9.00** | **10.50** | **5.66** | — |
| **PBIS, Nov 24–Mar 25 batch** | **the books** | — | **7.75** | **8.50** | **14.00** | **6.055550** | **2.182900** |
| `src/currency.js` `DEFAULT_RATES` | app pricing | 1.09 | 7.78 | 8.60 | — | — | — |
| `netlify/edge-functions/fx-rates.js` | live market feed | *daily* | *daily* | *daily* | — | — | — |

EUR is **4.7% apart** from the app's default and RMB **4.6% apart**. A PBIS file
generated with the app's rates would be wrong by roughly that much on every
non-HKD document — large enough to matter to an audit, small enough that nobody
notices for months.

**The two PBIS batches prove the rates really do move between years, and by a
lot.** GBP goes **14.00 → 10.50** and CAD **6.055550 → 5.66** between the
2024/25 file and the 2026 file. Only USD holds at the 7.75 peg.

> **GBP 14.00 — queried and confirmed.** Cindy, 2026-07-19: *"GBP 14 was
> 2024-2025 exch rate used in pbis."* Deliberate, not an error.
>
> The wider lesson matters more than the answer: 14.00 is far from any market
> GBP/HKD rate for that period (roughly 9.5–10.5), yet it is the correct value
> for the books. **So the rate table cannot be sanity-checked against market
> data, and must never be computed or "corrected".** It is copied from Cindy for
> each audit year, verbatim, and a value that looks wrong is not evidence that it
> is.

`MXN` also appears (2.182900) and is **not** among the app's
`CUSTOMER_CURRENCIES`, so the currency list is wider than the app currently
models.

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
