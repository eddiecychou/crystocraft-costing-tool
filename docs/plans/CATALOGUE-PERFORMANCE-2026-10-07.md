# Catalogue loading performance — 2026-10-07/08

## Outcome

The Operation Center product list and the customer corporate-gift shop now page
their card grids, defer card-only Firestore reads until the card approaches the
viewport, and serve bounded thumbnails through Netlify Image CDN. The work was
deployed in two commits:

- `cce805e7` — **Speed up product catalogue loading**
- `377ff4d0` — **Prefetch catalogue images near viewport**

Both commits are live on `main`. Netlify reported the final production deploy for
`377ff4d0` as `ready` on 2026-10-07 at 20:54 AEDT.

## Problem

The Operation Center product grid mounted every product and each card immediately
read both `pricing_tiers` and `images`. At the original 127-product count that
meant approximately 255 initial Firestore queries before accounting for image
downloads. The customer corporate-gift shop had the same gallery fan-out plus one
customer-price read per card. The live audit performed during the correction found
132 products by then.

## Shipped design

- Both grids render 24 products initially and offer **Load more** in groups of 24.
  The visible count is retained across a detail-page visit so scroll restoration
  still works.
- Admin cards render the parent product's `heroImage` immediately. The full image
  gallery starts loading when a card approaches the viewport, on interaction, or
  if the cached hero fails. This preserves the stale/missing-hero recovery path
  without recreating the original full-catalogue request burst.
- Publishing prices writes a bounded `pricing_summary[]` to the parent product.
  Admin cards use it without a subcollection query. Older products without the
  summary use a compatibility read for only the currently rendered page; the next
  ordinary price publish fills the summary without a one-off production backfill.
- Ordinary customer accounts use `heroImage` immediately and prefetch the gallery
  shortly before a card enters the viewport. Customer-specific price reads follow
  the same viewport trigger and are limited to the displayed page.
- Sensitive customer accounts retain the complete deterministic gallery-screening
  pass before the shelf is shown. This is intentionally not optimized away because
  it prevents another customer's branded photo from flashing or leaking through
  the Shop-by band.
- Firebase/Google Storage images displayed in catalogue cards are delivered through
  Netlify Image CDN at a bounded 640 px width and quality 72. The original upload
  remains the detail-page source, and card rendering falls back to that original if
  the transform service cannot serve a thumbnail.

## Expected initial request shape

- Admin, legacy products: one product listener plus at most 24 pricing reads; no
  gallery reads for the whole catalogue. Gallery reads begin only as cards approach
  the viewport. Republished products need no card pricing read.
- Ordinary customer: one product listener plus customer-price/gallery reads only
  for cards approaching the viewport, bounded by the 24-card displayed page.
- Sensitive customer: confidentiality takes priority, so gallery screening remains
  a full-catalogue pass; card rendering and customer-price reads are still paged.

The authoritative price and gallery subcollections are unchanged. No rules change
or production data migration is required.

## Image-cache audit and follow-up correction

After the first deployment, some cards still appeared blank or slow because the
optimization initially waited for hover/focus before reading the gallery. That was
too late for missing cached heroes and did not help touch-only devices.

A read-only production audit found:

- 132 product documents.
- 5 products with gallery images but no `heroImage` cache.
- 1 product with a stale cached hero: **Bracelet for Private Event**.
- 0 products with neither a hero nor a gallery image.

The five missing-cache products were:

- PU Top-Opening Pencil Case
- U-Shaped Memory Foam Travel Neck Pillow
- Rechargeable Electric Scalp Massager
- U-Shaped Memory Foam Travel Pillow with Round Storage Case
- Collapsible Silicone Lunch Box 800ML

The correction introduced `useInViewOnce()` with a 320 px look-ahead margin. A
card now requests its live gallery shortly before it becomes visible, so
`buildCardImages()` can repair missing/stale cache metadata before the operator
reaches the card. Hover, keyboard focus, and image-error recovery remain as backup
triggers.

## Image payload audit and thumbnail delivery

Read-only `HEAD` checks showed that oversized originals were a secondary—not
primary—factor. The largest sampled card sources were approximately 702 KB and
672 KB. Catalogue cards now route Firebase and Google Storage URLs through:

```text
/.netlify/images?url=<encoded-source>&w=640&q=72
```

`netlify.toml` allowlists only the two storage hosts. `cardImageUrl()` leaves
unknown hosts untouched, percent-encodes tokenized Firebase URLs, and
`CardImageCarousel` falls back to the original source if a transform fails. A live
smoke test against the bracelet gallery returned HTTP 200, `image/jpeg`, and a
21,068-byte transformed card image.

## Files changed

- `src/pages/Products.jsx` — 24-card paging, price-summary compatibility,
  viewport-triggered gallery/pricing reads.
- `src/customer/CorporateShop.jsx` — ordinary-customer viewport loading,
  customer-price paging, sensitive-viewer exception retained.
- `src/pages/PricingTiers.jsx` — writes bounded `pricing_summary[]` on publish.
- `src/components/CardImageCarousel.jsx` — optimized card URL with original-file
  fallback and asynchronous decoding.
- `src/hooks/useInViewOnce.js` — shared one-shot viewport trigger.
- `src/cardImageUrl.js` — restricted Netlify thumbnail URL builder.
- `netlify.toml` — Firebase/Google Storage remote-image allowlist.
- `qa/card-image-url.test.mjs` and `qa/card-images.test.mjs` — URL and stale-hero
  behavior coverage.

## Verification record

- Focused card-image tests: **7 passed, 0 failed**.
- Vite production build: **passed**.
- Netlify deployment for `377ff4d0`: **ready**.
- Live transformed bracelet image: **HTTP 200**, image content type confirmed.
- Firebase security rules: unchanged; no rules deployment required.
- Production data: read-only audit only; no direct backfill or mutation performed.
