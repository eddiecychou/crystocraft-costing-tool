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
buildable and finished quantities, by-finish/by-colour limits, lead weeks, MOQ,
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
Production verification pending.

The initial prebuilt-archive deployment attempt was rejected by Netlify, so the
final candidates are built directly from source with real local dependencies
and --skip-functions-cache. Subsequent candidate 6ad070604ed1bdfa2e000598 proved
packaging; final candidate adds selected-finish leads and shared stock-field
normalization. Product calculations remain unchanged; normalization now shares
one implementation for admin and server, including numeric legacy strings.
