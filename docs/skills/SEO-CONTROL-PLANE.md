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
| 3 | **`safeWrite` + `validate-payload`** — no DSH script writes WordPress except through a snapshot-guarded, field-scoped wrapper; no payload reaches a write without passing the code gate | Reference impls in `seo-control-plane/` (OC-owned, DSH vendors) | **BUILT 2026-09-02** |
| 4 | **Reconciliation** — live state vs last-approved batch; flags a reverted page, a broken trid, a reappeared EN link | OC page, same pattern as Woo Stock Match | planned |

Products are already covered by `woo-sync.js` `catalogue_page` → the **Woo Catalogue** page (Yoast title/desc + WPML `translations` per product). This control plane adds **blog posts and pages**.

## Step 1 — the state store (BUILT)

### `seo-state` edge function (`/api/seo-state`, admin-gated, read-only)
Reads via the **WP Application Password** (`WP_USER` / `WP_PASS` — `wp/v2/*` does
not accept the WooCommerce Consumer Key). Ops:

- `{ op: 'languages' }` → `wpml/v1/languages`, falls back to `en / es / zh-hant / ja / fr`.
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
  `status: 'pending_review'`.
- `{ op: 'poll' }` → batches where `status === 'approved'` (execute these).
- `{ op: 'get', id }` → one batch.
- `{ op: 'result', id, results: [{ index, ok, after, verified, error }] }` →
  merges results; `status` → `executed` (all approved OK) or `partial`.

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
    result: null | { ok, after, verified, error, at }
  }]
}
```
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
  payload, source })` → `{ passed, checks: [{ name, ok, detail }] }`. 15 checks,
  each mapped to a Workbench LESSONS-LEARNED entry: `json_parses` (B32),
  `widget_count` + `element_ids_preserved` (B20 stale-copy), `length_anomaly`
  (B6), `wrong_language_chars` (B33/B35 CJK leak, B6 simplified-in-zh-hant),
  `placeholder_markers` (B12), `brand_terms_preserved` (§3c), `sku_prefix_
  preserved` (B12), image/heading count parity (§2), `no_new_scripts/tables`,
  `seo_title_no_double_brand` (L-09), `seo_desc_length` (B47),
  `translation_draft_only` (Rule 4). CJK scan runs on the **JSON-decoded**
  `_elementor_data` (B35e). The Workbench attaches the result as each
  `seo_batches` item's `validation` field. `node
  seo-control-plane/validate-payload.test.mjs` = 11 incident cases.
- **`safe-write.mjs`** — `safeWrite({ get, put, id, endpoint, payload,
  expectedFields })`. Snapshots the entity → writes → re-reads → returns
  `{ ok:false, drift:[…] }` if any watched field outside `expectedFields`
  changed (plus a dedicated **variation id/price hash** guard for B52 — a
  variable-product save regenerating all variations with no prices). `get`/`put`
  are the Workbench's own `wp-api.mjs` helpers, injected. `*_elementor_data`
  fields are compared by FNV-1a hash. Returns a `result` object shaped for the
  `seo_batches` `result` op. **No Workbench script writes WordPress any other
  way.**

## Step 4 — reconciliation (planned)

OC page: pull current `seo-state`, diff against the last `executed` batch and
against the last history snapshot. Flag: status changed, slug changed,
`elementor_hash` changed unexpectedly, `seo_*_set` went false, a page that had a
translation now doesn't. Same shape as `WooStockReconcile.jsx`.
