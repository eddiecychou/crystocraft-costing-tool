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

## ShipmentForm mixes presentation with workflow orchestration — first slice extracted

3 November 2026: ERP comparison and stock badge presentation now live in
components/shipping/ShipmentReconciliation.jsx, leaving the parent 64 lines
shorter. Exact restoration and before/after component/visual tests retain current
behaviour; all calculations, subscriptions, adoption and financial/stock writes
stay in the page. Both exact-SHA jobs, full build and fresh candidate/production
role/shipping checks pass; released as 8551bc98. This is partial cleanup, not resolution of the entire large
form. Further sections need separate bounded slices. See
[current release status](docs/plans/V8.20-SHIPMENT-DISPLAY-CLEANUP.md).

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
See the [3 November investigation](docs/plans/V8.20-WORKSPACE-CI-RELIABILITY.md#3-november-documentation-closeout-failure--reset-the-page-client-too).

## Keeping this current

Add an entry when you notice something like this in passing during
unrelated work — dead code, an inconsistency between two similar modules, a
gap that isn't urgent but would waste time if rediscovered cold. Remove an
entry once it's actually been fixed (or note it was fixed and why it's still
worth knowing about, if that's useful context).
