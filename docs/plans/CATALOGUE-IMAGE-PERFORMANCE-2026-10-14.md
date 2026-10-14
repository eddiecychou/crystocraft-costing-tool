# Catalogue image performance — 14 October 2026

## Measured diagnosis

Production was on `746d8cef` when investigated. Successful Firebase card
thumbnails were already WebP (roughly 4–18 KB in the observed requests), but
ordinary reloads revalidated them and took roughly 2.8–5.8 seconds. Referenced
Firebase originals returned `Cache-Control: private, max-age=0`; their Storage
cache metadata was unset. This is not evidence that all photos were 1.5 MB.

The first 24 corporate cards had seven missing cached main-image references
and one stale Bracelet reference to a deleted Storage object. The largest
valid source in that sample was 702,259 bytes. All 23 valid sampled originals
had unset cache metadata. The Figurine catalogue contained 293 designs:
170 Firebase main images, 122 WordPress upload originals bypassing optimisation,
and one design without a main image. All 293 cards rendered initially.

The deployed image code had not changed since 7 October. The evidence points
to accumulated data gaps, zero-age caching and unbounded Figurine rendering;
it does not establish a new code regression or a controlled whole-page timing.

## Shipped scope

- Corporate gallery create/select/replace/delete and visibility/branding
  updates keep the product's main-image mirror in the same Firestore batch.
  Legacy selected URLs without `is_hero` are recognised. Customer detail also
  prefers the screened gallery over stale or internal cached references. Original files are
  deleted only after successful record updates; a failed replacement leaves
  the original usable. Prices, status and customer-facing copy are untouched.
- Catalogue image uploads use `private, max-age=86400` (one-day browser cache).
  Replacement URLs are timestamped. No public-cache policy, rules change or
  broader permission is introduced. Product Design handoff and range colour
  previews use the same metadata. This is performance optimisation, not a
  confidentiality guarantee; download URLs and existing access rules still apply.
- Admin-only **Settings → Products → Image Maintenance** first previews
  referenced-image metadata and corporate main-image repairs, without writing.
  Apply changes only cache metadata and the three main-image mirror fields;
  changed object generations/gallery fingerprints are rejected. Unavailable
  objects are reported and never invented or emptied into the main image.
  Run a second preview after applying; retry reported failures individually
  by rerunning the preview. It does not inspect every historical/unreferenced file.
- `cardImageUrl` now optimises HTTPS WordPress upload images on the two
  Crystocraft hostnames, in addition to existing Firebase sources. Netlify
  resizes to WebP, quality 72, with responsive 320/640-width card candidates.
  Original assets and existing art framing are unchanged. Unsupported hosts
  are untouched; carousel failure falls back to the original source.
- Both Figurine grids start at 24 cards and load 24 more per click. Filter
  changes reset the page; detail return restores the loaded page and position.
  Corporate grids already had 24-card pagination. Existing full-list searches,
  filters, counts and exports are preserved. This bounds rendered cards/image
  work, not parent Firestore collection reads; server-side cursor paging is
  a separate future change because current search/filter semantics span the list.

## Verification and release

- `node --test qa/card-image-url.test.mjs qa/card-images.test.mjs
  qa/catalogue-image-policy.test.mjs qa/catalogue-image-maintenance.test.mjs`:
  21 tests passed.
- `node qa/catalogue-image-smoke.mjs`: 77 checks passed on real components
  with seeded Firebase/Storage responses, at 375px and 1280px. Includes all
  four grids, load-more/filter/detail return, WebP requests, visibility isolation,
  admin/staff maintenance, atomic main-image updates and failed replacement.
  These are not live customer-account or production-write tests.
- Production Vite build passed; retain the usual large-chunk warning as
  pre-existing bundle debt. Repository no-undef lint passed with
  `--no-inline-config` (unrelated inline disables reference plugins absent from
  this deliberately single-rule QA configuration).

Implemented in isolated `codex/catalogue-image-performance`, based on deployed
`746d8cef`. The dirty original checkout and separate B0016 worktree are untouched.
No Firestore/Storage rules deployment is required. Release: smoke tests → push
the isolated commit to main → verify Netlify published the exact commit →
admin preview/apply existing image repairs → preview again and recheck cards.

Production repair counts and post-deploy observations belong in the final
release report; do not infer them from the seeded tests above.
