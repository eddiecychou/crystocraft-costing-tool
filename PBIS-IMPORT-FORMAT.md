# The JES → PBIS import format

Received from Cindy 2026-07-19: `invoice to import.xls` and `PO to import.xls`.

This file was **the longest pole in `JES-RETIREMENT-PLAN.md`**. Step 8 (invoices)
was deliberately last because an app-generated invoice has to reproduce whatever
PBIS ingests, and until now we had only PBIS *output* (`parse_pbis.py` reads the
`.RPT` journal listing). This is the input side.

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

## Open questions for Cindy

1. **What does `type` mean on purchases?** `FS`, `PP`, `RM`. `RM` is plausibly
   raw material; the rest would be guessing. Blank on invoices.
2. **Where do the exchange rates come from, and who maintains them?** They are
   standing rates, not daily: USD 7.75 (the peg), EUR 9.0, GBP 10.5, CAD 5.66,
   RMB 1.14 — round numbers, constant across the file. An app-generated file must
   use the same table or the books will not reconcile.
3. **How do discount and charge behave when populated?** The columns exist but
   are `0.0` on all 55 rows, so the fields are known and their semantics are not.
4. **Is the `Customer Name` column (12) read on import, or cosmetic?**

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
