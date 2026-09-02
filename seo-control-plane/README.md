# seo-control-plane/ — shared contract artifacts

Reference implementations for **Step 3** of the OC ⟷ DeepSeek Workbench
control plane (`docs/skills/SEO-CONTROL-PLANE.md`). These are **not** OC app
code — nothing in `src/` imports them. They are dependency-free ESM that the
DeepSeek Workbench **vendors verbatim** and runs on its side.

The OC owns them (they're the SSOT for "what a safe WordPress write looks
like"). When a new failure mode appears, add a check here, run the tests,
commit — then the Workbench re-vendors.

| File | What | Runs where |
|---|---|---|
| `validate-payload.mjs` | The validation gate. `validatePayload({kind, lang, endpoint, payload, source})` → `{passed, checks:[{name, ok, detail}]}`. Every check maps to a Workbench LESSONS-LEARNED entry (B6, B12, B20, B33/B35, L-09, Rule 4…). | Workbench, before any write; result attached as the `validation` field on each `seo_batches` item. |
| `safe-write.mjs` | The write wrapper. `safeWrite({get, put, id, endpoint, payload, expectedFields})` → snapshots the entity, writes, re-reads, **returns `ok:false` + `drift` if any field outside `expectedFields` moved** (B52 variation-wipe guard). Returns a `result` object shaped for `seo_batches`. | Workbench; `get`/`put` are its own `wp-api.mjs` helpers, injected. |
| `validate-payload.test.mjs` | `node seo-control-plane/validate-payload.test.mjs` — 11 cases covering the known incidents. | Here (CI / pre-commit). |

## How the Workbench uses them (the Step 2/3 flow)

```
for each intended write:
  before   = snapshot(await wpGet(id), expectedFields)
  validation = validatePayload({ kind, lang, endpoint, payload, source: enOriginal })
  items.push({ id, kind, lang, endpoint, summary, payload, before, validation })

POST /api/seo-batch { op:'create', batch:{ note, items } }        # → pending_review
# ... human approves/rejects at /seo-review, sends to DSH ...
POST /api/seo-batch { op:'poll' }                                 # → approved batches

for each item where decision === 'approve':
  r = await safeWrite({ get: wpGet, put: wpPut, id, endpoint, payload, expectedFields })
  results.push({ index, ...r.result })
  if (!r.ok) STOP the batch and alert          # drift detected — do not continue

POST /api/seo-batch { op:'result', id, results }                  # → executed | partial
```

`expectedFields` uses dotted paths for `meta` (`meta._yoast_wpseo_title`,
`meta._elementor_data`). Any `*_elementor_data` field is compared by FNV-1a
hash, not full string.
