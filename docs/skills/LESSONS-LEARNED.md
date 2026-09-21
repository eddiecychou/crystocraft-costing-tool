# Lessons Learned — the Error Log (CRITICAL)

> Every significant failure and its **verified permanent fix**, code-linked.
> Read this before "fixing" anything that feels familiar. **After any new
> incident, add an entry** — this file is how the same mistake stops being made
> twice.
>
> **Required template (failure-driven — record the failure that caused the fix,
> never just the change):**
> - **Symptom** — the observable wrong behaviour (what broke, for whom).
> - **Root cause** — *why* it happened, at the mechanism level.
> - **Permanent fix** — what makes it structurally impossible to recur, plus the
>   **MUST/MUST NOT** rule it establishes and the exact file(s).
>
> A changelog line that says only "changed X" is not a lesson — without the
> failure and the cause, the next person re-derives the bug. Ordered roughly by
> blast radius. Related boundaries: `ARCHITECTURE-RULES.md`.

---

## L-01 · Admin account silently demoted to `pending` (TWICE)

- **Symptom.** The real admin `eddie@uart.com.hk` was found flipped to
  `role:'customer', status:'pending'` on two separate occasions, locking it onto
  `PendingScreen`.
- **Root cause.** A "self-heal" `useEffect` in `src/App.jsx` auto-created a
  pending-customer `users/{uid}` doc whenever `useProfile`'s live `onSnapshot`
  reported the signed-in user's doc as missing. A live listener can transiently
  report a real, long-lived doc as "missing" (auth-token/cache race). A first fix
  (delay + re-confirm against the server) was **not** sufficient — it fired again.
- **Permanent fix.** The effect was **removed entirely** (V8.3), not patched a
  third time. **MUST NOT** ever auto-write an existing `users/{uid}` doc from a
  live `onSnapshot`/cache signal — not `role`, not `status`, not in any project.
  A genuinely orphaned Auth account now just sits on `PendingScreen` until a human
  creates the doc by hand. (memory `self-heal-incident`; `PROJECT-PLAN.md`
  Incident section.)
- **Corollary.** The `PendingScreen` message is generic — "same screen" ≠ "same
  bug". Three unrelated causes of "Awaiting approval" appeared in two cycles.
  **MUST** check *which uid / which doc exists* before assuming the mechanism.
- **Auditability (added 2026-09-02).** Both demotions were only *noticed*, never
  *explained* — there was no record of what wrote the doc or when. `AccountEdit.jsx`
  now appends to `audit_logs` on every `role`/`status`/`account_type` change
  (`../reference/FIRESTORE-COLLECTIONS.md` → `audit_logs`; append-only, admin-read). A future
  unexplained flip leaves a trail. **TODO:** the invitation-approval path
  (`netlify/functions/portal-invite.js`, Admin SDK) and price-group edits are
  not yet audited.

## L-02 · `send-email.js` was a real open relay

- **Symptom.** External review flagged, confirmed live: anyone could POST to the
  endpoint and make Crystocraft's Resend account email an arbitrary recipient.
- **Root cause.** The endpoint trusted a client-supplied `payload.email` as the
  send-to address with **zero authentication**.
- **Permanent fix.** Every call now requires a verified Firebase ID token; the
  recipient is **derived server-side** (`enquiry` → the token's own email claim;
  `account_approved` → admin + a Firestore lookup by uid), never from the request
  body. `src/notify.js` attaches the caller's ID token. **MUST** derive
  outbound-email recipients server-side from a verified identity — never trust a
  body-supplied address. (`ARCHITECTURE-RULES.md` §0; `PROJECT-PLAN.md`.)

## L-03 · Firestore open-relay analogue — the UI is not the boundary

- **Symptom / risk.** A page hidden from a role in the UI is still reachable by
  URL or by a direct SDK call; `AccessContext` even defaults to `'admin'`.
- **Root cause.** UI gates (`access.js`, `<Gate>`, sidebar filter) are
  convenience, not security.
- **Permanent fix.** `firestore.rules` + `storage.rules` are the only real
  boundary. **MUST** enforce every confidentiality/role rule there, keep the
  5-place `production` contract in sync, and re-run `qa/rbac-rules.test.mjs` on
  any rules change. (`ARCHITECTURE-RULES.md` §2.)

## L-04 · Resend 422 — tags must be ASCII (and the reversibility trap)

- **Symptom.** A campaign/personal send failed outright with Resend 422: *"Tags
  should only contain ASCII letters, numbers, underscores, or dashes."*
- **Root cause.** `marketing_contacts` doc ids **are the contact's own email
  address** (`idFromEmail` → `jane@example.com`, not an auto-id), and that raw id
  went straight into a Resend `mc_id` tag. CJK/spaces/punctuation in a
  customer/campaign name hit the same wall.
- **Permanent fix.** A shared normalizer `netlify/edge-functions/lib/resendTags.js`.
  **The first fix normalized lossily** (`customer@example.com` →
  `customer_example_com`) — sends succeeded but silently broke
  `resend-webhook.js`'s later doc lookup by that same tag value, killing every
  delivered/opened/bounced correlation. Corrected same session: **MUST** use
  `encodeTagId` (base64url — its alphabet is a subset of Resend's allowed set, so
  ASCII **and** reversible) for any id the webhook must decode back to a doc;
  `normalizeTagValue` (lossy) only for purely decorative tags. (`MARKETING-WORKFLOW.md`
  §5; `PROJECT-PLAN.md` V8.3.)

## L-05 · A shared helper with no default export broke the ENTIRE deploy

- **Symptom.** A whole Netlify deploy failed, blocking every unrelated same-day
  fix from going live.
- **Root cause.** `netlify/edge-functions/_auth.js` was a shared helper (not a
  route), but Netlify's bundler **auto-scans every top-level `.js`** under
  `netlify/edge-functions/` and requires each to export a valid default handler,
  regardless of `netlify.toml` routing.
- **Permanent fix.** Shared helpers **MUST** live in the
  `netlify/edge-functions/lib/` subdirectory (not auto-scanned). Established
  pattern: `lib/auth.js`, `lib/resendTags.js`, `lib/draftMemory.js`. When adding
  an edge function, also add its `[[edge_functions]]` block to `netlify.toml`.
  (`ARCHITECTURE-RULES.md` §6.)

## L-06 · `normLine` silently drops any un-whitelisted line field

- **Symptom.** A new field added to an order/PI line (e.g. `hide_total_qty`) just
  didn't persist — no error.
- **Root cause.** `src/shipping.js` `normLine` is a **strict allowlist**; order/
  PI/invoice lines are deliberate free-text snapshots, so anything it doesn't
  name is dropped on the way to Firestore.
- **Permanent fix.** **MUST** add the key to `normLine`'s whitelist whenever a new
  line field is introduced. Watch the same class on the corp-gift Convert-to-PI
  path (`ShipmentForm.jsx:310` tags corp lines as `range_products`, degrading the
  packing plan — known, in `TECH-DEBT.md`). (`ARCHITECTURE-RULES.md` §5.)

## L-07 · Stale-closure bug in Daily Drafts "Apply to all"

- **Symptom.** A bulk rewrite ("Apply to all") wrote stale field values for some
  drafts — the values as of the click, not the latest edits.
- **Root cause.** `DailyDrafts.jsx`'s `handleBulkRewrite` holds one `setField`
  closure across many awaited network calls (no re-render from its own
  perspective). A helper reading `edits` via that closure (`fieldsFor`) saw state
  frozen at the click. It *happened* to self-correct via `prev[draftId]` winning
  in the spread for already-touched keys — incidental, not guaranteed.
- **Permanent fix (bug-fix pack C-01).** Inside the `setField` `setEdits(prev =>
  …)` updater, base the new value on **`prev[draftId]` first**, falling back to
  the ORIGINAL Firestore draft (which never changes and needs no closure) only
  when the key was never touched. **MUST NOT** read component state via a captured
  closure inside an awaited loop — the `prev` updater argument is the only state
  safe to rely on. (`MARKETING-WORKFLOW.md` §1b; `src/marketing/DailyDrafts.jsx`
  ~line 890.)

## L-08 · `useProfile` never returns null — `!profile` checks never fire

- **Symptom.** A guard like `if (!profile) …` silently never executed for a
  signed-in user with no doc.
- **Root cause.** `src/hooks/useProfile.js` returns `{missing:true}` for "no
  doc", never `null`/`undefined` — so `!profile` is always false.
- **Permanent fix.** **MUST** check `.missing` (or the specific role/status),
  never truthiness of `profile`, to detect a missing profile. (memory
  `useprofile-missing-sentinel`.)

## L-09 · SEO title double-branding on WordPress

- **Symptom.** Published blog `<title>`s read "… | Crystocraft | Crystocraft".
- **Root cause.** The AI-generated SEO title appended `| Crystocraft`, but
  WordPress already appends the site name.
- **Permanent fix.** The blog generator **MUST NOT** append `| Crystocraft` to
  the SEO title — let WordPress add it. Also: upload images to the WP Media
  Library and set a featured image (not hotlinked); compress in-browser before
  upload; route canvas fetches through `/api/image-proxy`. (`MARKETING-WORKFLOW.md`
  §3; `PROJECT-PLAN.md` V3.0.)

## L-10 · esbuild-parse is not verification

- **Symptom.** A change "passed" (parsed clean, deployed) and was a blank page or
  a broken layout at runtime — shipped broken **three times**.
- **Root cause.** esbuild parse proves syntax only: it does not resolve
  identifiers (a missing import parses clean → runtime crash) and says nothing
  about layout.
- **Permanent fix.** **ALWAYS** run, per the change: `qa/eslint.no-undef.mjs`
  (used-but-not-imported) **and** a full `esbuild src/main.jsx --bundle`
  (unresolved imports across the graph); for UI/PDF, actually render it
  (dev-server or a `qa/*.html` harness → Chrome `--headless=new --screenshot`).
  State in the commit message what was and wasn't verified.
  (`ARCHITECTURE-RULES.md` §7; `qa/README.md`.)

## L-11 · Rules don't deploy via `git push` (permission-denied gap)

- **Symptom.** After shipping a rules-gated feature, staff/customer logins hit
  permission-denied even though the app was live.
- **Root cause.** `git push` → Netlify deploys the **app only**. `firestore.rules`
  / `storage.rules` are separate.
- **Permanent fix.** **MUST** deploy rules with `firebase-tools deploy --only
  firestore:rules` then `--only storage`, and for a rule that gates existing
  pages, **rules FIRST, then push the app**. `storage.rules` MUST track
  `firestore.rules` path-for-path (a V8.12 miss let production edit a record but
  not upload its files). (`ARCHITECTURE-RULES.md` §3; memory `rbac-production-role`.)

## L-12 · "Cropped" image was a contrast bug, not a layout bug

- **Symptom.** Carousel dots on figurine cards looked cropped/clipped.
- **Root cause.** Not overflow — contrast. Translucent `bg-white/50` dots sat on
  the white `object-contain` letterbox band, invisible except the sliver over the
  photo edge. Only figurine/range cards used `object-contain`; corp-gift's
  `object-cover` never showed it.
- **Permanent fix.** Unified all card grids to `object-cover` (square, matches
  the "square as standard" convention). Lesson: **MUST** check `object-fit` and
  what's actually *behind* an element before chasing overflow/clip on a "cropped"
  symptom. (`SKILL.md` §5 product images.)

## L-13 · GA4 "blank column" looked broken but wasn't

- **Symptom.** Portal "GA sessions (30d)" column was all "—"; the `app_uid`
  tagging looked dead.
- **Root cause.** The tagging worked (verified by querying GA4 directly). The
  page only listed `role==='customer'` accounts, so the only sessions GA4 had
  matched (all staff, right after the 2026-08-27 tag shipped) were invisible, and
  no approved customer had visited in the window.
- **Permanent fix.** `PortalLogins.jsx` now includes staff/internal via
  `roleGroupOf` and shows an "N matched / X unattributed" line so a blank column
  reads as "no traffic yet". Diagnostic lesson: **MUST** verify an integration by
  querying the source directly (`firebase-service-account.json` is a GA4 Viewer;
  recipe in `../reference/LOCAL-TOOLS.md` §GA4) before concluding the pipeline is broken.
  The `byUid` query is wrapped `.catch(()=>null)`, so a bad dimension name fails
  *silently* — check the dimension is registered (`customUser:app_uid`).

## L-14 · react-pdf: blank pages and stranded headings from `<Page>` layout

- **Symptom.** A generated Brand Proposal PDF (Sun Life, 2026-09-01) had a
  fully blank page after a premium-only section (p.20), and a section whose
  heading sat alone on one page with its products orphaned on the next, no
  heading (pp.21–22).
- **Root cause.** Two mechanisms in `src/components/BrandProposalPDF.jsx`.
  (a) `paginate([])` returns `[[]]`, so a section with a feature product and
  **no** regular products still emitted one body `<Page>` — a heading with
  no products. (b) A refactor had split the section heading and the product
  row into two *sibling* `<View>`s so the row could be vertically centred;
  when the row overflowed the page by a hair, react-pdf moved only the row,
  leaving the heading behind. Compounding it: a `flexGrow:1` centring wrapper
  around a `wrap={false}` block that is taller than the page makes react-pdf
  emit the block **and** a blank trailing page.
- **Permanent fix.** Emit body pages only when `regular.length > 0`. Keep the
  heading and the first content row **inside one `wrap={false}` block** (bind
  them — the whole unit moves together or not at all); centre *that* block
  with the `flexGrow` wrapper, and give it real headroom (feature image
  340→320, duo card 270→210) so the tallest realistic case — full heading +
  3-line captions — clears the 444pt content area. **MUST** render every
  tier with `qa/render-proposal.jsx` → `pdftoppm` before shipping a
  react-pdf layout change (esbuild parse says nothing about pagination — see
  L-10); the harness now carries a premium-only section and a
  full-heading-plus-duo section as permanent regression cases.

## L-15 · Mechanical auth migration mis-keyed edge functions

- **Symptom.** After the V8.14 RBAC flatten, several AI/OCR-assist edge fns
  (`process-quote`, `extract-pi`, `compose-message`, `generate-marketing-copy`,
  `rewrite-section`, `scrape-images`) were gated on the `quotes` module even
  though their only callers are supply / shipping / customers / product /
  figurine pages — a `staff` account with the right module for the *page* would
  still get **403** from the *helper* the page calls.
- **Root cause.** The `requireFrontOffice → requireModule(req, key)` migration
  picked `key` from the retired `sales` role's rough scope (a "front office"
  proxy that happened to include quotes), not from **who actually calls the
  endpoint**. Retagging by old-role assumption instead of by call graph.
- **Permanent fix.** Keys corrected against the real callers; `requireModule`
  now accepts a **string or an array** (any-match) for a fn reachable from
  pages in more than one module (`generate-marketing-copy` →
  `['products','figurine','marketing']`). **MUST**, when retagging an edge fn's
  auth: `grep -rn "/api/<name>"` its callers, and use the module on the
  route's `<Gate module>` in `src/App.jsx` — never the name of the old role.
  Per-fn key table in `../reference/API-REFERENCE.md`; `ARCHITECTURE-RULES.md` §2;
  `TECH-DEBT.md` "V8.14 code-review follow-up".

## L-16 · A CSS grid/flex track won't shrink below its content — `min-w-0`

- **Symptom.** The SEO Review page's right panel (a wide before→after diff
  table) pushed the **whole page** into horizontal scroll on a laptop, instead
  of scrolling inside its own `overflow-x-auto` container as intended.
- **Root cause.** A grid/flex child's default `min-width` is `auto`, which
  resolves to its **content** size. So the `1fr` track in
  `grid-cols-[240px_1fr]` grew to the table's natural width, overflowing the
  viewport, and the inner scroll container never engaged because its parent
  had already stretched.
- **Permanent fix.** `min-w-0` on the grid/flex child that holds the wide
  content; for a wide table also `table-fixed` + `break-all`/`colgroup` so
  cells wrap. **MUST** put `min-w-0` on any grid/flex column that contains a
  horizontally-scrollable or otherwise-wide child, or the child's own
  `overflow-x` is dead. Same class already load-bearing in `Layout.jsx`'s main
  column and `CustomerDetail`'s header — recurring, not a one-off.
  (`src/pages/SeoReview.jsx`, commit `a69d60b`.)

## L-17 · `serverTimestamp()` throws inside a Firestore array

- **Symptom.** Writing an `ai_enhance.enhanced_at` provenance field onto
  `RangeForm.jsx`'s `gallery[]` items would have thrown
  *"FieldValue.serverTimestamp() is not currently supported inside arrays"*.
- **Root cause.** Firestore rejects the `serverTimestamp()` (and any
  `FieldValue`) sentinel anywhere inside an **array** value — even nested in a
  map that is itself an array element. `RangeForm`'s gallery is an array of
  maps on the product doc; `ImageGallery.jsx`'s images are their own
  subcollection docs, where the sentinel is fine.
- **Permanent fix.** Per-item timestamps that live inside an array field use
  `new Date()` (client time); `serverTimestamp()` only for top-level fields or
  nested maps that are **not** under an array. **MUST** check whether the write
  target is an array element before reaching for `serverTimestamp()`.
  (`src/pages/RangeForm.jsx` vs `src/components/ImageGallery.jsx`, commit
  `baaa6ca`.)

## L-18 · Portal login stamps failed silently for most customers

- **Symptom.** Portal → Login Activity "only logs me, never my customers"
  (owner, 2026-09-10). Audit: **26 of 43 customers** had a real Firebase Auth
  `lastSignInTime` with **no `last_login_at`** on their `users/{uid}` doc —
  one as recent as the day before.
- **Root cause.** Two, compounding, both hidden by `stampLogin`'s
  `.catch(() => {})`:
  1. **Token race** — `stampLogin` fires from `useAuthState`'s
     `onAuthStateChanged` and its `updateDoc` could be issued before the
     Firestore SDK had the ID token wired to its connection →
     `permission-denied`. The owner reloads the app dozens of times a day so a
     stamp eventually lands; a customer who signs in once gets one failed shot.
  2. **Fragile rule** — the `users/{uid}` self-update path compared **nine**
     fields for equality (`ws_discount_pct`, `corp_markup_override`,
     `pricing_group`, …). Any doc with an odd/absent/null value in one denied
     the whole write.
- **Permanent fix.**
  - `authActivity.js` `stampLogin` now `await`s `auth.currentUser.getIdToken()`
    before the write and retries once after 1.5 s.
  - `firestore.rules` gained a dedicated self-update clause:
    `request.resource.data.diff(resource.data).affectedKeys()
    .hasOnly(['last_login_at', 'login_count'])` — permits the stamp whatever
    else the doc holds, still can't touch role/status/pricing. **Deployed
    separately** (`firebase deploy --only firestore:rules`).
  - 26 historical rows backfilled from Auth `lastSignInTime` (`login_count: 1`
    floor, `last_login_backfilled: true`).
  - Rules: **MUST NOT** gate a narrow self-write behind an N-field equality
    chain — use `diff().affectedKeys().hasOnly([...])`. Client: **MUST NOT**
    swallow a best-effort Firestore write's error without at least one
    token-aware retry; and a write fired straight from `onAuthStateChanged`
    **MUST** `await getIdToken()` first. Same family as L-13 — a
    `.catch(() => {})` / `.catch(() => null)` on an integration write hides
    exactly this. Verified end-to-end by minting a customer ID token and
    PATCHing the two fields via the Firestore REST API → 200.
  (`src/authActivity.js`, `firestore.rules`, commit `bf36e44`.)

## L-19 · Loose component lines on an order reserved no stock

- **Symptom.** Production colleague (XiangXia, 2026-09-10): "缺少部份 bom" —
  on a shipment's Component-stock reserve panel, parts she could see on the
  order (music-box assemblies: `P-WB051000002-WD`, `P-MMKEY-15A`, `P-MM173-02`,
  …) contributed **nothing** to the reserve. Also "1 figurine line(s) not
  matched to the Range".
- **Root cause.** `computeRequirements` (`src/mrp.js`) only ever explodes a
  line **through a matched `range_products` BOM**. A line whose own `item_code`
  *is* a stocked `range_components` code — a loose part added straight onto the
  order rather than a figurine SKU — matched no product, failed
  `looksLikeFigurineCode`, and fell into `skipped` (fully silent) or
  `unmatched` (one terse amber line). Its stock was never reserved.
- **Permanent fix.** `computeRequirements` builds `libByCode` and, in the
  `if (!product)` branch, treats a direct component-code match as a 1:1
  requirement (`bump(direct, qty * perUnit(l), code)`) before the
  figurine/skip classification. Shared with the MRP Requirements report, where
  it is likewise correct. **MUST:** an order line that names a component
  directly is a real requirement — never silently drop it because it isn't a
  figurine SKU. (`src/mrp.js`.)

## L-20 · A hand-rolled vis-network viewer left physics running forever

- **Symptom.** Owner: "the app response is slow recently." Audit found
  `corespotlightd` (macOS Spotlight) pinned at 226% CPU from this session's own
  file churn — a real, transient cause — but the owner asked a sharper
  follow-up: "could that be the graphify.html that runs locally?"
- **Root cause.** `graphify-out/graph.html` (graphify's own generated output)
  correctly does `network.once('stabilizationIterationsDone', () =>
  network.setOptions({ physics: { enabled: false } }))` — the force layout
  runs once, settles, then stops. The hand-rolled `graphify-out/merged-graph.html`
  (`scripts/build-merged-html.py`, built for the Repository-toggle view over
  the merged 5,292-node graph, V8.15) never did this: `vis.Network`'s barnesHut
  solver kept recalculating forces on every animation frame **indefinitely**,
  for as long as that tab stayed open — foreground or background, browser
  throttling only slows it, doesn't stop it. On ~5,000 nodes that's a real,
  sustained CPU cost, not a one-off spike.
- **Permanent fix.** Added the same `stabilizationIterationsDone` listener
  (`on`, not `once` — the viewer rebuilds the node/edge DataSet on every
  repo/leaf-node toggle, so physics is deliberately re-enabled for one
  re-layout pass each time, then switched off again once it resettles).
  Verified: `network.physics.physicsEnabled` → `false` ~10–14s after load.
  **MUST:** any hand-rolled `vis.Network` view must disable physics once
  stabilized — copy graphify's own pattern, don't assume the library does it
  by default (it doesn't). (`scripts/build-merged-html.py`.)

## L-21 · Tailwind's `content` glob missing an extension silently drops those classes

- **Symptom.** After porting Product Design's `.tsx` pages into this app
  (V8.16), a heading's `mt-10` computed `margin-top: 0px` live — the
  "Generations" section on `TemplateDetail.tsx` sat stuck directly against
  the JSON block above it, with no visible error anywhere.
- **Root cause.** `tailwind.config.js`'s `content: ['./index.html',
  './src/**/*.{js,jsx}']` never scanned `.ts`/`.tsx` files. Any utility class
  used **only** inside a ported `.tsx` file — never elsewhere in a `.jsx`
  file that happened to already use the same class — was invisible to
  Tailwind's JIT scanner and silently missing from the compiled CSS. This
  wasn't one broken class; it was every class across all 10 ported pages
  that no `.jsx` file happened to already use.
- **Permanent fix.** `content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}']`.
  **MUST**, when adding source files in a new extension to this repo (or any
  Tailwind v3 project): check the `content` glob covers it **before**
  debugging individual "missing style" reports one at a time — a systemic
  glob gap looks exactly like N unrelated CSS bugs. (`tailwind.config.js`.)

## L-22 · A bare `res.json()` leaks a raw browser parser exception to the user

- **Symptom.** A Product Design "Tweak with AI" call failed with the error
  text `Unexpected token 'h', "the edge fu"... is not valid JSON` — a
  literal fragment of the actual HTTP response body, not a real error
  message.
- **Root cause.** All 8 `/api/pd-*` client call sites did
  `const data = await res.json()` directly. That's fine when the server
  returns the JSON it's supposed to — but the moment it doesn't (a
  platform-level error page instead of the edge function's own JSON error
  body, a cold-start hiccup, anything upstream of the function's own
  try/catch), `res.json()` throws a native `SyntaxError` built from
  whatever text actually came back, and that exception's `.message`
  propagated straight into the UI unmodified.
- **Permanent fix.** Added `pdApiFetch()` (`src/lib/pdApi.ts`): reads the
  body as **text** first, parses it defensively, and collapses every
  failure shape into one clear, actionable message. **MUST NOT** call
  `res.json()` directly on a fetch whose failure path isn't fully
  controlled by your own code — read as text and parse defensively instead,
  for any endpoint that isn't guaranteed to always return your own JSON.
  Related: **L-25** below, on what that specific failure shape turned out
  to mean and how it's now handled automatically.

## L-23 · A card that returns `null` when empty is an invisible feature

- **Symptom.** Eddie: "I can't find that in customer, where did you put
  it?" — a newly-shipped "Product Design Concepts" section on
  `CustomerDetail.jsx` was nowhere to be found on any customer's page.
- **Root cause.** The component returned `null` entirely whenever a
  customer had zero *approved* concepts — which was every customer right
  after shipping (the one template used to verify it live had been reverted
  to `draft` afterward). A feature that renders nothing when empty is
  indistinguishable from a feature that doesn't exist.
- **Permanent fix.** Always render the section — loading / empty / populated
  states — matching every other section on that page (Purchase Orders,
  Portal Enquiries, etc.), with the empty state explaining how to populate
  it and linking to where. **MUST NOT** early-return `null` from a
  page-level section purely because it currently has no data; that's what
  an empty-state message is for. (`src/pages/CustomerDetail.jsx`.)

## L-24 · `object-cover` on a short fixed-height box crops reference photos

- **Symptom.** Eddie: "the image is cropped, it should be square" — a
  product's uploaded reference photos visibly lost their top and bottom
  edges in the Images gallery.
- **Root cause.** `w-full h-32 object-cover` on a photo whose real aspect
  ratio isn't that exact wide/short ratio center-crops away whatever
  doesn't fit — invisible until someone compares the thumbnail against the
  original. The same pattern (`w-full h-*` + `object-cover`) had been
  copy-pasted across five separate image grids in Product Design (product
  photos, brand reference images, generation thumbnails, template
  source-image panels).
- **Permanent fix.** `aspect-square` + `object-contain` on an `ivory-dark`
  plate — the whole photo is always visible, never cropped, at the cost of
  some empty margin on a non-square source. **MUST** use `object-contain`
  (never `object-cover`) for any reference/product photo where fidelity to
  the original matters — a generated or decorative image can tolerate a
  crop; a photo someone is using to judge a real physical product cannot.
  Found and fixed in all five spots at once, not just the one reported.

## L-25 · A non-JSON 5xx from an edge function usually means "the platform gave up," not "the request was wrong" — safe to retry once, silently

- **Symptom.** A Tweak instruction failed with `Request failed (500)`.
  Retrying the **exact same** instruction immediately succeeded.
- **Root cause.** The edge function's own error paths always return valid
  JSON (`jsonRes()`); a non-JSON body on a failed response means something
  upstream of that code killed the request — in this case, almost
  certainly a Netlify edge-function execution-time cutoff tripped by
  Gemini responding slowly that particular call, not a fault with the
  request itself. Reproduced live against production with the identical
  instruction to confirm this before treating it as a real fix rather than
  a guess.
- **Permanent fix.** `pdApiFetch()` (see **L-22**) now retries **once**,
  silently, but only for that exact failure shape (non-JSON body + failed
  status). A real 4xx/5xx with a proper JSON error body (bad input, access
  denied, Gemini genuinely rejecting the request) is a real answer and is
  **NOT** retried — retrying that would just waste a second Gemini call on
  a failure that will recur. **MUST**, before adding a retry to any
  failure path: confirm live that a bare retry of the *same* input actually
  fixes it — a retry that papers over a deterministic bug just hides it
  one layer deeper. (`src/lib/pdApi.ts`.)

## L-26 · A new customer picker doesn't automatically inherit the `RETAIL_TAG` exclusion

- **Symptom.** Eddie: "please ignore all the B2C customers for this" —
  Product Design's "New Template" customer dropdown listed Retail/B2C
  customers, even though the same exclusion already existed elsewhere
  (`ProductDetail.jsx`'s "branded for" picker, the Dashboard digest).
- **Root cause.** `RETAIL_TAG` (`src/domain/customer.js`) is a free-typed
  tag, not a schema field or a query filter — every place that lists
  customers for a B2B-only workflow has to remember to filter it out
  itself. `realCustomers.ts`'s `listRealCustomers()` (Product Design's one
  shared customer-list source) was written without it, because nothing
  connects it to the two places that already had the exclusion.
- **Permanent fix.** Filtered at that one shared source
  (`listRealCustomers()`) rather than per call site, so every picker built
  on it inherits the fix. **MUST**, when adding a new customer list/picker
  for a workflow that is B2B-only by *intent* (a concept, a brand profile,
  a corp-gift quote — not a transactional page like Invoices/Shipments,
  where a real B2C customer legitimately belongs): check whether
  `RETAIL_TAG` needs excluding, and prefer filtering at the shared list
  function over the individual picker. Grep `RETAIL_TAG` first — it's not
  applied automatically anywhere.

## L-27 · A form-owned array field can have an explicit "only this form writes it" rule — grep for it before adding a second writer

- **Symptom.** None visible in the UI — caught only during live verification
  of a new "+ Add to Existing Product" feature (`TemplateDetail.tsx`) by
  inspecting a figurine product's actual `<img>` list after the fact, not by
  trusting the button's own "success." The first implementation wrote a new
  photo straight onto a `range_products` doc's `gallery[]` via
  `updateDoc(..., { gallery: arrayUnion(...) })`.
- **Root cause.** `RangeForm.jsx` already has an explicit comment next to
  its own `onAddToGallery`: "unlike `colour_images`, nothing else writes to
  `gallery[]` from outside this form" — because the form loads the whole
  doc into local state on open and its Save button writes `gallery`
  wholesale back. A direct external write is invisible to an already-open
  tab; if a human has the form open and clicks Save afterward, their stale
  local `gallery` silently overwrites (loses) the external write. Missed
  this on the first pass because the write itself succeeded and looked
  correct — the race only shows up if someone has the form open at the
  wrong moment, which a same-session live test won't naturally hit.
- **Permanent fix.** Route the write through the form instead: extended
  `RangeForm.jsx`'s existing new-product query-param prefill
  (`design_no`/`description`/…) with `addGalleryUrl`/`addGalleryCaption`,
  read once in the edit-mode fetch effect and appended into local form
  state (stripped from the URL after), so it only actually persists when
  Eddie clicks Save Changes himself — same as every other gallery edit on
  that page. **MUST**, before writing to a field a form owns from outside
  that form: grep the form for an existing comment/pattern establishing who
  is allowed to write it (`colour_images` vs `gallery` in `RangeForm.jsx` is
  the precedent — one has a direct-write path *because* it was deliberately
  designed for it, the other explicitly does not). If no such comment
  exists but the field is loaded into `useState` on mount and only written
  back on Save, assume the same rule applies unless proven otherwise.

## L-28 · Two edge functions that proxy the same URLs need the same host allowlist — a security fix in one can silently break the other

- **Symptom.** Eddie, from a screenshot of Chrome's download tray: "I can't
  download the images from the figurine range product" — Chrome showed
  "無法在網站上擷取檔案" (couldn't retrieve the file from the site) for
  gallery photos on a figurine product, even though the same photos
  displayed fine on the page.
- **Root cause.** `netlify/edge-functions/download-image.js` and
  `image-proxy.js` both exist to fetch the *same* class of URLs server-side
  (one to force a download, one to sidestep CORS for display/canvas use) —
  but only `image-proxy.js` was ever given the `crystocraft.com`/
  `*.crystocraft.com` carve-out for WordPress-hosted figurine gallery
  photos (`RangeForm.jsx`'s "+ URL" button pastes exactly these). When
  `download-image.js` was SSRF-hardened (bug-fix pack A-02) to an
  allowlist of Firebase Storage hosts only, nobody re-checked its sibling
  proxy's allowlist for parity, so a URL that displays fine now 403s the
  moment the same image is downloaded.
- **Permanent fix.** Added the identical `crystocraft.com` carve-out to
  `download-image.js` — same host, same reasoning as `image-proxy.js`,
  still 403ing every other arbitrary host. **MUST**, when hardening or
  changing the host allowlist on one of a pair of URL-fetching edge
  functions serving the same data (a display proxy and a download-forcing
  proxy are the recurring pair here): grep for the other one and check its
  allowlist actually matches, rather than assuming they're already in sync.

## Operational reminders (low blast radius, high friction)

- **Bump `APP_VERSION` at cycle START**, not close (`src/appInfo.js`; corrected
  repeatedly — memory `version-bump-timing`).
- **Netlify deploy credit is limited** — batch commits, confirm before pushing to
  `main` (memory `netlify-deploy-credit`).
- **Node / firebase-tools are already on PATH** — don't re-walk install
  (`../reference/LOCAL-TOOLS.md`; memory `local-tools-available`).
- **A local `/api/* 404` is normal** — dev runs `netlify-cli dev --offline`
  (memory `edge-functions-local-dev`).
- **The QA-admin browser login may be dead** — `.env.local`'s
  `QA_ADMIN_PASSWORD` was the literal placeholder `whatever-you-set` for all of
  V8.14, so nothing that cycle was click-tested. Check the value is real before
  planning any browser verification; if it's the placeholder, say so and ask
  the owner to set one (memory `qa-admin-login`).
- **Don't revive `../plans/PRODUCT-VARIANTS-PLAN.md`** without reading its §4 audit — a
  typed per-variant price breaks the quote margin column and per-customer pricing
  (+5 landmines).

## How to add an entry

New incident → add `L-NN` with **Symptom / Root cause / Permanent fix**, link the
exact file(s), and state the **MUST/MUST NOT** rule it establishes. If it changes
a boundary, also update `ARCHITECTURE-RULES.md`; if it's worth recalling across
sessions, add an auto-memory. Then note it in the Change Log.

## Change Log

| Date | Change |
|---|---|
| 2026-08-31 | Created by merging root `INDEX.md` §5 (mistakes table) into full Symptom/Root-cause/Permanent-fix entries, and adding the incidents the mistakes table only referenced: Resend ASCII tag + reversibility (L-04), edge-fn auto-scan deploy outage (L-05), open relay (L-02), Daily-Drafts stale closure (L-07), SEO double-branding (L-09), GA4 blank-column (L-13). |
| 2026-09-01 | Formalized the failure-driven template at the top (Symptom / Root cause / Permanent fix is now the required, explicit format — "changed X" alone is not a lesson), per the Magister failure-driven-changelog pattern. |
| 2026-09-02 | Added L-14 — react-pdf `<Page>` pagination: a blank page from a premium-only section (`paginate([])` → `[[]]`) and a stranded heading from decoupling heading/content across sibling views; the fix is to bind heading+first-row in one `wrap={false}` block and render every tier through `qa/render-proposal.jsx` before shipping. |
| 2026-09-04 | Added L-15 (mechanical `requireFrontOffice→requireModule` migration mis-keyed AI-assist edge fns to `quotes` — retag by call graph + route `<Gate module>`, not by old role; `requireModule` now string-or-array), L-16 (a grid/flex `1fr` track won't shrink below content → `min-w-0` on the child or its inner `overflow-x` is dead), L-17 (`serverTimestamp()` throws inside a Firestore array — use `new Date()` for per-item timestamps in array fields). Operational reminder: the QA-admin login was non-functional all of V8.14 (placeholder password). |
| 2026-09-10 | Added L-18 — portal login stamps failed silently for 26/43 customers (token race + a 9-field-equality self-update rule, both hidden by `stampLogin`'s `.catch(()=>{})`). Fix: `await getIdToken()` + one retry, and a `diff().affectedKeys().hasOnly(['last_login_at','login_count'])` rule clause; 26 rows backfilled from Auth `lastSignInTime`. |
| 2026-09-10 | Added L-19 — loose component lines on an order (item code = a `range_components` code, not a figurine SKU) reserved no stock; `computeRequirements` only exploded through a matched Range BOM. Fix: direct component-code match → 1:1 requirement in `src/mrp.js`. Also: PU line `description` is now a growing `<textarea>` and prints with `white-space:pre-line` (line breaks preserved — reported by XiangXia). |
| 2026-09-10 | Editable reserved quantity (XiangXia ask #2) — a reserved line's qty is now editable inline on the Component/Crystal/Packaging order-stock panels via `adjustReservedLine` (`orderStock.js`) + `EditableQty.jsx`. Movement key carries a per-line `adj_seq` so re-entering an earlier value can't collide with its earlier movement and get deduped by `postMovement`. Design record + landmines: `../plans/RESERVE-QTY-EDIT-AUDIT.md`. |
| 2026-09-11 | Added L-20 — `graphify-out/merged-graph.html`'s hand-rolled vis-network view never disabled physics after the layout settled (graphify's own `graph.html` does), so the barnesHut solver ran on ~5,000 nodes every frame indefinitely while that tab was open. Fixed in `scripts/build-merged-html.py`. Also fixed: Corp Gift product save (`ProductForm.jsx`) had a bare `finally` with no `catch` — a failed write reset the button with nothing on screen; now shows the real error. |
| 2026-09-20 | Added L-21 through L-26 from the V8.16 Product Design port + its post-launch fixes: Tailwind `content` glob missing `.ts`/`.tsx` silently dropped classes app-wide (L-21); a bare `res.json()` leaks a raw browser parser exception on a non-JSON response (L-22); a section that returns `null` when empty is an invisible, undiscoverable feature (L-23); `object-cover` on a short fixed-height box crops reference photos — use `object-contain` (L-24); a non-JSON 5xx from an edge function usually means the platform gave up, not that the request was wrong — confirmed live before adding a silent one-shot retry (L-25); a new B2B-only customer picker doesn't automatically inherit the `RETAIL_TAG` exclusion — it has to be added explicitly, ideally at the shared list source (L-26). |
| 2026-09-21 | Added L-27 — a first pass at "add a Product Design image to an existing figurine product" wrote straight to `range_products.gallery[]` via `arrayUnion`, missing `RangeForm.jsx`'s existing "only this form writes gallery[]" rule (a stale open tab's Save would silently clobber it); caught during live verification by inspecting the actual `<img>` list, not by trusting the UI. Fixed by routing through the form via a new `addGalleryUrl`/`addGalleryCaption` query-param prefill instead of a direct write. |
| 2026-09-21 | Added L-28 — `download-image.js`'s SSRF-hardened allowlist (Storage hosts only) was never given the `crystocraft.com` carve-out its sibling `image-proxy.js` already has for WordPress-hosted figurine gallery photos, so those photos displayed fine but 403'd on download. Added the matching carve-out. |
