# V8.18 catalogue carousel response — 15 October 2026

## Diagnosis and scope

The shared CardImageCarousel changed one lazy img source on every arrow/swipe.
The next photo was neither requested nor decoded until navigation. Gallery
metadata was already fetched near the viewport; fetching that metadata does
not load the thumbnail pixels. A cold image response therefore sat directly
on the click-to-photo path.

All four callers use the same component: admin Products/Range and customer
CorporateShop/FigurineShop. Existing caller-side visibility/branding screening,
image framing, original assets, Firestore reads and pricing are unchanged.

## Change

Warm next/previous thumbnails only after the current visible/near-visible photo
loads. Hover, focus and touch promote neighbours; explicit navigation jumps
queued speculation. Global limit: two speculative requests, four total, with
responsive source/sizes matching the visible img. Decode before swapping; keep
the current photo while a cold target loads, with a visible status. Fast clicks
cancel obsolete display updates. Original fallback is retained; failed/stalled
requests release capacity. Data-saver and slow-2G/2G disable speculation. Cache
metadata is capped at 128 settled entries and includes viewport/DPR so resize
cannot incorrectly reuse a different responsive candidate's readiness.

## Measured validation

Controlled local browser fixture, real before/after component, eight photos,
800 ms response for the next thumbnail (warm transition, not a claimed live
network SLA):

| Card treatment | Before | After |
|---|---:|---:|
| Admin | 813 ms | 20 ms |
| Customer | 815 ms | 9 ms |

The server request trace confirms the after version requested adjacent photos
before the click, reused the matching 640w resource on navigation, and did not
warm the unseen offscreen gallery's next image. Only neighbours were fetched,
not all eight images. Phone-width test used matching 320w resources.

Cua browser checks: arrows do not open the product link; cold navigation retains
the last loaded photo and shows Loading photo; rapid next clicks finish on the
last selected image; gallery replacement removes old photos; 375px horizontal
swipe works while vertical gesture stays on the same photo; no horizontal
page overflow; failed next image retains the current photo with an error state,
Previous recovers, and an empty-gallery swipe does not crash. Router future
flag warnings come from the isolated fixture; no application runtime errors.

17 loader/source/gallery tests pass, including decoding, deduplication,
foreground priority, bounded concurrency, responsive candidates, original
fallback, stalled-request recovery, and data-saver handling. Changed source
no-undef lint and guarded Vite production build pass (existing chunk warning).

Reproduce the controlled fixture with `node qa/carousel-response-server.mjs`,
then open its before/after pages in a fresh browser with different run query
values; read the visible measurement output after Next. The fixture contains
synthetic photos and no production data. Source default port is 5187.

## Release

Candidate and production two-role verification will be recorded here before
closing the V8.18 follow-up. No Firestore/Storage rules changes are required.
