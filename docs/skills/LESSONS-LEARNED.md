# Lessons Learned — the Error Log (CRITICAL)

> Every significant failure and its **verified permanent fix**, in
> Symptom / Root cause / Permanent fix form, code-linked. Read this before
> "fixing" anything that feels familiar. **After any new incident, add an
> entry** — this file is how the same mistake stops being made twice.
>
> Ordered roughly by blast radius. Related boundaries: `ARCHITECTURE-RULES.md`.

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
  recipe in `LOCAL-TOOLS.md` §GA4) before concluding the pipeline is broken.
  The `byUid` query is wrapped `.catch(()=>null)`, so a bad dimension name fails
  *silently* — check the dimension is registered (`customUser:app_uid`).

## Operational reminders (low blast radius, high friction)

- **Bump `APP_VERSION` at cycle START**, not close (`src/appInfo.js`; corrected
  repeatedly — memory `version-bump-timing`).
- **Netlify deploy credit is limited** — batch commits, confirm before pushing to
  `main` (memory `netlify-deploy-credit`).
- **Node / firebase-tools are already on PATH** — don't re-walk install
  (`LOCAL-TOOLS.md`; memory `local-tools-available`).
- **A local `/api/* 404` is normal** — dev runs `netlify-cli dev --offline`
  (memory `edge-functions-local-dev`).
- **Don't revive `PRODUCT-VARIANTS-PLAN.md`** without reading its §4 audit — a
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
