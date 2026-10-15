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
no runtime errors. Customer and production gate evidence pending.
