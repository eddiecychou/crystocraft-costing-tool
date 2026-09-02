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
| 2 | **Batch / review contract** — DSH prepares a change batch, the human approves it per-item in the OC against a real diff | Firestore `seo_batches`, OC "SEO Review Queue" page | planned |
| 3 | **`safeWrite` + `validate-payload`** — no DSH script writes WordPress except through a snapshot-guarded, field-scoped wrapper; no payload reaches a write without passing the code gate | DSH side; OC supplies the spec | planned |
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

## Step 2 — batch / review contract (planned)

`seo_batches/{autoId}`:
```
{
  created_by: 'dsh',
  created_at, note,
  status: 'pending_review' | 'approved' | 'rejected' | 'executed' | 'partial',
  items: [{
    id, kind, lang, endpoint,          // the WP write DSH intends
    payload,                            // exact body
    before,                            // snapshot of the touched fields, pre-write
    validation: { passed: bool, checks: [...] },   // from validate-payload
    decision: 'pending' | 'approve' | 'reject',
    result: null | { ok, after, verified, error }  // filled by DSH post-write
  }]
}
```
The OC renders each item as a `before → payload` diff; the human approves per
item; `status` flips to `approved`; DSH polls, executes approved items through
`safeWrite`, writes `result` back. The OC then runs Step 4 reconciliation.

## Step 3 — `safeWrite` + `validate-payload` (planned, DSH side)

- **`validate-payload.mjs`** — every translation/generation payload passes this
  before it can be written: length-anomaly audit vs source (B6), wrong-language
  character scan (B33/B35 — CJK in fr/ja, simplified in zh-hant), placeholder /
  "please provide" markers (B12), image + H2 count parity, JSON parses, widget
  count unchanged, brand-term preservation, **structural diff vs EN source**
  (B20 stale-copy). Fail → cannot reach the write step.
- **`safeWrite(endpoint, payload, { expectedFields })`** — snapshot the entity,
  write, re-read, **abort + alert on any drift outside `expectedFields`** (B52 —
  a variable-product save silently regenerated 32 variations with no prices).
  No script writes WordPress any other way.

## Step 4 — reconciliation (planned)

OC page: pull current `seo-state`, diff against the last `executed` batch and
against the last history snapshot. Flag: status changed, slug changed,
`elementor_hash` changed unexpectedly, `seo_*_set` went false, a page that had a
translation now doesn't. Same shape as `WooStockReconcile.jsx`.
