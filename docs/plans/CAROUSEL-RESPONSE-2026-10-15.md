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

Candidate `6ad05e9a53fa8154e1531054`, source app commit `dcd76f47`, ready.
Served `/assets/index-CGhc3tGd.js`; served Firebase configuration probe HTTP 200.
Fresh password sign-ins for admin `claude-qa@crystocraft.com` and approved
customer `customer-qa@crystocraft.com` pass in separate signed-out Chrome
sessions. An initial IAB admin attempt reported a network connection error;
Chrome was used for the successful real-page gate, without altering credentials,
profiles or permissions. Customer route `/shop`, 136-product corporate catalogue,
reported pillow's gallery arrows and detail load; no internal controls, direct
Settings visit redirects to shop, refresh retains customer shell. Admin route
`/dashboard`, data and Settings navigation load; 140-product catalogue, same
pillow's gallery arrow and refresh pass. No runtime errors in successful sessions.
Both real arrow swaps changed the displayed URL and finished decoded, without
navigating away; cached reverse navigation completed without a loading state.
No production-data writes were used for functional verification (normal login
stamps only). Candidate screenshot evidence is under `/private/tmp/v818-evidence/`
with `carousel-candidate-admin.png` and `carousel-candidate-customer.png`.

The measurement fixture is pinned to pre-optimization revision `e7713ec0`
(overridable with CAROUSEL_BASE_REF) so its baseline remains reproducible after
the optimization commit. This fixture-only adjustment does not change the app.
No Firestore/Storage rules changes are required.

Production deploy `6ad05fb6471f701bdc4dd851`, commit
`a6b890d83a10dbf9fdd7318959ae8139992b89f4`, published 15 October 2026
16:08 AEDT. Verification completed around 16:41 AEDT. Both production hostnames
serve `/assets/index-CPvOoILc.js`; Firebase configuration probes return HTTP 200.
Build marker: V8.18 · 15 Oct, 16:08.

Fresh password admin sign-in PASS on portal.crystocraft.com in private Chrome:
QA identity, dashboard data, Settings navigation and 140-product catalogue load.
Full repeatable two-role gate used the site's production hostname
https://ua-product-manager.netlify.app, which serves the same current deployment
and bundle, with explicit sign-out between roles. This keeps the owner's working
portal.crystocraft.com session intact. IAB again returned a connection error;
Chrome authenticated successfully without account/configuration changes.

- Admin PASS: claude-qa@crystocraft.com; dashboard routing and data, Settings
  navigation, 140-product catalogue, reported pillow's decoded arrow swap,
  product detail with admin sections, refresh retains admin shell; no captured
  runtime errors.
- Customer PASS: customer-qa@crystocraft.com; /shop routing and isolated QA company,
  corporate catalogue and reported pillow's decoded arrow swap, detail loads
  without admin/internal sections, refresh retains customer shell, direct /settings
  redirects to /shop; no captured runtime errors. Signed out after verification.

Both arrow swaps changed the image source, finished with naturalWidth > 0 and
aria-busy=false, and stayed on the catalogue URL. A separate check on
portal.crystocraft.com/products also passes on the updated build using the owner's
existing session (not counted as fresh login proof). Screenshots:
`/private/tmp/v818-evidence/carousel-production-admin.png`,
`carousel-production-customer.png`, and `carousel-portal-admin.png`.

The complete local suite is 28 passing tests (17 carousel/source/gallery plus
11 Firebase configuration), full src/netlify no-undef lint passes, guarded
production build passes. No production product, price, image or access-rule
writes were used. No Firebase rules deployment. First uncached images can still
wait on the network; the optimization moves neighbouring downloads before the
click and retains the last loaded photo during a cold download.
