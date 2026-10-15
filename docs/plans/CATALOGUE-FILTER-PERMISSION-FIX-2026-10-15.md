# V8.18 saved catalogue filters and customer permission repair

## Cause and fix

The admin figurine catalogue restored an obsolete product category from session
storage. React's select displayed its first option (All), but the predicate still
used the obsolete value. Resetting that single control restored 294/294 designs.
All four catalogues restored unchecked saved categories; both figurine catalogues
and the admin corporate catalogue also restored unchecked lifecycle statuses.

Shared useCatalogueFilter now validates against the actual offered options. It
returns the corrected value to both control and predicate immediately and repairs
session storage. Dynamic category validation waits for a successful snapshot,
including an empty result; it never discards a valid filter while loading or on a
failed fetch. Valid filters and searches still persist across product navigation.
No global storage clear, product edits or changes to visibility/access policies.

Customer FigurineDetail called useComponents, a supply-side hook which queries
range_components and attempts migrateLegacyComponents. Customer rules correctly
deny this, and the rejected migration promise produced an unhandled permission
error. The customer page no longer imports or calls that internal subscription.
Customer availability now uses only the published product/defaults: explicit
notes and lifecycle remain; private component availability is unknown, so stock
and lead time require confirmation on enquiry. Unknown stock is not labelled
sold out or fast delivery, and customers can request a quantity without an
invented stock cap. Internal admin component availability remains unchanged.
No permission broadening or rules deployment.

## Validation

26 domain/carousel/Firebase configuration assertions pass; full src/netlify
no-undef lint and guarded Vite build pass. Local real React-hook browser fixture
checks all four catalogue filter keys: obsolete saved category clears after
loading and stays repaired after reload; valid selection survives loading and
reload; removing a selected category resets to All. Fixture is synthetic,
local-only, with no production writes.

Candidate 6ad06a626f697d5435e66963, app commit 541b024, served
/assets/index-DCu4c36w.js, configuration probe HTTP 200.
Fresh admin QA password login: dashboard/data/Settings, 294/294 figurines,
227 filtered Figurines persist on refresh and reset to 294; 140 corporate gifts;
no runtime errors. Fresh customer QA password login: /shop, 292 figurines,
Angels filter 26 persists through detail navigation and clears back to All;
136 corporate gifts. Previously failing Sacred Angel Freestand detail loads,
refreshes and shows honest availability pending confirmation, with no runtime
errors. Direct /settings redirects to /shop; no internal controls. Both roles
signed out after candidate checks. Candidate screenshots are under
/private/tmp/v818-evidence/filters-candidate-{admin,customer}.png.

## Production verification — PASS

Production deploy `6ad06b0ef2dd0a79247f10db`, release commit
`44b3c583c8969fac044ae79d977aeca6f76c366f`, published 15 October 2026
16:57 AEDT. Build marker V8.18 · 15 Oct, 16:56. Portal and default production
hostname both serve `/assets/index-CRKTnIdM.js`; both configuration probes return
HTTP 200. No Firestore/Storage rules were changed or deployed.

Fresh real-page password sign-ins were repeated on the current production
hostname https://ua-product-manager.netlify.app, in separate explicitly signed-out
QA sessions; this avoids signing the owner out of portal.crystocraft.com. Both
hostnames resolve to the same published deployment/bundle. Completed around
17:01 AEDT, with no captured runtime errors for either role.

- Admin claude-qa@crystocraft.com PASS: /dashboard, pipeline and Settings
  navigation; 294/294 figurines; Figurines selection 227 survives refresh, clears
  back to All; 140 corporate gifts, Fitness & Wellness survives refresh and
  clears normally; correct admin shell persists. Screenshot:
  /private/tmp/v818-evidence/filters-production-admin.png.
- Approved customer customer-qa@crystocraft.com PASS: /shop and isolated QA
  company; 292 figurines, Angels 26 survives product detail and return; All
  restores the catalogue. Previously failing Sacred Angel Freestand detail and
  refresh pass without a permission error or internal controls. Retired-stock
  Sacred Angel(Hymn Book) correctly shows confirmation required rather than
  falsely sold out; quantity remains available for an enquiry and no Infinity
  is shown in page text. 136 corporate gifts; Fitness & Wellness 8 survives
  refresh and clears normally. Direct /settings redirects to /shop. Screenshot:
  /private/tmp/v818-evidence/filters-production-customer.png.

Both QA sessions signed out after checks. No product saves, order submissions,
price changes, invitations or account/permission changes during verification;
normal login activity stamps only. Local fixture server stopped after testing.
The evidence-only closure commit uses [skip netlify] to preserve this verified
production build.
