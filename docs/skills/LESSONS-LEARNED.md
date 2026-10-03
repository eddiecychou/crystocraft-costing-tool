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

## L-29 · `placeholder_markers` covered half the languages this site actually publishes in

- **Symptom.** A Workbench (DeepSeek harness) handoff reported 29 published
  posts serving a leaked translator instruction as their `excerpt` — e.g.
  "Please provide the text to translate." in French, Japanese, or Spanish
  instead of real copy. All 29 were already fixed by the time this reached
  the OC side; this entry is about the check that let them ship, not the
  live data.
- **Root cause.** `seo-control-plane/validate-payload.mjs`'s
  `placeholder_markers` check (`PLACEHOLDER_RX` + `SPANISH_INSTRUCTION_RX`)
  only ever covered English, Spanish, and **simplified** Chinese. French and
  Japanese had zero coverage — not a weak pattern, no pattern at all. And
  **zh-hant is a first-class language on this site (52 published posts)**,
  but the Chinese terms (`请提供`/`请输入`/`需要翻译`) were simplified-only;
  their traditional forms (`請提供`/`請輸入`/`需要翻譯`) silently never
  matched. 28 of the 29 leaks could not have been caught by any check that
  existed before this fix, regardless of how carefully anyone reviewed a
  batch — the gap was in what languages were enumerated, not a bug in any
  one pattern.
- **Permanent fix.** Added `FRENCH_INSTRUCTION_RX`, `JAPANESE_INSTRUCTION_RX`,
  `TRADITIONAL_ZH_INSTRUCTION_RX` — same co-occurrence shape the existing
  `SPANISH_INSTRUCTION_RX` already used: a request/imperative marker AND a
  translation stem together, not either alone. This mattered in practice: a
  first draft (from the handoff, caught before landing here) flagged the
  markers unconditionally and produced real false positives — "Veuillez
  indiquer votre adresse de livraison" (checkout copy) and "請提供您的訂單
  編號以便我們查詢" (a real form field) both read as leaks under the naive
  version. Verified independently before applying (not just trusted the
  handoff's own numbers): wrote a standalone test script, ran the proposed
  regexes against all 9 leak strings + 12 non-leak strings the handoff
  listed (including its own false-positive catches) — 22/22 correct. Then
  applied to the real file and ran the full `validate-payload.test.mjs`
  suite (35 tests) — 0 regressions. **MUST**, when adding language coverage
  to any check enumerated per-language (this file's `wrong_language_chars`
  has the same shape): gate an instruction/placeholder pattern on
  co-occurrence with the actual leak-indicating term, never on a polite
  opener or a common phrase alone — and add both a positive (leak) and
  negative (real copy in that language) test case, not just the positive.
- **Cross-repo note.** This file (`seo-control-plane/validate-payload.mjs`)
  is vendored verbatim by the external DeepSeek Workbench, which runs it
  before every WordPress write — this repo owns the master, the Workbench
  re-vendors on request (see `docs/skills/SEO-CONTROL-PLANE.md` §6.6 and
  `MARKETING-WORKFLOW.md`'s external-governance section for the boundary).
  New checksum after this fix: `sha256[:12] = 8f7599b1c64c` (was
  `9fa7e66955ca`) — pass this back to the Workbench side to re-vendor.

## L-30 · An unscoped global `@media print` rule blanked every OTHER print page in the app

- **Symptom.** "Print / Save as PDF" produced a completely blank page/PDF on
  the customer portal's SI invoice — reported live via a screenshot of an
  empty print preview. Confirmed the same blank-page symptom hit the PU
  print route too ("Bugs: something wrong with the print function of the
  App... Both PU and SI").
- **Root cause.** `src/index.css` had a `@media print { body * {
  visibility: hidden; } #spec-sheet-print-target, ... { visibility: visible;
  } ... @page { size: A4 landscape; margin: 0 } }` block, added for the
  Product Design spec-sheet print feature (V8.16) — but written into the
  **global** stylesheet, imported once app-wide from `src/main.jsx`, with no
  gating. `body * { visibility: hidden }` applies to literally every print
  job in the app; only the spec-sheet component ever defines
  `#spec-sheet-print-target` to satisfy the visibility exception. Every
  OTHER print page (SI/PU invoices, credit notes, proforma, packing list,
  catalogue, portal invoices) hid every element on the page with nothing to
  un-hide it. A sweep confirmed this was the ONLY instance of the pattern —
  every other print-CSS block in the app already lives inside its own
  page/component (self-contained while mounted), not the global file.
- **Permanent fix.** Moved the rule out of `index.css` entirely into a
  component-scoped `<style>` tag inside `SpecSheetEditorForm.tsx`, so it
  only exists in the DOM while that one editor is mounted. `@page` can't be
  gated by a selector/class (it's a page-level at-rule, not conditional on
  an element), so a body-class toggle would NOT have been enough — full
  removal from global scope was the only correct fix. **MUST**: any
  `@media print` rule using a broad selector (`body *`, `*`, `#root *`) or
  an unconditional `@page` belongs in a component-scoped `<style>`, never in
  a file imported app-wide — grep `src/index.css` for `@media print` before
  adding a new print feature and confirm each existing block is either
  genuinely app-wide by design (documented) or self-contained.
- **Companion fix (same sweep): brittle positional print selectors.**
  `CataloguePreview.jsx`'s own (correctly-scoped) print CSS targeted
  `Layout.jsx`'s chrome via DOM position (`#root > div > aside`, `#root >
  div > div > main`, etc.) — this would silently break (wrong elements
  hidden/shown, no error) if `Layout.jsx`'s nesting ever changed. Replaced
  with explicit `data-print-shell`/`data-print-hide`/`data-print-root`
  attributes added directly on the Layout elements the print CSS needs,
  so a future Layout refactor breaks loudly (attribute missing → catalogue
  print visibly wrong) instead of silently.

## L-31 · Re-inviting an already-invited contact silently dropped new pricing

- **Symptom.** Owner set a customer's WS discount/currency on the "Invite to
  portal" pricing dialog, but a second attempt to correct it had no visible
  effect at all — no error, no confirmation it changed.
- **Root cause.** `createInvitation`'s duplicate-invitation guard (an
  existing non-terminal invitation for the same customer+email reuses the
  record rather than creating a second one) returned the existing doc
  immediately, without ever looking at the new `pricing` argument the
  second call carried.
- **Permanent fix.** When the existing invitation is still `pending` (not
  yet claimed — nothing live to conflict with), the new pricing is now
  written onto it; once `claimed`/`approved` it's left alone, since the
  account already exists by then and pricing changes belong on
  `AccountEdit.jsx` instead. The client message now says "pricing updated"
  distinctly from the generic "already invited," so the admin can tell the
  second click actually did something.

## L-32 · A modal's backdrop-click-to-close broke on a native `<select>` dropdown, first click only

- **Symptom.** "The first time I click it, when I change the exchange rate,
  it will quit [closes the dialog]. But I go in the second time it is
  okay." — the invite-pricing dialog closed itself the moment the admin
  interacted with the currency `<select>`, but only intermittently.
- **Root cause.** The dialog's backdrop `<div onClick={onCancel}>` relied on
  the CONTENT div's `onClick={e => e.stopPropagation()}` to avoid closing
  for clicks genuinely inside the dialog. A native `<select>`'s dropdown
  list is rendered by the browser as a popup, not as a DOM descendant of
  that content div — so an option-click's resulting event could reach the
  backdrop without ever passing through the stopPropagation guard.
- **Permanent fix.** Replaced the stopPropagation pattern with the standard,
  more robust one: the backdrop only closes on a click whose `e.target ===
  e.currentTarget` (i.e. the click genuinely originated on the backdrop
  itself), which is correct regardless of where the triggering interaction
  actually came from. **MUST**: any dismissible overlay containing a native
  `<select>` (or anything else that renders outside the normal DOM
  subtree — a browser-native popup, a portal) needs the `e.target ===
  e.currentTarget` guard, not bare `stopPropagation()` on the content
  wrapper — `ConfirmDialog.jsx` uses the older pattern too and doesn't
  contain a `<select>` today, but check it again before adding one.

## L-33 · A form input whose target field is derived from the current values re-points itself when you clear it

- **Symptom.** Caught in code review, not in production — no one had hit it
  live yet, but it was already on `main` and shipped. In `CustomerForm.jsx`'s
  new `WhatsAppNumbers` (the collapsed one-field-by-default WhatsApp editor,
  L-30's cycle): a contact whose only number was `whatsapp_business` shows a
  single unlabelled input bound to that field. Select-all + delete to retype
  it, and the input silently re-bound to `whatsapp_personal` — the DOM node
  remounted (focus lost mid-edit) and every character typed afterwards went
  into the wrong field. Net effect: the business number erased, the new one
  filed as Personal.
- **Root cause.** The visible rows were computed fresh on every render and
  **ordered filled-first**: `const rows = [...filled, ...empty]`, then
  `rows.slice(0, 1)` for the collapsed view. That makes the identity of "the
  first row" a function of the current values, so emptying a field reorders
  the array underneath the input the user is typing in. The `key={t.field}`
  then correctly told React these were different elements, which is exactly
  why it remounted. This mattered beyond cosmetics because
  `DailyDrafts.jsx` branches on Personal vs Business to choose which
  WhatsApp account to send outreach from — a mis-filed number silently
  mis-routes future messages, with nothing to alert anyone.
- **Permanent fix.** Which slots are visible is now **state, seeded once**
  (`useState(() => …)` from the contact's filled fields, else the first
  slot), rendered in canonical `WA_TYPES` order, and unioned with anything
  currently filled so a row is never dropped. A slot only ever gets added
  (via "Add another"), never removed, so an input's field binding is fixed
  for the life of the card. **MUST**: when a collapsed/progressive-disclosure
  form maps one visible control onto one of several underlying fields, derive
  *which* field from stable state, never from the current values — a control
  whose binding can change as the user edits will silently write to the wrong
  field. Reordering a list by "non-empty first" is the usual way this sneaks
  in. Verified with a logic test asserting the old derivation reproduces the
  re-point and the new one doesn't (11 assertions, incl. the mirror
  personal-only case).

## L-34 · `key={i}` hands a card's component state to a different record when the list is reordered

- **Symptom.** Also caught in the same review. `ContactsEditor` renders
  `contacts.map((c, i) => <div key={i}>)` and has Move-up/Move-down buttons.
  `WhatsAppNumbers` kept its "is the second slot revealed?" flag in
  `useState(filled.length > 1)` — evaluated on mount only. Move a contact
  with **both** WhatsApp numbers into a position previously held by a
  one-number contact, and the component instance at that index is reused
  rather than remounted: the flag stays `false`, the collapsed view renders
  one row, and that contact's Business number sits in form state **rendered
  in no input at all**. It still saved correctly (no data loss), but an admin
  could neither see nor edit it, and the single unlabelled field read as if
  it were their only number.
- **Root cause.** Two things that are each individually defensible and only
  bite together: (a) an index key, so React's reconciliation treats position
  as identity and reorders mutate *which record a live component instance is
  showing*; (b) state initialised from props on mount with no path to
  re-derive when those props later describe a completely different record.
  `useState(initialValue)` re-running is a thing people assume; it isn't.
- **Permanent fix.** Two layers, deliberately. `ContactsEditor` now keys by
  `c.id || i` (contacts get a real `genContactId()` id from
  `normalizeContact`; a brand-new unsaved one falls back to its index), so
  card state follows the contact it belongs to. *And* `WhatsAppNumbers`'
  visible set is unioned with whatever is currently filled (L-33's fix), so
  even a stale slot flag can no longer hide a real value — belt and braces,
  because the key fix alone would still leave a wrong-but-invisible state
  reachable via the unsaved-contact index fallback. **MUST**: any list whose
  rows carry their own component state (an expander, a draft, a toggle, a
  focus trap) must be keyed by a stable record id, not the array index, the
  moment that list can be reordered, inserted into, or removed from — and
  **MUST NOT** rely on `useState(fromProps)` to track a prop that can change
  identity under it. Belongs on the checklist next to any new "move up /
  move down" affordance.

## L-35 · A currency with no rate on file was shown to the customer unconverted, wearing that currency's label

- **Symptom.** Found in the 2026-09-28 whole-repo review, not by a customer
  complaint — which is the worrying part, because it is silent by
  construction. A portal account whose `base_currency` was GBP, AUD, CAD or
  SGD saw HKD magnitudes labelled as their own currency: a USD 20 figurine
  displayed as **"GBP 155.60"** instead of ~GBP 15.90. ~7.8x over, and
  nothing about it looks broken — it is a plausible number in the right
  format. Verified live: the real `settings/exchange_rates` doc has no rate
  for any of those four today.
- **Root cause.** Three things lining up. `CUSTOMER_CURRENCIES`
  (`src/currency.js`) offers seven currencies and is used by
  `AccountEdit.jsx`, the signup form and the invite-pricing dialog. But
  `DEFAULT_RATES` only ever held RMB/USD/EUR/HKD, `/api/fx-rates` only
  returned RMB/USD/EUR/GBP, and — the part that made it permanent —
  `Settings.jsx`'s save was a **non-merge** `setDoc({RMB, USD, EUR})`, which
  wipes any other key in the doc on every save. So even a GBP rate that had
  been fetched could not survive. The conversion then swallowed it:
  `fromHKD` was `Number(amountHKD) / (rates[cur] || 1)` — a missing rate
  divided by 1 and returned the HKD figure unchanged. The whole failure is
  one `|| 1`: the falsy-fallback pattern applied to a value where "absent"
  and "1" mean completely different things.
- **Permanent fix.** `fromHKD` returns **null** for a currency with no rate,
  never the raw amount; `fmtMoney` already renders null as `—`, and the one
  call site doing arithmetic (`EnquiryPage`'s cart total) already coerces
  null and flags the line "indicative", so an unrated currency degrades to
  *no price shown* rather than a wrong one. `/api/fx-rates` now returns
  AUD/CAD/SGD too; `Settings.jsx` saves with `{merge: true}`, carries the
  portal-only rates through, and **shows an amber warning naming any
  customer-facing currency with no rate** — without that, a blank storefront
  has no visible explanation. The per-account fixed `fx_rate` escape hatch
  is unaffected and still works with no global rate. **MUST**: never use
  `|| <fallback>` on a rate, price, quantity or discount where the fallback
  is a *valid-looking value* — for a missing FX rate, 1 is not a safe
  default, it is a silent wrong answer. Return null and let the UI say "—".
  **MUST**: when a picker offers an enum (currencies, here), something has
  to guarantee every option is actually supported end to end — offering a
  seventh currency was free, making it work was not. Covered by
  `qa/money-fixes.test.mjs`, which asserts every `CUSTOMER_CURRENCIES` entry
  either converts or returns null, and fails if `|| 1` returns.

## L-36 · A publish step deleted a field the reader still preferred, so every quote line came in at 0

- **Symptom.** Adding any product to a client quote in HKD (the default
  currency) produced a line priced **0.00**, with the correct figure sitting
  unread in the same tier document.
- **Root cause.** Two halves of the same feature disagreed about the schema
  after a USD→HKD migration. `PricingTiers.publish()` writes
  `price_hkd: <computed>`, `sell_currency: 'HKD'` and explicitly
  `sell_price: deleteField()` ("clear legacy fields so stale values can't
  resurface"). `QuoteDetail.handleAddProducts` still read
  `td.sell_currency === quoteCurrency ? (td.sell_price || 0) :
  toQuoteCurrency(td.price_hkd || 0)`. Because the published
  `sell_currency` is `'HKD'` and the default quote currency is also `'HKD'`,
  the *common* path took the first branch, read the deleted field, and
  `undefined || 0` produced 0 — while the correct value was only reachable
  from the branch that never ran. A deliberate cleanup on the write side
  silently became a zero on the read side.
- **Permanent fix.** Only take the legacy field when it actually holds a
  value: `(td.sell_currency === quoteCurrency && td.sell_price != null)`,
  else fall through to `price_hkd`. Note `!= null` rather than truthiness, so
  a genuine `sell_price: 0` still wins — the test pins that distinction.
  **MUST**: when a write path starts deleting or renaming a field, grep every
  reader of that field in the same commit. `deleteField()` is a schema change
  with no type system to catch it, and the failure mode is a plausible
  default (`|| 0`), not an error.

## L-37 · The customer storefront rendered a zero price as free, while the admin grid hid it

- **Symptom.** A corp-gift product with no costed components published a
  customer-visible price of **HKD 0** on the product page, and "from HKD 0"
  as its headline price in the shop grid.
- **Root cause.** `PricingTiers.publish()` computes
  `Math.ceil(totalUnitCostAtQty(...) * DEFAULT_MARKUP)`, which is legitimately
  `0` when no component has a preferred supplier quote — so a zero price is a
  real, reachable state, not corrupt data. The two sides then filtered it
  differently: the customer pages used `t.price_hkd != null` (0 passes, and
  `Math.min` even elects it as the "from" price) while the admin grid used a
  truthy filter `t.price_hkd` (0 is dropped). The asymmetry ran in the worst
  possible direction — the customer saw "free", and the only person who could
  have noticed saw an empty row.
- **Permanent fix.** Customer-facing filters now use `Number(price_hkd) > 0`,
  matching the admin side, so an uncosted product shows no price at all
  rather than a free one. **MUST**: when the same data is filtered in an
  internal view and a customer-facing view, the customer-facing filter must be
  at least as strict — and when a computed price can legitimately be zero,
  decide explicitly whether zero means "free" or "not priced yet", because
  `!= null` and truthiness quietly pick opposite answers. **Worth revisiting:**
  this fixes the display, not the cause — `publish()` will still write a 0
  tier. Blocking the publish (or flagging uncosted products before publish) is
  the deeper fix and was deliberately left out of scope here.

## L-38 · A thread's `messages[]` can exceed Firestore's 1 MiB doc cap once media URLs are inline

- **Symptom.** Importing the "Prestige x UA" WhatsApp group (5,257 messages, 2,091 attachments) crashed the media pass: `Document '.../whatsapp_threads/personal__group__prestige-x-ua' cannot be written because its size (1,401,493 bytes) exceeds the maximum allowed size of 1,048,576 bytes.` The text-only import had succeeded — adding the attachment URLs is what pushed it over.
- **Root cause.** A thread doc stores the whole conversation in one `messages[]` array. Per-message overhead is ~170 bytes *before* any URL, so a few thousand messages already approach the cap, and each attachment adds a ~250-byte token URL. Prestige's text-only doc was 1,000 KB; the 2,091 URLs added ~400 KB. **Nothing in the model expected a single thread to cross 1 MiB.**
- **Permanent fix.** `scripts/upload-whatsapp-media.mjs` estimates the doc with URLs and, when it would exceed ~1 MB, writes them to a **separate map doc** `whatsapp_threads/{id}/media/urls` (`{ [attachment_filename]: downloadUrl }`) and strips them from `messages[]` — the thread stays at 1,000 KB, the URLs live in their own doc. Readers **MUST** fall back to it: `CustomerDetail.jsx` reads that doc for any thread whose messages have an `attachment_filename` but no `attachment_url`. **MUST NOT** assume "one thread = one small doc"; any new writer of `messages[]` (including the browser's `uploadAttachments`) has to respect the same cap — known remaining gap in `TECH-DEBT.md`.

## L-39 · A launchd job runs with a minimal `PATH`, so a script calling `node` by name fails into a log

- **Symptom.** The new `com.crystocraft.whatsapp-auto-import` job loaded fine, but nothing ever imported; the only evidence was `node: command not found` in `scripts/whatsapp-sync_*.log`. `launchctl list` showed no obvious failure.
- **Root cause.** launchd starts a job with a minimal environment (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`), not the login shell's `PATH`. Homebrew's node (`/opt/homebrew/bin/node`) is not on it, so the wrapper `bash` script's plain `node …` call could not resolve.
- **Permanent fix.** `scripts/whatsapp-sync.sh` hardcodes `NODE=/opt/homebrew/bin/node` — exactly as `email-sync/hourly_sync.sh` already hardcodes its Python interpreter path. **MUST** use an absolute interpreter path in any launchd-run script. **MUST** verify a new/changed launchd job by `kickstart`-ing it and reading its own log, never by trusting `launchctl list`'s exit status alone.

## L-40 · Netlify's secrets scan fails the deploy on a false positive from seeded test data

- **Symptom.** Two consecutive deploys went to `state: error` ~33 s in with no application change involved; the build log pointed at a line in a **test fixture**.
- **Root cause.** Netlify's secrets scan greps the repo for values resembling the site's configured secrets. `qa/whatsapp-import-smoke.mjs` seeded a fake WhatsApp id — the literal `wa-` plus a digit string shaped like a phone number — and that byte sequence happened to match the value of `RENDER_ADMIN_PASSWORD`, so the scan flagged it as a leaked secret and failed the build. (The exact value is deliberately **not** reproduced here: see L-46.)
- **Permanent fix.** The seeded value became an obviously-fake `wa-00000000000`. **MUST NOT** seed a fixture with anything shaped like a real secret. `RENDER_ADMIN_PASSWORD` **MUST** be treated as compromised (its value is in git history) and rotated — and per the owner, secrets belong in Netlify's own env settings, not hardcoded anywhere in the repo. `SECRETS_SCAN_OMIT_KEYS` in `netlify.toml`'s `[context.production]` is the escape hatch; prefer fixing the fixture.

## L-41 · A WhatsApp group is not a person — filing one against a contact misattributes every message

- **Symptom.** Two exports were group chats ("Prestige x UA", "Intertek Sweden Event Gift"); a group's `_chat.txt` carries a different sender on every line. The importer only knew "customer + contact person" and "lead + phone", so there was no correct way to file them.
- **Root cause.** Thread identity was `account × contact_id`, which assumes exactly one person per conversation. A group has many participants and no single `contacts[]` entry; forcing it onto a person attributes the whole conversation to whichever member was picked, and collides/merges with that person's real 1:1 thread.
- **Permanent fix.** Groups are a **third thread type**: `conversationGroupId({account, groupName})` → `{account}__group__{slug}` (never collides with `{account}__{contactId}`), stored with `thread_type:'group'`, `group_name`, `contact_id:null`, linked to a CUSTOMER (company) rather than a person. `isLegacyThread` now keys on `account` **alone** — the old `!contact_id` test would have mislabelled every group as an un-migrated legacy thread. **MUST NOT** file a group against a contact person. Detect one from the content (a "you created the group" system line, >2 distinct `sender`s) — not the filename, since one group archive is named after the event.

## L-42 · A migrated-away thread stays invisible only if every reader filters its tombstone

- **Symptom.** After the legacy→`account × contact` migration, a customer's WhatsApp card (and the AI summary's candidate list) showed each migrated conversation **twice** — once as the new thread, once as the old one.
- **Root cause.** `migrateLegacyThread` deliberately **never hard-deletes**: it writes the new thread, verifies it, then stamps the old doc `migrated_to: <newId>` as a tombstone so the migration stays reversible via `undoMigrateLegacyThread`. Any reader that just listed `whatsapp_threads` therefore saw both docs.
- **Permanent fix.** Every reader of `whatsapp_threads` **MUST** skip tombstones — `.filter(d => !d.data().migrated_to)` — done in `CustomerDetail.jsx`, `MarketingContacts.jsx`, `src/whatsappSummaryApi.js`, and the Dashboard digest's `activityFromWhatsappThreads`. **MUST NOT** hard-delete on migration; reversibility is the point.

## L-43 · A test double must export every symbol its consumer imports — the smoke test silently stops building

- **Symptom.** `qa/whatsapp-import-smoke.mjs` failed at its esbuild step with an opaque stack trace, after a page change unrelated to the smoke test.
- **Root cause.** The smoke test bundles `WhatsAppImport.jsx` against hand-written stub modules. When the page began importing `mergeLegacyThread` from `../domain/whatsappImport`, the stub didn't export it, so the named import failed to resolve — and esbuild surfaced that as a stack trace, not a "missing export" line.
- **Permanent fix.** When a page adds an import from a stubbed module, add the matching export to that stub in the same change. The stubs are `../domain/whatsappImport`, `../domain/customer`, `../whatsappSummaryApi`. Treat a smoke-test esbuild failure as "a stubbed symbol changed" and read the **top** of the error, not the stack.

## L-44 · "No unintended drift" and "the intended change happened" are different questions — a no-op write answered the first and was reported as success

- **Symptom.** A `seo_batches` item was submitted with `payload` omitted (caller error). `safeWrite` returned `index 0 ok=true verified=true`, the batch result read `{"ok":true,"status":"executed","executed":1,"of":1}` — and **nothing had been written**. An `executed` + `verified:true` batch was indistinguishable from a real write. Raised by DSH while staging a WordPress content edit; the other four language versions of the same hub and the 22 Elementor posts in the corporate cluster all go through this path, so it would recur.
- **Root cause.** Two gaps compounded. `netlify/functions/seo-batch.js`'s `create` coerced a missing payload with `payload: it.payload ?? {}`, so a payload-less item was stored as a valid empty write. Then `safe-write.mjs` computed `ok = !writeErr && drift.length === 0` and returned `verified: ok` — but drift detection only answers *"did anything change that I did not ask to change?"*. It cannot answer *"did the change I asked for happen?"*, and a no-op trivially satisfies the first question. Nothing anywhere asked the second.
- **Permanent fix.** Three parts, all in the OC. (1) `seo-batch.js` `create` rejects any item whose `payload` is absent, `{}` or `[]` with 400 `{ error, indexes }` (exported `emptyPayloadIndexes`). (2) `safe-write.mjs` adds `verified` and `noop`: `intended = expectedFields` (with `*_elementor_data` folded to `meta._elementor_data`), `noop = intended.length > 0 && none of them changed`, `verified = ok && !noop`, and `result.error` explains the no-op. (3) `seo-batch.js` `op:'result'` (exported `batchOutcome`) marks a batch `executed` only when every approved item is `ok:true` **and not** `verified:false`, returns `unverified` as a count, and `/seo-review` / `/seo-reconcile` render it as a failure. **MUST** gate execution on `verified`, never on `ok` alone. **MUST NOT** turn a declared `expectedFields` into an unverifiable write — an empty `expectedFields` (no stated intent) deliberately falls back to `verified = ok` so a no-op alarm is never invented, and a result sent without `verified` at all (older DSH) is treated the same way. Tests: `seo-control-plane/safe-write.test.mjs` (24), `qa/seo-batch-guard.test.mjs` (13).

## L-45 · A parity check comparing a rendered page against a raw body can never pass — Elementor edits were unsatisfiable

- **Symptom.** OC validation blocked a correct Elementor page edit: `FAIL image_count_parity — 0 <img> vs source 36` and `FAIL heading_count_parity — 0 <h2> vs source 4`. The batch was downgraded to `blocked` (nothing unsafe written), but **no** correct Elementor text edit could pass the gate.
- **Root cause.** `validate-payload.mjs` counted `<img>`/`<h2>` with `asString(payload.content) + …` against `asString(source.content) + …`. `seo-batch.js`'s `revalidate()` falls back to `it.before` when no `source` is given, and `before.content` is the **REST `content` object** `{ rendered, raw }` — which `asString()` (a `JSON.stringify`) resolved to the whole thing, and `payloadText` to `.rendered`. For an Elementor post `.rendered` **is the entire built page** (36 images, 4 headings) while the payload's `content` is the raw `post_content` string — a short paragraph with none. The two sides were structurally incapable of agreeing, and the check was being applied to a payload shape it was never written for (for Elementor, `widget_count` + `element_ids_preserved` already guard the tree).
- **Permanent fix.** A `contentString(c)` helper — string → itself; object → `String(c.raw ?? '')` — applied to **both** sides of `image_count_parity`, `heading_count_parity` **and** the `srcBodyStr`/`bodyStr` used by `no_new_scripts`/`no_new_tables`. Preferring `.raw` keeps the check working for classic HTML posts (where `raw` *is* the body) and correctly no-ops for Elementor ones; the rendered page's inline JSON-LD `<script>` had also been suppressing the script check entirely. **MUST NOT** "fix" a parity failure by trimming `source.content` to a bare string — that deletes the source-side data the check exists to compare against (DSH's stopgap: reverted once the validator was corrected). **MUST** compare like with like whenever one side can be a REST object and the other a raw string. **This fix was itself incomplete — see L-47** (a fourth call site, `payloadText()`, and a `.rendered` fallback that quietly restored the old behaviour).

## L-46 · A lesson that quotes the secret it is about re-breaks the deploy

- **Symptom.** Every production deploy after 2026-10-03 07:55 HKT went to `state: error` ~36 s in, while `npm run build` was green locally and the change looked harmless. The site kept serving the **previous** build, so the failure was invisible from the app: it was found only by checking Netlify's deploy records (see below). The first casualty was a **docs-only** commit; the next was a code fix that silently never shipped.
- **Root cause.** **The L-40 write-up quoted the offending fixture value verbatim** — the exact byte sequence that had just failed the secrets scan — so the lesson *about* the leak re-introduced the leak. Netlify's scan matches repository bytes against the site's configured env values (the L-40 mechanism); `SECRETS_SCAN_OMIT_KEYS` did not save it. The tell is that a **docs-only** commit failed: no file that commit touched can break `vite build`, so the failure had to come from a post-build scan of the repository rather than from the build. Confirmed by checking out the last good deploy's tree — the byte sequence is absent from it and present in every failing one. (Two full 64-hex `shasum` digests added to `seo-control-plane/README.md` in the same commit were *suspected* too and were truncated to the L-29 12-char convention — but `deno.lock` is hundreds of 64-hex digests and deploys fine, so high entropy alone is **not** what the scanner keys on; that change is hygiene, not the diagnosed cause.)
- **Permanent fix.** (1) **MUST NOT** reproduce the value a secrets-scan lesson is about — describe its *shape* instead ("`wa-` + a phone-number-shaped digit string"). The same rule applies to a commit message and to any issue/PR text. (2) Hash fingerprints in the repo use the **12-hex** convention (`LESSONS-LEARNED.md` L-29 already passes one back to DSH for re-vendoring). (3) **MUST** verify a deploy actually reached `state: ready` after every push — `git push` succeeding is not a deploy. The check needs no CLI login: `curl -s "https://api.netlify.com/api/v1/sites/<siteId>/deploys?per_page=3"` → look at `state` (`ready`/`error`), and `/api/v1/sites/<siteId>`'s `published_deploy.commit_ref` says which commit is actually live (`siteId` is in the gitignored `.netlify/state.json`). The build **log** does need `netlify login`; the API returns an empty `error_message` to an unauthenticated caller, so ask the owner to paste the failing line. See `../reference/LOCAL-TOOLS.md`.

## L-47 · A same-root-cause fix at three of four call sites comes back at the fourth — and a fallback to the exact value the fix exists to avoid is not a fallback

- **Symptom.** DSH re-ran the affected batch against the deployed L-45 fix and reported defect 2 as *partially* fixed: parity and script/table checks now passed, but `brand_terms_preserved` still failed on a correct Elementor edit — `FAIL brand_terms_preserved — brand term(s) translated away: Swarovski, MagSafe`, on a post whose own text contains neither term. The other four language versions of that hub and the 22 Elementor posts all sat behind it.
- **Root cause.** Two misses, same root cause as L-45. (1) `payloadText()` — which feeds `brand_terms_preserved`, `wrong_language_chars` and `placeholder_markers` — still had its own copy of the bug: `else if (v && typeof v === 'object' && typeof v.rendered === 'string') parts.push(v.rendered)`. On the payload side `content` is a plain string; on the **source** side it is the live REST object, so the whole built page counted as *source text*. The source then always looked richer than the payload, and the brand check — `BRAND_TERMS.filter(t => srcBare.includes(t) && !payBare.includes(t))` — concluded a term was dropped. It is the same false-flag class the function already documents for `yoast_head` / `yoast_head_json` (B53). (2) `contentString()` itself ended `String(c.raw ?? c.rendered ?? '')`: when `.raw` is **absent** it fell straight back to `.rendered`, the exact value the fix exists to avoid. That matters because `wpEntity()` fetches **without `context=edit`**, which omits `.raw` — so any caller who forgot the parameter silently got the old behaviour back, which is what DSH measured: `{ rendered }` alone still failed parity; with `raw` present it correctly skipped.
- **Permanent fix.** `payloadText` now routes object fields through `contentString`, and `contentString` uses **`.raw` only** — an absent `.raw` returns `''`, meaning *"no authored body, nothing to compare"*, so the body-level checks **skip** rather than comparing against the render. Callers **MUST** fetch `source`/`before` with `context=edit` (DSH's `submit-hub-zh.mjs` now does; the check is a silent skip without it, not an error). The `before.content` trimming workaround is dropped. Two rules for next time: **MUST** grep for the *pattern*, not just fix the call site that was reported — "the render is not the body" had four call sites, and fixing three left the gate still unsatisfiable; and **MUST NOT** write a fallback to the very value a fix exists to avoid — silently restoring old behaviour for callers who miss a parameter is worse than skipping, because it reads as "checks ran". Tests: `validate-payload.test.mjs` 49 → 55, all six new assertions verified to fail against the pre-fix validator.
- **Correction (DSH's third pass, and it is right).** Both sites above were real defects and both fixes were worth making — **neither was why `brand_terms_preserved` failed.** The actual cause was a *shape asymmetry* (L-48). DSH's own summary of the process failure is the lesson to keep: *"A defect that reproduces under two different explanations has not been explained by either."* Two plausible root causes were named before the hypothesis was tested; the second fix passed its own test suite and still did not close the reported symptom, which was the signal to stop patching and go measure the data shapes.

## L-48 · `before` is a snapshot, not an entity — a flat/nested shape mismatch silently shrank the gate's own check set

- **Symptom.** DSH's third pass found the OC's authoritative verdict was wrong **in both directions** at once. Read back from the `validation` the OC had *stored* for a batch it accepted, only 12 checks had run — and the batch's item reported:
  ```
  widget_count            *** OC SKIPPED ***
  element_ids_preserved   *** OC SKIPPED ***
  length_anomaly          *** OC SKIPPED ***
  ```
  The same payload with a nested `source` ran 13 checks, all passing. So `failed_validation: 0` had marked a batch safe **having verified none of its Elementor structure**, while the one comparison that did run (`brand_terms_preserved`) failed for a bogus reason — `brand term(s) translated away: Swarovski, MagSafe` on a post whose own text contains neither term.
- **Root cause.** The two sides of an item are stored in **different shapes** and nothing reconciled them:
  ```
  payload = { content, excerpt, meta: { _elementor_data, … } }             ← NESTED
  before  = { content, title, "meta._elementor_data": …, "meta._yoast…": … } ← FLAT
  ```
  `seo-batch.js`'s `revalidate()` falls back to `it.before` when no `source` is given, and (1) `parseElementor(source?.meta?._elementor_data)` finds nothing in a flat object, so the three `_elementor_data` guards — B20 stale-copy, B6 hallucination-scale — **silently never ran**; while (2) `payloadText()` skipped the *key* `meta` but not the *dotted key* `meta._elementor_data`, so the entire Elementor JSON (50,082 chars in the measured case, including container settings, image filenames and alt text that `widgetTexts` deliberately excludes) was pushed as source **text**. The source therefore always looked richer than the payload, and `brand_terms_preserved` — `BRAND_TERMS.filter(t => srcBare.includes(t) && !payBare.includes(t))` — concluded a term had been dropped. A gate that quietly shrinks its own check set is worse than no gate: it reports `passed` with the confidence of a full validation while having run a partial one.
- **Permanent fix.** (1) `normalizeEntity()` in `validate-payload.mjs` folds dotted `meta.*` keys into a nested `meta`, applied to **both** `payload` and `source`, so every check is shape-agnostic and a flat `before` is a usable source. It lives in the **validator** rather than in `revalidate()` so the Workbench's vendored copy and any future caller are protected too; `payloadText` additionally skips `meta.*` so the raw-JSON-as-text leak cannot come back. (2) **Skips are first-class**: `checks[].ok` may be `null` ("did not run", with the reason in `detail`), `validatePayload` returns `{ passed, checks, ran, skipped }`, `create` returns `skipped_validation`, and `/seo-review` names the skipped checks against the item. `passed` still fails only on an explicit `false`, so nothing that passed before fails now — but `passed: true, skipped: 0` is a full pass and `skipped > 0` is a partial one. (3) A payload that **writes `_elementor_data` MUST carry a usable source tree**: without one the three layout guards report `ok:false` and the item is blocked — an unguarded layout write is precisely what they exist to stop, so that case fails rather than skips. Tests: `validate-payload.test.mjs` 55 → 72, the new assertions verified to fail against the pre-fix validator (three structural guards absent, brand falsely dropped, gate blocking a correct edit). **MUST NOT** pass a field *snapshot* where an entity is expected — `before` exists for the audit trail and the drift fingerprint; a type error there disables checks instead of raising. **MUST NOT** let a gate's check set shrink without saying so: if a check cannot run, that fact belongs in the result. **MUST** test the data-shape hypothesis before naming a cause — this took three passes, and the first two explanations each had a plausible mechanism and a green test suite.
- **Verified, and the process rule that came out of it (2026-10-03).** DSH re-ran the affected batch against the deployed validator (`validate-payload.mjs` fingerprint `9d5eb99c6eda`, OC deploy `099aa2968`) and it **passes on its own merits** — the three `_elementor_data` guards now run, `brand_terms_preserved` no longer false-flags, and the `before.content` trimming workaround is no longer wanted. The transferable rule, and the reason this lesson is written the long way: **MUST NOT** report a defect fixed until the *reporter's* reproduction passes. Three passes were spent here — the first two each had a plausible mechanism and a green local suite, and both were wrong. A green suite on the fixer's side proves the fix does what the fixer thought; it says nothing about whether it addresses what the reporter saw. DSH's own summary of why is worth keeping verbatim: *"A defect that reproduces under two different explanations has not been explained by either."*

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
| 2026-09-23 | Added L-29 — `seo-control-plane/validate-payload.mjs`'s `placeholder_markers` check had zero French/Japanese coverage and Chinese-simplified-only terms, missing traditional Chinese (a first-class site language) entirely; 28 of 29 sitewide leaked-translator-instruction posts, reported by a Workbench handoff, predated any check that could have caught them. Added `FRENCH_INSTRUCTION_RX`/`JAPANESE_INSTRUCTION_RX`/`TRADITIONAL_ZH_INSTRUCTION_RX`, gated on co-occurrence (marker + translation stem) to avoid false-positiving on real copy, per the same shape `SPANISH_INSTRUCTION_RX` already used. Verified independently (not just trusted the handoff) with a standalone script before applying, then the full 35-test suite after. New checksum `8f7599b1c64c` to pass back for re-vendoring. |
| 2026-10-03 | Added L-38 through L-43 from the WhatsApp archive-import build (plan: `../plans/WHATSAPP-ARCHIVE-IMPORT-PLAN.md`): a thread's `messages[]` blows past Firestore's 1 MiB cap once media URLs are inline (Prestige x UA group — spill to `whatsapp_threads/{id}/media/urls`), L-39 (a launchd job's minimal `PATH` can't find Homebrew `node` — use an absolute interpreter path; verify via the job's own log), L-40 (Netlify's secrets scan failed the build on a digit-string in a smoke-test fixture that matched `RENDER_ADMIN_PASSWORD`; rotate it, and keep secrets in Netlify's env), L-41 (a WhatsApp group is not a person — new `group` thread type keyed `account × group-name`, and `isLegacyThread` now keys on `account` alone), L-42 (every `whatsapp_threads` reader must filter the `migrated_to` tombstone or migrated chats show twice), L-43 (a stubbed module must export every symbol its consumer imports — the smoke test's esbuild step is the canary). |
| 2026-10-03 | Added L-44 and L-45 from the two SEO control-plane defects DSH raised while staging a WordPress write (`docs/skills/SEO-CONTROL-PLANE.md`, brief §"After the fix"): a payload-less item became `{}`, wrote nothing, and returned `ok:true/verified:true` so the batch reported `executed` — drift detection cannot prove the *intended* change happened, so `create` now rejects empty payloads, `safeWrite` returns `verified`/`noop`, and `op:'result'` marks such a batch `partial` (L-44); and image/heading parity compared a live `.rendered` Elementor page against a raw payload body, making every correct Elementor edit unsatisfiable — both sides now read `.raw` via `contentString()`, as do the script/table checks (L-45). Both vendored files re-hashed for DSH. |
| 2026-10-03 | Added L-46 after the push for L-44/L-45 turned out **not to have deployed**: every production deploy since the L-40 write-up failed with `state: error` ~36 s in, because that lesson quoted the offending fixture value verbatim, re-introducing the byte sequence the secrets scan matches. L-40's text is now redacted to the value's *shape*, `seo-control-plane/README.md` records 12-hex fingerprints (the L-29 convention; `deno.lock` proves high entropy alone is not the trigger), and `../reference/LOCAL-TOOLS.md` documents the no-login deploy-state check — `git push` succeeding is not a deploy. |
| 2026-10-03 | Added L-48 — DSH's third pass found the real cause of the `brand_terms_preserved` failure and, underneath it, that the OC's authoritative gate had been running a **reduced check set**: `payload` is nested (`meta: {…}`) while `before` is flat (`'meta._elementor_data'`), so falling back to `before` as `source` silently skipped `widget_count` / `element_ids_preserved` / `length_anomaly` *and* pushed the whole Elementor JSON as source text. `normalizeEntity()` now folds dotted keys into a nested `meta` for both sides, skips are first-class (`ok: null` + reason, `{passed, checks, ran, skipped}`, `skipped_validation` on `create`, listed in `/seo-review`), and a layout write with no usable source tree is **blocked**. L-47 was corrected: its two sites were real defects but neither was the cause. `validate-payload.test.mjs` 55 → 72, fingerprint `9d5eb99c6eda`. |
| 2026-10-03 | **Closed — DSH confirmed the control-plane defects are fixed.** Three rounds: defect 1 (empty payload / no-op reported as success — L-44) and defect 2 fixed on the first pass; `payloadText` + the `.rendered` fallback on the second (L-47, real defects, not the cause); and the flat/nested shape asymmetry on the third (L-48 — the actual cause, which had also been silently disabling three layout guards while the gate reported `passed`). Verified against deploy `099aa2968`, `validate-payload.mjs` `9d5eb99c6eda` / `safe-write.mjs` `653305dd4fe8`. The lasting process rule is in L-48: a defect is not fixed until the reporter's reproduction passes. |
| 2026-10-03 | Added L-47 — DSH verified defect 1 fixed and defect 2 only *partially*: the "render is not the body" fix had a fourth call site (`payloadText()`, feeding `brand_terms_preserved` / `wrong_language_chars` / `placeholder_markers`) and `contentString()` still fell back to `.rendered` when `.raw` was absent — which is the default for `wpEntity()` without `context=edit`, so the fallback silently restored the old behaviour. `contentString` is now `.raw`-only (absent → '' → check skips), `payloadText` routes objects through it, and the `before.content` workaround is dropped. `validate-payload.test.mjs` 49 → 55, the six new assertions verified to fail against the pre-fix validator. `validate-payload.mjs` re-fingerprinted (`3bf6c751c578`). |
