# Crystocraft Corporate Gift Costing Tool — Project Plan

> **Canonical plan lives in Obsidian:** `Crystocraft/Operations/Costing Tool - Project Plan.md`
> and `Costing Tool - Issues & Bugs Log.md`. This in-repo copy is a convenience snapshot.

## Current Status — V7.11 CLOSED as of 2026-07-09

**Deployed to Netlify (live `4e9af3f`).** CRM pipeline/fulfilment split + a
manual (non-AI) image editor with crop/rotate + a new **Production module**
(renamed from Shipping) carrying a light-MRP Component Requirements report +
a real bug hunt across PI save/reconciliation/packing that turned up and
fixed four separate root causes. Commit chain on `main`: `6153ceb` →
`5363988` → `1e51845` → `149a3c5` → `8e37f83` → `1cbfcf6` → `a8c3e44` →
`97a3143` → `8ce7c3e` → `cc82008` → `be856c3` → `21a9473` → `85588bd` →
`7c27f03` → `1d3e4b9` → `d6ac1ff` → `ba9e600` → `4e9af3f`.

**V7.12 begins fresh in a new conversation.** No open threads from V7.11 —
every fix in this batch was headlessly tested (pure-logic modules) or
build-verified; the handful of purely-visual pieces (crop drag feel, table
layout) were confirmed live by the owner. Next likely focus: **MRP Phase 2 —
deduct component stock on order confirmation** (idempotency + negative-stock
decisions flagged, not yet made), or a fresh bug/feature batch as raised.

### CRM: sales pipeline vs. order fulfilment (Dashboard, CustomerDetail, EnquiryForm)
- **Root problem:** a customer with a live production order *and* a separate
  new-order enquiry only showed one of the two on the Dashboard — every
  customer was collapsed to their single "latest" enquiry before any stat
  card saw the data, so whichever thread wasn't newest was silently hidden.
  Separately, production status lived on a dated interaction-log entry, so
  "closing" a production job meant editing history — which a time-based log
  should never require.
- **Fix — Dashboard cards now read from the right source per concern:**
  **In Production** and **New Orders — 30 Days** are now **order-based**
  (`orders` collection, status Confirmed/Packing/Ready and PI date in the
  last 30 days respectively) instead of enquiry-based, so a customer can
  appear in both cards independently and closing a job = marking its order
  **Shipped** (in the Shipping/Production module) — no log editing, ever.
  **Pipeline** stays enquiry-based but is now deduped *within* each status
  class rather than globally, so parallel threads never hide one another.
  Follow-ups are task-driven (any thread with a due date surfaces, latest or
  not).
- **Interaction-log status redesign:** trimmed to a pure sales-pipeline
  vocabulary — **Open / Quoted / Confirmed / Lost / On Hold** — dropping
  **In Production** and **Completed** (those are fulfilment, now owned
  exclusively by the Order). Confirmed/legacy terminal states sort into a
  **History** section below still-active threads (active pinned on top,
  each group newest-first). Fixed a pre-existing bug where **Confirmed**
  rendered as a plain grey badge instead of green ("won").
- **Topic tags** (thread labels: General/New Order/Production/Support) were
  built, shipped, then removed same-session per owner feedback ("very
  distracting") — the active/history pinning and dashboard fix, which
  actually solved the reported problem, were kept.
- **Lesson:** a flat, date-sorted log conflates *when something happened*
  with *what state it's in* — resolving one thread's status must never be
  able to visually or structurally bury a different, still-open thread.
  Production/fulfilment state belongs on the entity it describes (the
  Order), not on a diary entry about it.

### Image editor: manual Adjust tab + crop/rotate (non-AI)
Built in response to the AI enhance/background tool being unpredictable,
slow (~30s edge-function ceiling), and overkill for small touch-ups —
deterministic pixel edits don't need AI at all.
- **Stage 1 — Adjustments** (`src/components/ManualAdjust.jsx`, new): live
  Brightness / Contrast / Saturation / Warmth / Sharpness sliders with
  before/after preview and Reset, rendered via canvas (`ctx.filter` for the
  first three, hand-written pixel passes for warmth + unsharp-mask
  sharpen — both covered by headless pixel-math tests). Wired as an
  **"Adjust (manual)"** tab alongside AI enhance in **both** image editors:
  the shared corp-gift/component `ImageGallery` and the figurine `RangeForm`
  (which has its own separate modal — would otherwise have been missed).
- **Stage 2 — Crop & rotate**: added `react-easy-crop` (interactive drag
  delegated to a proven library) + a new pure `src/imageCrop.js`
  (`getCroppedCanvas`, rotation/bounding-box math — headlessly tested) for
  aspect presets (Square/4:3/3:4/16:9/Original), 90° rotate, and a ±45°
  straighten slider. **Two follow-up bugs caught after initial ship:**
  the library's required CSS was never imported (cropper mounted unstyled,
  undraggable) — fixed with one import line; and a `fetch(src)` CORS block
  meant the editor couldn't load images at all — fixed by loading via a
  `crossOrigin` `<img>` (the same approach the AI path already used) with a
  same-origin `/api/image-proxy` fallback.
- **`image-proxy` allowlist widened** to `crystocraft.com` (WordPress) in
  addition to Firebase Storage — figurine photos imported from the
  catalogue blog live there and the proxy fallback was 403-ing on them.
- **Corp-gift component (BOM) images could never reach any of this** —
  `ComponentDetail.jsx`'s `ImageGallery` never had the `enhanceable` prop set
  (unlike the main product gallery), so those images had no edit button at
  all. Added.
- **Scroll position preserved across an image edit** (`ImageGallery.jsx`):
  captured on open, restored on close (Keep/Save-as-new/Discard/✕/backdrop),
  so replacing one image doesn't bounce the whole product page back to the
  top — lets you edit a gallery one image at a time.
- **Corp-gift product list** (`Products.jsx`) ported the figurine list's
  proven **id-based `scrollIntoView`** restore (was a fragile pixel
  `scrollTop`) — returning from a deep edit (e.g. Pricing) now lands back on
  the exact product card instead of the top of the list.

### Production module (renamed from Shipping) + Component Requirements (light MRP v1)
- **"Shipping" → "Production"** label rename (nav + page heading) — this
  module is now more production-planning than shipping-only. Route path
  `/shipping` and the internal `ShipmentForm` component name were
  deliberately left alone (invisible plumbing; renaming risks breaking
  links for no user benefit). Later, all remaining user-facing "Shipment"
  wording on the order page (title fallback, back link, save/delete
  buttons, error messages) was cleaned up to "Order" for the same reason —
  a half-renamed term is more confusing than an unrenamed one.
- **New "Requirements" tab** (`src/pages/ComponentRequirements.jsx` +
  pure engine `src/mrp.js`): select one or more confirmed PIs → explode
  each figurine line into its critical components (plating-aware, parsed
  from the item code) → aggregate gross requirement per component code
  across all lines/PIs → deduct current stock → shortage-to-order report,
  worst-first, with a shortages-only toggle and CSV export. **Read-only v1
  — no stock is mutated** (deduct-on-confirm is Phase 2, deferred by design
  per owner: no separate WIP-warehouse/reservation layer, matching the
  "revert to a single stock number, deduct on confirm" decision).
- **"Always needed" BOM scope** (`all_variants` flag, `criticalComponents.js`):
  fixed a real modelling gap — some figurine parts are fixed-finish but
  required on *every* variant (e.g. a gun-colour base), which the existing
  plating-inference logic wrongly treated as "only for that plating's SKU"
  and filtered out of other-plating orders. The new explicit scope overrides
  the inferred plating; centralized into `refScopePlating`/`refApplies` so
  MRP, `buildableFromComponents`, and `rangeCosting` all agree (previously
  each had its own copy of the plating filter).
- **"Not in product range" flagged loudly**: a PI line whose item code looks
  like a real figurine SKU but matches no product now surfaces in a **red**
  panel (code · qty · PI · description) instead of disappearing into the
  same quiet bucket as genuine non-figurine (corp-gift/charge) lines.
- **Reconciliation matcher bug (the real root cause of most of the above
  looking broken):** `matchRangeProduct` matched on the **design core only**
  and ignored `format_code`, so two different products sharing a design
  number (e.g. `D0355-001` "Mini Rose Freestand" vs `D0355-230` "Mini Rose
  with Crystal Bible") collapsed to one match key and picked a match
  arbitrarily — reconciliation had been silently linking some PI lines to
  the wrong product. Unified reconciliation with the same format-aware
  `matchProductCode` already used by the stock-list import and MRP (one
  matcher, no drift); `loadRangeProductsLite` was also missing
  `format_code` entirely, which would have silently defeated the fix.
  MRP itself is robust to this even for **already-saved** bad matches — it
  re-derives each line's product from the item code (unless the user
  explicitly confirmed a manual match).
- **"Re-match" button** on PI reconciliation: re-runs auto-match with the
  corrected matcher on an already-loaded PI, preserving any line the user
  classified manually — the one-click fix for PIs matched before this
  patch.
- **Blank product names in reconciliation + MRP:** range products have no
  dedicated name field — the display name is entered via **Description**
  (confirmed by RangeForm's own code comment: no separate name input
  exists). `loadRangeProductsLite` built its name from legacy
  `design_name`/`name` fields only, never checking `description`, so any
  recently-created product came back blank and reconciliation showed the
  confusing literal word **"matched"** instead of a name. Fixed in both
  `loadRangeProductsLite` (reconciliation) and a new shared `productLabel()`
  helper in `mrp.js` (the "Used by" column had the identical gap).
- **Orders tab** (was "Shipments"): rebuilt as a proper staff-facing table
  — Order Date · PI # · SO # · Customer · Currency · Order Value · Status —
  sorted by order date, row-click to open.
- **Order Value showing blank for some PIs:** the on-screen "Order Totals"
  card computes a subtotal/discount/total live from line items but never
  persisted it — `total_amount`/`subtotal` only got written when the PI
  extraction happened to capture a stated total from the PDF. Extracted the
  calculation into a shared `computeOrderTotals()` and both save paths now
  fall back to it when no PI-stated total exists. Existing blank orders
  need one re-save (open + Save Changes) to pick it up.
- **Packing list showing `NaN kg GW`:** `parseFloat('') ?? parseFloat(x) ?? 0`
  doesn't work as a fallback chain — `parseFloat` returns `NaN`, not
  `null`/`undefined`, so `??` never triggers and an unset "actual weight"
  (the normal not-yet-entered state) poisoned the whole shipment's running
  total. Fixed with explicit `Number.isFinite` checks at each step.

### PI Save button hanging forever
Reported as "button hangs but the PI **is** saved" — two distinct root
causes, found in sequence:
1. **First fix (real, but not the reported bug):** with `persistentLocalCache`,
   a Firestore write promise resolves only on server ack, though the write
   is durable in the local cache immediately — a network stall could hang
   the button forever even though the order was safely cached. Added a
   `raceWrite` helper (proceed after a 6s grace period; still surface a fast
   rejection as an error).
2. **Actual cause:** `/shipments/new` and `/shipments/:id` render the same
   `<ShipmentForm>` with no `key`, so React **reuses the component instance**
   across the create → edit navigation instead of remounting it — the
   `saving` state flag, which relied on unmount to reset, simply never
   cleared. Fixed with a `finally { setSaving(false) }`.
- **Lesson:** the first fix was a plausible, well-tested guess that didn't
  match the actual symptom closely enough — confirmed live by the owner as
  still broken, which is what surfaced the real (structural, not
  network-timing) cause. Worth remembering: "hangs but the data is saved"
  is more often a stuck UI state than a stuck promise.

---

## Current Status — V7.10 CLOSED as of 2026-07-08

**Deployed to Netlify (live `0ad1f23`).** A pre-launch bug batch + Portal account
management rework + customer email notification system + account activity tracking +
an expanded, tabbed Schema Audit + an image-enhancement reliability fix. Commit chain on
`main`: `2a2ab7f` → `2a3fb2f` → `6a6b1af` → `a1b308d` → `8ae50b4` → `09bd6f4` → `49594ec`
→ `b631b12` → `4edc8a2` → `00761a7` → `0ad1f23`.

**V7.11 begins fresh in a new conversation.** No open threads from V7.10 — all fixes
verified via build + headless smoke tests and confirmed live (email system tested
end-to-end by the owner). Next likely focus: **Supplier Module A-0** (spec held from
earlier sessions), or a fresh bug/feature batch as raised.

### Portal account management (`CustomerAccounts.jsx` rewrite + new `AccountEdit.jsx`)
- **Accounts list** is now a compact, clickable list showing the **linked CRM
  customer's name** (falls back to the account's own), the full **login email**,
  **country**, and a **Customer / Internal** category badge. Row → opens the edit page.
- **New edit page** `/portal/accounts/:id` holds all per-account settings that used to
  crowd the list row: link-to-customer, account category, currency, fixed FX, Figurine
  WS %, Corp markup, plus the lifecycle actions. Shows the account **UID** (for
  reconciling duplicates against Firebase Auth).
- **`account_type`** field on the `users` doc (`customer` | `internal`, default customer,
  no migration) + a **type filter** on the list.
- **New `suspended` status + Suspended tab.** Suspend moves a customer out of the active
  list (reversible via **Restore**, keeps their settings) instead of dumping them back
  into Pending.
- **Delete** lives only on the edit page and works for any **non-self** account
  **including admins** (self-delete guarded). Enables removing orphaned/duplicate `users`
  docs in-app. Firestore rules already allow admin delete.
- **Duplicate-email flag** on the list. Root cause of "duplicate accounts": `users` is
  keyed by Auth UID and Firebase blocks a second password signup on the same email, so a
  duplicate = an **orphaned `users` doc** (old Auth deleted but doc left, or a
  console-created stub). Reconcile by keeping the doc whose ID == the Auth UID.
- **Mobile:** the tab strip (Pending/Customers/Suspended/Admins) horizontal-scrolls.

### Auth self-heal (`App.jsx`)
- A signed-in Auth user with **no `users` doc** now auto-creates a pending-customer doc
  on sign-in (allowed by the self-create rule; stamped `self_healed: true`) so they appear
  in Pending for approval. Fixes "has a login but is invisible to admins." Note: an admin
  cannot create a doc for another UID (rule is self-only) — the user must sign in once.

### Signup pending-screen fix (`Login.jsx`)
- Removed the post-signup `signOut`; new signups stay signed-in as pending and land on the
  "Awaiting approval" screen instead of flashing back to the login form.

### Customer email notifications via Resend (new)
- **`netlify/edge-functions/send-email.js`** (`/api/send-email`) + **`src/notify.js`**
  (`notifyEmail`, fire-and-forget). Events: **enquiry** (customer confirmation with item
  table + admin alert), **account_approved** (customer), **signup** (customer + admin).
  Branded HTML templates, **reply-to routing** (customer mail → sales inbox; admin alerts →
  the customer). Triggers in `EnquiryPage.submit`, `Login.handleSignUp`, `AccountEdit`
  approve. Dormant until `RESEND_API_KEY` is set (returns `skipped`).
- **Env vars:** `RESEND_API_KEY` (secret), `MAIL_FROM` (`Crystocraft <noreply@crystocraft.com>`),
  `MAIL_ADMIN`, `MAIL_REPLY_TO` (optional), `PORTAL_URL`.
- **Domain `crystocraft.com` verified in Resend** (Tokyo region) via DKIM `resend._domainkey`
  + `send` MX/SPF at host DNS (existing mail untouched). **All 4 email types confirmed live.**

### Image enhancement timeout fix — two rounds (`enhanceImage.js` new, `ImageGallery.jsx`, `RangeForm.jsx`)
- The `Unexpected token 'h'… JSON` error is a **Netlify edge-function timeout** (not a
  token/quota limit) — `gemini-2.5-flash-image` is a slow, unpredictable job running against
  a hard **~30s edge-function ceiling**; when it loses that race, Netlify (not our code)
  returns a plain-text error that broke a blind `res.json()`.
- **Round 1** fixed only the corp-gift path (`ImageGallery.jsx`): downscale the source to
  max 1536px/JPEG q0.9 and send inline (skips the server-side Storage fetch) + defensive
  text-parse for a legible message.
- **Round 2** found the **figurine editor (`RangeForm.jsx`) had its own separate, unfixed
  copy** of the same handler — hence the bug "still happening often" even on a small
  (1000px/500KB) image, since that path still blind-parsed JSON and had no downscale.
  Extracted one shared **`enhanceProductImage()`** (`src/enhanceImage.js`) used by both
  `RangeForm` and `ImageGallery` so they can't drift apart again; added a **one-time retry
  on timeout** (the model is intermittently slow — a retry recovers most transient cases).
  Model output res (~1024px) is unchanged and Keep stores ≤1800px, so the **≥1000px
  standard is preserved**.
- **Ceiling not eliminated** — a hard architectural limit remains (Netlify edge functions
  cap at ~30s regardless of code). If timeouts recur often after this fix, the real cure is
  moving enhancement to a Netlify **background function** (up to 15 min budget, client
  polls for the result) or a small **Fly.io** service (long-running, no platform-imposed
  time limit) — not attempted this round.

### Mobile layout fixes
- `RangeCosting.jsx` crystal-BOM rows stack full-width on mobile (were clipped by
  `<main>`'s `overflow-x-hidden`, hiding the dropdowns).
- `Components.jsx` tab strip is horizontal-swipe only (`overflow-x-auto overflow-y-hidden`);
  list rows stack so component names aren't crushed by the fixed-width stock stepper.
- `CustomerAccounts.jsx` Pending/Customers/Suspended/Admins tab strip is horizontal-scroll
  only — was overflowing/clipping on narrow phones.

### Account activity log (`AccountEdit.jsx`, `Login.jsx`)
- New **Activity** card on `/portal/accounts/:id`: **Registered** date, **Last sign-in**,
  **Sign-in count**, and the account's full **enquiry history** (date, item count,
  estimated total, status) — the strongest signal for "should I follow up with this
  customer?". `Login.handleSignIn` stamps `last_login_at`/`login_count` on the `users` doc
  (self-update, fire-and-forget, never blocks login). No backfill — login tracking starts
  from this deploy; enquiry history is complete (pre-existing data).
- Known limits (accepted): no IP/device/session-duration (would need Admin SDK); "last
  sign-in" only reflects explicit logins, not session activity.

### Schema Audit — pre-launch checks, review lists, and a tabbed/collapsible redesign (`SchemaAudit.jsx`)
- **Missing-components check, split by consequence**: Last Stock with no components =
  **error** ("availability comes only from remaining part stock → shop shows it SOLD OUT");
  Made to Order with no components = **warning** ("sellable at a default lead time, but
  can't be costed"). Concept/Retired exempt. (Confirmed with owner: Last Stock availability
  IS component/part-stock-driven — this isn't a separate finished-units counter.)
- **Missing-images checks**: range products with no `gallery[]` AND no variant image
  (retired exempt) → warning; corp products with no `heroImage` (won't show a photo in
  listings) → warning.
- **"Last-stock-only components" review list** (info severity): components referenced
  *only* by Last Stock/Retired designs (excludes any also used by an MTO or concept
  product, and unused ones), each annotated with stock qty + lead time. Read-only —
  the hint explicitly warns that deleting these breaks the SOLD OUT signal, since
  last-stock availability is computed from component stock, not a separate counter.
- **Category tabs + collapsible groups**: the ~10 groups (was one long stacked list) are
  now organised under tabs — **Range Products, Range Components, Customers, Accounts,
  Corp Gifts, Orders** — each with an issue-count badge; only present categories show a
  tab. Each group card is **collapsed by default** (name/count/Copy only) and expands on
  click, so the page reads as concise instead of overwhelming.
- **Range Products split into separate cards** by lifecycle: **Range — Made to Order**,
  **Range — Last Stock**, plus **Range — Concept** / **Range — Retired** shown only when
  those exist — so findings route to the right staff by product type.
- **Per-group Copy button** on every card (in addition to the page-level "Copy report"):
  copies that group's **entire** issue list as plain text — including rows past the
  on-screen 100-row display cap — so a colleague gets the full list even when truncated
  on screen.

---

## Current Status — V7.7.1 as of 2026-06-24

**V7.7.1 deployed to Netlify (commit `5d04b7d`).** Live at https://ua-product-manager.netlify.app

### V7.7.1 — Crash fix + page error boundary (2026-06-24)
- 🔴 **White-screen crash opening any existing figurine card** (`5df607a`). The `formPlatings`
  `useMemo` added in V7.7 read `form.variants` while `form` is `null` (existing products load
  async); hooks run before the `if (!form) return` / `if (fetching) return <LoadingBar/>`
  guards, so it threw on first render — blank screen with **no loading bar**. New products were
  fine (`form` starts non-null). Fixed with `form?.variants`. **Third V7.7 regression** — all
  runtime-only, all shipped green (sandboxed CI can't run a live preview).
- 🟢 **Page-level error boundary** (`5d04b7d`, `src/components/ErrorBoundary.jsx`). Wrapped the
  `<Routes>` inside both the admin Layout (`home="/dashboard"`) and customer Storefront
  (`home="/shop/figurine"`). A render/lifecycle throw now shows a recoverable fallback card with
  the error message (nav intact) instead of unmounting to a white screen; resets on navigation
  via a `pathname` key. Caveat: does not catch async errors in handlers/promises.

**Lessons**: a thrown hook beats every guard — hooks run before any early `return`, so new
top-of-component hooks must tolerate not-yet-loaded state (`form?.x`). Build-passing ≠ working
for runtime crashes; a page error boundary is the cheapest net when CI has no live preview.

### V7.7 — Plating-specific critical components (2026-06-24)
Figurine metal parts that differ by plating (e.g. Gold `…-G` and Chrome `…-C` carry
**different ERP item codes, stock, and cost**) can now be wired to the specific plating
variant they belong to. Solves two problems: (1) component-level stock directed to the
relevant plating; (2) costing wires the right component cost to the right variant.

- **Data model (backward-compatible, no migration):** each ref in a product's
  `critical_components[]` gains an optional `plating_code`. Blank = applies to **all
  variants** (shared parts — bodies, NFC chips, boxes). Tagged = applies only to the
  matching plating variant. Existing untagged products behave exactly as before.
- **Costing (`rangeCosting.js`):** `componentsCostHKD` / `toolingHKD` now take the
  variant and filter refs by `plating_code`, so the per-variant cost table charges the
  correct plating's part and **tooling is no longer double-counted** across platings.
- **Stock & lead promise (`criticalComponents.js`):** `buildableFromComponents` and
  `makeLeadWeeks` are now plating-aware with **"soonest plating wins"** semantics — a
  zero-stock Chrome no longer poisons the Gold buildable/lead. Per-plating buildable is
  summed and **capped by the shared-parts ceiling** (shared body stock is finite). No
  plating tags ⇒ behaviour byte-identical to before.
- **Editor UI (`RangeForm.jsx`):** each selected component row has a **plating-scope
  dropdown** (All variants / Gold / Chrome / …) and a **clone (+) button** that defaults
  the copy to the first unused plating. Rows now carry a stable ephemeral `_uid` (form-
  only, stripped on save) used as React key + mutation target.
- **Costing breakdown (`RangeCosting.jsx`):** each row shows a plating badge.

**Bugs found & fixed in the same session** (post-first-push review, commit `a39e060`):
- 🔴 Stock/lead functions were NOT plating-aware in the first push (`6b8765b`) — a
  product with 500 Gold + 0 Chrome parts wrongly reported **0 buildable (bottleneck:
  Chrome)**. Now reports **100 buildable** (capped by the shared body). Costing itself
  was correct in the first push; only the production-signal functions lagged.
- 🟠 Clone/duplicate React-key collision (`refKey = id||code` matched two rows) → edits
  hit both rows + duplicate-key warnings. Fixed with the stable `_uid`.
- 🟠 Two refs for the same (component, plating) could double-count cost — clone now
  defaults to an unused plating to prevent it.

**Lessons** (full write-ups in the Obsidian Issues & Bugs Log):
- A "fix all surfaces" change must enumerate **every** consumer up front — costing,
  stock, lead, and UI are separate call sites; fixing the cost path while leaving the
  stock/lead path produces silent wrong numbers.
- Deriving a React key from business fields (`id||code`) breaks the moment one entity can
  appear in a list more than once; use a stable per-row id instead.
- Rolling a per-variant quantity into a single product promise needs an explicit rule
  (here: soonest plating wins, shared-capped) — don't let it default to an accidental min.

### V7.6 — Shipping/PI fixes, Quote margin, USD costing, Filter persistence (2026-06-24)
Bug-fix + polish pass on the Shipping (PI import) and Quote modules.
- **PI customer dropdown fixed** — `customers` collection keys on `company_name`, but
  ShipmentForm queried `orderBy('name')`; Firestore silently returns **zero docs** when no
  doc has the ordered field, so the dropdown was blank. Switched query/options/auto-match to
  `company_name`; dropped references to non-existent fields (`name_cn`, `default_incoterm`, `city`).
- **PI customer auto-link + inline "Add as new customer"** — fuzzy-match extracted name; if no
  match, one-click create a customer stub without leaving the import flow.
- **Marco Polo PI parses** — `gemini-2.5-flash` + `thinkingBudget: 0` (no 30s edge-fn timeout) +
  `maxOutputTokens: 16384`; discount/total rows no longer leak in as line items.
- **PI order totals** — subtotal/discount%/total card with computed-vs-stated subtotal check.
- **Quote margin = all-in** — tooling summed into `tooling_cost_hkd`; new All-in cost column =
  recurring + tooling/tier-qty; margin uses it per tier. (Re-add pre-V7.6 quote items to recompute.)
- **Figurine costing shown in USD** (engine still HKD, converted at view layer).
- **Product & Range list filters persist** across navigation via `sessionStorage` (`pf-*` / `rf-*`).

**Lessons** (full write-ups in the Obsidian Issues & Bugs Log):
- Firestore `orderBy(field)` is *also a filter* — drops docs missing the field, returns empty with no error.
- Thinking models + 30s serverless timeouts don't mix — disable thinking, don't down-tier the model.
- Convert currency at the view layer; amortise tooling into per-unit cost for correct per-tier margin.

---

## Current Status — V3.x as of 2026-06-23

**Live in production on Netlify (commit `5a95a13`, deployed 2026-06-23).**
Pre-costing stable checkpoint backed up on GitHub:
git tag `v3.1-pre-range-costing` (commit `c94f74b`) — `git reset --hard` to it to roll back
the costing work below.

### Bug fixes & UX improvements — deployed 2026-06-23 (this session)

- **Login fixed for all users** — root cause was a direct `netlify-cli deploy --prod --dir=dist`
  (local build) that bypassed Firestore's authorised domain list. Fixed by always deploying via
  `git push origin main` → Netlify GitHub integration. Lesson logged in the Issues & Bugs log.
- **Customer → PI Orders linkage** — CustomerDetail now has a **PI Orders** card that queries
  `orders` by `customer_id`, sorted newest first. Each row shows PI number, order date, currency
  and status badge, and links directly to `/shipments/:id`. **+ New PI** button opens ShipmentForm
  pre-filled with the customer (via `?customer_id=` URL param).
- **ShipmentForm customer pre-fill** — opening `/shipments/new?customer_id=...` now pre-selects
  the customer dropdown and resolves the name as soon as the customers list loads.
- **Bulk Category Editor — two bugs fixed:**
  - Filter dropdowns now show only categories that are actually present on products (no stale
    constants-list values like old "Figurines" mixed with current "Figurine").
  - Apply fields are now comboboxes (`<input list>`) accepting free-text entry — type a new
    name to bulk-rename a category across all selected products.
  - Filters auto-reset after a successful apply, so the product type filter works immediately
    without needing a manual clear (previously the stale `filterDesign` made it appear broken).
- **Corp Gift Products — mobile search layout** — filter row now stacks on mobile: search input
  takes its own full-width row, the two dropdowns share the row below side-by-side. No more
  squeezed search box on narrow screens.

### Range / Figurine Costing — BUILT & deployed (2026-06-22)
Cost a figurine from its critical components, mirroring corp gift. Opt-in per product —
products without a `costing` object keep their `ws_price_usd`; nothing recalculates
automatically.
- **Component-built cost** — `range_components` cost comes from a **supplier_quotes**
  subcollection (see next item). Product cost = Σ(component cost × qty) + extra lines.
- **Base + plating/crystal adders** — `costing.extra_lines` (assembly/packaging, all
  variants) + per-plating adder + per-crystal-colour adder; a multi-colour variant is
  costed at its dearest colour. Markup (per-product override, else pricing-group/default)
  → HKD sell price, using the corp-gift FX rates (`settings/exchange_rates`).
- **`rangeCosting.js`** — pure module mirroring `pricing.js`; volume-aware component cost,
  tooling amortised over qty, per-variant all-in cost → sell.
- **Costing page** `/range/:id/costing` (button in the figurine editor) — component cost
  breakdown, editable extra/plating/crystal adders, markup + quantity tiers, live
  per-variant cost & sell table, Save / Save & publish (writes `product.costing`).

### Supplier quotes with image + OCR on critical components — BUILT & deployed (2026-06-22)
The corp-gift supplier-quote flow, brought to figurine critical components.
- **`range_components/{id}/supplier_quotes`** subcollection — each quote has its own
  screenshots/PDF, AI-OCR-extracted unit cost, currency, MOQ, volume tiers and lead times.
  Reuses the existing `/api/process-quote` Gemini endpoint and image preprocessing.
- **Preferred quote** — star one; its cost is **denormalised onto the component doc**
  (`unit_cost`, `unit_cost_currency`, `volume_tiers`, tooling, `preferred_quote_id`) so
  `rangeCosting` reads cost with no subcollection fetch.
- **`RangeQuoteForm`** `/components/critical/:id/quotes/:quoteId` — drag-drop upload, OCR,
  volume tiers, preferred toggle, delete. The component editor lists quotes with a preferred
  star + attachment preview instead of a single manual cost.
- **Safe write** — saving the component editor writes descriptor fields only (merge), so it
  never clobbers quote-owned cost.

### Shipping & Logistics module — Phases 12.0 + 13.0 BUILT & deployed (2026-06-23)

First two slices of the Shipping module (full spec: Obsidian `Shipping___Logistics_Module_Spec.md`).

- **13.0 — Logistics vendor KB** (`/logistics`) — `logistics_vendors` CRUD with graded
  coverage tags (region + strong/OK/avoid + per-region modes), freight modes, incoterms,
  reliability rating (fragile-weighted), multi-contact, damage history. `freight_quotes`
  cost-history data layer (HKD-normalised) ready for bootstrap import (13.1). No standing
  rate cards (guardrail 7).
- **12.0 — Order/PI anchor + figurine PI import** (`/shipments`) — upload a figurine
  proforma invoice (PDF/image) → `extract-pi` Gemini edge function reads header + line
  items. Brand-agnostic SKU matcher (`stripBrand` core compare, like Crystal-Bible import)
  auto-links lines to `range_products`. Reconciliation screen classifies every line
  (Figurine / Corp Gift / Ad-hoc / Charge) with manual override; non-product = charge,
  excluded from packing. `orders` + `orders/{id}/lines` data layer. "Promote to catalogue"
  deferred per decision; corp-gift PI import out of scope v1 (Path A covers corp gift).
- **New collections** (admin-only Firestore rules added in console): `orders`,
  `packing_lists`, `logistics_vendors`, `freight_quotes`, `freight_rfqs`. New Storage paths
  `orders/*` + `freight_quotes/*` (pasted into Storage Rules tab). New edge function
  `extract-pi` registered in `netlify.toml`.
- **Next:** 13.1 WeChat freight-quote bootstrap, then 12.1 packing list (carton model).

### Catalogue Collections "Shop by" band — BUILT & deployed (2026-06-23)

Curated entry section above the product grid in both customer shops (Corp Gift + Figurine).

- **C0 — New In tag** — explicit `is_new` boolean on each product (checkbox in the editor),
  not date-based. Drives a green "New" badge + new-first sort. Immune to re-import/retire.
- **C1 — Admin CRUD** — `/catalogue-band` page. Per-catalogue switcher. Band settings
  (show/hide, columns, max tiles). Collection list with up/down reorder. Editor modal:
  title, subtitle, type (`filter` / `manual` / `smart`), filter value, manual product
  picker (search + tick + image), smart rule, accent palette, image mode, image upload,
  title colour (white/black), overlay colour (dark/light/none) + opacity slider.
- **C2 — Customer band** — `CollectionBand` component above the filter bar. Tiles are
  `aspect-square` (no label strip below); custom tiles: full-bleed `object-cover` image +
  configurable gradient scrim + label overlay; templated tiles: accent-tinted background +
  product image centred + label overlay. Tiles that resolve to zero products are hidden.
  Ragged-row rule: only show complete rows (< 1 full row → band hidden). Clicking a tile
  deep-links into the grid with an active collection chip + Clear button; category dropdown
  clears the collection.
- **Storage** — band images under `catalogues/band/…` (already in Storage rules allowlist).
  Tile + settings data in `settings/catalogue_band` (single doc, covered by existing
  `settings/*` Firestore rule — no new rule needed).
- **Live WYSIWYG preview** in the editor mirrors the customer tile exactly as you adjust
  overlay / title colour settings.
- **Visual fix (2026-06-23)** — all tiles are `aspect-square` on the card itself; label is
  an absolute overlay, not a strip below the image. Eliminates the height mismatch and the
  thin line that appeared under custom tiles against a lighter background.

### What's new since V3.0 (figurine / UX work, up to 2026-06-22)
- **WordPress image importer** (`/range/import-images`) — scans the catalogue blog pages
  via the `scrape-images` edge function and matches each photo to a figurine product by
  its item code, then bulk-adds matched photos to each product's gallery. Matching is
  **brand-letter agnostic** (a product stored as `D0002-230-C` still matches a photo named
  `U0002-230-CAB.jpg`) — compares on the `design-format-plating` core.
- **Variant image picker** — figurine variant images are picked from the shared gallery /
  uploaded / enlarged, with the image URL integrated into the picker (standalone "Image URL"
  field removed). Variant uploads/URLs auto-add to the gallery, deduped.
- **Range gallery click-to-enlarge** lightbox, matching corp-gift behaviour.
- **Corp-gift admin price fix** — admin product card always shows `price_hkd` (HKD); the
  legacy `sell_price` (old USD schema) is cleared on publish so stale values can't resurface.
- **Figurine list scroll restore** — returning from a product edit scrolls the last-opened
  card back into view instead of resetting to the top (`sessionStorage` `range-last-id`).
- **Mobile menu** — bottom bar keeps 4 primary tabs; "More" now opens a 4-column icon-grid
  sheet listing all 12 sections (grab handle + dimmed backdrop), reachable in one tap.

---

## Current Status — V3.0 as of 2026-06-06

**V3.0 is deployed to Netlify and live in production.**

### What's new in V3.0 (2026-06-06)
- **Blog / Content Generator** — AI-powered blog post writer with Spotlight (single product) and Roundup (multi-product) modes; publishes directly to WordPress as a draft via REST API
- **Blog: image compression pipeline** — all images compressed in-browser before upload (hero ≤400KB at 1200px wide, content ≤200KB); same-origin `/api/image-proxy` edge function bypasses Firebase Storage CORS
- **Blog: WordPress publishing** — uploads images to WP Media Library for SEO; sets featured image; creates Gutenberg blocks (heading, paragraph, image, gallery, spacer, button); all links open in new tab; white text on black buttons
- **Blog: per-section rewrite** — after AI generates content, each section has a "↺ Rewrite" button; type guidance (e.g. "more focused on banking clients") and AI rewrites just that section
- **Blog: product hyperlinks** — global CTA URL adds an enquiry button at post end; per-section/item URL links that block's heading and images only
- **Blog: customisable button text** — default "View Product →" / "Enquire Now →", overridable per post
- **Blog: SEO title** — AI no longer appends `| Crystocraft` (WordPress adds this automatically)
- **Blog: varied AI openings** — banned "Elevate", "Discover", "Introducing", "Transform", "Unleash" as openers
- **Product duplicate** — ⧉ Duplicate button copies product, all BOM components + their images, and product images
- **Product AI writer rewrite** — "↺ Rewrite with guidance" appears after generating marketing copy; same guided-rewrite UX as blog
- **Image gallery: orientation tags** — L/S/P toggle buttons on each image card; auto-detected on upload
- **Image gallery: image types** — Hero, Product Detail, Packaging, Lifestyle, Customisation, Client Ref
- **Volume price tiers on supplier quotes** — add multiple (min qty → unit cost) rows per supplier quote; pricing tier calculation auto-selects the correct component price for each order quantity; "Volume pricing active" badge shown
- **Mobile fixes** — product page header stacks vertically on mobile; blog CTA URL / Button Text fields stack on mobile; blog button removed from product page header to reduce overflow
- **Netlify secret scan** — public Firebase config keys exempted from scanner via `SECRETS_SCAN_OMIT_KEYS`
- **All blog edge functions registered** in `netlify.toml` for local `netlify dev` testing

### What's working end-to-end (V2.1 and earlier)
- Create and manage products with image galleries (hero image, type labels, lightbox)
- Build a BOM per product: add components, upload component images
- Record supplier quotes per component — AI extraction from WeChat/supplier screenshots via Gemini
- Mark a preferred supplier per component (enforced, single preferred only)
- Store supplier database with catalog PDFs/images
- Calculate pricing tiers with unit cost + tooling amortisation, margin colour coding, markup slider
- Build client quotes: pick products, set multiple qty/price tiers per product
- Export client quote to Excel (.xlsx) with embedded product photos, one row per pricing tier
- **Product Catalogue builder** — create branded A4 landscape catalogues with auto layout, drag-to-reorder images, cover page with background photo, print/PDF export
- **Supplier quote improvements** — searchable supplier combobox, delete quote, remove uploaded attachments
- **Drag-to-reorder** images in product and component image galleries
- **Pricing tiers shown on product cards** in the product list (HKD xx @ xxx pcs)
- **Rebranded** to "Crystocraft Product Management App"; Netlify site renamed to `ua-product-manager.netlify.app`; logo shown on login page; page title and OG tags updated
- Firebase security rules locked (Firestore + Storage)
- Deployed to Netlify with `GEMINI_API_KEY` set

### What's not done yet
- **Settings page** — exchange rates UI exists but is read-only placeholder; categories and user management not built
- **Client quote PDF export** — stubbed as "coming soon" in the Export modal
- **Dashboard** — no home screen; app opens directly to Products
- **Data migration** — products being entered manually

---

## 1. Problem Statement

Crystocraft's corporate gift business is growing rapidly, creating an explosion of new product concepts and supplier quotes that are currently tracked in per-client Excel sheets. Key pain points:

- No central product/concept database — the same product gets recreated across multiple client sheets
- Products are assembled from multiple components, each with 2–3 alternative supplier quotes — impossible to model cleanly in Excel
- Supplier quotes arrive as WeChat/WhatsApp screenshots, making data capture chaotic
- Hard to recall what products exist and their costs when responding to a new B2B enquiry
- Growing number of clients and concepts is consuming increasing mental energy

The core crystal figurine business (30+ years) is handled by an existing ERP and is out of scope for this tool.

---

## 2. Goals

1. Centralise all corporate gift products and concepts in one searchable database
2. Model each product as a Bill of Materials (BOM) — components + per-component supplier options
3. Capture supplier quotes with image attachments (screenshots, PDFs)
4. Use AI to extract cost/MOQ/lead time from supplier quote images
5. Calculate HKD sell prices across quantity tiers automatically
6. Generate clean client quote sheets quickly from the master product database
7. Support multi-user access (owner + 2 colleagues initially)

---

## 3. Scope

### In Scope (V1)
- Product/concept catalog with status tracking
- BOM per product (components + assembly notes)
- Supplier quotes per component with image upload + AI extraction
- Quantity-tier HKD pricing per product
- Client quote builder (select products → generate quote)
- User authentication (email/password, 3 users)
- Export client quote to Excel and PDF — both with embedded product photos, professional layout

### Out of Scope (V1)
- Crystocraft core crystal line (handled by ERP)
- CRM / sales pipeline tracking
- Inventory management
- WooCommerce / website integration
- Mobile native app

---

## 4. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React 18 + Vite + SWC | Same as Expense Tool; fast builds, consistent codebase |
| Routing | React Router v6 | Same as Expense Tool |
| Database | Cloud Firestore | `persistentLocalCache` for offline-first fast loads |
| Auth | Firebase Auth | Email/password + Google OAuth; same as Expense Tool |
| File Storage | Firebase Storage | Product images, component images, supplier quote attachments |
| AI Extraction | Gemini API (`gemini-2.5-flash` → `gemini-2.5-pro` fallback) | Vision OCR; handles Chinese text in WeChat/supplier screenshots |
| Serverless | Netlify Edge Functions (Deno) | Gemini API key stays server-side, never in browser |
| Export (Excel) | ExcelJS | `.xlsx` with embedded product photos; same library as Expense Tool |
| Export (PDF) | `@react-pdf/renderer` | Professional PDF quote with photos, branding, layout |
| Hosting | Netlify | Already have plan; CI/CD from Git |
| Styling | Tailwind CSS | Fast, clean UI |

---

## 5. Data Model

### `products`
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| name | string | Product/concept name — format: `[Category] – [Key Feature] – [Use Case]` |
| product_code | string | Corporate gift code e.g. `CG-DRINK-2601` — Phase 6 |
| erp_finished_code | string? | Optional — ERP SKU if product maps to an existing figurine SKU |
| category | string | e.g. Drinkware, Trophy, Stationery |
| status | enum | `concept` / `sampled` / `active` / `discontinued` |
| description | string | 2–3 sentences: material, size, customisation method, use case |
| assembly_notes | string | Factory assembly instructions |
| created_at | timestamp | |
| updated_at | timestamp | |

### `product_images` (subcollection of product)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| caption | string | Optional description |
| type | enum | `reference` / `sample` / `final` / `client_usage` |
| sort_order | number | Display order in gallery |
| uploaded_at | timestamp | |

### `components` (subcollection of product)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| name | string | e.g. "Crystal Body", "NFC Card", "Packaging Box" |
| spec | string | Material, size, finish etc. |
| unit | string | pcs / set / kg |
| sort_order | number | Display order in BOM |
| notes | string | |
| erp_code | string? | Optional — ERP reference code (e.g. `U0257-001-GAB`, `FM-PL120120H00-C`, `P-PB099-01-02`) |

### `component_images` (subcollection of component)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| caption | string | Optional description |
| type | enum | `spec` / `sample` / `drawing` / `reference` |
| sort_order | number | Display order |
| uploaded_at | timestamp | |

### `supplier_quotes` (subcollection of component)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| supplier_name | string | |
| unit_cost | number | Per piece cost |
| unit_cost_currency | enum | `RMB` / `HKD` / `USD` / `EUR` |
| moq | number | Minimum order quantity |
| tooling_sample_cost | number | One-time tooling/sample cost |
| tooling_sample_cost_currency | enum | `RMB` / `HKD` / `USD` / `EUR` |
| sampling_lead_time_days | number | Days from order to sample/prototype ready |
| tooling_lead_time_days | number | Days for tooling if custom mould required (0 if none) |
| production_lead_time_days | number | Baseline production lead time — free input, overridable per pricing tier |
| is_preferred | boolean | Mark preferred supplier |
| notes | string | |
| created_at | timestamp | |

### `quote_attachments` (subcollection of supplier_quote)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| file_url | string | Firebase Storage URL |
| file_name | string | Original filename |
| file_type | string | image / pdf |
| ai_extracted | boolean | Whether AI was used to fill fields |
| uploaded_at | timestamp | |

### `pricing_tiers` (subcollection of product)
Tiers are fully flexible — any quantity can be added (100, 200, 300, 500, 1000, 2000, etc.) depending on the supplier's MOQ breakpoints. No fixed set of tiers.

| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| quantity | number | User-defined: 100 / 200 / 300 / 500 / 1000 / 2000 / etc. |
| total_cost_rmb | number | Auto-calculated from preferred supplier unit costs × qty |
| tooling_cost_rmb | number | One-time tooling/sample cost (amortised or shown separately) |
| price_hkd | number | Sell price — manually set or auto-suggested from markup |
| margin_pct | number | Auto-calculated: (price_hkd − cost_hkd) / price_hkd |
| production_lead_time_days | number | Optional override — if larger qty needs more time than baseline |

### `client_quotes`
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| client_name | string | |
| contact_name | string | |
| date | timestamp | |
| status | enum | `draft` / `sent` / `won` / `lost` |
| rmb_to_hkd_rate | number | Exchange rate used |
| notes | string | |

### `client_quote_items` (subcollection of client_quote)
| Field | Type | Notes |
|---|---|---|
| id | string | Auto |
| product_id | string | Reference to product |
| product_name | string | Snapshot at time of adding |
| product_category | string | Snapshot |
| product_description | string | Snapshot |
| hero_image | string | Firebase Storage URL snapshot |
| tiers | array | `[{ quantity: number, price_hkd: number }]` — multiple qty/price options per product |
| status | string | Product status snapshot |
| createdAt | timestamp | |

---

## 6. Application Pages

### 6.1 Product Catalog (`/products`)
- Grid/list of all products with search, filter by category/status
- Status badges: Concept · Sampled · Active · Discontinued
- Quick stats: number of components, number of suppliers, last updated

### 6.2 Product Detail (`/products/[id]`)
- Product info (name, category, status, description)
- BOM section: list of components, each expandable to show supplier quotes
- Per-component: add/edit supplier quotes, upload quote images, trigger AI extraction
- Pricing tiers table: qty → total cost RMB → HKD sell price → margin %
- Action: "Add to Client Quote"

### 6.3 Add / Edit Product (`/products/new`, `/products/[id]/edit`)
- Form: basic product info
- Then add components one by one
- Each component: add supplier quotes + attachments

### 6.4 Client Quotes (`/quotes`)
- List of all client quotes with status
- Create new quote: pick client, select products + quantities
- View/edit quote: adjust prices, add notes
- Export to Excel and PDF

### 6.5 Client Quote Detail (`/quotes/[id]`)
- Client info, date, exchange rate
- Table of selected products: image, name, spec summary, qty, unit price HKD, total
- "Your Brief" summary section
- Export buttons → Excel (`.xlsx`) and PDF — both include product photos and professional layout
  - **Excel**: product photo per row (embedded), item name, spec summary, qty tiers, unit price HKD
  - **PDF**: branded layout with Crystocraft logo, product image card per item, clean typography — suitable to send directly to client

### 6.6 Settings (`/settings`)
- Manage categories list
- Manage users (invite colleagues by email)
- Default RMB → HKD exchange rate

### 6.7 Login (`/login`)
- Email/password auth via Firebase

---

## 7. Architecture

```
Browser (React SPA)
│
├── Firebase Auth          — sign-in / sign-out / session state
├── Firestore              — all product, component, quote, pricing data
├── Firebase Storage       — product images, component images, supplier quote attachments
│
└── Netlify (edge/serverless)
    ├── /api/process-quote     — Edge Function (Deno): calls Gemini to extract supplier quote data
    └── /api/download-image    — Edge Function (Deno): CORS proxy for Firebase Storage URLs
```

Same architecture as Expense Tool — all API keys stay server-side in Netlify environment variables.

---

## 8. AI Supplier Quote Extraction

Uses the same two-image pipeline proven in the Expense Tool for maximum accuracy:

| Version | Format | Used for |
|---|---|---|
| Colour JPEG (93%) | `image/jpeg` | Firebase Storage, image display in app |
| Greyscale PNG (lossless) | `image/png` | Gemini API only — discarded after extraction |

**Preprocessing steps** (client-side, before sending to Gemini):
1. Resize to max 2400px
2. Convert to greyscale (removes colour noise, improves contrast on WeChat screenshots)
3. Auto-levels (stretch histogram to 0–255, clip 1% outliers)
4. Encode as lossless PNG

**Extraction flow:**
1. User uploads screenshot/image to the supplier quote form
2. Client preprocesses image (greyscale PNG) and POSTs to `/api/process-quote`
3. Edge function forwards to `gemini-2.5-flash` (falls back to `gemini-2.5-pro` on error)
4. Gemini extracts: supplier name, unit cost, currency, MOQ, tooling/sample cost, lead time, sample time
5. Extracted fields pre-fill the form — user reviews and corrects before saving
6. Original colour JPEG uploaded to Firebase Storage as the attachment record

**Supports:** WhatsApp screenshots, WeChat screenshots (Simplified Chinese handled), PDF quotes, email screenshots.

---

## 8. Pricing Calculation Logic

For each product:

```
Each component cost converted to HKD using exchange rates set in Settings:
  Component Cost HKD = unit_cost × exchange_rate_to_hkd

Total Component Cost HKD = Σ preferred supplier component cost HKD
Assembly Cost HKD = manually entered if applicable
Total Unit Cost HKD = Total Component Cost HKD + Assembly Cost HKD

Suggested HKD Sell Price = Total Unit Cost HKD × markup multiplier (user-defined, e.g. 1.4–2.0×)
Margin % = (Sell Price − Total Unit Cost HKD) / Sell Price
```

Exchange rates stored as a Firestore `settings` document (not hardcoded), so new currencies can be added without a code change. Initial set:
- RMB → HKD
- USD → HKD
- EUR → HKD

HKD is the base/display currency. Adding a new currency only requires adding a new rate entry in Settings.

Pricing tiers are user-defined per product (any qty: 100, 200, 300, 500, 1000, 2000…). User adds tiers matching the supplier's actual MOQ breakpoints. Sell price is auto-suggested but always overridable.

---

## 9. Build Phases

### Phase 1 — Foundation ✅ Complete
- [x] Vite + React 18 + Tailwind project setup
- [x] Firebase Auth (login page, protected routes)
- [x] Firestore data model (products, components, supplier quotes, pricing tiers, client quotes)
- [x] Product list page with search + category/status filters
- [x] Add/edit product form
- [x] Component BOM management (add/edit/delete components)

### Phase 2 — Supplier Quotes ✅ Complete
- [x] Add/edit supplier quotes per component
- [x] Firebase Storage integration for image uploads
- [x] Gemini AI extraction from supplier quote screenshots (two-image pipeline: greyscale PNG → Gemini, colour JPEG → Storage)
- [x] Mark preferred supplier per component (enforced at save — clears all other `is_preferred` flags)
- [x] Supplier database (name, address, phone, WeChat ID)
- [x] Supplier catalog storage (PDFs + images, thumbnails, lightbox)
- [x] Component image gallery (upload, hero star, type labels, 2-column grid, lightbox)

### Phase 3 — Pricing ✅ Complete
- [x] Pricing tiers table per product (flexible qty tiers)
- [x] Auto-calculate unit cost + tooling cost from preferred suppliers
- [x] Tooling/unit amortisation per tier (`toolingCostHKD / quantity`)
- [x] All-in cost, sell price (inline editable), margin % with colour coding
- [x] Markup slider (1×–4×) with live suggested price
- [x] Warning banners for missing preferred suppliers (orange/red with links)
- [x] Exchange rates from Firestore `settings/exchange_rates` with hardcoded fallback

### Phase 4 — Client Quotes ✅ Complete
- [x] Client quote list + create new quote
- [x] Product picker modal (search, multi-select)
- [x] Multiple pricing tiers per item in quote (e.g. 200 pcs @ HKD 120 AND 500 pcs @ HKD 100)
- [x] Inline tier editing (qty + price per row), add/remove tiers per product
- [x] Status dropdown (draft / sent / won / lost)
- [x] Export to Excel with embedded product photos (ExcelJS) — one row per tier per product
- [ ] Export to PDF (`@react-pdf/renderer`) — stubbed as "coming soon"

### Phase 5 — Polish & Deployment ✅ Complete (V1.0 → V2.0)
### Phase 5.1 — UX Improvements ✅ Complete (V2.1)
- [x] Netlify deployment — pushed to Git, connected Netlify, `GEMINI_API_KEY` set
- [x] Firebase security rules locked (Firestore + Storage, all paths)
- [x] Supplier quote improvements: searchable combobox, delete quote, remove attachments
- [x] Drag-to-reorder images in product and component galleries (sort_order persisted to Firestore)
- [x] Pricing tiers displayed on product list cards
- [x] Rebranded to "Crystocraft Product Management App" — login logo, sidebar, page title, OG tags, Netlify site name (`ua-product-manager.netlify.app`)

### Phase 6 — Product Catalogue ✅ Complete (V2.0)
New feature: branded A4 landscape PDF catalogue generator.

- [x] Catalogue list page (`/catalogues`) — create, edit, preview, delete
- [x] Catalogue builder (`/catalogues/[id]`) — add products, drag to reorder items
- [x] Auto layout from image count per product:
  - 1–3 images → quarter page (4 products per A4 in 2×2 grid)
  - 4 images → half page (2 products per A4 side by side)
  - 5–6 images → full page (1 product per A4)
- [x] Per-product image sequencer: drag to reorder selected images; first = hero (★); max 6
- [x] Quarter-page layout variants: single (image left/text right), double (text left/2 images right), triple (3 images horizontal top/text bottom)
- [x] Half-page layout variants: 4-image (2×2 grid top 65%/text 35%), 3-image (vertical images left/text right)
- [x] Full-page layout: hero + up to 3 sub-row left pane (62%), text + up to 2 images right pane (38%)
- [x] Cover page: background image upload (Firebase Storage), black/white overlay + opacity slider (0–90%), text at lower-right
- [x] Gold dividers throughout at `rgba(200, 169, 81, 0.3)`
- [x] Page summary widget in builder: shows quarter/half/full page counts and blank slots
- [x] Print/PDF export: A4 landscape, correct pagination, `print-color-adjust: exact` for backgrounds
- [x] Marketing description field per product in catalogue (separate from product description)
- [x] Firebase Storage rules: `catalogues/{catalogueId}/{allPaths=**}` added

**Print tip:** Use Chrome incognito to avoid RSS/feed browser extension icons appearing in PDF output.

### Phase 7 — Next Steps
- [ ] Settings page: exchange rates — editable UI + `/api/fx-latest` edge function to fetch live rates (CNY/USD/EUR→HKD)
- [ ] Settings page: category management, user management
- [ ] Dashboard / home screen (products by status, quotes by status, recent activity)
- [ ] Client quote PDF export — implement with `@react-pdf/renderer`
- [ ] Data migration: manual entry of top 20–30 active corporate gift products from `CorpGiftCosting-20260523.xlsx`
- [ ] Product coding: `product_code` field (`CG-[CAT]-[YY][NN]`)

### Phase 6 — Product Coding & ERP References
- [ ] Add `product_code` field (`CG-[CAT]-[YY][NN]`) to products — user-confirmed (not fully auto-generated, to avoid Firestore race conditions); display on product list, detail, pricing, and both exports
- [ ] Add optional `erp_finished_code` field to products (for figurines that map directly to an ERP SKU)
- [ ] Add optional `erp_code` field to components (reference to ERP `U/FM/P` codes, no validation required)
- [ ] Component coding (`CMP-[TYPE]-[DETAIL]`) — defer until enough data exists to see which components recur across 3+ products; do not build UI yet

### Future — Gift Selector (Separate Project)
The `gift-selector.md` describes a **separate customer-facing project** for Crystocraft.com — a B2B gift quiz with rules-based product matching and lead capture. It has its own stack (Next.js, PostgreSQL, WooCommerce API) and should be planned independently. The only integration point with the costing tool is that concept templates / the product catalog could eventually be sourced from Firestore in a future phase.

---

## 10. Environment Variables

### Frontend (`.env.local` / Netlify site variables)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```
Safe to expose — Firebase security enforced by Auth rules, not key secrecy.

### Backend (Netlify environment variables — server only)
```
GEMINI_API_KEY=
```
Only accessed inside the Deno edge function, never sent to the browser.

---

## 11. Key Implementation Notes (Learned from Expense Tool)

- **Firestore persistence**: Use `persistentLocalCache` + `persistentMultipleTabManager` — serves data from IndexedDB instantly on repeat loads
- **Real-time listeners**: Use `onSnapshot` everywhere (not `getDocs`) — auto-pushes changes back to UI, clean up with `return unsubscribe` in `useEffect`
- **File upload UX**: Single image → auto-extract immediately; multiple images → show list with Remove buttons first, then single "Extract" button with progress counter
- **File IDs**: Use a stable numeric `_id` counter (not filename) so Remove works correctly when multiple files share generic names (e.g. `image.jpg` from mobile)
- **Image preprocessing**: Run `preprocessForGemini` client-side before POSTing to edge function — do not send raw colour image to Gemini
- **Gemini fallback**: Try `gemini-2.5-flash` first, retry once after 3 seconds on high-demand errors, then fall back to `gemini-2.5-pro`
- **ConfirmDialog**: Use custom in-app modal for all destructive actions (delete product, delete component, delete quote) — browser `confirm()` shows "Block this pop-up" on mobile Chrome
- **CORS proxy**: Firebase Storage URLs require the `/api/download-image` edge function proxy for downloading images (e.g. for Excel export with embedded images)
- **Auth domains**: Add Netlify branch preview URLs to Firebase → Authentication → Authorized domains before testing
- **Mobile date inputs**: Add `-webkit-appearance: none` + `min-height: 36px` + `line-height: 1.4` to prevent collapsing on iOS WebKit

---

## 12. Migration from Excel

After V1 is live, migrate existing products from the 3 Excel files:

| Source File | What to migrate |
|---|---|
| `CorpGiftCosting-20260523.xlsx` | All unique products → master product catalog |
| `Parts-Costing-260521.xlsx` | Reference only (core crystal line, stays in ERP) |
| `Stock-WSPrice-20250527.xlsx` | Reference only |

Migration approach: manual entry for top 20–30 active corporate gift products first, then add concepts progressively as they are discussed with new clients.

---

## Range / Figurine Costing — BUILT (design record)

> ✅ **Shipped 2026-06-22** (see Current Status at the top for the as-built summary).
> Kept as the design record. Pre-build checkpoint: git tag `v3.1-pre-range-costing`
> (commit `c94f74b`); `git reset --hard` to it to roll back.
>
> **One change vs the plan below:** component cost was NOT stored as flat fields on
> `range_components`. Instead each component got a **`supplier_quotes` subcollection**
> (image + OCR, multiple quotes, preferred). The preferred quote's cost is denormalised
> onto the component doc as the same fields (`unit_cost`, `unit_cost_currency`,
> `volume_tiers`, `tooling_sample_cost`), so steps 2–4 below are unchanged.

**Goal:** cost a figurine the way corp gift is costed, but built from the existing
**critical component** model. Opt-in per product — products left untouched keep their
existing `ws_price_usd`; nothing recalculates automatically.

**Decisions locked with the user (2026-06-22):**
1. Cost source = **components + extra lines.** Each critical component carries a cost;
   product cost = Σ(component cost × qty) + extra lines (plating, crystal, assembly, packaging).
2. Variant precision = **base + plating/crystal adders.** One base cost plus a per-plating
   adder (Gold vs Chrome) and a per-crystal-colour adder. Accurate per-variant without
   re-entering each SKU.
3. Currency/output = **HKD cost → markup → sell (match corp gift).** Uses FX rates from
   `settings/exchange_rates` and the existing pricing-group markups.

**Build steps (4 files, all additive — no migration):**
1. **`range_components` gain cost fields** (`criticalComponents.js` + `RangeComponentForm.jsx`):
   `unit_cost`, `unit_cost_currency` (RMB/USD/EUR/HKD), optional `volume_tiers`
   (`[{ min_qty, unit_cost }]`, same shape as corp-gift quotes), optional `tooling_sample_cost`.
   One shared body's cost then feeds every product that references it (as its stock already does).
2. **Range product `costing` object** (written by the new page only):
   - `extra_lines: [{ label, cost, currency }]` — base lines applied to all variants
   - `plating_costs: { [plating_code]: { cost, currency } }` — per-plating adder
   - `crystal_costs: { [crystal_code]: { cost, currency } }` — per-crystal adder
   - `markup` (optional per-product override; else pricing-group / `DEFAULT_MARKUP`)
   - `tiers: [{ quantity, lead_time_days }]` — optional volume breakpoints
3. **New pure module `rangeCosting.js`** (mirrors `pricing.js`):
   `rangeVariantCostHKD(product, lib, rates, variant, orderQty)` =
   Σ(component cost at qty × qty_per_unit) + Σ extra lines + plating adder + crystal adder,
   all → HKD; tooling amortised over qty; × markup → sell price.
4. **New page `RangeCosting.jsx`** at `/range/:id/costing` (mirrors `PricingTiers.jsx`):
   component cost breakdown → editable extra/plating/crystal adders → quantity tiers →
   per-variant resolved cost + sell-price table → Publish. "Costing" button added to the
   figurine editor.

**Rollback note:** if anything regresses (range list, corp-gift pricing, or build),
revert to tag `v3.1-pre-range-costing`. All changes are additive; the only schema additions
are new optional fields on `range_components` and a new `costing` field on `range_products`,
neither of which is read by existing code paths.

---

## 13. Future Phases (Post-V1)

- **Crystocraft New Product Costing Sheet** — a separate, simpler tool for calculating WS price for new figurines before entering the ERP (replaces Parts-Costing Excel)
- **Image gallery per product** — reference photos, sample photos, client usage photos
- **WhatsApp/WeChat message parser** — paste raw message text, AI extracts quote data
- **Client brief intake form** — shareable link for clients to submit requirements, auto-matches to products
- **Analytics** — which products are most quoted, win rate per client, margin trends
- **CRM light** — track follow-ups and status per client enquiry
- **Catalogue Collections & Merchandising** — ✅ C0/C1/C2 **BUILT 2026-06-23**. C3 (seasonal date windows + `new_in` smart tile in the band) and C4 (best_sellers + account row) remain future phases. Full spec: `Crystocraft/Operations/Catalogue_Collections_Spec.md`.
