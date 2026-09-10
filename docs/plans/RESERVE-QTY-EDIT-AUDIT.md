# Editable reserved quantity — feasibility audit

> **BUILT — V8.15, 2026-09-10.** `adjustReservedLine` in `src/orderStock.js`;
> inline `EditableQty` cell in both the Component and Crystal/Packaging cards.
> Verified end-to-end against a live order (woo-65496): reserve → 1→5→3→5→3 →
> release, ledger `reserved_after` tracked every step (1,5,3,5,3,0), on-hand
> untouched, the 5→3→5→3 cycle posted four distinct movements (no idempotency
> dedupe — landmine L-A held), stored line qty == component `reserved_qty` at
> every point. The audit below is kept as the design record.

**Ask (XiangXia, 2026-09-10, `~/Desktop/app问题.xlsx`):** on a shipment's
**Crystal stock** panel, next to a line "Reserved · 2026/8/13 · BDC-8232-0014-002
· C1 · 300", she wrote **"可以修改数量吗"** — *can I edit the quantity?* Same wish
applies to the **Component stock** panel (the "不是标配，需修改内容" note).

Today the only way to change a reserved quantity is **Release the whole
reservation and redo it**. This audit is the groundwork for an in-place edit.
Nothing here is built yet.

---

## 1. How reservation works now

On-hand is **derived** — never a mutable number. Each stock item
(`range_components/{id}`, `crystals/{id}`, `packaging/{id}`) has an append-only
`movements/` sub-collection; `postMovement` (`src/stockLedger.js`) applies one
movement inside a transaction and caches two balances on the item doc:

| field | meaning |
|---|---|
| `stock_qty` | on-hand (physically in stock) |
| `reserved_qty` | allocated to confirmed orders, on the line, not yet consumed |

`available = stock_qty − reserved_qty` (`availableOf`, `criticalComponents.js`).

Movement types that matter here (`movementEffect`):

| type | on-hand Δ | reserved Δ |
|---|---|---|
| `reserve` | 0 | **+\|q\|** |
| `release` | 0 | **−\|q\|** |
| `produce` | −\|q\| | −\|q\| |

### The order lifecycle (`src/orderStock.js`)

Per stock class, three fields on `orders/{id}` track a strict one-way stage:

```
open ──reserveForOrder──▶ reserved ──produceForOrder──▶ committed
  ▲                          │                              │
  └──────releaseForOrder─────┘         reverseProduceForOrder┘
```

- `*_reserved` / `*_reserved_at`, `*_committed` / `*_committed_at`
- `*_lines` = `[{ <idField>, code, qty }]` — the frozen list of what was reserved
  (`component_lines` + `component_id`; `crystal_lines` + `crystal_id`;
  `packaging_lines` + `packaging_id`)
- `<*_reserved>_generation` — integer, bumped **only** by `reserveForOrder`
- `component_gaps` (metal only) — what couldn't be reserved

Every movement in the loop is keyed
`{verb}_{orderId}_g{generation}_{lineId}` (e.g.
`reserve_UC4971-26_g2_abc123`). `postMovement` makes that string the movement
**doc id**, so a retry after a partial failure finds the doc already there and
returns without double-posting. `produce` / `release` / `reverse_produce` reuse
the same `generation`, distinguished by the verb prefix.

`produceForOrder` and `releaseForOrder` read **`d[*_lines]`** and post
`Math.abs(l.qty)` per line — so **whatever qty is stored on the line is
authoritative** for consume and for release. That is the hook an edit needs.

### Two panels, two shapes

| | Component stock (`OrderStockIssue.jsx`) | Crystal / Packaging (`OrderInventoryIssue.jsx`) |
|---|---|---|
| where qtys come from | MRP explosion of the order's figurine lines through each Range BOM (`computeOrderIssue` → `mrp.computeRequirements`) — plating-aware, shared parts counted once | operator hand-picks SKU + types a qty; **no BOM** |
| after Reserve | `component_lines` frozen; preview no longer consulted | `crystal_lines` / `packaging_lines` frozen |
| reserved-state UI | `LinesTable` — code + qty, read-only | small table — code + colour + qty, read-only |

Both go through the **same** `reserveForOrder / produceForOrder /
releaseForOrder` in `orderStock.js`. **One edit primitive there serves all three
classes.**

---

## 2. What "edit a reserved line qty" must actually do

For a line currently reserved at `oldQty`, target `newQty`:

1. **Guard:** stage must be `reserved` for that class. Never edit once
   `committed` (reverse production-in first). `newQty` an integer `> 0`
   (to remove a line entirely, that's a separate "delete line" action —
   post a `release` for the whole line and drop it from `*_lines`).
2. **Post the delta** to that one item's ledger:
   - `newQty > oldQty` → `postMovement(colPath, lineId, { type: 'reserve', qty: newQty - oldQty, … })`
   - `newQty < oldQty` → `postMovement(colPath, lineId, { type: 'release', qty: oldQty - newQty, … })`
   - equal → no-op
3. **Rewrite the stored line:** `*_lines` → map, set `qty = newQty` on the
   matching `lineId`. Everything downstream (`produceForOrder`,
   `releaseForOrder`) then uses the new number automatically.
4. **Leave an audit note** on the movement, e.g.
   `Adjusted reservation 300 → 250 · order UC4971/26`, so `StockLedger.jsx`
   shows a human reason rather than a bare `reserve`/`release`.

No `firestore.rules` change: `movements` writes need `can('supply')`,
`orders/{id}` needs `can('shipping')` — a staff user editing a shipment already
holds both. No schema migration: `*_lines[].qty` already exists and is already
the value `produce`/`release` trust.

---

## 3. Landmines

### L-A · Idempotency-key collision (the real one)

Keys are `{verb}_{orderId}_g{gen}_{lineId}`. There is **no edit counter** in
that string. If an edit posts `reserve_UC…_g2_abc` and later the line is edited
again in a way that would post the same verb for the same line in the same
generation, `postMovement` sees the doc id already exists and **silently
dedupes** — the ledger doesn't move, but step 3 would still rewrite `*_lines`.
Reserved qty and the ledger then disagree. Concretely: `300 → 250` (posts
`release …_g2_abc`), then `250 → 300` (posts `reserve …_g2_abc` — *new*, fine),
then `300 → 250` again → **same key as the first**, deduped, drift.

**Fix:** put a per-line monotonic counter in the key. Store `adj_seq` (int) on
each `*_lines` entry, increment it every edit, key the movement
`adjust_{orderId}_g{gen}_{lineId}_a{adj_seq}`. Always unique, still retry-safe.

### L-B · Partial failure between step 2 and step 3

If the movement posts but the `orders/{id}` update throws, the ledger has moved
and the stored line hasn't. On retry, the deterministic key (with `adj_seq`)
dedupes the movement and the `*_lines` write goes through — self-healing, **as
long as the retry uses the same `adj_seq`**. Compute `adj_seq` once, before the
movement, not from a re-read.

### L-C · Metal edits detach the line from the BOM — on purpose, but say so

Once you hand-edit `component_lines[i].qty`, that line no longer equals what the
Range BOM says. That is exactly the "不是标配" case she wants — but the preview
table (`PreviewTable`) is only shown in the `open` stage, so there's no
recompute to fight it. Fine. The UI should still label an edited line
("adjusted") so it's not mistaken for a BOM-exact figure, and Release → re-Reserve
must clearly go back to BOM values (it already does — fresh generation, fresh
explosion).

### L-D · `component_gaps` is untouched

Editing a reserved qty doesn't change what *couldn't* be reserved. Leave
`component_gaps` alone. Don't try to be clever and clear it.

### L-E · Negative available / oversell

`reserve` will happily push `reserved_qty` above `stock_qty` (available goes
negative) — the current Reserve flow already allows this (`after < 0` is shown
red, not blocked). Keep the same posture: **warn, don't block**. Show
`avail N → M` with M red when negative, like `OrderInventoryIssue`'s add-row
does.

### L-F · Concurrent viewers

Both cards subscribe with `onSnapshot`, so a second user sees the new qty within
a second of the write. The transaction in `postMovement` protects the balance.
The only unprotected bit is the `*_lines` array rewrite — last-write-wins on a
whole-array `updateDoc`. Two people editing two different lines of the same
order within the same second could clobber each other. Low probability
(one order, two editors, same second), but the safe form is a `runTransaction`
on `orders/{id}` for step 3, or a `FieldValue.arrayRemove`+`arrayUnion` pair
keyed on the exact old element. Recommend the transaction — simpler to read.

### L-G · Crystal `reserved_qty` visibility

`mrp.js`'s crystal-stock roll-up and `InventoryStockTab` both read
`crystals/{id}.reserved_qty`; `release`/`reserve` maintain it inside the
transaction, so those stay correct with no extra work.

---

## 4. Recommended shape

**`src/orderStock.js`** — one new export, class-agnostic like the rest:

```js
// Adjust ONE already-reserved line to a new absolute qty. Posts the delta as a
// reserve/release movement and rewrites the stored line. Stage must be
// `reserved` (not committed). Retry-safe via a per-line adj_seq in the key.
export async function adjustReservedLine(cfg, orderId, orderLabel, lineId, newQty) { … }
```

- reads `orders/{id}` in a transaction, finds the line by `cfg.order.lineIdField`
- `delta = newQty - oldQty`; bail if `0`; throw if committed / line missing / `newQty <= 0`
- `adj_seq = (line.adj_seq ?? 0) + 1`
- `postMovement(cfg.collectionPath, lineId, { type: delta > 0 ? 'reserve' : 'release', qty: Math.abs(delta), order_id: orderId, note: \`Adjusted reservation \${oldQty} → \${newQty} · order \${orderLabel}\`, idempotencyKey: \`adjust_\${orderId}_g\${gen}_\${lineId}_a\${adj_seq}\` })`
- in the same transaction, write `*_lines` with `{ ...line, qty: newQty, adj_seq }`

**UI (both cards):** make the qty cell in the reserved-state table an inline
number input with a ✓/✗ (or a small pencil that swaps in input + Save). On Save,
`window.confirm` showing `avail N → M` (M red if negative), then call
`adjustReservedLine`. Reuse the existing `run()` busy/error wrapper. Metal card
also wants the current `available` surfaced in that table (it isn't today).

**Out of scope for a first pass:** adding a brand-new line to an existing
reservation, and editing after production-in. Both have clean existing
workarounds (Release/re-Reserve; Reverse production-in).

---

## 5. Effort / test plan

Small–medium. ~1 primitive + ~2 table cells.

Manual test matrix (needs a real shipment in `reserved` stage):

1. Increase a metal line 100 → 150 → ledger `reserve` +50, `reserved_qty` +50,
   `component_lines[i].qty` = 150, `adj_seq` = 1.
2. Decrease same line 150 → 120 → `release` −30, qty 120, `adj_seq` 2.
3. Repeat an earlier value 120 → 150 → 120 → three distinct movements, no dedupe,
   balances consistent (this is the L-A regression).
4. Production-in after edits → consumes 120 (the edited value), not 100.
5. Release after edits → returns exactly `reserved_qty` to on-hand, `component_lines` = [].
6. Edit to a qty that makes available negative → warns, still allowed.
7. Same for a crystal line and a packaging line (same primitive).
8. Kill the tab between movement and `*_lines` write; reload; retry the same edit
   → movement dedupes, `*_lines` catches up, no drift.

---

## 6. Files

| file | role |
|---|---|
| `src/orderStock.js` | add `adjustReservedLine` |
| `src/stockLedger.js` | `postMovement` — unchanged, already handles `reserve`/`release` + idempotency |
| `src/components/OrderStockIssue.jsx` | inline qty edit in the `reserved` table (`LinesTable`), + show `available` |
| `src/components/OrderInventoryIssue.jsx` | inline qty edit in the `reserved` table |
| `firestore.rules` | **no change** (`can('supply')` + `can('shipping')` already held) |
| `../reference/FIRESTORE-COLLECTIONS.md` | note `*_lines[].adj_seq` once built |
