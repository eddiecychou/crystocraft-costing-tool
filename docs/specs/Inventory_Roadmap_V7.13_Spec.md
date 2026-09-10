# Inventory Roadmap — V7.13 (Component Inventory as Source of Truth)

> **Status: BUILT — V7.13 CLOSED 2026-07-14, live `7819bb0`.** This doc was
> written 2026-07-10 as the pre-build plan (agreed direction, evidence, open
> decisions) — everything in §3–§7 below shipped, including the two-stage
> reserve→production-in model that was decided *after* this doc was written
> (owner clarified the real ERP workflow mid-cycle). For what actually got
> built, in order, with commit hashes, see **`PROJECT-PLAN.md` → "Current
> Status — V7.13 CLOSED"** in this repo. This file is kept as the historical
> record of the reasoning and evidence (esp. §4's crystal-Excel analysis).
> Canonical version belongs in Obsidian
> (`Crystocraft/Operations/Costing Tool - Project Plan.md`).

## 1. Goal

Move component inventory off the ERP and make **this app the source of truth**,
in stages. Metal components are already loaded and matched to ERP itemcodes. The
two remaining component classes are **crystals** and **packaging** — fewer items,
but the hard part is (a) how they attach to a product/order and (b) how stock is
deducted when an order is confirmed/shipped.

Two milestones that must **not** be conflated:

- **Operational truth** — what's physically on the shelf, what to reorder.
  Achievable in V7.13.
- **Financial truth** — year-end valuation, retiring the ERP. A *later* milestone
  gated on a proper ledger, period-lock, and a valuation basis. Do not let the
  year-end goal pull unfinished valuation work into V7.13.

## 2. Foundational principles (from the V7.13 critical review)

1. **A ledger, not a mutable number.** On-hand must be a *derived running balance*
   over an append-only movement log (receipt / issue / adjustment / stock-take),
   never a single editable `stock_qty` that gets decremented in place. A single
   number cannot answer "why is on-hand 340?" and breaks the first time an order
   is edited, cancelled, or re-confirmed. **This is the decision everything hangs
   on.** (The metal-component `stock_qty` today is fine for read-only MRP but must
   become derived once we start deducting.)

2. **Reserve, don't hard-deduct, at confirm.** Real inventory needs three
   quantities: **on-hand**, **reserved** (committed to confirmed orders), and
   **on-order** (POs raised). Confirming an order should *reserve*; the physical
   *issue* happens at production/shipment. (Note the half-built `reserved_qty`
   field already in the schema.)

3. **Shadow-run before retiring the ERP.** Keep the ERP authoritative for one full
   cycle while the app mirrors movements, reconcile at period end, retire only
   when the numbers tie out. Keep the inventory module decoupled from the agile
   costing flow (which quotes still drive — see [[project-supplier-po-module]]).

## 3. The core decision — TWO deduction mechanisms

Different component classes behave differently; forcing one model on all three is
the mistake. This is correct design, not a compromise:

| Class | Deduction mechanism | Why |
|---|---|---|
| **Metal components** | per-unit **BOM explosion** (already built) | Deterministic, ~1:1 per figurine; forward MRP is valuable. |
| **Crystals** | **batch issue per order**, against a ledger | Usage is variable/customised; samples & defects are non-order movements. |
| **Packaging** | **batch issue per order** (pack-time), against a ledger | Cartons/inserts consumed at pack time, per order — not per finished unit. |

Metal stays on the deterministic per-unit BOM. Crystals and packaging move to a
manual **batch-per-order** issue against a running-balance ledger.

## 4. Why batch-per-order is right for crystals — evidence

Reviewed the owner's live files on 2026-07-10:

- **`FSTK.XLS`** — ERP warehouse balance report (貨倉結存報告), 255 stock lines.
  Current on-hand; the year-end count basis. Each crystal **colour is already a
  distinct ERP code** (e.g. `BDC-8232-0014-005` = PI/Rosaline).
- **`捷克水晶进出仓明细2026.xls`** — a manual **append-only ledger**, one sheet per
  crystal colour SKU (26 SKUs). Columns: date · qty in (入仓) · running balance
  (剩余总存数) · qty out (出仓) · order detail (UC/PO/SO). Already the ledger shape
  we want.

Counting every issue row across all 26 sheets (≈3.5 years of history):

- **1,183 total deductions.**
- **993 (84%) are already batch-per-order-per-colour** — one row = the actual total
  crystals of that colour consumed by one order, tied to a UC/SO.
- **~171 (15%) are samples, exhibition pieces, incoming defects, adjustments**
  (样板 / 来货次品 / 不良水晶调整) — **not driven by any order.**

Conclusions:

- The batch-per-order model **is already how the business works** — we are
  digitising existing practice, not inventing a new one.
- A per-unit colour BOM would fight reality: usage varies by design and customer
  colour choice; there is no stable "SKU = 12 pink + 8 clear per unit".
- **The 15% non-order movements are fatal to a BOM-explosion-on-confirm model** —
  it structurally cannot record samples/defects, so the balance would drift from
  the ERP within weeks. A ledger with manual issues **plus adjustments** captures
  everything. This alone settles it.

**Critical caveat:** batch deduction does **not** mean colours stop being tracked.
The ~26 colour SKUs remain in the item master and the ledger; at issue time you
still pick *"450 of BDC-8232-0014-005 PI"*. What is dropped is only the
**product → colour-quantity mapping**, not colour tracking.

## 5. The tradeoff we accept

The per-unit BOM (metal) buys **forward requirement/shortage prediction**. Batch
deduction is a record *after the fact*, so **crystal MRP is given up**. Acceptable
because crystals are a bulk consumable buffer (big periodic 入仓 receipts consumed
down), not a made-to-order part — forward planning matters far less than for
metal. Volume is modest: ≈340 issues/year across 26 SKUs (~28/month), the same
effort as the Excel today but with auto running-balances and a real order link
instead of free text.

## 6. Data model (crystals & packaging)

- **Item master** — seed from `FSTK.XLS`, **reuse the ERP codes as keys** (same
  convention already used for metal components). ~26+ crystal colour SKUs;
  packaging SKUs similar order of magnitude. UOM = PCS (crystals).
- **Append-only movement ledger** per SKU:
  `{ date, type: receipt|issue|adjustment|stocktake, qty, order_id?, note }`.
  On-hand = derived running balance; never a mutable number.
- **Order link is OPTIONAL** on issue rows — 84% link to an order, ~16%
  (samples/defects) do not. If the link is mandatory, that 15% cannot be recorded.
- **Optional, later:** a per-design "typical usage" template that *pre-fills* the
  batch at issue time (operator adjusts to actuals) — light planning without a
  rigid colour BOM. Start fully manual.

## 7. Phasing

1. **V7.13a — Ledger + reservation on metal.** Introduce the movement ledger,
   make metal `stock_qty` derived, reserve-on-confirm / issue-on-ship. Prove the
   mechanism end-to-end on components already trusted and ERP-matched.
2. **V7.13b — Crystals.** Item master seeded from FSTK; batch issue per order
   against the ledger; adjustments/samples/defects supported; optional order link.
3. **V7.13c — Packaging.** Same batch model, tied to the pack step
   (`packing_lists`), not the product BOM.
4. **Shadow-run vs ERP** for one full cycle; reconcile `FSTK` at period end before
   retiring the ERP for these classes.

Counterintuitively, **start with metal, not crystals/packaging.** The deduction
*mechanism* is category-agnostic and metal is already loaded and ERP-matched — the
ideal proving ground before touching the harder classes.

## 8. Open decisions for the team — RESOLVED (as built)

1. **Deduction timing** — ~~reserve-at-confirm / issue-at-ship, or hard-deduct
   at confirm?~~ **Decided, then refined mid-cycle**: started as a manual,
   reversible single-stage "Issue" action; owner then clarified the real ERP
   practice is genuinely two-stage — **Reserve** at order confirmation +
   deposit (allocated, still on-hand), then **Production-in** when actually
   built (consumed). Built as reserve→produce for all three classes.
2. **Opening balances** — **still open**, not done this cycle. Stock currently
   reads whatever was in the app's `stock_qty`/component records before the
   ledger existed (auto-seeded as an opening stock-take on first movement) —
   this has **not** been reconciled against a fresh `FSTK` count. Needed
   before trusting the numbers for real ordering decisions.
3. **V7.13 scope** — **decided: operational truth only.** Financial/year-end
   truth (period-lock + valuation basis) explicitly deferred to a later
   milestone — see PROJECT-PLAN.md "Deliberately not done in V7.13".
4. **Packaging attach point** — **decided: batch-per-order**, same as
   crystals (not per finished unit, not tied specifically to the pack step in
   `packing_lists` as originally floated — simpler than that, matches the
   crystals pattern exactly since the owner wanted parity for vendor
   material-requirement calculations).

## 9. Migration note

The manual crystal ledger and the ERP `FSTK` balance may not currently tie out
(hand-kept vs system). Before the app can be the source of truth, do **one clean
stock-take to set opening balances**, then shadow-reconcile against `FSTK` for a
cycle. Same shadow-mode path that earns finance sign-off to retire the ERP.
