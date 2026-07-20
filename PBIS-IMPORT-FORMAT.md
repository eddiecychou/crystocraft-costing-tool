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

  M03's last invoice is 2024-12-27 — the very row in this CSV — and 228 invoices
  since 2025-01-01 carry no `UA`.

  > **Correction, same day.** That looked like a finished relationship, and an
  > earlier draft concluded `UC` was therefore safe as a universal key going
  > forward. **Owner: Mascot still has business, "maybe one order per year."**
  > The series is **dormant, not dead.**

  So the app must not assume every sale carries a UC. `UA` is rare enough to
  handle by exception rather than by design, but "UC covers everything" is false
  both for history (~340 unmatched M03 invoices, correctly) and for the
  occasional future order.
- **UC4657 — a typo in Cindy's file, NOT a design gap.**

  > **Correction.** An earlier draft called this "a concrete second example of
  > the multi-invoice UC question" and concluded the registry's one-row-per-UC
  > shape could not represent it. **Wrong on both counts.** Owner: *"there will
  > never be one UC, 2 invoices. Either it is an update — there will be a suffix
  > at the UC, e.g. UC1234 was updated by UC1234-a — or it is a wrong
  > input/typo."*

  Traced it, and the rule holds exactly:

  | | |
  |---|---|
  | `SI240248` | → `UC4657` in the registry (Rex Wong, HKD 4,290) ✅ matches |
  | `SI240240` | **not in the registry at all** — no row references it |

  So `UC4657` legitimately belongs to `SI240248`. `SI240240`'s reference in
  Cindy's CSV is simply wrong.

  The real finding underneath is different and still worth acting on:
  **`SI240240` is an invoice in JES and in the books with no registry entry
  whatsoever.** Not a shape problem — a missing row.

  How often the mistake happens, measured: only **5 of 3,691** registry rows have
  more than one invoice in `jes_si` (`UC1683`, `UC1777`, `UC2395`, `UC3796`,
  `UC4836`). Rare enough to be error rather than practice — but it does recur, so
  an app that owns the registry should **detect and reject it** rather than
  assume it cannot happen.

So of four apparent discrepancies: one is a second reference series (`UA`), one
is a typo plus a missing registry row, and two are ordinary drift. **None is a
format problem, and none is a design gap.**

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
   **Answered 2026-07-19: Cindy's audit-year rates; full FY 2026-27 table now
   recorded above.** Fixed for the financial year, set by Cindy — not market rates, which
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

## The authoritative rate table — FY 2026-27 (from Cindy, 2026-07-19)

| Currency | Rate |
|---|---:|
| HKD | 1 (pivot) |
| USD | 7.75 |
| EUR | 9 |
| GBP | 10.5 |
| CAD | 5.66 |
| RMB | 1.14 |
| MXN | **0.4581** |

Direction is **HKD per 1 unit of foreign currency** (1 USD = 7.75 HKD).

### ⚠️ MXN in the 2024-25 batch looks inverted — worth Cindy checking

The Nov 24 – Mar 25 file carries `MXN 2.182900`. Cindy's 2026-27 figure is
`0.4581`. These are reciprocals:

```
1 / 0.4581   = 2.182929      (file has 2.182900)
1 / 2.1829   = 0.458106
```

Every other currency in that file follows HKD-per-unit — USD 7.75, EUR, GBP,
CAD, RMB. `0.4581` is also the economically sensible direction, since one peso is
worth well under one HKD. So `2.1829` appears to be **MXN per HKD**, the wrong
way round.

There is exactly one MXN invoice in the batch, **`SI250016`, 844.07 MXN**:

| Applied rate | Booked as |
|---|---:|
| 2.1829 (as in the file) | **HK$1,842.52** |
| 0.4581 (this year's direction) | HK$386.67 |

If the inversion is real, that invoice is overstated by about **HK$1,456**.

**Stated as a question, not a correction** — GBP 14.00 also looked wrong by
market and turned out to be deliberate, so the rate table is not ours to judge.
But a reciprocal to five significant figures is a different kind of evidence from
"looks high", and the two files disagree by a factor of 4.76 on the same
currency. Cindy should decide.

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

## UC numbers are not always plain `UC####` — 6% carry a suffix

Owner, 2026-07-19: an updated order gets a **suffix on the same UC** —
`UC1234` updated by `UC1234-a`. This was not previously written down anywhere,
and it matters: the app's allocator issues plain sequential numbers only.

Measured across all 3,691 registry rows — **227 (6.1%) are not plain `UC####`**:

| Shape | Count | Example |
|---|---:|---|
| `UC####(A)` | 72 | `UC1547(A)` |
| `UC####/UC####` | 37 | compound — see below |
| `UC####-#` | 31 | the hyphen form |
| `UC####(B)` | 14 | `UC1547(B)` |
| `UC####/####` | 10 | `UC1956/61` |
| `UC####/UC####/UC####` | 10 | three at once |
| `UC####/####/####` | 9 | |
| `UC####/UC####/UC####/UC####` | 6 | four at once |

Two distinct things are mixed in here:

1. **Update suffixes** — `(A)`, `(B)`, `-1`. This is the rule the owner
   described, and the parenthesised form is more common than the hyphen. An
   allocator must be able to issue `UC1234(A)` against an existing `UC1234`.
2. **Compound references** — `UC2008/2016`, and up to four UC numbers in a single
   `uc_no` field. **This is not the update rule and is not yet explained.** It
   may be several orders combined onto one document. ~72 rows.

## Hard requirements for the generator (Cindy, 2026-07-19)

Three operational answers that constrain the design more than the file format
does. Each of these fails **silently in the books** if ignored.

### 1. PBIS has NO duplicate protection

> *"PBIS will see it as new entry if a document is imported twice. I need to
> delete it manually."*

**The app must track what it has already exported.** There is no safety net at
the far end: a re-run after a partial failure, a retried download, or two people
exporting the same quarter all post the invoice twice, and Cindy has to find and
delete it by hand.

This is the opposite of the image upload, where re-running was cheap because
uploads were upserts. Here **re-running is dangerous**, so the exporter needs an
exported-state marker per document and a deliberate "re-export anyway" path
rather than a plain button.

### 2. Cadence is quarterly

> *"Normally, I do it every 3 months."*

So the natural shape is **"everything not yet exported, up to a cut-off date"**,
not a live feed and not one-file-per-invoice. Combined with (1): the batch itself
is worth recording, so a re-send can reproduce exactly what was sent before.

### 3. Voided invoices must be EXCLUDED at source

> *"Normally, voided invoice should not import into pbis. It may be due to
> mistake handling. All imported invoice or purchase order will be checked and
> adjusted manually in pbis."*

The format has no way to express a credit, a reversal or a cancellation — every
row is a positive document. **Voids are handled by never sending them.**

So the exporter needs a reliable void signal. Today that is
`uc_registry.jes_si = 'VOID'` — and `UC4933` is exactly the case where it failed:
a voided invoice reached the books because the registry was not updated. Owner
confirms it was a mistake and should not have happened.

That makes the registry-adoption problem (see `PROJECT-PLAN.md`) a **correctness
dependency, not just tidiness**: if the app is to filter voids out of the export,
the app's void flag has to be the real one, maintained live — not a snapshot of
Cindy's spreadsheet.

Cindy also checks and adjusts everything manually after import, so the export is
a first draft rather than the final word. Useful to know: it means a small
formatting imperfection is recoverable, while a duplicate or a stray void is not.

## What this unblocks

Invoicing was last in the retirement plan *because of this file*. With the format
known and the app's data validated 32/32 against it, the invoicing step can now
be scoped properly rather than deferred. The remaining work is a generator that
emits these twelve columns, plus the customer/supplier code mapping and the
exchange-rate table from question 2.

**Not yet built.** This document is the contract, not an implementation.
