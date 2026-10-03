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

Dependency-free ESM reference implementations, OC-owned SSOT, the Workbench
**vendors them verbatim**. See `seo-control-plane/README.md`.

- **`validate-payload.mjs`** — `validatePayload({ kind, lang, endpoint,
  payload, source })` → `{ passed, checks: [{ name, ok, detail }] }`. 16 checks,
  each mapped to a Workbench LESSONS-LEARNED entry: `json_parses` (B32),
  `widget_count` + `element_ids_preserved` (B20 stale-copy), `length_anomaly`
  (B6), `wrong_language_chars` (B33/B35 CJK leak, B6 simplified-in-zh-hant),
  `placeholder_markers` (B12; fr/ja/zh-hant coverage added **L-29**,
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
  `node seo-control-plane/validate-payload.test.mjs` covers the known incident
  cases.
- **`safe-write.mjs`** — `safeWrite({ get, put, id, endpoint, payload,
  expectedFields })`. Snapshots the entity → writes → re-reads → returns
  `{ ok:false, drift:[…] }` if any watched field outside `expectedFields`
  changed (plus a dedicated **variation id/price hash** guard for B52 — a
  variable-product save regenerating all variations with no prices). `get`/`put`
  are the Workbench's own `wp-api.mjs` helpers, injected. `*_elementor_data`
  fields are compared by FNV-1a hash. **New 2026-10-03 (L-44): it also returns
  `verified` + `noop`** — `ok` answers "did anything *unintended* move?", which
  a no-op satisfies trivially; `verified:false` with `noop:true` means none of
  `expectedFields` moved, i.e. the intended change never happened. Callers gate
  on `verified`, never on `ok` alone. Returns a `result` object shaped for the
  `seo_batches` `result` op. **No Workbench script writes WordPress any other
  way.**

This directory is also the **vendoring contract**: DSH copies both files
verbatim and verifies the sha256[:12] fingerprint recorded in
`seo-control-plane/README.md` (`validate-payload.mjs` = `3bf6c751c578`,
`safe-write.mjs` = `653305dd4fe8` after the 2026-10-03 fixes). The
OC tells DSH when either changes (`op:'create'` re-runs the vendored validator
server-side, so a stale copy shows up as `validation_mismatch`). Both files have
their own `node`-runnable test: `validate-payload.test.mjs` (55 cases) and
`safe-write.test.mjs` (24 cases), plus `qa/seo-batch-guard.test.mjs` (13) for the
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
| 2026-09-02 | Steps 1–4 built: `seo_state`/`seo_state_history`, `seo_batches` + `seo-batch` + `/seo-review`, `seo-control-plane/` (`validate-payload` + `safe-write`), `/seo-reconcile`. |
| 2026-09-23 | **L-29** — `placeholder_markers` extended to fr/ja/zh-hant (was en/es/zh-hans only). |
| 2026-10-03 | **Two control-plane defects raised by DSH while staging a WordPress write, both fixed here.** (1) A payload-less item was accepted, wrote nothing, and returned `ok:true/verified:true` → the batch reported `executed`. `create` now rejects an empty payload (400), and `safeWrite` returns `verified`/`noop` (gate on `verified`, not `ok`) with `op:'result'` marking such a batch `partial`. (2) Image/heading parity was unsatisfiable for Elementor edits because a live entity's `.rendered` page was compared against a raw payload body — both sides now go through `contentString()`, which prefers `.raw`, as do `no_new_scripts`/`no_new_tables`. DSH re-vendors both files (sha256[:12] fingerprint in `seo-control-plane/README.md`) and drops its `before.content` workaround. See `LESSONS-LEARNED.md` L-44 / L-45. |
| 2026-10-03 | **L-47 — defect 2's fix was incomplete and DSH verified the remainder.** `payloadText()` was a fourth call site of the same bug (it fed `brand_terms_preserved` / `wrong_language_chars` / `placeholder_markers` from the built page, so the source always looked richer than the payload and brand terms read as "translated away"), and `contentString()` still fell back to `.rendered` when `.raw` was absent — the default for `wpEntity()` without `context=edit`. `contentString` is now `.raw`-only and `payloadText` uses it; an absent `.raw` makes the body-level checks **skip** rather than compare against the render. New `validate-payload.mjs` fingerprint `3bf6c751c578`; callers must fetch `source`/`before` with `context=edit`. `validate-payload.test.mjs` 49 → 55. |
