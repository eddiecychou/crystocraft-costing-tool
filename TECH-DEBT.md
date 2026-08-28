# Tech Debt & Footguns

A running list of things noticed during review or investigation that are
worth a deliberate look — not urgent bugs, not fixed silently, just recorded
here so they don't get rediscovered from scratch next time someone trips
over them. Add to this whenever you notice something in passing that isn't
in scope for the task at hand.

Each entry: what it is, why it's not already fixed, and where to look.

## Three edge functions have no auth check

`customizer-render.js`, `customizer-palette.js`, and `enhance-image.js`
proxy third-party secrets (`RENDER_TOKEN`, `GEMINI_API_KEY`) but have no
`isAdmin()`/`requireAdmin()` check in their source — every other AI/proxy
function in `API-REFERENCE.md` does. May be intentional (the customizer is a
public-facing feature; the secret staying server-side is the actual
mitigation either way) or may be an oversight. Changing auth posture on a
public-facing feature is a product decision, not a code cleanup — flagged
2026-08-26, not changed.

**Where:** `netlify/edge-functions/customizer-render.js`,
`customizer-palette.js`, `enhance-image.js`.

## Two parallel implementations of the same admin check

Most edge functions inline their own `isAdmin(uid, idToken, projectId)` (a
Firestore REST check of `users/{uid}.role === 'admin'`). A newer set —
`credit-note.js`, `compose-message.js`, `extract-pi.js`, `extract-po.js`,
`generate-blog.js`, `generate-marketing-copy.js`, `process-quote.js`,
`rewrite-section.js`, `scrape-images.js`, `woo-sync.js` — imports a shared
`requireAdmin()` from `netlify/edge-functions/lib/auth.js` instead. Same
effect, two implementations. Worth converging on the shared one over time
rather than adding a 38th inline copy next time a new function needs auth.

V8.12 added a *third* shape: `erp.js` now has `getRole()` (returns the
role string, not a bool) because it needs to distinguish `production` from
`admin`, not just gate on admin. If more functions ever need role-aware
(not admin-only) auth, `lib/auth.js` should grow a `requireRole()` /
`getRole()` rather than each one re-inlining the Firestore REST read.

**Where:** compare any inline `isAdmin()` block against
`netlify/edge-functions/lib/auth.js`; `erp.js`'s `getRole()`.

## RBAC (`production` role) — client capability map vs server rules can drift

V8.12's `production` role is enforced in **four** places that must agree,
with no single source:
1. `src/access.js` (`PRODUCTION_MODULES`) — nav + route gates.
2. `firestore.rules` (`isStaff()` / `isProduction()`) — the real boundary
   for Firestore.
3. `storage.rules` (`isStaff()`) — the boundary for object uploads; must
   track (2) path-for-path or a production user can edit a record but not
   attach its files (found in the V8.12 DeepSeek review — storage.rules had
   no `isStaff()` at first).
4. `netlify/edge-functions/erp.js` (`PRODUCTION_ENTITIES`) — the ERP proxy;
   its own header comment adds that `ErpLookup.jsx`'s
   `PRODUCTION_ERP_ENTITIES` is a **fifth** partial copy (UI tab list, a
   subset of the server set).

`qa/rbac-rules.test.mjs` covers the Firestore layer only — not storage, not
the edge function, not the UI map. Adding a module to `access.js` without
the matching rule opens a menu that permission-denies; the reverse grants
data with no way to reach it. Keep them in sync by hand and re-run the
emulator test on any `firestore.rules` change. See `PROJECT-PLAN.md` V8.12
§2 and the `rbac-production-role` memory.

**Where:** `src/access.js`, `firestore.rules` + `storage.rules` (search
`isStaff`), `netlify/edge-functions/erp.js` (`PRODUCTION_ENTITIES`),
`src/pages/ErpLookup.jsx` (`PRODUCTION_ERP_ENTITIES`),
`qa/rbac-rules.test.mjs`.

## Corp-gift quote lines are labelled as figurine products on Convert-to-PI

`ShipmentForm.jsx:310` writes `matched_product_ref: { collection:
'range_products', id: it.product_id, … }` and `line_type: 'range'` for **any**
catalogue quote item. But `QuoteDetail.jsx`'s product picker adds **corp
gifts** — `it.product_id` is a `products/` id (`QuoteDetail.jsx:268` reads
`products/{id}/pricing_tiers`). So a corp-gift quote converted to a PI claims a
match against a `range_products` id that doesn't exist.

Consequences: `packing.js:132` (`rangeProducts.find(...)`) returns `undefined`,
so `pcs_per_carton` / carton dims / weights are all missing and the carton plan
silently falls back to **1 carton, no dimensions, no weight**. `mrp.js:55–61`
is guarded so it degrades safely, but the line is invisible to material
planning. Meanwhile `ShipmentForm.jsx:1227` still renders a green ✓ "matched"
badge — the UI asserts a match that isn't real, which is the part most likely
to mislead someone.

Found during the V8.12 product-variants audit (see
`PRODUCT-VARIANTS-PLAN.md` §4.11), not fixed there because it is unrelated to
that feature and deserves its own decision: either set `collection: 'products'`
for corp items and teach the consumers, or leave corp lines
`ad_hoc`/unmatched — which is what they effectively are for packing and MRP.

**Where:** `src/pages/ShipmentForm.jsx:310`, `src/packing.js:132`,
`src/mrp.js:55`.

## Tag bookkeeping is duplicated, not shared

`customer.js` and `marketingContact.js` each have their own
`renameTagEverywhere`/`deleteTagEverywhere` — separate implementations, not
a shared helper. A rename in one never touches the other's tags, which is
probably correct behavior (they're different tag vocabularies) but means a
future bug fix in one won't automatically apply to the other. Not wrong,
just a place a fix could get applied to only half the codebase by mistake.

**Where:** `src/domain/customer.js` and `src/domain/marketingContact.js`,
both have functions of the same name doing conceptually the same job.

## `customers` vs `marketing_contacts` bulk-summary scan duplication

Carried over from the V8.10 Deepseek review (see `PROJECT-PLAN.md`): the
plan itself flags `SummaryScanSection`/`ContactSummaryScanSection` and the
two halves of `whatsappSummaryApi.js`/`emailSummaryApi.js` as hand-duplicated
between the customer and marketing-contact versions of the same "scan and
refresh summaries in bulk" feature. Collapse into one shared implementation
if a third collection ever needs the same pattern — not worth the
refactor for two.

## Keeping this current

Add an entry when you notice something like this in passing during
unrelated work — dead code, an inconsistency between two similar modules, a
gap that isn't urgent but would waste time if rediscovered cold. Remove an
entry once it's actually been fixed (or note it was fixed and why it's still
worth knowing about, if that's useful context).
