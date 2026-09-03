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
function in `API-REFERENCE.md` does. The secret never reaches the browser,
so the exposure is **quota/CPU abuse, not secret theft**.

**Owner decision (V8.13 code review): leave them open — "not important, no
need to guard."** So this is now a *recorded, accepted* posture, not an
open oversight. If abuse ever shows up, add `requireFrontOffice()` (from
`lib/auth.js`) — `enhance-image.js` is the low-risk one to gate first.

**Where:** `netlify/edge-functions/customizer-render.js`,
`customizer-palette.js`, `enhance-image.js`.

## Parallel implementations of the same auth check

Most edge functions inline their own `isAdmin(uid, idToken, projectId)` (a
Firestore REST check of `users/{uid}.role`). A newer set —
`credit-note.js`, `compose-message.js`, `extract-pi.js`, `extract-po.js`,
`generate-blog.js`, `generate-marketing-copy.js`, `process-quote.js`,
`rewrite-section.js`, `scrape-images.js`, `woo-sync.js` — imports a shared
`requireAdmin()` / `requireFrontOffice()` from
`netlify/edge-functions/lib/auth.js` instead. Same effect, two shapes.
Worth converging on the shared one over time rather than adding another
inline copy.

**Node functions** have a parallel version of this: `portal-invite.js`
carries its own `normalizePkcs8` + `initAdminApp` (deliberately, per its
comment). `seo-batch.js` (2026-09-02) imports them from the new
`netlify/functions/lib/firebaseAdmin.js` instead. Migrate `portal-invite.js`
to that shared helper when it's next touched — until then there are two
copies of the PEM-repair idiom.

**V8.13 code-review fix:** 14 functions
(`send-campaign`, `send-personal-email`, `generate-outreach-drafts`,
`draft-outreach-topic`, `discuss-outreach-draft`, `discuss-customer-email`,
`route-email-question`, `compose-email-answer`, `suggest-tag-merges`,
`transcribe-whatsapp-audio`, `refresh-{email,whatsapp,alibaba}-summary`,
`uc.js`) had a *local* helper literally named `isAdmin()` whose body had
quietly widened to `['admin','sales'].includes(role)`. **V8.14 (2026-09-02)**
broadened each in place to `isFrontOffice(uid, token, PROJECT_ID, moduleKey)`
— admin / `staff` holding `moduleKey`. Still 13 near-identical inline copies
(uc.js is the 14th): converge them onto the shared `requireModule()` from
`lib/auth.js` when next touched. The 10
functions that already used the shared helper were retagged
`requireFrontOffice` → `requireModule(req, key)` in the same commit.

V8.12 added a *third* shape: `erp.js` now has `getRole()` (returns the
role string, not a bool) because it needs to distinguish `production` from
`admin`, not just gate on admin. If more functions ever need role-aware
(not admin-only) auth, `lib/auth.js` should grow a `requireRole()` /
`getRole()` rather than each one re-inlining the Firestore REST read.

**Where:** compare any inline `isAdmin()` / `isFrontOffice()` block against
`netlify/edge-functions/lib/auth.js`; `erp.js`'s `getRole()`.

## RBAC — client capability map vs server rules can drift

V8.14 model (`admin | staff | customer` + `users/{uid}.modules[]`) is enforced
in places that must agree, with no single source:
1. `src/access.js` (`MODULE_GROUPS` / `resolveModules` / `canAccess`) — nav + route gates.
2. `firestore.rules` (`can(m)` / `moduleList()`) — the real Firestore boundary.
3. `storage.rules` (`can(m)`) — object uploads; must track (2) path-for-path
   (V8.12 DeepSeek review — storage.rules had no staff helper at first).
4. `netlify/edge-functions/lib/auth.js` (`requireModule`) + each edge fn's key;
   `erp.js` checks `erp` for the full surface.

The legacy `production` / `sales` shim was removed 2026-09-02 (both accounts
migrated). `bank.js` and `erp.js` no longer carry per-entity role tiers.

`qa/rbac-rules.test.mjs` covers the Firestore layer only — not storage, not
the edge function, not the UI map. Adding a module to `access.js` without
the matching rule opens a menu that permission-denies; the reverse grants
data with no way to reach it. Keep them in sync by hand and re-run the
emulator test on any `firestore.rules` change. See `PROJECT-PLAN.md` V8.14
RBAC subsection, `docs/skills/ARCHITECTURE-RULES.md` §2, and the
`rbac-production-role` memory.

**Where:** `src/access.js`, `firestore.rules` + `storage.rules` (search
`isStaff`), `netlify/edge-functions/erp.js` (`PRODUCTION_ENTITIES`),
`src/pages/ErpLookup.jsx` (`PRODUCTION_ERP_ENTITIES`),
`qa/rbac-rules.test.mjs`.

## ~~Corp-gift quote lines are labelled as figurine products on Convert-to-PI~~ — FIXED V8.13

**Fixed (V8.13 code review):** the convert path in `ShipmentForm.jsx` now
writes `line_type: 'corp_gift'` + `matched_product_ref.collection: 'products'`
for catalogue lines (a client quote is always a corp-gift product — that's the
only picker `QuoteDetail.jsx` has). `corp_gift` is a real `LINE_TYPES` value
(packable, "Corp Gift" badge) that the figurine-MRP special-case
(`shipping.js:576` `line_type === 'range'`) correctly skips. `buildFullCartonPlan`
still returns 1 carton for it — but that is now *correct* (corp gifts carry no
structured packing DB; CuiLing types dims), not a silent failure wearing a
false "matched ✓". Original analysis kept below for context.

---

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

## i18n — dynamic keys, and untranslated leftovers

The `t()` translator (V8.14, supply/inventory scope — see SKILL.md §5 "i18n")
keys on the literal English string, so `scripts/i18n-translate.mjs`'s regex only
sees `t('literal')`. Strings reached through a variable — `t(STATUS_META[x].label)`,
`t(MOVEMENT_TYPES.find(...).note)`, `t(MERGE_FIELD_LABELS[f])`, `t(c.category)` —
are listed by hand in `scripts/i18n-extra-keys.json`. **Add to that file** when
wrapping another config-label lookup, or it silently stays English.

Deliberate English leftovers in the in-scope pages: `'Error: '`-prefixed catch
messages (kept English as `String(x).startsWith('Error')` sentinels), the
`useErpPurchaseOrders` hook's "Could not reach the ERP archive." (no `t` in a
bare hook), `PO_PAYMENT_TERMS` labels (already bilingual EN+繁中 in the literal),
and all dates/numbers (scope decision). Not bugs — noted so they're not
"discovered" later.

## Keeping this current

Add an entry when you notice something like this in passing during
unrelated work — dead code, an inconsistency between two similar modules, a
gap that isn't urgent but would waste time if rediscovered cold. Remove an
entry once it's actually been fixed (or note it was fixed and why it's still
worth knowing about, if that's useful context).
