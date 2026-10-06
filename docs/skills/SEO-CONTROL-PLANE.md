# SEO Control Plane — Operation Center ⟷ DeepSeek Workbench

> **Purpose.** The DeepSeek Workbench (DSH) is the fast *producer* of crystocraft.com
> SEO / multilingual / Artgen work. Its failure pattern (Workbench
> `SEO/LESSONS-LEARNED.md` B1–B53) is always the same shape: **output written
> live → damage found hours/days later → no restorable state**. This document
> defines the control plane that moves *durable state, the approval record, and
> verification* onto the Operation Center — the code-reviewed side that does not
> hallucinate. DSH stays the sole writer of WordPress; the OC never writes
> WordPress.
>
> **Ownership.** The OC (Claude) owns this file and the Firestore schema below.
> DSH reads it and implements the producer side (`safeWrite`, `validate-payload`,
> writing batches). Division of labour otherwise per
> `Deepseek Workbench/SEO/MASTER-SKILL-ALIGNMENT.md`.

## The four steps

| Step | What | Where | Status |
|---|---|---|---|
| 1 | **State store + snapshot** — a structured "what's live now" for posts/pages, snapshottable for rollback | OC page `/seo-state`, edge fn `seo-state`, Firestore `seo_state` + `seo_state_history` | **BUILT 2026-09-02** |
| 2 | **Batch / review contract** — DSH prepares a change batch, the human approves it per-item in the OC against a real diff | Firestore `seo_batches`, Node fn `seo-batch`, OC page `/seo-review` | **BUILT 2026-09-02** |
| 3 | **`safeWrite` + `validate-payload`** — no DSH script writes WordPress except through a snapshot-guarded, field-scoped wrapper; no payload reaches a write without passing the code gate | Reference impls in `seo-control-plane/` (OC-owned, DSH vendors) | **BUILT 2026-09-02**; **V8.15:** the OC now re-runs `validate-payload.mjs` server-side in `seo-batch.js` `create` (stored `validation` = OC's, DSH's kept as `dsh_validation` + `validation_mismatch`), and `poll` blocks any approved-but-OC-failed item — the gate no longer relies on DSH's honesty. **2026-10-03:** two control-plane defects fixed — empty-payload items rejected at `create`, `verified`/`noop` added to `safeWrite` so a no-op can never report success (L-44), and every body-level check (parity, scripts/tables, and the brand/language text scans) compares the RAW body (L-45, completed at the fourth call site by **L-47**) |
| 4 | **Reconciliation** — live state vs a history snapshot or an executed batch; flags a reverted page, a clobbered layout, a disappeared SEO field | OC page `/seo-reconcile` | **BUILT 2026-09-02** |

Products are already covered by `woo-sync.js` `catalogue_page` → the **Woo Catalogue** page (Yoast title/desc + WPML `translations` per product). This control plane adds **blog posts and pages**.

## Step 1 — the state store (BUILT)

### Corpus language sweep (2026-10-06)

`/api/seo-state` also accepts admin-only `{ op:'corpus', kind:'product'|'post'|'page', lang, page }`.
It reads one page of 20 **published** translations and returns `{ scanned,
flagged:[…], incomplete:[…], has_more }`; call pages from 1 until `has_more:false` for every
kind/language pair. Products use the server's WooCommerce read credentials;
posts/pages use the WP Application Password with `context=edit`. It measures
`post_content`, `post_excerpt`, and Elementor `editor`, `title`, `text`,
`description_text`, `caption` fields from their authored values, not the
rendered page. Each flagged row includes its aggregate script counts and
offending fields. `incomplete` names rows where the REST response did not
expose Elementor meta or raw WP body, so a partial scan is not mistaken for a
clean page. Thresholds: zh-hant/zh-hans Han <40%; ja Han+kana <30%;
es/fr CJK >5%; en CJK >40%. This is a **read-only audit of existing content**,
not a payload gate and not an automatic repair. An absent/invalid Elementor
tree is reported; an empty body has no ratio and is not mislabeled English.

Example request (with an admin Firebase ID token):
`POST /api/seo-state` with `{"op":"corpus","kind":"product","lang":"zh-hant","page":1}`.
Do not infer a full-site result from one page; record pages scanned and any
WordPress API failures.

**Vantage notes (measured 2026-10-06):** WordPress cache `Vary` includes
`User-Agent`, so a Googlebot-shaped fetch and a plain fetch may see different
cache variants. For a comparison use the same user-agent on both reads and
verify the public render separately. WCML `by_location` converts a REST
`regular_price` by requester location (the reported Hong Kong workstation saw
HKD); it is not the stored database value. Verify price truth through WP-CLI,
not a location-sensitive REST response.

### `seo-state` edge function (`/api/seo-state`, admin-gated, read-only)
Reads via the **WP Application Password** (`WP_USER` / `WP_PASS` — `wp/v2/*` does
not accept the WooCommerce Consumer Key). Ops:

- `{ op: 'languages' }` → `wpml/v1/languages`, falls back to `en / es / zh-hant / ja / fr`.
- **Products** are also pulled into `seo_state` (`kind: 'product'`, via the
  `woo-sync` `catalogue_page` op — `wc/v3`, Yoast read from `meta_data` by key,
  no `_elementor_data`) so reconcile resolves product batch items. Keyed
  `product:<id>`, matching a batch item's `{ kind:'product', id }`.
- `{ op: 'content_page', kind, lang, page }` — one page (100) of `wp/v2/posts` or
  `wp/v2/pages` in one language, `context=edit`. Each row:
  `{ id, kind, lang, slug, status, link, modified, title, seo_title, seo_desc,
  seo_title_set, seo_desc_set, focus_kw, elementor_len, elementor_hash }`.
  - `seo_title` / `seo_desc` = `yoast_head_json.title` / `.description` (what
    actually renders); `*_set` = whether `_yoast_wpseo_*` meta is hand-written
    vs Yoast auto-generating it.
  - `elementor_hash` = FNV-1a 32-bit of `_elementor_data` — a cheap layout
    fingerprint so a layout change is visible without storing 60 KB/post.
- `{ op: 'wpml_status', type }` — best-effort `wpml/v1/posts?type=post|page`
  (authoritative per-language status 0/3/10); shape returned as-is.

### Firestore

- **`seo_state/{doc}`** — the current snapshot, chunked (`head` + `c0..cN`,
  500 rows/chunk). Mutable cache; `saveSeoState` overwrites on Refresh.
  Admin read/write.
- **`seo_state_history/{autoId}`** — **APPEND-ONLY** timestamped snapshots
  (`{ rows, row_count, note, taken_at }`). Never updated or deleted. This is
  the rollback reference. Admin read + create only.

Both written by `src/seoCache.js`; read by `src/pages/SeoState.jsx` via
`src/seoStateApi.js`.

### Usage discipline (the point of Step 1)
**Before any bulk WordPress change, take a snapshot** (`/seo-state` → "Save
snapshot", with a note like "before FR product batch"). If a later change
reverts a slug, flips a status, wipes SEO meta, or replaces a layout, the
snapshot row says what it was — diff `elementor_hash` / `slug` / `status` /
`seo_*` against the current read.

## Step 2 — batch / review contract (BUILT)

### `seo-batch` Node function (`/api/seo-batch`)
A **Node** Lambda (writes Firestore via the Admin SDK, same as
`portal-invite.js`; shares `netlify/functions/lib/firebaseAdmin.js`).
**Auth is a shared secret, not a Firebase session** — the caller is a machine:
`Authorization: Bearer <SEO_BATCH_SECRET>`. Set `SEO_BATCH_SECRET` (≥16 chars)
on Netlify **and** in the Workbench `.env`.

DSH ops (POST JSON):
- `{ op: 'create', batch: { note, items: [...] } }` → `{ id }`. Each item:
  `{ id, kind, lang, endpoint, summary, payload, before, validation }`
  (≤500 items). Stored with `decision: 'pending'`, `result: null`,
  `status: 'pending_review'`. **An item with an empty/absent `payload` is
  rejected 400** (`{ error, indexes }`) — nothing to write (fix 1a, 2026-10-03).
- `{ op: 'poll' }` → batches where `status === 'approved'` (execute these).
- `{ op: 'get', id }` → one batch.
- `{ op: 'result', id, results: [{ index, ok, after, verified, noop, error }] }`
  → merges results; `status` → `executed` only when every approved item is
  `ok:true` **and not** `verified:false`, else `partial` (plus `executed`,
  `unverified`, `of` counts). `ok` proves no *unintended* drift; `verified`
  proves the *intended* change happened — a no-op satisfies the first trivially
  (fix 1b, 2026-10-03).

### `seo_batches/{autoId}` (Firestore)
```
{
  created_by: 'dsh', created_at, note, item_count,
  status: 'pending_review' | 'approved' | 'rejected' | 'executed' | 'partial',
  items: [{
    index, id, kind, lang, endpoint, summary,
    payload,                                       // exact WP write body
    before,                                        // touched fields pre-write
    validation: { passed: bool|null, checks: [{name, ok}] },
    decision: 'pending' | 'approve' | 'reject',    // set by the human in /seo-review
    result: null | { ok, after, verified, noop, error, at }
  }]
}
```
`result.verified === false` (with `ok: true`) means the write was a **no-op** —
nothing in `expectedFields` moved. `/seo-review` renders it as a failure, not
"✓ executed", and `/seo-reconcile` buckets it `failed`.
Rules: `read, update` if admin (the human, via `/seo-review`); `create, delete`
denied (DSH creates via Admin SDK, bypassing rules).

### `/seo-review` (OC page, admin)
Lists batches; for the selected one, renders each item as a `before → after`
field diff with per-item Approve / Reject (plus "approve all passing
validation" / "reject all"). **Send to DSH** flips `status` to `approved` (if
≥1 approved) or `rejected` — only when every item has a decision. After DSH
executes, each item shows its `result`.

### Contract flow
DSH prepares → `create` → human reviews at `/seo-review` → Send to DSH →
DSH `poll` → executes each approved item through **`safeWrite`** (Step 3) →
`result` back. Step 4 reconciliation then confirms live state matches.

## Step 3 — `safeWrite` + `validate-payload` (BUILT — `seo-control-plane/`)

**2026-10-06 gate changes.** `length_anomaly` now means actual >3×/4×
growth; an unchanged old cap breach is separately
`over_cap_pre_existing` (blocked unless the item carries
`acceptPreexistingOverCap:true`, which is recorded in the check detail), while
any changed/introduced cap breach is `over_cap_introduced` and still blocked.
An intentional append carries both `appendOnly:true` and
`expectedNewIds:[…]` on the batch item; the OC re-validation passes them to
the validator, which requires precisely those new IDs and a matching widget
count increase. These options are **item metadata**, not WordPress payload
fields. `safeWrite` now compares each requested concrete field's full read-back
value with the exact payload (not just before/after movement): wrong or empty
postmeta yields `ok:false`, `verified:false`, and `unlanded`. A Yoast meta write
requires the Workbench's WP-CLI-backed indexable invalidation callback after
the meta read-back lands. Missing/failed callback prevents a verified success.
The OC still never writes WordPress.

Dependency-free ESM reference implementations, OC-owned SSOT, the Workbench
**vendors them verbatim**. See `seo-control-plane/README.md`.

- **`validate-payload.mjs`** — `validatePayload({ kind, lang, endpoint,
  payload, source })` → `{ passed, checks: [{ name, ok, detail }] }`. 16 checks,
  each mapped to a Workbench LESSONS-LEARNED entry: `json_parses` (B32),
  `widget_count` + `element_ids_preserved` (B20 stale-copy), `length_anomaly`
  (B6), `wrong_language_chars` (B33/B35 CJK leak, B6 simplified-in-zh-hant),
  `placeholder_markers` (B12; fr/ja/zh-hant coverage added **L-29**,
  and the **zh-hant `SIMPLIFIED` guard is DERIVED from OpenCC's
  `STCharacters.txt` — 3,803 characters, not the 193 hand-picked ones it replaced
  (L-49)**; `scripts/derive-zh-hant-simplified.mjs --check` re-derives and fails on
  drift, so the constant must never be hand-edited),
  2026-09-23 — was en/es/zh-hans only, missing half the languages this site
  publishes in), `brand_terms_preserved` (§3c), `sku_prefix_
  preserved` (B12), image/heading count parity (§2), `no_new_scripts/tables`,
  `seo_title_no_double_brand` (L-09), `seo_desc_length` (B47),
  `translation_draft_only` (Rule 4), and `no_encoding_damage` (U+FFFD, lone
  surrogates, legacy mojibake). CJK and encoding scans run on the
  **JSON-decoded** `_elementor_data` (B35e). **New 2026-10-03 (L-45): the parity
  and script/table checks read the RAW body on both sides** via `contentString()`
  — a live entity's `content` is the REST object `{ rendered, raw }` and
  `.rendered` is the whole built page for an Elementor post, so raw-vs-rendered
  could never agree and *every* correct Elementor edit failed the gate. **A
  same-day follow-up (L-47) closed the same bug at its fourth call site**:
  `payloadText()` — which feeds `brand_terms_preserved`, `wrong_language_chars`
  and `placeholder_markers` — also resolved objects to `.rendered`, so the built
  page counted as *source text* and brand terms were reported "translated away"
  (`Swarovski, MagSafe`) on posts whose own body had never contained them. And
  `contentString()` no longer falls back to `.rendered`: an absent `.raw` returns
  `''`, so the body-level checks **skip** — because `wpEntity()` fetches without
  `context=edit` by default and a fallback silently restored the old behaviour.
  **Callers MUST fetch `source`/`before` with `context=edit`**, or those checks
  cannot run. The Workbench attaches the result as each `seo_batches` item's
  `validation` field.
  **Finally (L-48), a shape asymmetry DSH found on its third pass — the real
  cause.** An item's `payload` is **nested** (`meta: { _elementor_data }`) while
  its `before` snapshot is **flat** (`'meta._elementor_data'`), and
  `revalidate()` falls back to `before` as the `source`. A flat entity used to
  (a) leave `parseElementor(source.meta._elementor_data)` empty, **silently
  disabling** `widget_count` / `element_ids_preserved` / `length_anomaly` — the
  OC's stored validation simply did not contain them — and (b) have its whole
  Elementor JSON (50 KB measured) pushed as source *text*, making
  `brand_terms_preserved` unsatisfiable. `normalizeEntity()` now folds dotted
  `meta.*` keys into a nested `meta` for both sides, so a flat `before` is a
  usable source and every check is shape-agnostic. **Skips are first-class**:
  `checks[].ok` may be `null` ("did not run", reason in `detail`),
  `validatePayload` returns `{ passed, checks, ran, skipped }`, `create` returns
  `skipped_validation`, and `/seo-review` names the skipped checks — so
  `passed: true, skipped: 0` (full pass) is finally distinguishable from a
  partial one. A payload that writes `_elementor_data` **MUST** carry a usable
  source tree; without one the three layout guards report `ok:false` and the item
  is blocked.
  **Three entity SHAPES and one comparison rule (L-50/L-52, 2026-10-03).** A
  product carries meta as a WooCommerce LIST (`meta_data: [{key, value}]`), not
  `meta._elementor_data` — reading only the nested object left a product payload
  apparently textless (`brand_terms_preserved` falsely failing, `json_parses` and
  the three `_elementor_data` guards **absent**). `normalizeEntity` now folds
  nested `meta`, dotted `meta.*` and `meta_data[]` into one `meta`. And a
  body-level check compares **only the fields both sides carry** (`sharedBody`):
  with no overlap it SKIPS with a reason, because a source that is present but
  incomplete — a `before` carrying only `_elementor_data` — otherwise reports a
  page's existing `<table>` as newly introduced.
  `node seo-control-plane/validate-payload.test.mjs` covers the known incident
  cases (135 after the 2026-10-06 gate additions).
- **`safe-write.mjs`** — `safeWrite({ get, put, id, endpoint, payload,
  expectedFields })`. Snapshots the entity → writes → re-reads → returns
  `{ ok:false, drift:[…] }` if any watched field outside `expectedFields`
  changed (plus a dedicated **variation id/price hash** guard for B52 — a
  variable-product save regenerating all variations with no prices). `get`/`put`
  are the Workbench's own `wp-api.mjs` helpers, injected. `*_elementor_data`
  fields are fingerprinted by FNV-1a for drift checks; requested-value read-back
  compares the full value. It returns `verified` + `noop`; callers gate on
  `verified`, never on `ok` alone. **Verification is per FIELD (L-51):** it
  returns **`unlanded`** — payload fields whose post-read differs from the
  exact requested value, even if something moved — so a payload
  where `description` lands and `meta._elementor_data` silently does not is
  **not** verified, and the error names the field. A mismatch makes **both**
  `ok` and `verified` false. Yoast meta writes require `invalidateYoastIndexable`
  to confirm the matching indexable row was deleted after the value landed;
  the Workbench supplies WP-CLI transport using `yoast-indexable.mjs`. `get()`
  also resolves a dotted `meta.<key>` from WooCommerce's `meta_data[]` (L-50). Returns a `result` object
  shaped for the `seo_batches` `result` op. **No Workbench script writes WordPress any other
  way.**

  **Wire contract (2026-10-06 smoke follow-up):** a product must be reviewed and
  sent as `payload: {meta_data:[{key:'_yoast_wpseo_title',value:'…'}]}`;
  its fresh `get` must expose `meta_data[]`. A `wp/v2` post/page writes
  `payload: {meta:{_yoast_wpseo_title:'…'}}` and must expose that field in a
  fresh `get`. In both cases `expectedFields` is
  `['meta._yoast_wpseo_title']`. `safeWrite` understands either in-memory
  carrier, but WooCommerce ignores nested `meta` on write. A `put` response
  echoing the request is not evidence that the value persisted. See the
  exact examples and SSH transport quoting in `seo-control-plane/DSH-BRIEFING.md`.

This directory is also the **vendoring contract**: DSH copies the validator,
write wrapper, and Yoast invalidation helper
verbatim and verifies the sha256[:12] fingerprint recorded in
`seo-control-plane/README.md` (`validate-payload.mjs` = `57e397f1b810`,
`safe-write.mjs` = `8e4d16f4f195`,
`yoast-indexable.mjs` = `28eba647fe55` after the 2026-10-06 changes). The
OC tells DSH when a vendored file changes (`op:'create'` re-runs the validator
server-side, so a stale copy shows up as `validation_mismatch`). Local tests:
`validate-payload.test.mjs` (135 assertions), `safe-write.test.mjs` (47),
`corpus-language.test.mjs` (5), `yoast-indexable.test.mjs` (2), and
`qa/seo-batch-guard.test.mjs` (13) for the
OC-side guards. When a fix changes a *class* of bug, grep for the pattern across
the file before declaring it done — L-47 is what happens otherwise.

## Step 4 — reconciliation (BUILT — `/seo-reconcile`)

Diffs the **current** `seo_state` (SEO State page's cache — only as fresh as
the last read there) against a chosen baseline. Two modes:

- **vs Snapshot** — pick a `seo_state_history` entry. Per content row, compares
  `status` / `slug` / `seo_title_set` / `seo_desc_set` / `elementor_hash`.
  Buckets: `unchanged` / `changed` (with per-field from→to) / `new` (in current,
  not snapshot) / `gone` (in snapshot, not current). Answers "has anything
  drifted since T?" regardless of cause — a reverted page, a clobbered layout,
  SEO meta that vanished.
- **vs Batch** — pick an `executed` / `partial` batch. Per approved item,
  compares the current row against `result.after` (the `safeWrite` fingerprint
  taken right after the write): `slug` / `status` / layout hash changed *since
  execution*, or a Yoast title/meta-desc we wrote that is no longer set, or the
  execution itself failed (`result.ok === false`). Buckets: `held` / `drifted` /
  `failed`. Answers "did our approved changes land and stay?"

CSV export of the drift/failed rows in both modes.

## Change Log

| Date | Change |
|---|---|
| 2026-10-06 | DSH's Yoast smoke test exposed an ambiguous meta write contract: `safeWrite` understands nested and list carriers, but `wc/v3` only writes `meta_data[]`; the reviewed payload must be the same body sent at execution. Documented exact `payload`/fresh `get`/`expectedFields` shapes for products and `wp/v2` posts/pages, remote-shell quoting for WP-CLI, and the Workbench sync check's need to inspect both active vendor copies plus `yoast-indexable.mjs`. Added product Yoast and misleading-PUT-echo tests; an undefined old `meta` carrier is no longer counted as an intended field. The Workbench-owned checker and client still need DSH changes. |
| 2026-10-06 | Corpus script-ratio audit, split cap/growth checks with explicit pre-existing acknowledgement, declared Elementor append intent, exact per-field write read-back, and a fail-closed Workbench Yoast indexable deletion contract. Two vantage notes: User-Agent cache variants and WCML `by_location` REST price conversion. See the sections above and `seo-control-plane/README.md` for current hashes. |
| 2026-09-02 | Steps 1–4 built: `seo_state`/`seo_state_history`, `seo_batches` + `seo-batch` + `/seo-review`, `seo-control-plane/` (`validate-payload` + `safe-write`), `/seo-reconcile`. |
| 2026-09-23 | **L-29** — `placeholder_markers` extended to fr/ja/zh-hant (was en/es/zh-hans only). |
| 2026-10-03 | **Two control-plane defects raised by DSH while staging a WordPress write, both fixed here.** (1) A payload-less item was accepted, wrote nothing, and returned `ok:true/verified:true` → the batch reported `executed`. `create` now rejects an empty payload (400), and `safeWrite` returns `verified`/`noop` (gate on `verified`, not `ok`) with `op:'result'` marking such a batch `partial`. (2) Image/heading parity was unsatisfiable for Elementor edits because a live entity's `.rendered` page was compared against a raw payload body — both sides now go through `contentString()`, which prefers `.raw`, as do `no_new_scripts`/`no_new_tables`. DSH re-vendors both files (sha256[:12] fingerprint in `seo-control-plane/README.md`) and drops its `before.content` workaround. See `LESSONS-LEARNED.md` L-44 / L-45. |
| 2026-10-03 | **L-50 / L-51 / L-52 — four product-write gaps.** (1) **WooCommerce's meta shape** (`meta_data: [{key, value}]`): product payloads looked textless, so `brand_terms_preserved` falsely failed and the three `_elementor_data` guards **did not run**. All three shapes now fold into `meta`. (2) **`verified` is per FIELD**: `safeWrite` returns `unlanded` (asked for a change, did not move) and requires it empty — four product fixes had been called clean with untouched trees. (3) **An incomplete source skips**: body checks compare only the fields both sides carry, so a `before` with only `_elementor_data` no longer reports an existing `<table>` as newly introduced (nor a meta-only write as an image wipe). Fingerprints `8ab3fdd35671` / `cdd1502769db`; tests 107 → 126 and 24 → 36. |
| 2026-10-03 | **L-49 — the zh-hant `SIMPLIFIED` guard replaced with a derived list.** The 193 hand-picked characters were 4.9% of the 3,803 that OpenCC's `STCharacters.txt` marks simplified-only (missed `订 礼`, so `訂製`/`禮品` passed), contained seven valid-Traditional characters (`云 厂 叶 后 广 征 种`, so `皇后`/`征戰` were rejected) and 10 duplicates. Derived instead — and the derivation needs no exemptions, so the six previously special-cased fall out automatically. `scripts/derive-zh-hant-simplified.mjs --check` guards against drift; tests 72 → 107, and against the old guard the new suite fails 26 assertions. |
| 2026-10-03 | **CLOSED — all three control-plane defects fixed and verified by DSH against the deployed build.** Defect 1 (empty payload / a no-op reported as `executed+verified`, L-44), defect 2's four `.rendered` call sites (L-45, L-47) and the flat/nested shape asymmetry underneath the brand-check failure (L-48 — which had also been silently disabling `widget_count` / `element_ids_preserved` / `length_anomaly` on the authoritative side). Final fingerprints: `validate-payload.mjs` `9d5eb99c6eda`, `safe-write.mjs` `653305dd4fe8`; live in OC deploy `099aa2968`. Skips are now first-class so a partial pass can never again be read as a full one. |
| 2026-10-03 | **L-48 — DSH's third pass found the real root cause: a shape asymmetry.** `payload` is nested while `before` is flat; falling back to `before` as `source` silently disabled the three `_elementor_data` guards **and** pushed the whole Elementor JSON as source text, so the gate was wrong in both directions (skipped what matters, failed what should pass) while reporting `passed`. `normalizeEntity()` normalises both shapes inside the validator (so DSH's vendored copy is covered too, and `revalidate()` needs no change); skips are first-class (`ok:null` + reason, `{passed, checks, ran, skipped}`) and surfaced via `skipped_validation` on `create` and in `/seo-review`; a layout write with no usable source tree is blocked. Fingerprint `9d5eb99c6eda`; tests 55 → 72. |
| 2026-10-03 | **L-47 — defect 2's fix was incomplete and DSH verified the remainder.** `payloadText()` was a fourth call site of the same bug (it fed `brand_terms_preserved` / `wrong_language_chars` / `placeholder_markers` from the built page, so the source always looked richer than the payload and brand terms read as "translated away"), and `contentString()` still fell back to `.rendered` when `.raw` was absent — the default for `wpEntity()` without `context=edit`. `contentString` is now `.raw`-only and `payloadText` uses it; an absent `.raw` makes the body-level checks **skip** rather than compare against the render. New `validate-payload.mjs` fingerprint `3bf6c751c578`; callers must fetch `source`/`before` with `context=edit`. `validate-payload.test.mjs` 49 → 55. |
