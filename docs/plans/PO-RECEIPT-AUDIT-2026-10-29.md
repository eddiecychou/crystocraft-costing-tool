# OC purchase-order receipt audit — 29 October 2026

Read-only audit completed at one fixed Firestore snapshot:
29 October 2026 **03:58:18.318 UTC / 11:58:18.318 HKT / 14:58:18.318 AEDT**.
Owner requested checking all other POs after PU260076's correction. No OC record,
stock movement, balance, PO status, price or application deployment was changed.

## Result

- All **36 OC POs** were checked: the other 35 plus a recheck of PU260076.
- Nine POs have received flags and **29 saved receipt rows, 6,965 pieces net**.
  Every saved receipt matches its actual stock item/code and ledger quantity.
  Eight POs cover every ordered line; PU260053 has one unreceipted line below.
- The other **27 POs** have no saved receipts and no stray PO stock movements.
  They are not treated as missing deliveries simply because they have orders.
- No duplicate, over-posted, wrong-item, orphaned, missing-saved-movement or
  unrecorded PO receipt was found. No nonzero unreversed earlier generation was
  found. PU260061's two old +300 receipts were each reversed by -300, then replaced
  by +320 each; net 640, not an extra receipt.
- All **27 stock items referenced by received POs**, including PU260053's pending
  owl, have current cached stock/reservations consistent with their chronological
  movement histories. The 235 relevant history movements include stocktakes,
  reservations, production and manual corrections as well as PO receipts.

## One line remains unresolved — preserve stock

[PU260053](https://portal.crystocraft.com/purchase-orders/oDcN4rD2BSMkzMk9A7RS)
orders five lines of 200 each. Its four linked receipts total 800 and are correct.
There is no PO receipt for **200 × FM-S(OW)-H(C)**, the owl component
`range_components/rc_muf94jxwu44mi`.

The owl's separate stock history is important:

| Date (Hong Kong) | Stored movement | Quantity / balance |
|---|---|---:|
| 24 Sep 2026, 16:14:50 | Manual stocktake, “Inline stock update” | Counted 200; stock 200 |
| 24 Sep 2026, 16:18:14 | Reservation for UC4944/26 | Reserved 192; stock 200 |
| 24 Sep 2026, 16:20:08 | Production-in for UC4944/26 | Used 192; stock 8; reserved 0 |

The stocktake has no PO identifier; it is not evidence of a linked PU260053
receipt. It may already include the ordered goods. **Do not add another 200 or
reverse/re-receive the PO** based on the missing link alone: that could double-count
goods already included in the manual count.

The owner was asked whether those 200 were physically delivered and answered:
**“Not sure — leave pending.”** The PO, its existing four receipts and the owl's
stock of 8 have therefore been left unchanged. This is a pending provenance /
delivery-confirmation question, not a confirmed 200-piece stock shortage.
The existing PO-level received flag does not establish that every ordered line
arrived; do not clear it and risk re-posting the four already received lines.

## Received orders

| PO | Ordered lines | Saved receipt rows | Posted net quantity | Audit result |
|---|---:|---:|---:|---|
| PU260050 | 1 | 1 | 500 | All lines match |
| PU260053 | 5 | 4 | 800 | Four receipts match; owl 200 remains pending |
| PU260057 | 2 | 2 | 630 | All lines match |
| PU260058 | 2 | 2 | 1,000 | All lines match |
| PU260060 | 4 | 4 | 897 | All lines match |
| PU260061 | 2 | 2 | 640 | All lines match; old generation fully reversed |
| PU260070 | 7 | 7 | 1,582 | All lines match |
| PU260073 | 1 | 1 | 500 | All lines match |
| PU260076 | 6 | 6 | 416 | RE 102 / PI 60 / FU 64 / VL 65 / PE 60 / C1 65 |
| Total | 30 | 29 | 6,965 | One 200-piece line pending confirmation |

PU260050 and PU260073 each have a 500-piece receipt for P-AYCIR045-G. These are
different PO IDs and receipt dates, not duplicate movement records for one PO.
PU260076's original red movement remains its sole red receipt (+102); its five
correction movements remain +60/+64/+65/+60/+65.

PU260060, PU260070 and PU260073 retain `status: draft` despite recorded receipts.
Their item/quantity/ledger checks pass. This workflow metadata was not changed.

Unreceived POs checked: PU260014, PU260023, PU260025, PU260030, PU260032,
PU260034, PU260040, PU260041, PU260044, PU260045, PU260046, PU260051,
PU260052, PU260055, PU260056, PU260062, PU260063, PU260064, PU260065,
PU260066, PU260067, PU260068, PU260069, PU260071, PU260072, PU260074,
PU260075.

## Method and evidence

The connected Firebase list API verified the 36 PO records. Its collection listing
does not provide a movement collection-group scan, so the existing local
read-only audit credentials were used for fixed-project GET/list requests and
Firestore's read-only `runQuery` POST. No database write endpoint was used.

All reads used the same server `readTime`, with complete pagination:

- 36 `purchase_orders` documents.
- 1,738 stock identities: 851 `range_components`, 322 `crystals`, 565 `b2c_stock`,
  zero `packaging`; only stock identity/balance fields were retrieved.
- **3,470 movement documents across the entire movement collection group**,
  including movements under deleted/unlinked parents if present. Of these, 33
  explicitly reference a PO: 31 positive receipts and two reversal adjustments.

Checks compare PO codes, typed component links, saved receipt target IDs, source
rows, quantities, deterministic movement IDs, class and parent identity, generation,
reversal nets, extra/missing movements and receipt flags. The full collection-group
scan also detects PO movements outside the expected stock targets. An independent
raw-data equation check confirmed all 29 saved receipt rows equal both their PO
quantities and their per-PO net movement quantities (6,965 in total).

Stock histories were replayed by commit time, using per-item sequence to resolve
same-commit ordering. Old timestamp-based sequence values predate the later small
per-item counters; globally sorting both eras by `seq` would give false balance
failures. Two first-record historical stocktakes explicitly establish pre-ledger
opening balances (35 and 112). These legacy baselines were recorded, not rewritten
or mistaken for new/missing PO deliveries. Subsequent deltas, absolute stocktake
counts, final cached balances, reservations and current sequence counters agree.

Private raw snapshots, GET/query-only collector, offline analyzer and detailed
result remain in ignored `migration/po-audit-20261029.local/`. No live stock repair
was needed or performed. This audits recorded OC data, not a physical inventory
count or an assertion that every supplier delivery has arrived. Legacy ERP POs
outside the 36 OC records are outside this audit.
