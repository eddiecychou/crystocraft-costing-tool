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
                  { id, kind, lang, endpoint, summary, payload, before, source,
                    expectedNewIds?, appendOnly?, acceptPreexistingOverCap?, validation }
                - payload  = the EXACT WP REST body you will send; for a wc/v3
                             product, meta is `meta_data: [{key,value}]` at review
                             time, not converted after the owner approves it
                - before   = a snapshot of the fields `payload` touches, read live NOW
                - source   = the EN-original entity this was translated/derived from.
                             SEND IT on every translation item — without it the OC's
                             re-validation (below) can't run the structure / parity /
                             brand-preservation checks.
                - validation = validatePayload({ kind, lang, endpoint, payload, source,
                    expectedNewIds, appendOnly, acceptPreexistingOverCap })

3. VALIDATE     If validation.passed === false → DO NOT include a live write for it.
                Fix the payload (re-translate, re-anchor) and re-validate.
                A batch may still carry a failed item for the owner to SEE, but
                you must not execute it later even if "approved".

4. SUBMIT       POST /api/seo-batch  { op: 'create', batch: { note, items } }
                → { id, failed_validation, mismatches: [itemIndex] }.
                Status starts 'pending_review'.
                An item with an EMPTY or absent `payload` is rejected with 400
                ({ error, indexes }) — nothing to write. Build the payload
                first, then the item; never submit a placeholder item.
                THE OC RE-RUNS validatePayload SERVER-SIDE on every item. The
                stored `validation` is the OC's result (this is what the owner
                sees and what `poll` enforces); your self-report is kept as
                `dsh_validation`, and `validation_mismatch:true` is flagged where
                the two disagree. A non-zero `failed_validation` or `mismatches`
                in the response means fix and resubmit — don't wait for review.
                (The OC's copy of validate-payload.mjs is the SSOT. Your 4
                session fixes — yoast_head skip, script/style strip before the
                brand check, the 6 trad-form removals from the zh-hant set, and
                the separate SIMPLIFIED_JA list — are folded into the master as
                of the V8.15 "fold DSH's 4 validate-payload fixes" commit.
                Re-vendor from that; don't keep a fork.)

5. WAIT         The owner reviews at OC /seo-review — per-item Approve/Reject
                against a before→after diff — then clicks "Send to DSH".
                The batch flips to 'approved' (or 'rejected').

6. POLL         POST /api/seo-batch { op: 'poll' }  → batches where status==='approved'.

7. EXECUTE      For each item where decision === 'approve':
                  r = await safeWrite({ get, put, invalidateYoastIndexable,
                    id, endpoint, payload, expectedFields })
                  if (!r.verified) → STOP the whole batch, alert the owner.
                `r.ok` alone is NOT enough: it only proves nothing UNINTENDED
                moved in older vendored wrappers. In the 2026-10-06 wrapper,
                `ok` ALSO fails when a requested field reads back changed-but-wrong,
                empty, or Yoast invalidation is unconfirmed. `r.verified:false`
                with `r.noop:true` means the intended change never happened — a
                failure to report, not a success. `r.drift` says what else moved.
                Collect { index, ...r.result } for every executed item.
                NOTE: `poll` downgrades any approved item that failed the OC's
                validation to decision:'blocked' (with block_reason) and reports
                `blocked_count`. `decision === 'approve'` already skips those —
                do not "recover" a blocked item.

8. REPORT       POST /api/seo-batch { op: 'result', id, results }
                → { status: 'executed' | 'partial', executed, unverified, of }.
                'executed' requires every approved item to be ok AND not
                explicitly verified:false, so a no-op can never report as
                success. `unverified` counts the no-ops — treat a non-zero
                `unverified`, or status 'partial', as a failed batch to
                investigate before moving on.

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
        "source": { /* the EN-original entity — send on every translation item */ },
        "validation": { "passed": true, "checks": [ { "name": "...", "ok": true } ] }
      }
      // ... up to 500 items
    ]
  }
}
→ { "ok": true, "id": "<batchId>", "failed_validation": 0, "skipped_validation": 0, "mismatches": [] }
```

**The OC re-runs `validatePayload` on every item.** The stored `validation` is
the OC's own result; `dsh_validation` keeps the value you sent; `validation_mismatch`
is `true` on any item where the two `passed` verdicts differ. `failed_validation`
(count) and `mismatches` (item indexes) in the response are your signal to fix
and resubmit before the owner even looks. `poll` will not release an
OC-failed item even if it gets approved (returned as `decision:"blocked"`).

**`skipped_validation` (count) is NOT a failure — but it is not a pass either.**
It counts items where the OC gate could not run every applicable check (no
`source` at all, or a source body with no `.raw`). `failed_validation: 0` on its
own means "nothing failed", not "everything was checked". **A full pass is
`failed_validation: 0` AND `skipped_validation: 0`.** Each item's stored
`validation` carries `{ passed, checks, ran, skipped }`, and every check that did
not run appears in `checks` with `ok: null` and a reason in `detail`.

Server stores each item with `index`, `decision: "pending"`, `result: null`,
and the batch `status: "pending_review"`.

**Empty payload → 400.** An item whose `payload` is absent, `{}`, or `[]` is
rejected before anything is stored:
`{ "error": "item(s) with an empty payload — nothing to write", "indexes": [0] }`.
Before 2026-10-03 such an item was accepted, wrote nothing, and came back
`ok:true / verified:true`, so the batch reported `executed`. Fix the caller;
don't resend it unchanged.

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
    { "index": 0, "ok": true,  "after": {...}, "verified": true,  "noop": false, "unlanded": [], "error": null },
    { "index": 1, "ok": false, "after": {...}, "verified": false, "noop": false, "unlanded": [], "error": "drift: [{field:'variations',...}]" },
    { "index": 2, "ok": true,  "after": {...}, "verified": false, "noop": true,  "unlanded": [], "error": "no-op: none of the expected fields changed" },
    { "index": 3, "ok": true,  "after": {...}, "verified": false, "noop": false, "unlanded": ["meta._elementor_data"], "error": "requested change did not land in: meta._elementor_data" }
  ]
}
→ { "ok": true, "status": "executed" | "partial", "executed": n, "unverified": k, "of": m }
```
`safeWrite` returns a ready-made `result` object — pass `{ index, ...r.result }`.

**Verification is per FIELD, not per item (L-51).** Index 3 above is the shape
that used to report clean: `description` landed, `meta._elementor_data` silently
did not, and any single expected field moving used to certify the item. Now
`verified` requires `unlanded` to be empty too, and the error names the fields
that did not move. A field the payload does not carry, or carries unchanged from
`before`, asks for nothing and is not held against the write — so over-declaring
`expectedFields` (a permission list) stays safe.

The OC reads `verified` as follows: `'executed'` requires every approved item to
have a result with `ok:true` AND not `verified:false`. Index 2 above is a no-op —
`ok` is true (nothing unintended moved) but the intended change did not happen —
so it makes the batch `partial` and is counted in `unverified`. Send `noop`
through so the reviewer sees why. Leave `verified` out entirely only if you are
an older client: the OC then falls back to `ok` for that result.

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
- `source` = the **EN-original** entity the payload was translated/derived from (the
  object with `name`, `description`, `meta._elementor_data`, etc.). Pass it on every
  item — it powers widget-count parity, element-id preservation, length-anomaly,
  brand-term and SKU-prefix checks, image/H2 parity, and the script/table guards.
  **Without it those checks do not run, and the OC now says so** (`skipped > 0`, and
  `skipped_validation` on the batch) rather than reporting an unqualified pass.
  - **A payload that writes `_elementor_data` MUST carry a usable source tree.** If
    it does not, `widget_count`, `element_ids_preserved` and `length_anomaly` report
    `ok:false` ("did not run — …") and the item is **blocked**. An unguarded layout
    write is what B20/B6 are, so that case fails rather than skipping.
  - **Three shapes, all understood by validation — not interchangeable REST write
    bodies.** The validator folds nested (`meta: {…}`), flat
    (`'meta._elementor_data'`), and WooCommerce (`meta_data: [{key, value}]`)
    into `meta`. `safeWrite` resolves a dotted `meta.<key>` from either nested
    `meta` or `meta_data[]`. The actual product REST payload MUST use
    `meta_data[]`; a `wp/v2` post/page payload uses `meta: {…}` when that key is
    writable through REST. Before this a product payload looked
    textless: `brand_terms_preserved` falsely failed and the three
    `_elementor_data` guards **did not run at all** (L-50). If you declare the
    whole `meta_data` list in `expectedFields`, that covers the tree inside it.
  - **Send a COMPLETE source.** Body-level checks compare only the fields both
    sides carry. A `before` carrying *only* `_elementor_data` has no baseline for
    `content`, so `no_new_tables` / `no_new_scripts` / parity **skip** (rather than
    reporting the page's existing `<table>` as newly introduced) — you lose those
    checks (L-52). Include the body fields the write touches, and fetch with
    `context=edit`.
  - **`before` is a snapshot, not an entity** — it holds only the fields the payload
    touches, in DOTTED form (`'meta._elementor_data'`, not `meta._elementor_data`).
    The OC normalises those dotted keys into a nested `meta` before validating, so a
    flat `before` is a usable *fallback*; but send a real nested `source` anyway.
    A snapshot used where an entity is expected is a type error that silently
    disables checks — which is exactly what happened before 2026-10-03 (L-48).
  - **Fetch it with `context=edit`.** A REST entity fetched without it has no
    `content.raw`, so the body-level checks (image/heading parity, scripts/tables,
    and the brand/language text scans) have no authored body to compare and
    **skip**. That is deliberately the safe answer — not a failure — but a missing
    `context=edit` silently costs you those checks. Do the same for the `before`
    snapshot you send: the OC falls back to it when no `source` is given.
  - Pass the **whole live entity**, REST object and all. `content` is
    `{ rendered, raw }` and `.rendered` is the entire built page; the validator
    reads `.raw` **only** (2026-10-03, both the parity/script checks and
    `payloadText`'s text scans), so a correct Elementor edit — one that changes
    only `meta._elementor_data` — passes instead of failing
    `0 <img> vs source 36` or `brand term(s) translated away: Swarovski, MagSafe`
    on terms that were never in the payload body. **Do NOT** work around a failure
    by trimming `source.content` to a bare string: that suppresses the check
    instead of satisfying it. Re-vendor the validator and add `context=edit`.
- Returns `{ passed, checks: [{ name, ok, detail }] }`. The 16 checks and their
  B-lesson mapping are listed at the top of `validate-payload.mjs`.
- **`passed === false` → do not execute that item.** Full stop.

### `expectedFields` (for step 7)
The list of fields this write is *allowed* to change. `safeWrite` aborts if
anything else moves. Dotted paths for meta; any `*_elementor_data` compared by
hash.
```js
// a Yoast-meta-only write on a product:
const productYoastWrite = {
  payload: { meta_data: [
    { key: '_yoast_wpseo_title', value: 'New title' },
    { key: '_yoast_wpseo_metadesc', value: 'New description' },
  ] },
  expectedFields: ['meta._yoast_wpseo_title', 'meta._yoast_wpseo_metadesc'],
}
// a translation content write:
const translationExpectedFields = [
  'name', 'description', 'short_description', 'meta._elementor_data',
  'meta._yoast_wpseo_title', 'meta._yoast_wpseo_metadesc', 'slug', 'status',
]
```
`safeWrite` always ALSO watches `status, slug, type, sku, price, regular_price,
sale_price, stock_status, stock_quantity, categories, date, featured_media` and
`meta._elementor_data` — so a stray change to any of those trips it even if you
forgot to list it.

### Exact Yoast field contract (write body vs verification path)

| Endpoint | Reviewed `payload` and `put` body | Fresh `get` result | `expectedFields` |
|---|---|---|---|
| `wc/v3/products/:id` | `{ meta_data: [{ key: '_yoast_wpseo_title', value: 'New title' }] }` | `{ meta_data: [{ key: '_yoast_wpseo_title', value: 'New title' }, ...] }` | `['meta._yoast_wpseo_title']` |
| `wp/v2/posts/:id` or `wp/v2/pages/:id` | `{ meta: { _yoast_wpseo_title: 'New title' } }` | `{ meta: { _yoast_wpseo_title: 'New title' } }` | `['meta._yoast_wpseo_title']` |

One-line calls (both require `invalidateYoastIndexable`):

```js
await safeWrite({ get: () => wpEntity('wc/v3/products/66373'), put: wpWrite, id: 66373, endpoint: 'wc/v3/products/66373', payload: { meta_data: [{ key: '_yoast_wpseo_title', value: 'New title' }] }, expectedFields: ['meta._yoast_wpseo_title'], invalidateYoastIndexable })
await safeWrite({ get: () => wpEntity('wp/v2/posts/66373?context=edit'), put: wpWrite, id: 66373, endpoint: 'wp/v2/posts/66373', payload: { meta: { _yoast_wpseo_title: 'New title' } }, expectedFields: ['meta._yoast_wpseo_title'], invalidateYoastIndexable })
```

For a page, replace `posts` with `pages`. `safeWrite` accepts either shape as
an **in-memory value carrier**, but the endpoint determines the write body;
WooCommerce silently ignores `meta: {…}`. Do not convert a product's reviewed
`meta` payload to `meta_data` only at execution time: the operator must review
the exact body that is sent. `put`'s response is **not** verification. The
injected `get` must re-read the persisted value after the write; a `put` echoing
the new value while `get` still returns the old value correctly fails. If a
`wp/v2` Yoast key is not exposed for read/write through REST, use an explicitly
supported authoritative transport or stop — do not infer success from a 200.

---

## 5. `safe-write.mjs` — vendor and inject I/O

```js
import { safeWrite } from './safe-write.mjs'   // vendored verbatim
import { deleteYoastIndexable } from './yoast-indexable.mjs'

const r = await safeWrite({
  get: (id) => wpGet(`wc/v3/products/${id}?lang=fr`),   // your wp-api.mjs GET
  put: (endpoint, body) => wpWrite(endpoint, body),      // your wp-api.mjs PUT/POST
  // Required for _yoast_wpseo_* writes. runWpCli executes argv on the WP host,
  // rejects non-zero exits, and returns stdout; quote argv for the remote shell.
  invalidateYoastIndexable: ({ id, endpoint }) =>
    deleteYoastIndexable({ id, endpoint, runWpCli }),
  id,
  endpoint,
  payload,
  expectedFields,
  // allowVariationChange: true   // ONLY when the write is deliberately about variations
})

if (!r.verified) {
  // !r.ok              → drift or a write error: r.drift = [{ field, before, after, note? }]
  // r.noop             → NOTHING in expectedFields moved; the write wrote nothing
  // r.unlanded.length  → the payload asked for a change here and it did not land:
  //                      the write silently did not happen. Name it in the alert.
  // STOP the batch. Do NOT continue to the next item. Alert the owner.
}
results.push({ index: it.index, ...r.result })
```

`safeWrite` does: pre-read → `put` → post-read → compare. It catches B52
(variable-product save regenerating variations with empty prices) via a
dedicated variation id/price-hash guard.

`runWpCli(args)` over SSH needs **remote-shell quoting**. `execFileSync` avoids
the local shell, but SSH joins its remaining arguments into one remote command;
the remote shell otherwise splits the SQL argument at spaces. Reference
transport (adapt host/config/path in the Workbench, never place credentials in
the OC):

```js
import { execFileSync } from 'node:child_process'
const remoteQuote = a => "'" + String(a).replace(/'/g, "'\\''") + "'"
const runWpCli = args => {
  const remote = ['wp', '--path=' + WP_PATH, ...args].map(remoteQuote).join(' ')
  return execFileSync('ssh', ['-F', SSH_CONFIG, SSH_HOST, remote], { encoding: 'utf8' })
}
```

This is a reference, not a live-tested OC transport. The Workbench owns and
tests the actual host connection. A non-zero WP-CLI exit must reject.

**Workbench adapter follow-up from the 9/11 smoke:** `dsh-client.mjs` currently
changes a reviewed product `payload.meta` into `meta_data[]` only inside
`executeApproved`; construct and submit `meta_data[]` in `buildItem` instead,
and send that identical body to `safeWrite`. Stop the batch on `!r.verified`
(not merely `!r.ok`). Parse a numeric WordPress ID from the endpoint **pathname**
before `?lang=…`, or from a separately validated numeric post ID; a batch item
label such as `title-9119` is not a safe fallback. Finally, update the
Workbench-owned `check-vendor-sync.mjs` to include `yoast-indexable.mjs` and
discover/check every active `seo-control-plane` vendor directory, especially
both `Deepseek Render/` (the `dsh-client` import) and `SEO/`. This OC repo's
operating agreement makes those Workbench edits DSH-owned.

**2026-10-06 gates:** The post-read must equal each concrete value in the
payload, not merely differ from `before`; a changed-but-wrong value and an
empty field requested as populated are failures. `meta_data[]` is checked per
key. For intentional Elementor appends, put `expectedNewIds: ['new-id']` and
`appendOnly: true` on the batch item **and** pass them to `validatePayload`;
the OC re-validation reads those same item fields. An unchanged over-cap field
is reported as `over_cap_pre_existing`; use
`acceptPreexistingOverCap: true` to record an explicit acknowledgement. It
never waives a new/changed over-cap value. The `length_anomaly` result now
means actual ratio growth, not an unchanged old breach.

For `_yoast_wpseo_*` writes, the Workbench must vendor
`yoast-indexable.mjs`, import `deleteYoastIndexable`, and supply a WP-CLI
transport. `safeWrite` blocks a Yoast write if the callback is missing and
fails the result if deletion is not confirmed. The OC does not have WP-CLI
access and does not delete WordPress rows itself. After the callback, fetch
the public render to confirm Yoast rebuilt the intended title/description.

For existing untranslated content, use admin-only `/api/seo-state`
`{op:'corpus',kind,lang,page}` (20 published rows per page; continue until
`has_more:false`). The payload validator cannot discover old content. The
corpus response reports only flagged rows and the scanned count. Compare
public page variants with the **same User-Agent**: the reported WordPress
`Vary` includes `User-Agent`. WCML `by_location` can convert REST
`regular_price` to HKD from a Hong Kong workstation; use WP-CLI for the
stored price, never the location-dependent REST value.

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
      failure mode adds a check there). Verify the copy is byte-identical to the
      sha256[:12] fingerprint recorded in `seo-control-plane/README.md` → "Vendoring contract"
      before you trust a run. Current fingerprints: `validate-payload.mjs`
      `57e397f1b810`, `safe-write.mjs` `8e4d16f4f195`, and
      `yoast-indexable.mjs` `28eba647fe55`. Anything older is stale.
- [ ] Fetch `source` (and the `before` snapshot) with **`context=edit`**, or the
      body-level checks silently skip.
- [ ] Wrap your `wp-api.mjs` write path so **nothing** writes WordPress except
      through `safeWrite`, and gate the batch on `r.verified`, not `r.ok`.
- [ ] Add the batch build + `/api/seo-batch` calls to your pipeline scripts.
- [ ] Paste the `§4c` block (drafted by the OC) into the Workbench's
      `MASTER-SKILL-ALIGNMENT.md`.

## 8. First run

Do one **small** real batch end to end before a big one: pick ~5 items (e.g. a
single category's Yoast titles), submit, have the owner approve at `/seo-review`,
poll, execute through `safeWrite`, report, and check `/seo-reconcile` shows all
5 `held`. That proves the whole loop and the secret/vendoring before you commit
a 200-item run to it.

---

## 9. Change Log

| Date | Change |
|---|---|
| 2026-09-02 | Briefing written; control plane live (steps 1–4). |
| 2026-10-03 | **Two defects fixed** (raised by DSH while staging a WordPress write). **1a** `create` now rejects an item with an empty/absent `payload` (400) instead of silently storing `{}` and reporting a no-op as success. **1b** `safe-write.mjs` returns `verified` (did the INTENDED change happen?) alongside `ok` (did anything UNINTENDED move?); `noop:true` when none of `expectedFields` moved, and `op:'result'` now marks a batch `partial` — never `executed` — when any approved item is `verified:false`. **2** `validate-payload.mjs` compares the **RAW** body (`content.raw`) on both sides for image/heading parity and `no_new_scripts` / `no_new_tables`, so a correct Elementor edit (which changes only `meta._elementor_data`) passes. **DSH must re-vendor both files** (sha256[:12] fingerprint in `seo-control-plane/README.md`) and gate execution on `r.verified`, and should drop its `before.content` workaround. |
| 2026-10-03 | **Defect 2's fix was incomplete — follow-up from DSH, now closed.** `payloadText()` was a fourth call site of the same bug: it resolved an object field to `.rendered`, so the whole built page counted as *source text* and `brand_terms_preserved` reported terms (e.g. `Swarovski, MagSafe`) "translated away" when they were never in the payload body. `contentString()` now also backs `payloadText` **and uses `.raw` only** — an absent `.raw` returns `''` and the body-level checks **skip**, rather than falling back to the render (`wpEntity()` omits `context=edit`, so the fallback silently restored the old behaviour). **Re-vendor `validate-payload.mjs` (fingerprint `3bf6c751c578`), fetch `source`/`before` with `context=edit`, and drop the `before.content` workaround.** L-47. |
| 2026-10-03 | **The real root cause, found by DSH on the second attempt: a SHAPE ASYMMETRY** — `payload` is nested (`meta: {…}`), `before` is flat (`'meta._elementor_data'`), and `payloadText` skipped the key `meta` but not `meta._elementor_data`. A flat `before` used as `source` therefore (a) **silently disabled** `widget_count`, `element_ids_preserved` and `length_anomaly` — the OC's stored validation simply did not contain them — and (b) pushed the whole 50 KB Elementor JSON as source *text*, so the source always looked richer than the payload and `brand_terms_preserved` was unsatisfiable. `validatePayload` now normalises both shapes (`normalizeEntity`, so a flat `before` works), skips are first-class (`ok:null` + reason, `{passed, checks, ran, skipped}`), the create response adds `skipped_validation`, `_elementor_data` writes without a usable source tree are **blocked**, and `/seo-review` lists skipped checks. Fingerprint `9d5eb99c6eda`. L-48. |
| 2026-10-03 | **Four product-write gaps closed (L-50/L-51/L-52).** (1) **WooCommerce's meta shape**: a product carries `meta_data: [{key, value}]`, not `meta._elementor_data`, so a product payload looked textless — the three `_elementor_data` guards **did not run** and `brand_terms_preserved` falsely failed. All three shapes are now folded into `meta`, and `safeWrite`'s `get()` resolves `meta.<key>` from `meta_data[]` — so a product write declared as `meta._elementor_data` works. (2) **`verified` is per FIELD**: a payload where `description` landed and `meta._elementor_data` silently did not used to return `verified:true` (four product fixes were called clean with untouched trees). `safeWrite` now returns **`unlanded`** — the fields the payload asked to change that did not move — and `verified` requires it to be empty. (3) **An incomplete source skips instead of lying**: a `before` carrying only `_elementor_data` made `no_new_tables` report a page's existing `<table>` as newly introduced, and a meta-only write reported `0 <img> vs source 2`. Body checks now compare only the fields both sides carry, and skip with a reason when there are none. **Re-vendor both files** (`validate-payload.mjs` `8ab3fdd35671`, `safe-write.mjs` `cdd1502769db`); `op:'result'` carries `unlanded` through. |
| 2026-10-03 | **The zh-hant `SIMPLIFIED` guard replaced with a DERIVED list (L-49).** The hand-curated 193-character list was **4.9%** of the 3,803 characters OpenCC's `STCharacters.txt` marks simplified-only: it missed `订 礼` (so `訂製`/`禮品` passed the guard), missed `会 时 关 学 爱 给`, and carried **seven characters that are valid Traditional** (`云 厂 叶 后 广 征 种`) — which is why four zh-hant fixes were being refused. It also had 10 duplicate characters. Now derived (mapping changes it AND it never appears on the traditional side of any mapping; plus the four orthographic variants OpenCC also normalises — `床 秘 群 峰`), which needs **no exemption list**: the six previously special-cased (只 繁 慕 谷 回 台) fall out automatically. **Re-vendor `validate-payload.mjs`** — it now also **exports `SIMPLIFIED`**. `scripts/derive-zh-hant-simplified.mjs --check` re-derives from the dictionary and fails on drift. NOTE for your scan: the derived set flags `户` in the footer template's 「客户服務」, i.e. every Chinese page. |
| 2026-10-03 | **CLOSED — verified by DSH.** All three defects fixed and confirmed against the deployed build (`validate-payload.mjs` `9d5eb99c6eda`, `safe-write.mjs` `653305dd4fe8`; OC deploy `099aa2968`). DSH re-vendored hash-identical and re-ran the affected batch, which now passes on its own merits: the three `_elementor_data` guards run, `brand_terms_preserved` no longer false-flags, and the `before.content` workaround is no longer needed. Nothing outstanding on either side. The round-by-round record and the process rule (a defect is not fixed until the *reporter's* reproduction passes) are in `../docs/skills/LESSONS-LEARNED.md` L-44 / L-45 / L-47 / L-48. |
