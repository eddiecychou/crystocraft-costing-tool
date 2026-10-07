# Catalogue loading performance — 2026-10-07

## Problem

The Operation Center product grid mounted every product and each card immediately
read both `pricing_tiers` and `images`. At 127 products that meant approximately
255 initial Firestore queries before accounting for image downloads. The customer
corporate-gift shop had the same gallery fan-out plus one customer-price read per
card.

## Shipped design

- Both grids render 24 products initially and offer **Load more** in groups of 24.
  The visible count is retained across a detail-page visit so scroll restoration
  still works.
- Admin cards render the parent product's `heroImage` immediately. The full image
  gallery loads only on hover/focus or if the cached hero fails, preserving the
  stale-hero recovery path.
- Publishing prices writes a bounded `pricing_summary[]` to the parent product.
  Admin cards use it without a subcollection query. Older products without the
  summary use a compatibility read for only the currently rendered page; the next
  ordinary price publish fills the summary without a one-off production backfill.
- Ordinary customer accounts use `heroImage` immediately and load the carousel on
  interaction. Customer-specific price reads are limited to the visible page.
- Sensitive customer accounts retain the complete deterministic gallery-screening
  pass before the shelf is shown. This is intentionally not optimized away because
  it prevents another customer's branded photo from flashing or leaking through
  the Shop-by band.

## Expected initial request shape

- Admin, legacy products: one product listener plus at most 24 pricing reads; no
  gallery reads until interaction. Republished products need no card pricing read.
- Ordinary customer: one product listener plus at most 24 customer-price reads; no
  gallery reads until interaction.
- Sensitive customer: confidentiality takes priority, so gallery screening remains
  a full-catalogue pass; card rendering and customer-price reads are still paged.

The authoritative price and gallery subcollections are unchanged. No rules change
or production data migration is required.
