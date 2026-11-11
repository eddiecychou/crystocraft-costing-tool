# Tech Debt & Footguns

A running list of things noticed during review or investigation that are
worth a deliberate look — not urgent bugs, not fixed silently, just recorded
here so they don't get rediscovered from scratch next time someone trips
over them. Add to this whenever you notice something in passing that isn't
in scope for the task at hand.

Each entry: what it is, why it's not already fixed, and where to look.
The [maintenance cleanup plan](docs/plans/OC-MAINTENANCE-CLEANUP-PLAN.md) orders
proposed behaviour-preserving work; it does not override accepted owner decisions
or authorize fixing unrelated entries as part of another change. Resolved entries
retain historical evidence and link their later release records.

## Credit-note RPC privilege review — P1, separate from Shipping

12 November Shipping migration preflight: Supabase advisors flag the existing
`public.allocate_credit_note(...)` and `public.void_credit_note(bigint,text)`.
Read-only catalog checks confirm both are SECURITY DEFINER and effectively
executable by `anon`, `authenticated` and `service_role`. Their bodies and caller
migration need a bounded authorization review before changing grants; no function
was invoked, no credit note was created/voided and no ACL was changed by this
Shipping release. Prioritize identifying authorized callers and testing a
service-only boundary with fictional records. Preserve legitimate credit-note
workflows. [Function privilege guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
This is a pre-existing exposure to review, not a regression caused by the new
Shipping receipt function, which has explicit service-only execution.

## Mobile form font specificity — P2, dashboard correction released

10 November responsive audit: the intended global 16px input/select/textarea rule
under max-width 767px has lower specificity than .input, which still computed to
14px on the live dashboard. This weakens the repository's documented mitigation
for mobile input zoom. The released dashboard polish scopes 16px/minimum-height rules
to .dashboard-workbench only; desktop density and other modules are unchanged.
Audit remaining forms before a separate global change. Verify computed styles and
physical-device behavior rather than treating a media-rule declaration as proof.
[Measured scope and limits](docs/plans/V8.20-DASHBOARD-UI-POLISH.md).

## Shipping health/ownership checkpoint — open, review only

**12 November released correction:** SH07-R1 and SH07-R2 are fixed in `443173e`, production `6af49af233e344fb714e28fa`.
Initial retries finish the pinned first invoice's accounting work; changed
ownership requires review. New PI originals are capped at 20 MB in selection,
server validation and Storage create rules. Both original failures now run as
ordinary acceptance tests in required CI. [Current implementation and publication status](docs/plans/V8.20-SHIPPING-RECOVERY-RELEASE.md).

**Historical 12 November SH-07 readiness findings (now corrected):** [review and evidence](docs/plans/V8.20-SHIPPING-RECOVERY-RELEASE-READINESS.md).
**SH07-R1 / P1:** initial Direct Invoice labels a linked first SI complete while
financial follow-up is pending. A failed RPC leaves registry amounts/references
blank; an original-request retry skips the unfinished operation. Saved-order
Resume repairs the same SI without another issue. Fix status and pinned-first-
operation retry before deploying; two fictional desired-behavior probes remain
explicit TODO failures. **SH07-R2 / P3:** the new PI original path has no byte-size
ceiling; add consistent selection/server/Storage limits. These are documented,
not silently fixed. Existing recovery and intentional-repeat/split/reissue tests
pass. The saved-order concurrent-edit issue in the next dated entry was already
[fixed and released as 55ee1d3](docs/plans/V8.20-SAVED-ORDER-CONCURRENT-EDIT-FIX.md).

**9 November concurrent-edit review.** Fictional two-operator Web SDK/rules
tests confirm stale deposits/prices, removal/recreation of another editor's
lines, mixed-version loading and header/line total mismatch on reconnect or a
read/commit race. Existing invoice-reference revision guards remain narrower.
The proposed commercial revision and draft-preserving conflict workflow are
documented before implementation. [Review and next repair](docs/plans/V8.20-SAVED-ORDER-CONCURRENCY-REVIEW.md).

6 November 2026, clean dbd107ae. All 149 existing Shipping regressions pass;
33 additional fictional characterizations cover previously untested combinations.
Pause routine presentation extractions for separately authorized correctness work:

The owner subsequently authorized **SH-01/02 only**, now released as 6f3ec3e.
PI committed-file/result and current-import/SO ERP guards pass 171 Shipping cases,
22 fictional Chrome cases and six additional actual production stages with
intercepted fictional responses. Both exact-SHA jobs, build and fresh candidate/
production admin/customer gates pass. [Correction/release evidence](docs/plans/V8.20-SHIPPING-PI-OWNERSHIP-FIX.md).
The owner next authorized SH-04 financial Re-sync. Its complete source projection,
strict targeted reads, raw-source authority/review guards and visible recovery
outcomes are released as 3022bfe (40 integration, 2 SDK, 38 Chrome,
916 prebuild cases), including review-only known ledger accounting/unknown base
when source accounting is blank. Both exact-SHA jobs and fresh candidate/production
admin/customer financial-read/API gates pass. [Correction/release record](docs/plans/V8.20-INVOICE-RECONCILIATION-FIX.md).
SH-03 customer no-deposit payable exports are corrected and released as 96ba538
after both exact-SHA jobs, 1,027 prebuild tests, fresh candidate/production roles
and saved PDF/XLSX verification. [Scope/evidence](docs/plans/V8.20-CUSTOMER-INVOICE-PAYABLE-FIX.md).
The other findings below remain open.

- **P1 PI source identity — corrected in SH-01/02:** original overlapping/failed replacement extraction can attach
  B's PDF to A's SO/UC/lines; a late ERP comparison can offer/adopt A's lines for B.
  Bind committed file/result/comparison identity, including replacement failure.
- **P1 financial contract — corrected:** the reviewed baseline omitted approved customer accounting payable
  without a positive deposit; released SH-03 above addresses it. Sales Invoices Re-sync omitted accounting/date/reference
  fields and could reset the financial copy while its warning cleared; metadata-only
  drift was not detected. The saved Firestore order remained intact in the fixture.
  The Re-sync portion is corrected under the subsequent SH-04 authorization above;
  the customer export portion is released separately under SH-03 above.
- **P1 allocation recovery — fixed 8 November 2026 (SH-05B):** lost allocation/link
  acknowledgments could previously issue a second SI on retry. [Durable recovery](docs/plans/V8.20-INVOICE-RETRY-RECOVERY.md)
  is released as 9a5d93a: persisted per-intent identity, atomic SQL receipts,
  explicit split/reissue, separate link/follow-up recovery and stale-save rules.
  Historical invoices are preserved; no automatic duplicate repair or order-level
  uniqueness was introduced. Native concurrency/actual Firebase tests and both
  required CI jobs gate future releases.
- **Allocator privilege gap — fixed 8 November 2026 (SH-05A):** the exact reviewed
  function now denies effective anon/authenticated execution and retains the
  existing service_role grant; PUBLIC is absent. Definition/OID/owner/search path
  are unchanged. Canonical setup and 18 actual PostgreSQL regression cases protect
  the fix. [Migration, CI and fresh-role evidence](docs/plans/V8.20-INVOICE-ALLOCATOR-PERMISSIONS.md).
  Durable per-intent recovery is released under SH-05B above. Other financial functions need
  a separately bounded grant review; this release does not claim their state.
- **P2 initialization — fixed 8 November 2026 (SH-06):** [quote initialization](docs/plans/V8.20-QUOTE-INITIALIZATION-FIX.md)
  now owns loading/error/Retry and applies the complete header/line attempt before
  enabling editing/Create. Existing source mappings and empty-quote entry remain.
  Released as 97cbf5d after both required jobs and fresh candidate/production
  role, actual SDK Retry, access and served-artifact gates. See that record for evidence.
- **P2 completion/re-entry — SH-08 released:** [Durable
  conversion recovery](docs/plans/V8.20-QUOTE-ORDER-CONVERSION-RECOVERY.md) uses
  server-owned intent per order, atomic SO/order/lines/receipt/link, Open/Resume,
  explicit additional orders and quote-copy ownership reset. Local real-page,
  SDK/rules, native Chrome and existing regressions pass. Released as dd053d7
  after both exact-SHA jobs, fresh candidate/production roles, live read-only
  status/customer-denial, rules readback and artifact verification. No
  quote uniqueness or historical deduplication. Old tabs submit source-less
  manual orders: new-field guards alone cannot prevent those Creates while
  preserving manual workflows. Refresh tabs at cutover; broader SH-07 remains.
- **SH-07 general Create recovery.** Manual orders, PI imports, Duplicate Order and initial Direct Invoice have local fixes for lost confirmations. Each intended copy owns one UC receipt, and intentional repeats obtain independent numbers. Direct Invoice retries reuse the saved order and its first invoice operation. [Direct Invoice implementation](docs/plans/V8.20-INITIAL-DIRECT-INVOICE-RECOVERY.md). [Manual and PI implementation](docs/plans/V8.20-MANUAL-ORDER-PI-RECOVERY.md) · [Duplicate Order implementation](docs/plans/V8.20-DUPLICATE-ORDER-RECOVERY.md) · [Original fictional findings](docs/plans/V8.20-GENERAL-ORDER-CREATE-RECOVERY-REVIEW.md).


These mechanisms predate the recent extraction work. Known concurrent-editor and
browser-close synchronization limits remain separate design debt. Packing/Freight
async failure/selection risks are source-reviewed coverage gaps, not reproduced
cross-scenario corruption. The original review made no historical repair, app
change or deployment; subsequent authorized releases are linked above.
[Ownership, exact fictional reproductions, limits and prioritized plan](docs/plans/V8.20-SHIPPING-HEALTH-OWNERSHIP-REVIEW-2026-11-06.md).

Follow-up identity tests also reproduce a pre-existing ERP adoption unit warning:
erpSoImport.lineFromErp omits unit, while ShipmentLineRow's controlled input reads
line.unit. After a parsed pcs line it can become uncontrolled, retaining its old
visible unit until normalization. Frozen pre-fix source reproduces the same
warning. Record the unit display/projection contract before a separately scoped
repair; the SH-01/02 identity fix does not change ERP units.

## Shipping order loading and save outcomes — corrected and released

6 November 2026. Fictional tests on 4d675ce reproduced six stale/mixed loading
states and characterized eight save outcomes. An actual Chrome/React Router
test captured A's data saved to B's mocked order/lines after a late A response.
Missing or rejected reads also left previous data editable. The proposed first
repair was route-scoped loading with abandoned-response guards and visible errors.

Separate pre-fix save diagnostics showed independent header/line completion, navigation
and financial-upsert invocation at the six-second timeout, and no inline error
after late rejection. A delayed line query can reach that timeout before any
line batch existed. The follow-up evaluated write consistency and observable
pending/committed/error states with the real SDK persistence requirements.

The affected loader sequencing and save primitives match pre-extraction
a38465b5. Both runtime corrections are now implemented under subsequent owner
authorization: route isolation and blocked load failures, one-batch header/line
persistence and acknowledged-save feedback. Released as 0fec1ff9 after both
exact-SHA jobs, full build and fresh candidate/production role/shipping gates.
Concurrent-editor protection and durable cross-system financial synchronization
remain separate work. [Correction and limits](docs/plans/V8.20-SHIPPING-LIFECYCLE-FIX.md). [Evidence and proposed repairs](docs/plans/V8.20-SHIPPING-LIFECYCLE-REVIEW-2026-11-06.md).

## ShipmentForm mixes presentation with workflow orchestration — display/reference slices extracted

6 November: page header/navigation presentation now has a controlled component;
ShipmentForm retains state, allocation/save/read sequencing and actual tab content.
The owner-authorized slice is released as af53c1b3 after source/browser
parity, full build, both exact-SHA jobs and fresh candidate/production roles
and view-only real-tab/readback checks. Pause further routine Shipping extraction
for a bounded health/ownership review after release.
[Header/navigation slice](docs/plans/V8.20-SHIPMENT-NAVIGATION-CLEANUP.md).

6 November: the owner authorized saved-header field mapping extraction after
the lifecycle repairs. The exact whitelist/defaults now live in orderEditFields;
ShipmentForm retains requests, guards, source/line state, Retry and save/allocation
sequencing. Released as 6a232360 after source/browser parity, full build, both
exact-SHA jobs and fresh candidate/production role/shipping gates. This does not
resolve concurrent-edit or durable financial-index synchronization debt.
[Saved-header mapping slice](docs/plans/V8.20-SHIPMENT-HEADER-MAPPING-CLEANUP.md).

Save validation/visible-error corrections are released as 37ea5b2a after both
exact-SHA jobs, full build and fresh candidate/production role/feature gates.
[Correction evidence](docs/plans/V8.20-SAVE-AND-CUSTOMER-NAVIGATION-FIXES.md).
The discovery below describes the now-corrected pre-release behavior.

**3 November health review:** pause the next extraction for a confirmed save
regression from the separate Woo metadata repair: a loaded saved total is checked
against an edited Accounting Total before the live line-derived check, so matching
edited line/accounting amounts can be rejected. Baseline 43073fc saves; current
source does not. An older UI defect hides edit-form save errors inside an absent
import card. Both had isolated actual-form reproductions before correction.
Correct the validation context and visible error path without weakening genuine
adjustment guards. [Assessment and revised order](docs/plans/V8.20-CLEANUP-HEALTH-REVIEW-2026-11-03.md).

The owner subsequently authorized Document References only. Its controlled card
now lives in components/shipping/ShipmentDocumentReferences.jsx; number/revision
updates, focus, validation and all writes remain parent-owned. Nineteen real-page
cases pass on original/extracted source; the parent is another 61 lines shorter.
Released as 42fdaa51 after both exact-SHA jobs, the full build and fresh
candidate/production role/reference/focus checks; no live allocation/save/stock
actions. [Document References evidence](docs/plans/V8.20-SHIPMENT-REFERENCES-CLEANUP.md).

3 November 2026: ERP comparison and stock badge presentation now live in
components/shipping/ShipmentReconciliation.jsx, leaving the parent 64 lines
shorter. Exact restoration and before/after component/visual tests retain current
behaviour; all calculations, subscriptions, adoption and financial/stock writes
stay in the page. Both exact-SHA jobs, full build and fresh candidate/production
role/shipping checks pass; released as 8551bc98. This is partial cleanup, not resolution of the entire large
form. Further sections need separate bounded slices. See
[current release status](docs/plans/V8.20-SHIPMENT-DISPLAY-CLEANUP.md).

## Saved WooCommerce invoice allocation loses total/HKD payout metadata

3 November: owner authorized the separate runtime fix/read-only audit. Both
whitelists preserve recorded values; an unknown-total guard prevents registry
zeroing while keeping the issued SI/UC. Seven added app lines; all 38 cases pass,
with 18 targeted failures against frozen original. Review flags three invoiced
registry discrepancies and one unmatched app invoice; historical values remain
untouched by this task, with no inferred bank/HKD settlement. Runtime repair
released as 159c4d8d after exact-SHA CI/build/fresh candidate/production gates.
Concurrent non-QA finance activity changes the follow-up review list to eight
entries; both dated snapshots remain. Historical review stays open.
[Release/review status](docs/plans/V8.20-WOO-INVOICE-DATA-FIX.md).

Found during Document References characterization, before extracting any app
code. ShipmentForm's existing getOrder/header-load whitelist omits total_amount;
doAllocateSi uses header.total_amount for the best-effort UC Registry total /
deposit. Separately, shipping.normOrder omits woo_net_payout_hkd even though
ShipmentForm reads it for non-HKD fee/payout remarks. A fictional raw saved order
with total 1222 and HKD payout 9456 produces null registry total/deposit and the
manual HKD-payout fallback. The number allocation and zero-balance payload remain.

These existing gaps were characterized, not corrected by the presentation slice.
The runtime repair now pins the original total/fee semantics and intentionally
updates characterization assertions. The historical review supplies dated lists,
not a guessed backfill; concurrent finance work is preserved. The original
presentation slice did not inspect/correct live records.
[Original discovery](docs/plans/V8.20-SHIPMENT-REFERENCES-CLEANUP.md).

## Customer navigation can retain stale customer data and section state

Keyed page/section isolation and guarded-loader/error/Retry corrections are
released as 37ea5b2a: 12 actual-page and 19 component cases pass, both exact-SHA
jobs and all fresh candidate/production role/feature gates pass. See the
[correction evidence](docs/plans/V8.20-SAVE-AND-CUSTOMER-NAVIGATION-FIXES.md).
Original discovery and baseline evidence remain below.

3 November health review confirms two pre-existing problems: CustomerDetail's
unguarded Promise.all loader can finish A after navigation to B, displaying A
under B's URL. Its 37-line loader matches pre-cleanup ee3e32c.
CustomerCollapsible also keeps the previous storageKey's initialized state on
same-instance navigation; current and frozen original both reproduce it. These
are not extraction regressions. Fix navigation response/state isolation before
more extraction; test delayed loads and same-instance preferences. The isolated
repro proves a read/render mismatch, not a cross-customer write. Both findings
were open at discovery and are corrected by the release above. [Assessment and evidence](docs/plans/V8.20-CLEANUP-HEALTH-REVIEW-2026-11-03.md).

## Three edge functions have no auth check

`customizer-render.js`, `customizer-palette.js`, and `enhance-image.js`
proxy third-party secrets (`RENDER_TOKEN`, `GEMINI_API_KEY`) but have no
`isAdmin()`/`requireAdmin()` check in their source — every other AI/proxy
function in `docs/reference/API-REFERENCE.md` does. The secret never reaches the browser,
so the exposure is **quota/CPU abuse, not secret theft**.

**Owner decision (V8.13 code review): leave them open — "not important, no
need to guard."** So this is now a *recorded, accepted* posture, not an
open oversight. If abuse ever shows up, add `requireFrontOffice()` (from
`lib/auth.js`) — `enhance-image.js` is the low-risk one to gate first.

**Where:** `netlify/edge-functions/customizer-render.js`,
`customizer-palette.js`, `enhance-image.js`.

## Parallel implementations of the same auth check

**Second pilot migration, 3 November 2026:** discuss-outreach-draft now delegates
its marketing gate to requireModule. Topic/shared/client/rules are unchanged;
38 before/after contracts pass. See the [refinement implementation/release status](docs/plans/V8.20-REFINEMENT-AUTH-CLEANUP.md).
Other inline endpoint checks remain open; this does not complete global auth
convergence or authorize policy changes.

**First migration, 3 November 2026:** draft-outreach-topic now delegates to the
existing requireModule(req, 'marketing'); shared helper and other endpoints are
unchanged. Before/after contracts, exact source restoration, both required CI
jobs and fresh candidate/production role gates pass; see
[current implementation/release status](docs/plans/V8.20-TOPIC-AUTH-CLEANUP.md).
At that stage the inline refinement check was the next proposed slice. This does not
change permissions or the accepted open-endpoint posture below.

**3 November 2026 — characterization, not convergence:** the
[access-control pilot](docs/reference/ACCESS-CONTROL-MATRIX.md) tests the real
shared helper and draft-outreach-topic/discuss-outreach-draft gates with signed
sessions, plus relevant actual Firebase rules. That QA-only batch left app/auth/rules unchanged.
Keep method/config ordering and profile-error contracts when separately
authorizing the first single-endpoint migration. Node helper consolidation is
still separate. See the [QA record](docs/plans/V8.20-ACCESS-CONTRACTS.md).

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
`lib/auth.js` when next touched. The 10 functions that already used the shared
helper were retagged `requireFrontOffice` → `requireModule(req, key)`.

**V8.14 code-review follow-up (2026-09-03):** the mechanical migration keyed
several AI/OCR-assist fns to `'quotes'` (the ex-`sales` proxy) even though their
only callers live in other modules — over-restriction, dead features for the
staff meant to use them. Corrected: `process-quote` → `supply`, `extract-pi` →
`shipping`, `compose-message` → `customers`, `generate-marketing-copy` /
`rewrite-section` → `['products','figurine','marketing']` (called from product +
figurine + blog pages), `scrape-images` → `figurine`. And three fns that were
still `requireAdmin` despite a grantable module: `extract-po` → `supply`,
`woo-sync` / `seo-state` → `woo`. `requireModule` now accepts a string OR an
array of keys (any-match). **When retagging an edge fn, grep its `/api/<name>`
callers and use the route `<Gate module>` they sit behind — not the old role.**

V8.12 added a *third* shape: `erp.js` now has `getRole()` (returns the
role string, not a bool) because it needs to distinguish `production` from
`admin`, not just gate on admin. If more functions ever need role-aware
(not admin-only) auth, `lib/auth.js` should grow a `requireRole()` /
`getRole()` rather than each one re-inlining the Firestore REST read.

**Where:** compare any inline `isAdmin()` / `isFrontOffice()` block against
`netlify/edge-functions/lib/auth.js`; `erp.js`'s `getRole()`.

## RBAC — client capability map vs server rules can drift

**3 November 2026:** a bounded human-role matrix now covers the actual client
permission functions, shared helper, two Daily Drafts AI endpoints and relevant
Firestore/Storage read/create gates. It confirms marketing versus customers
ownership, with service identities and lifecycle checks explicitly outside
scope. It reduces this pilot's regression risk; wider multi-file drift remains
open. Both required CI jobs include the new suites. See
[ACCESS-CONTROL-MATRIX.md](docs/reference/ACCESS-CONTROL-MATRIX.md).

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

`qa/rbac-rules.test.mjs` covers Firestore and Storage — not the edge function
or the UI map. Adding a module to `access.js` without
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
`docs/plans/PRODUCT-VARIANTS-PLAN.md` §4.11), not fixed there because it is unrelated to
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

## Production-order reserve — deferred asks from XiangXia (2026-09-10)

Two items from her screenshot report (`~/Desktop/app问题.xlsx`) were fixed in
V8.15 (PU description line breaks; loose component lines now reserve — **L-19**).
Four were logged and **not built**, because each is a real behaviour change to
the reserve/consume flow, not a quick fix:

1. **Per-run BOM override.** "有些产品不是标配，需修改内容" — some builds
   deviate from the Range BOM for one order. Today the reserve list is derived
   purely from `range_products.critical_components` via `mrp.computeRequirements`;
   there is no per-order add/remove/adjust. Needs a stored override on the order
   doc that `computeOrderIssue` layers on top of the explosion.
2. ~~**Editable reserved quantity.**~~ **DONE — V8.15.** Inline qty edit on the
   reserved Component / Crystal / Packaging panels via `adjustReservedLine`
   (`orderStock.js`) + `EditableQty.jsx`. See `docs/plans/RESERVE-QTY-EDIT-AUDIT.md`.
3. **PO list — JES-duplicate check.** Flag app POs whose PU/supplier/items
   already exist in JES (`PurchaseOrders.jsx`). A "Check app POs for JES
   duplicates" link already exists — she wants it to actually surface the
   overlapping rows.
4. **PO list — sort by PU number.** `PurchaseOrders.jsx` currently sorts by
   date; add a PU-number sort.

## Browser WhatsApp import can still blow the 1 MiB Firestore doc cap

The **browser** import path — `WhatsAppImport.jsx` → `importWhatsAppZip` →
`uploadAttachments` (`src/domain/whatsappImport.js`) — still writes
`attachment_url` **inline** into `messages[]`. A large *manual* import (a group
with thousands of messages plus media, e.g. Prestige x UA: 5,257 msgs / 2,091
attachments) would therefore exceed Firestore's 1 MiB per-document cap and fail
the write.

The **server-side** path already handles this: `scripts/upload-whatsapp-media.mjs`
spills the URLs to `whatsapp_threads/{id}/media/urls` when the inline doc would
exceed the cap, and `CustomerDetail.jsx` reads that fallback. The browser path
was not given the same treatment, so a large manual import remains broken while
the weekly auto-import (manifest-driven, server-side) is fine.

Fix: route the browser's `uploadAttachments` through the same media-doc spill —
project the doc size before the transactional write and, on overflow, write the
URLs to `media/urls` leaving `attachment_url` null. Not done because manual
imports of big groups are rare and the auto-import covers the real workflow.

**Where:** `src/domain/whatsappImport.js` (`uploadAttachments`),
`src/pages/WhatsAppImport.jsx` — compare with
`scripts/upload-whatsapp-media.mjs` and `src/pages/CustomerDetail.jsx`.

## `SIMPLIFIED_JA` is still a hand-curated list

L-49 replaced the zh-hant `SIMPLIFIED` guard with a derivation from OpenCC and a
`--check` that fails on drift. The **ja** guard next to it (`SIMPLIFIED_JA` in
`seo-control-plane/validate-payload.mjs`) is still hand-curated — it came from
B54, where reusing the zh-hant set false-flagged ordinary Japanese kanji, so it
was narrowed by hand to the PRC-only subset.

That is the same shape of risk L-49 just demonstrated: no way to say whether any
given character belongs, and no measurement of coverage. It is *not* the same fix
— Japanese kanji are not a simplified/traditional mapping, so OpenCC's
`STCharacters.txt` can't derive it the way it derives the zh-hant set; a
plausible route is the set of characters OpenCC maps *into* Japanese-specific
forms, or a ja dictionary (e.g. `JPVariants`/`JPShinjitaiCharacters`).

Left alone because it is lower-traffic and the failure mode is a false flag on
correct ja text rather than a silent pass of Simplified text — but it is the next
one to measure rather than trust.

**Where:** `seo-control-plane/validate-payload.mjs` (`SIMPLIFIED_JA`),
`docs/skills/LESSONS-LEARNED.md` L-49 (the zh-hant precedent).

## Resolved — lead interaction history collection-scoped date index

The pre-existing missing COLLECTION_DESC index was reproduced on unchanged
production before the CRM extraction. The enquiries.date override had retained
only group indexes, disabling listInteractions' date-desc collection query.

Resolved 1 November 2026: both collection directions restored and READY, both
group indexes preserved, all 47 existing lead histories and the 358-row ordered
group query verified. The viewer now exposes failure/Retry and ignores stale
requests. Fresh candidate/production admin and customer checks pass on source
d99b8fc4 after both required GitHub jobs passed. Query paths, records and rules
are unchanged. [Repair and release evidence](docs/plans/V8.20-LEAD-INTERACTION-HISTORY.md).

## Workspace emulator stall — deadlines repaired, intermittent trigger open

**3 November recurrence:** [run 41475038991](https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/41475038991)
now locates this occurrence at case 21's final Web SDK `read original cache`
verification, after both actual pages loaded all selected periods. The named
15s guard failed and blocked the release. That audit-only assertion now uses an
independent emulator Admin SDK server read; its expected value, real page SDK /
listeners / rules and all deadlines remain. All 63 local cases pass. Both
required jobs pass on repaired 671f5e51
in run 41477279696, attempt 1. Deliberately changed server data still fails the
original assertion in the isolated fault check. The audit no longer depends on
the UI watch stream; the underlying intermittent
SDK stall mechanism is still unconfirmed. See the
[investigation update](docs/plans/V8.20-WORKSPACE-CI-RELIABILITY.md) and
[refinement release gates](docs/plans/V8.20-REFINEMENT-AUTH-CLEANUP.md).

Observed 2 November 2026 in first attempts of runs
[41376548278](https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/41376548278)
and [41383016404](https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/41383016404).
Rules/earlier suites and workspace cases 1–20 passed, then no further case was
reported before the 10-minute job cancellation. Unchanged-SHA retries passed
both required jobs, and the complete local emulator command passed during the
Sent release. Neither presentation extraction changed the workspace tests,
Dashboard or CustomerDetail. The cause/location of the stall is unconfirmed;
the last log line alone does not prove which setup, assertion or cleanup hung.

Separate QA reliability investigation: reproduce/isolate the transition after
case 20 and the following fixture/setup, instrument asynchronous waits and
cleanup, and use bounded diagnostics without replacing real stateful hooks or
skipping assertions. Do not just extend the CI timeout or treat retries as the
repair. All exact-SHA release gates remain mandatory. Recorded separately to
preserve the behaviour-only scope of the standing-rules extraction.

**Where:** qa/customer-workspace-sync-emulator.mjs,
qa/customer-workspace-sync-fixture.mjs, qa/local-day-clock.mjs and
.github/workflows/product-search.yml. Evidence:
[standing-rules release](docs/plans/V8.20-DAILY-DRAFTS-STANDING-RULES-CLEANUP.md).

Owner-approved investigation on 2 November could not reproduce the original
trigger in ten unchanged Node 22 runs, the complete local sequence or the
instrumented Linux run (both jobs passed first attempt). Confirmed unbounded
wait/process defects are now repaired locally with named 15s steps, a 45s case
bound and an independent 90s parent watchdog; eight guard regressions preserve
failures and verify worker cleanup. Final QA source 31dbd725 passed both jobs
first attempt in run 41407404097, with every page/timezone case retained and
zero failures/skips. Production is unchanged. The original trigger
remains open; fail-fast guards are not evidence that it cannot recur:
[active investigation](docs/plans/V8.20-WORKSPACE-CI-RELIABILITY.md).

The shipping documentation closeout 4ca351b2 later failed in the Los Angeles
workspace run (41493089982): a second task was missing before any calendar
advance. This differs from the earlier final audit-read stall. The QA-only
fixture now resets the real page client/cache as well as emulator data, with
a regression that fails against the original shared-client fixture. All old
case bodies/assertions, timezones and deadlines remain; application/rules and
the verified shipping deployment are unchanged. This closes a confirmed test
isolation gap, not a proven root cause of every intermittent SDK failure.
QA source 97547527 passes both required jobs first attempt in run 41495678616,
including all 67 Linux guard/page/timezone cases and later emulator suites;
release:ci -- --wait passes. No application redeployment was made for this fix.
See the [3 November investigation](docs/plans/V8.20-WORKSPACE-CI-RELIABILITY.md#3-november-documentation-closeout-failure--reset-the-page-client-too).

## Keeping this current

Add an entry when you notice something like this in passing during
unrelated work — dead code, an inconsistency between two similar modules, a
gap that isn't urgent but would waste time if rediscovered cold. Remove an
entry once it's actually been fixed (or note it was fixed and why it's still
worth knowing about, if that's useful context).

## Saved-order concurrent editing resolved — 9 November 2026

Versioned root/line batches, coherent server loading and device draft retention are released. Invoice ownership writers participate; stock flags retain their own ownership. [Migration and evidence](docs/plans/V8.20-SAVED-ORDER-CONCURRENT-EDIT-FIX.md). Durable cross-system financial synchronization remains a separate review, and unreleased local order-creation recovery is outside this release.
