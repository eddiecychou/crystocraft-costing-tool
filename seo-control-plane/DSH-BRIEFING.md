# DSH briefing — the SEO control plane is live

**From:** Operation Center (Claude) · **To:** DeepSeek Workbench (DSH) · **Date:** 2026-09-02

You now go through a control plane for **every WordPress write**. This briefing
is everything you need to wire your scripts to it. Full reference:
`docs/skills/SEO-CONTROL-PLANE.md`, `seo-control-plane/README.md`,
`docs/skills/MARKETING-WORKFLOW.md` §6.6.

---

## 1. Why

Every B1–B53 incident is the same shape: **output written live → damage found
hours/days later → no restorable state.** The state store, the approval record,
and verification now live on the OC (code-reviewed) side. You stay the **sole
writer of WordPress**. What changes is that a write is now: *prepare → validate
→ get human approval in the OC → execute through a guard → report back*.

The old flow — show a contact sheet in the DeepSeek chat, write live, keep state
in prose handoffs — is retired.

---

## 2. The loop (do this for every batch of writes)

```
1. SNAPSHOT     Owner opens OC /seo-state → Read → Save snapshot (with a note).
                Do not start a bulk change without a fresh snapshot.
                (You don't call this; you ask the owner to, or confirm it's done.)

2. PREPARE      For each intended write, build an item:
                  { id, kind, lang, endpoint, summary, payload, before, validation }
                - payload  = the EXACT WP REST body you would have sent
                - before   = a snapshot of the fields `payload` touches, read live NOW
                - validation = validatePayload({ kind, lang, endpoint, payload, source })

3. VALIDATE     If validation.passed === false → DO NOT include a live write for it.
                Fix the payload (re-translate, re-anchor) and re-validate.
                A batch may still carry a failed item for the owner to SEE, but
                you must not execute it later even if "approved".

4. SUBMIT       POST /api/seo-batch  { op: 'create', batch: { note, items } }
                → { id }.  Status starts 'pending_review'.

5. WAIT         The owner reviews at OC /seo-review — per-item Approve/Reject
                against a before→after diff — then clicks "Send to DSH".
                The batch flips to 'approved' (or 'rejected').

6. POLL         POST /api/seo-batch { op: 'poll' }  → batches where status==='approved'.

7. EXECUTE      For each item where decision === 'approve':
                  r = await safeWrite({ get, put, id, endpoint, payload, expectedFields })
                  if (!r.ok) → STOP the whole batch, alert the owner. r.drift says what moved.
                Collect { index, ...r.result } for every executed item.

8. REPORT       POST /api/seo-batch { op: 'result', id, results }
                → status becomes 'executed' (all approved OK) or 'partial'.

9. RECONCILE    Owner opens OC /seo-reconcile → "vs Batch" → picks this batch.
                Confirms every approved item is 'held' (not drifted/failed).
                Also "vs Snapshot" to confirm nothing ELSE moved.
```

wp-cli steps (WPML `set_element_language_details` trid link, Elementor
`_elementor_element_cache` clear, `flush-css`, host purge) are **unchanged** —
still operator-run, still after the write.

---

## 3. `/api/seo-batch` — the contract

Node function. **Auth: `Authorization: Bearer <SEO_BATCH_SECRET>`** (set in the
Workbench `.env` and on Netlify — done). It is NOT a Firebase session; you are a
machine. Base URL: `https://portal.crystocraft.com` (or the netlify.app domain).

### `op: 'create'`
```jsonc
POST /api/seo-batch
{
  "op": "create",
  "batch": {
    "note": "FR product batch — Aroma Diffuser (11)",
    "items": [
      {
        "id": 53987,                       // WP post/product id (nullable)
        "kind": "product",                 // 'post' | 'page' | 'product'
        "lang": "fr",                      // 'en'|'es'|'zh-hant'|'ja'|'fr'
        "endpoint": "wc/v3/products/53987?lang=fr",   // the exact REST path
        "summary": "FR translation of Aroma Diffuser name+desc+ED",
        "payload": { /* exact WP REST body */ },
        "before": { /* current live values of the fields payload touches */ },
        "validation": { "passed": true, "checks": [ { "name": "...", "ok": true } ] }
      }
      // ... up to 500 items
    ]
  }
}
→ { "ok": true, "id": "<batchId>" }
```

Server stores each item with `index`, `decision: "pending"`, `result: null`,
and the batch `status: "pending_review"`.

### `op: 'poll'`
```
POST /api/seo-batch { "op": "poll" }
→ { "batches": [ { id, note, status:"approved", items:[...] }, ... ] }   // up to 20
```
Each returned item carries its `decision` ('approve' / 'reject') and everything
you sent. Execute only `decision === 'approve'`.

### `op: 'get'`
```
POST /api/seo-batch { "op": "get", "id": "<batchId>" }  → { "batch": {...} }
```

### `op: 'result'`
```jsonc
POST /api/seo-batch
{
  "op": "result",
  "id": "<batchId>",
  "results": [
    { "index": 0, "ok": true,  "after": { /* safeWrite fingerprint */ }, "verified": true,  "error": null },
    { "index": 1, "ok": false, "after": {...}, "verified": false, "error": "drift: [{field:'variations',...}]" }
  ]
}
→ { "ok": true, "status": "executed" | "partial", "executed": n, "of": m }
```
`safeWrite` returns a ready-made `result` object — pass `{ index, ...r.result }`.

---

## 4. Building an item

### `before`
Read the entity live (`wpGet`) **at prepare time** and keep only the fields
`payload` writes. Use dotted keys for `meta`:
```js
const live = await wpGet(`wc/v3/products/${id}?lang=fr`)
const before = {
  name: live.name,
  slug: live.slug,
  status: live.status,
  'meta._elementor_data': live.meta?._elementor_data ?? null,   // stored/shown as-is; the OC hashes it
  'meta._yoast_wpseo_title': metaVal(live.meta_data, '_yoast_wpseo_title'),
}
```
The `/seo-review` diff renders `before[key]` vs the payload value per key.

### `validation`
```js
import { validatePayload } from './validate-payload.mjs'   // vendored verbatim from seo-control-plane/
const validation = validatePayload({ kind, lang, endpoint, payload, source: enOriginalObject })
```
- `source` = the **EN-original** entity the payload was translated/derived from
  (the object with `name`, `description`, `meta._elementor_data`, etc.). Pass it
  whenever you have it — it powers widget-count parity, length-anomaly, brand-term
  and SKU-prefix checks, image/H2 parity. Without it, only the language / marker /
  double-brand / draft-only checks run.
- Returns `{ passed, checks: [{ name, ok, detail }] }`. The 15 checks and their
  B-lesson mapping are listed at the top of `validate-payload.mjs`.
- **`passed === false` → do not execute that item.** Full stop.

### `expectedFields` (for step 7)
The list of fields this write is *allowed* to change. `safeWrite` aborts if
anything else moves. Dotted paths for meta; any `*_elementor_data` compared by
hash.
```js
// a Yoast-meta-only write on a product:
expectedFields: ['meta._yoast_wpseo_title', 'meta._yoast_wpseo_metadesc']
// a translation content write:
expectedFields: ['name', 'description', 'short_description', 'meta._elementor_data',
                 'meta._yoast_wpseo_title', 'meta._yoast_wpseo_metadesc', 'slug', 'status']
```
`safeWrite` always ALSO watches `status, slug, type, sku, price, regular_price,
sale_price, stock_status, stock_quantity, categories, date, featured_media` and
`meta._elementor_data` — so a stray change to any of those trips it even if you
forgot to list it.

---

## 5. `safe-write.mjs` — vendor and inject I/O

```js
import { safeWrite } from './safe-write.mjs'   // vendored verbatim

const r = await safeWrite({
  get: (id) => wpGet(`wc/v3/products/${id}?lang=fr`),   // your wp-api.mjs GET
  put: (endpoint, body) => wpWrite(endpoint, body),      // your wp-api.mjs PUT/POST
  id,
  endpoint,
  payload,
  expectedFields,
  // allowVariationChange: true   // ONLY when the write is deliberately about variations
})

if (!r.ok) {
  // r.error, r.drift = [{ field, before, after, note? }]
  // STOP the batch. Do NOT continue to the next item. Alert the owner.
}
results.push({ index: it.index, ...r.result })
```

`safeWrite` does: pre-read → `put` → post-read → compare. It catches B52
(variable-product save regenerating variations with empty prices) via a
dedicated variation id/price-hash guard.

---

## 6. What stays exactly the same

- **EN-first.** Meta/content is written on the EN original. A WPML-linked
  translation is read-only or a standalone draft — never bulk-write a linked
  translation's fields via REST.
- **Never publish an unlinked translation.** `validate-payload` enforces
  `status: 'draft'` for a `?lang=xx` create — but it's still Rule 4.
- **Operator wp-cli** for the trid link, element-cache clear, flush-css, host
  purge — after the write, verified by a server-side fetch.
- **Per-URL 301s**, no blanket regex.
- **Product Truth**, the locked art styles, banned opener words, no
  double-branding — all unchanged (`MARKETING-WORKFLOW.md` §6.2–§6.4).

---

## 7. Setup checklist

- [x] `SEO_BATCH_SECRET` set on Netlify **and** in the Workbench `.env` (owner, done).
- [ ] Vendor `seo-control-plane/validate-payload.mjs` and `safe-write.mjs` into
      the Workbench (copy verbatim; re-copy when the OC updates them — a new
      failure mode adds a check there).
- [ ] Wrap your `wp-api.mjs` write path so **nothing** writes WordPress except
      through `safeWrite`.
- [ ] Add the batch build + `/api/seo-batch` calls to your pipeline scripts.
- [ ] Paste the `§4c` block (drafted by the OC) into the Workbench's
      `MASTER-SKILL-ALIGNMENT.md`.

## 8. First run

Do one **small** real batch end to end before a big one: pick ~5 items (e.g. a
single category's Yoast titles), submit, have the owner approve at `/seo-review`,
poll, execute through `safeWrite`, report, and check `/seo-reconcile` shows all
5 `held`. That proves the whole loop and the secret/vendoring before you commit
a 200-item run to it.
