# V8.18 secure customer stock and lead times

## Correction

The prior permission repair removed the customer page's private component
subscription, but replaced stock quantities and lead times with confirmation
text. This release restores those features through a read-only server projection.

`src/availability.js` contains the unchanged calculation body extracted from
criticalComponents. Admin continues to import the same exports through that
module; the customer endpoint uses the identical pure calculation. Customer
Firestore permissions remain unchanged. No migration is run for customers.

POST /api/customer-availability verifies the Firebase token (including revocation)
and the current role/profile; only admin or approved customer is allowed. The
product must be storefront-visible. The server privately reads only referenced
components and production defaults. Its explicit DTO returns verified status,
buildable and finished quantities, by-finish/by-colour limits and selected-finish/colour lead times, lead weeks, MOQ,
customerPromise and checkedAt. It excludes costs, suppliers, private component
records/IDs/codes, bottleneck and procurement-driver metadata. Private/no-store.
Missing components fail closed without a false stock count or fast promise.

The customer detail refreshes every 30 seconds while visible and on focus, aborts
obsolete requests, times out stalled requests and provides Retry. Loading/errors
cannot enable a stock-backed enquiry. Last-stock caps, finish sold-out states,
from-stock mode and colour-specific limits use the server result. Unknown MTO
availability remains enquiry-only with confirmation text; it is not sold out.
This is availability for an enquiry, not an inventory reservation or order.

## Validation / packaging

47 tests pass: API auth/profile/publication boundaries, input limits, generic
failures, strict response fields/no private codes, exact parity with admin,
reservation subtraction, procurement + assembly leads, per-finish and colour
shared-pool allocation; existing filter, carousel, Firebase config and B0016 BOM
regressions. Full src/netlify no-undef lint and guarded build pass. Extracted
calculation body compares byte-for-byte equal to the previous admin module.

Initial candidates 6ad06ef48fa99836d2e2086f and 6ad06f7e72277d6a9e1a8171
failed with a missing Firebase Admin package. Production was not published.
Root cause: the worktree's node_modules was an external symlink, archived as the
link rather than the dependency tree. Replaced only the worktree link with a
local copy-on-write dependency clone. Explicit archive inspection: 980 files,
37 Firebase Admin files, no root node_modules symlink. The new function scopes
esbuild/external_node_modules packaging in netlify.toml; Git CD installs real
dependencies. Existing production checkout/dependencies are untouched.

Final candidate `6ad071d84a122e7bffd36e67`, source commit `24cf194` (preceded by
`586331f`, `ae11915`, `6d242cc`), served `/assets/index-CGbCa4uk.js`, configuration
probe HTTP 200. Live API comparison with current admin data: Sacred Angel
Freestand 5 total (C 0 / G 5), root lead 3 weeks, selected C 9 weeks / G 3 weeks;
Sacred Angel(Hymn Book) 50 (C 0 / G 50), G lead 3 weeks, C sold out. Totals,
finish limits and selected-finish leads match the shared admin calculation.
Customer direct private-component request returns 403; anonymous endpoint 401;
no private code/cost/supplier fields in actual customer responses.

Fresh candidate admin password sign-in passes: dashboard data/Settings, 294/294
catalogue, source-product admin availability unchanged, refresh/admin shell and
runtime checks pass. Screenshot availability-candidate-admin.png under
/private/tmp/v818-evidence. Fresh candidate approved customer password sign-in also passes: /shop and isolated
QA company, 292 designs, no internal controls; first product Chrome lead 9 weeks,
Gold lead 3 weeks with 5 available in From stock mode. Entering 999 clamps to 5.
Refresh retains customer shell; second product automatically selects Gold and
shows 50 left/max 50, with sold-out Chrome hidden. No runtime errors. Direct
/settings redirects to /shop. Both QA roles explicitly signed out afterward.
Candidate screenshot availability-candidate-customer.png under the same folder.
## Production verification — PASS

Deploy `6ad072b0043a65b5011bf282`, commit
`c1ef5c6db19e8aeae0dee2bc1d019a2b9ab31f60`, published 15 October 2026
17:29:48 AEDT. Build marker V8.18 · 15 Oct, 17:29. Both production hostnames
serve `/assets/index-BHxo8YlD.js` and Firebase configuration probes return 200.
No Firestore/Storage rules changes or deployment.

Read-only authenticated API comparison on https://portal.crystocraft.com passes
against current admin Firestore data, including reservations and shared stock
normalization: Freestand 5 total (C 0, G 5), selected leads C 9/G 3 weeks; Hymn
Book 50 total (C 0, G 50), Gold lead 3 weeks, Chrome sold out. Actual responses
contain no supplier/cost/bottleneck/part-code fields. Customer direct private
component requests return 403 and anonymous endpoint requests return 401.
API password-token testing is additional functional evidence, not browser login
proof; both fresh real-page logins were separately completed below.

Fresh browser gates use the current site's production hostname
https://ua-product-manager.netlify.app, serving the identical published build,
with explicit sign-out between roles to preserve the owner's portal session.
Verified around 17:34 AEDT:

- Admin claude-qa@crystocraft.com: password sign-in, /dashboard data/Settings,
  294/294 catalogue, source-product 5 buildable/C0/G5 and 3-week lead unchanged,
  correct shell after refresh, no captured runtime errors. Loaded catalogue
  screenshot: /private/tmp/v818-evidence/availability-production-admin.png.
- Approved customer customer-qa@crystocraft.com: password sign-in, isolated QA
  company in /shop, 292 catalogue designs; source-product Chrome 9-week estimate
  changes to Gold 3 weeks/5 available, entering 999 clamps to 5. Refresh remains
  in customer shell and loads current server availability. Last-stock product
  shows only Gold 50 left, hides sold-out Chrome, and entering 999 clamps to 50.
  No internal controls or runtime errors; /settings redirects to /shop.
  Screenshot: /private/tmp/v818-evidence/availability-production-customer.png.

Both roles signed out. No enquiry/order submission, product/price edits,
permission changes, invitation or reset emails were performed. Normal sign-in
activity stamps only. Server responses are fresh availability snapshots for an
enquiry; they do not reserve stock. Evidence-only closure uses [skip netlify]
so it does not replace the verified production deployment.

The initial prebuilt-archive deployment attempt was rejected by Netlify, so the
final candidates are built directly from source with real local dependencies
and --skip-functions-cache. Subsequent candidate 6ad070604ed1bdfa2e000598 proved
packaging; final candidate adds selected-finish leads and shared stock-field
normalization. Product calculations remain unchanged; normalization now shares
one implementation for admin and server, including numeric legacy strings.

## Final combined production catalogue audit — 15 October, 17:48 AEDT

PASS on unchanged current production deploy 6ad072b0043a65b5011bf282. Fresh
password admin/customer QA sign-ins were performed sequentially on the same
production hostname documented above. The owner's portal session was untouched.

| View | Loaded total | Combined live flow |
|---|---:|---|
| Admin figurine | 294 | Product category Figurines + design Angels + Made to Order + search Sacred Angel restore after refresh (2 matches); Next/Previous produce decoded images without leaving grid; detail shows C0/G5 and 3-week aggregate; returning preserves filters. Clearing restores full list. In stock only survives refresh with 138 matches, then clears normally. |
| Admin corporate | 140 | Fitness & Wellness + Concept + Cervical Massage survive refresh; reported pillow's arrows work without navigation; detail and return preserve filters; clearing restores full catalogue. |
| Customer figurine | 292 | Angels + Made to Order + Sacred Angel survive refresh (4 matches); arrows work within grid, detail/return retains filters; Chrome estimate 9 weeks, Gold 3 weeks/5 available; input 999 clamps to 5. Retired-stock Gold 50 left/max50, Chrome hidden, 999 clamps to 50. Reset restores 292. |
| Customer corporate | 136 | Fitness & Wellness + Cervical Massage survive refresh (1 match); Next/Previous work without opening product; detail has customer-only controls, return preserves filters; reset restores 136. |

All four tested Next swaps changed source, finished with decoded pixels and
aria-busy=false, and retained the catalogue URL. Previous navigation also works.
No new timing/SLA claim was made; this is an integration check on production.

47 regression tests pass again, including obsolete-filter repair (tested with
synthetic options, without renaming production categories), carousel loader,
server availability/privacy, Firebase config and existing colour-BOM cases.
Live portal API comparison again matches admin totals, finish limits and leads
for both checked products. Customer private component reads remain 403 and
anonymous requests 401. No runtime errors captured during either role's flows.
/settings redirects the customer to /shop. QA test filters reset and both roles
signed out; no cart/enquiry/order submissions, product edits or access changes.

Evidence in /private/tmp/v818-evidence/: final-admin-figurine-catalogue.png,
final-admin-corporate-catalogue.png, final-customer-figurine-catalogue.png,
final-customer-corporate-catalogue.png, final-customer-stock-and-lead.png.
No further app changes/deployment required; documentation-only audit commit
uses [skip netlify].
