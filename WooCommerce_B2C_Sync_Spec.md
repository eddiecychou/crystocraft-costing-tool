# WooCommerce B2C → Operation Center — Gap Analysis & Phased Plan

Written 2026-08-22, V8.7. Source: `WooCommerce B2C → Operation Center.md`
(Cindy's business rules, captured by the owner). That document explicitly
asked for a technical audit before implementation — this is that audit,
done directly against this codebase rather than round-tripped through
DeepSeek, since the answers to almost every open question in its §12 are
already sitting in the code.

## 0. Bottom line

This is closer to **"extend the existing invoice/credit-note/UC model"**
than "build a new one." Sales Invoice, Credit Note, and UC Registry already
exist, are already admin-gated through Supabase edge functions, and already
carry most of the fields the business rules ask for — foreign currency,
remarks, adjustment-with-reason, multiple credit notes per invoice. The real
work is (1) a new WooCommerce connection that does not exist yet, and (2) a
handful of schema additions to carry external identifiers and idempotency
keys through the existing tables, not a parallel system.

---

## 1. What already exists (so this is built on it, not beside it)

Measured 2026-08-22:

- **Sales Invoice model** — [`src/pages/SalesInvoices.jsx`](src/pages/SalesInvoices.jsx),
  backed by [`app_sales_invoice`](erp-sync/app_sales_invoice.sql) (Supabase)
  + the order doc in Firestore. An invoice is not a separate record — it's
  an order given an invoice number (`erp_si_no`). Two paths already exist:
  **wholesale** (invoice raised from a sales order) and **retail/Direct
  Invoice** (`/shipments/new?direct=1` — no sales order behind it, exactly
  the shape of a WooCommerce order).
- **Foreign currency, already free-form.** `orders.currency` is validated
  against a fixed list per [`shipping.js:223`](src/shipping.js:223) but the
  list already includes non-HKD currencies, and `app_sales_invoice.currency`
  is plain `text` — no forced conversion anywhere in the write path. §3.7's
  "preserve original currency" requirement is already the system's default
  behaviour, not a change.
- **Adjustment-with-reason (SR-05), already enforced twice.** Both
  `app_sales_invoice` (`accounting_total`/`adjustment`/`adjustment_reason`)
  and `app_credit_note` (`accounting_amount`/`adjustment`/`adjustment_reason`)
  reject a nonzero gap with no reason, client-side (ShipmentForm) and
  server-side ([`uc.js:175`](netlify/edge-functions/uc.js:175),
  [`credit-note.js:55`](netlify/edge-functions/credit-note.js:55)). This is
  exactly the mechanism §3.6 ("Fee details" in remarks) and the payment-fee/
  exchange-rate note in §12 Q14 need — no new mechanism required, just a
  convention for what text goes in `adjustment_reason`/`remarks`.
- **Credit Note already supports the doc's refund rules without changes:**
  - `si_no` on `app_credit_note` is a plain reference column, not unique or
    FK-constrained — **one Sales Invoice can already have multiple Credit
    Notes** (§12 Q8, answered: yes, already true).
  - Posting a credit note never touches the original invoice row (§4.1/4.2).
  - `channel` column already exists on `app_credit_note`, unused so far —
    a ready-made slot for `'woocommerce'`.
  - `record_date` (when discovered) vs `accounting_date` (refund date)
    are already separate columns — matches §4.3 exactly.
  - Partial refunds: `lines jsonb` already carries arbitrary returned-line
    detail, or `system_amount`/`accounting_amount` alone for an amount-only
    credit (§4.2, §12 Q7 — answered: yes, already supported both ways).
- **UC Registry already has most of §7's fields**: `deposit`, `balance`,
  `bal_pay_date`, `remarks`, `source`, `confirmed`, `status` — see
  [`uc.js:18`](netlify/edge-functions/uc.js:18). `source` is free text,
  so `'WooCommerce'` needs no schema change, only a value convention.
  Duplicate prevention (§12 Q9) is already solved: `allocate_sales_invoice`
  is one Postgres transaction issuing the SI **and** the UC together, so a
  UC can never be burned without an invoice attached — the same transaction
  shape is what a Woo-triggered invoice should reuse, not a new allocator.
- **Line-level charge classification already exists.** `shipping.js`'s
  `line_type` (`null | 'range' | 'corp_gift' | 'ad_hoc' | …`) plus
  `computeOrderTotals()`'s `chargesTotal` already separates flat charges
  (e.g. freight) from priced product lines and rolls them into the order
  total distinctly from `discountAmount` — see
  [`shipping.js:476-494`](src/shipping.js:476). §3.5's requirement (separate
  discount, shipping, tax, grand total) is the same shape, needs new
  `line_type` values (`'shipping'`, `'tax'`), not a new totals model.
- **CSV export is a solved, reused pattern.** `exportCsv.js` +
  `ExportFilterBar` already drive Sales Invoice and UC Registry exports with
  a per-page `COLUMNS` array (see
  [`SalesInvoices.jsx:232`](src/pages/SalesInvoices.jsx:232)). §8's Excel
  export is an additional `COLUMNS` array on a new page, not new
  infrastructure. (Doc says "Excel" — current exports are CSV, which Excel
  opens natively; confirm with Cindy whether an actual `.xlsx` with
  formatting is required, or CSV is fine as it is for every other export in
  the app today.)
- **Admin-gated Supabase edge-function pattern, proven three times over**
  (`uc.js`, `credit-note.js`, `erp.js`): verify Firebase ID token → check
  `users/{uid}.role === 'admin'` via `requireAdmin()` in
  [`lib/auth.js`](netlify/edge-functions/lib/auth.js) → talk to Supabase
  with the secret service-role key server-side, browser never sees it. A
  WooCommerce sync function follows this exact shape. §10.13 (admin-only
  access) is inherited for free by using it.
- **The WordPress connection pattern already exists and is proven live.**
  [`publish-to-wordpress.js`](netlify/edge-functions/publish-to-wordpress.js)
  authenticates against the *same* WordPress install (`WP_BASE_URL`/
  `WP_USER`/`WP_PASS`, HTTP Basic via an Application Password) that runs
  WooCommerce. This answers §12 Q1 directionally: the site is reachable and
  a credentialed pattern already exists — but **WooCommerce's own REST API
  (`/wp-json/wc/v3/`) authenticates with dedicated Consumer Key/Secret
  pairs, not WP Application Passwords** — a new credential pair from
  WooCommerce → Settings → Advanced → REST API, not a reuse of `WP_PASS`.

---

## 2. Real gaps — need a design decision before code

### 2.1 Invoice numbering collides with the "use Woo's order number" rule

§3.4 asks for `sales_invoice_document_no = WooCommerce order number`. But
`si_no` on `app_sales_invoice` is generated by
`allocate_sales_invoice()` in the shape `SI` + yy + 4-digit sequence — the
**same series JES used**, per [`soNumber.js`](src/soNumber.js)'s header:
cutover to app-only allocation happened 2026-07-23 specifically so nothing
else issues numbers into that series. Setting `si_no` directly to a
WooCommerce order number (e.g. `#10482`) would break that series and any
downstream code that pattern-matches `SI\d{6,}` (see
[`uc.js:160`](netlify/edge-functions/uc.js:160), the `/^SI\d{6,}$/` guard
that would outright reject a Woo-shaped number).

**Recommendation**: keep `si_no` in the existing SI series (so the PBIS
feed, UC allocator, and reconciliation logic need no branching), and add a
new nullable column — `external_order_no` (or reuse `customer_po`, which
already exists on `app_sales_invoice` and is unused by Woo orders) — to
carry the WooCommerce order number for cross-reference. Confirm with Cindy
whether "for easy cross-reference" means it must be *the* document number
visible on the printed invoice (in which case it prints alongside the SI
number, not instead of it) or just present in the record.

### 2.2 No WooCommerce connection exists at all

Nothing in `netlify/edge-functions/` talks to `/wp-json/wc/v3/`. This is
new code, not an extension. Given §6 ("On the 7th of each month, sync the
previous month's paid orders" — a human-reviewed monthly batch, not
real-time) and §11's explicit "no real-time two-way sync" exclusion, a
**polling pull-on-demand edge function** (admin clicks "Sync WooCommerce",
same posture as the existing ERP sync tooling) is a better fit than a
webhook receiver — fewer moving parts, no public unauthenticated endpoint
to secure, and it matches how every other external-data surface in this
app already works (`erp-sync/`, the ERP mirror). A webhook could be added
later if Cindy wants faster visibility, but is out of scope for v1 per
§11.

### 2.3 No idempotency key exists anywhere in the write path today

§9 requires "same order imported twice → one invoice, one UC." Nothing in
`app_sales_invoice` or `app_credit_note` today stores a foreign order ID
from an external system — `order_id` is the *Firestore* order doc ID, which
doesn't exist until the app creates it. Needs a new unique column, e.g.
`woo_order_id` on whatever table represents the imported transaction (see
2.4 below) — enforced with a real `unique` constraint, not just
application-level checking, matching this codebase's habit of trusting the
database over the client (see `si_no not null unique` already on
`app_sales_invoice`).

### 2.4 Where does an imported-but-not-yet-invoiced WooCommerce order live?

This is the one genuine new-model decision. Two options:

- **(a) Reuse the Firestore `orders` collection.** Each synced Woo order
  becomes a lightweight `orders/{id}` doc with `channel: 'woocommerce'`,
  `status: 'confirmed'` (pre-invoiced) or similar, feeding straight into the
  *existing* "Direct Invoice" retail flow and the *existing* "awaiting
  invoice" list on `SalesInvoices.jsx`. Cindy's review-and-select step
  (§6) becomes: open Sales Invoices, see Woo orders sitting in "awaiting,"
  pick which to invoice — the page already draws this exact distinction for
  retail orders today.
- **(b) A dedicated staging collection** (`woo_orders/{id}`) reviewed on its
  own page, only becoming a real order/invoice on posting.

**Recommendation: (a).** It reuses the page Cindy already uses monthly for
retail invoicing, needs no new review UI, and the "one Sales Invoice per
order, do not combine" rule (§3.1) is already how every order works today.
The customer display format (§3.2, `O07 Online Crystocraft - "Name"`) is
then just how `customer_name` gets set on import — likely with no
`customer_id` link (guest checkout, §12 Q10), which `shipping.js`'s
"THE INVARIANT" comment already anticipates for retail (a retail sale
needn't resolve to a `customers` record — same pattern `creditNotes.js`
already uses for `marketplace_ref`).

### 2.5 Discount / shipping / tax as separate lines

`line_type` (§1 above) has no `'shipping'`, `'discount'`, or `'tax'` value
today — only `'range' | 'corp_gift' | 'ad_hoc'` and null. Needs new values
recognised by `computeOrderTotals()` and the invoice print template
([`SalesInvoicePrint.jsx`](src/pages/SalesInvoicePrint.jsx)) so they render
as their own labelled lines rather than folding into `chargesTotal`
undifferentiated. Small, additive change — the classification mechanism
already exists, just needs new members.

---

## 3. Answers to the source document's open questions (§12), where the codebase already answers them

| # | Question | Answer from this audit |
|---|---|---|
| 5 | Does Sales Invoice support foreign currencies? | Yes, already — `currency text`, no forced conversion. |
| 6 | External document number = Woo order number? | Not as `si_no` directly — collides with the JES-shared series. Needs a new column (§2.1). |
| 7 | Credit Note support partial refunds / line refs / multiple CNs per invoice? | Yes to all three, already built (§1). |
| 8 | Can one Sales Invoice have multiple Credit Notes? | Yes — `si_no` is an unconstrained reference column. |
| 9 | How does UC Registry prevent duplicate UC# on re-sync? | It doesn't need to — `allocate_sales_invoice` issues SI+UC in one transaction; re-running the *Woo* sync must not call that allocator twice for the same order, which is the idempotency key gap in §2.3, not a UC Registry gap. |
| 15 | What does "posted" map to in this app? | `status: 'issued'` on `app_sales_invoice`, `status: 'posted'` on `app_credit_note` (default) — both already exist. |

**Resolved empirically, 2026-08-22** (Phase 1 live against real orders):

- **§12 Q1 — auth**: REST API Consumer Key/Secret, confirmed working
  (`WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET`, Basic auth over HTTPS).
- **§12 Q4 — gateway fee**: the store's gateway is **WooCommerce Payments**
  (`payment_method === 'woocommerce_payments'`). It does **not** use
  `fee_lines` (that came back empty on every order checked). The fee lives
  in private post meta: `_wcpay_transaction_fee` (the fee amount) and
  `_wcpay_net` (total − fee, the actual payout amount) — found via the
  per-order meta inspector added to the WooCommerce Sync page. Both are
  returned by the standard orders REST endpoint (no extra Stripe API call
  needed — WooCommerce Payments already surfaces what Stripe's Balance
  Transaction would have given us). `woo-sync.js`'s `gatewayFee()` now reads
  this directly, with `fee_lines` kept as a fallback for the (currently
  theoretical) case of a different gateway being enabled later, and `null`
  — not `0` — when neither source has anything, so a genuinely missing fee
  can never be misread as "no fee charged."
- **§3.6/§8 "Fee details" implication**: this closes the manual-entry
  question raised 2026-08-22 — the fee is fully automatable via
  `_wcpay_transaction_fee`, no manual keying required. `remarks`/
  `adjustment_reason` can be populated automatically with the resolved fee
  and net payout rather than left for Cindy to type in each month.
- **§12 Q2/Q3 — payout date/amount**: `_wcpay_net` answers "amount." Payout
  *date* (settlement to the merchant's bank, distinct from `date_paid`) was
  not found in the per-order meta checked so far — still open, likely lives
  in WooCommerce Payments' own deposits/payouts data rather than on the
  order at all. Needs a further check (WooCommerce Payments has its own
  REST namespace for deposits) before §7's "Balance payment date" can be
  wired up with confidence.

Still genuinely open (need Cindy/WordPress-admin, not code):

10. Guest checkout — handled the same way `creditNotes.js` already handles
    a customer with no CRM record: `customer_name` set directly, no
    `customer_id`, per §2.4 above.
11/12/13. Tax-copy-exactly, one-row-vs-detail-sheet, CN-worksheet-placement
    — pure Excel-export design choices, deferred to when §8 is built, easy
    to get Cindy's input on with a mockup rather than guessing now.

---

## 4. Phased plan

**Status as of 2026-08-22: Phases 1–3 built and deployed.** Phases 4
(refunds → Credit Notes) and 5 (Excel export) are not started.

**Phase 1 — Connection + read-only staging (no writes to Finance yet)**
- New edge function `netlify/edge-functions/woo-sync.js`, admin-gated via
  `requireAdmin()`, same shape as `erp.js`/`uc.js`.
- Pulls orders from `/wp-json/wc/v3/orders` for a given date range, using
  actual payment/status fields (§2.2 — confirm "paid" independent of just
  processing/completed by inspecting `date_paid`, not `status`).
- Pulls refunds via `/wp-json/wc/v3/orders/<id>/refunds`.
- Surfaces results in a new read-only admin page for Cindy to review —
  no Firestore writes, no invoice numbers burned. This phase alone answers
  §12 Q2/Q3/Q4 empirically instead of by guessing, against real data.

**Phase 2 — Import into the order model, manual review** (built —
`src/wooImport.js`, "Import" button on the WooCommerce Sync page)
- Per-order "Import" → creates `orders/{id}` at a **deterministic** doc ID
  (`woo-<wooOrderId>`, not an arbitrary Firestore auto-ID) inside a
  transaction — this turned out to be a stronger idempotency mechanism than
  the originally-planned `woo_order_id` field check (§2.3): a re-import can
  never race past a check-then-create, because the check and the create are
  the same atomic operation. `channel: 'woocommerce'`, `woo_order_id`,
  `woo_order_no`, customer name formatted per §3.2, currency preserved per
  §3.7 (guarded against a currency outside the app's own list — `USD`
  fallback, never a silent wrong-currency coercion).
- These land in the *existing* "awaiting invoice" list on
  `SalesInvoices.jsx` (`status: 'confirmed'`) — no new invoicing UI, as
  planned.
- **No new `line_type` values needed** — shipping/tax turned out to fit the
  *existing* `non_product`/`chargesTotal` mechanism (`shipping.js`'s
  `computeOrderTotals`, originally built for freight/insurance on a PI
  import) exactly, as flat charge lines. Discount was never a line at all —
  it's the order header's own `discount_amount` field, which every order
  already has. §2.5's predicted schema work turned out unnecessary.

**Phase 3 — Invoice + UC Registry wiring** (built — `uc.js`, `ShipmentForm.jsx`,
`SalesInvoices.jsx`)
- Added `channel`/`external_order_no` columns to `app_sales_invoice` (SQL
  applied directly to Supabase, not run through a migration tool) rather
  than reusing `customer_po` as first considered in §2.1 — a dedicated
  column reads clearer and avoids overloading a field with an established,
  different meaning ("the customer's own PO number").
- `upsert_invoice` (`uc.js`) now writes both; `ShipmentForm.jsx`'s save path
  threads them through — this required adding `channel`/`woo_order_no` to
  an explicit field whitelist in the order-load code (`setHeader({...})`),
  the same whitelist-drop trap that silently dropped `contact_id` before it
  was added there (see PROJECT-PLAN.md V8.x notes on that bug).
- `SalesInvoices.jsx` shows a "Woo #57844" badge next to the SI number for
  a WooCommerce-sourced invoice, and the CSV export gains `Channel`/
  `WooCommerce order no.` columns.
- Fee/exchange-rate detail goes into the order's `notes` (→ invoice
  `remarks`) automatically at import time (Phase 2), not typed in later —
  stronger than §3.6's original "text convention" plan, since §3 already
  resolved the fee as fully automatable (`_wcpay_transaction_fee`/
  `wc/v3/payments/transactions`), so there is nothing left for a human to
  type.

**Phase 4 — Refunds → Credit Notes**
- Reuse `postCreditNote()` unchanged; set `channel: 'woocommerce'`,
  `marketplace_ref` = Woo order number, `record_date`/`accounting_date`
  split per §4.3, `woo_refund_id` idempotency key on whatever join lets
  Phase 1's staged refund become a posted CN without re-posting on retry.

**Phase 5 — Excel export**
- New `COLUMNS` array + export page reusing `exportCsv.js`, per §8's table,
  after confirming with Cindy whether CSV (matches every other export
  today) actually needs to become a formatted `.xlsx`.

Each phase is independently shippable and reversible — Phase 1 alone is
useful (visibility into what WooCommerce actually reports) even if later
phases are re-scoped after seeing real data.

---

## 5. Recommended immediate next step

Build Phase 1 only, and use its real output to close §12 Q2/Q3/Q4 with
evidence instead of assumption — those three questions are gateway/
WooCommerce-install-specific and cannot be answered from this codebase
audit alone. Everything past Phase 1 should be re-confirmed against what
Phase 1 actually returns before committing to the exact column set.
