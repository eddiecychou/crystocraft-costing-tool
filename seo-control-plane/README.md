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
| `validate-payload.mjs` | The validation gate. `validatePayload({kind, lang, endpoint, payload, source})` → `{passed, checks:[{name, ok, detail}]}`. Every check maps to a Workbench LESSONS-LEARNED entry (B6, B12, B20, B33/B35, L-09, Rule 4…). | Workbench, before any write; result attached as the `validation` field on each `seo_batches` item. Also re-run server-side by `netlify/functions/seo-batch.js` — the OC's `validation` is authoritative, DSH's is kept as `dsh_validation`. |
| `safe-write.mjs` | The write wrapper. `safeWrite({get, put, id, endpoint, payload, expectedFields})` → snapshots the entity, writes, re-reads, **returns `ok:false` + `drift` if any field outside `expectedFields` moved** (B52 variation-wipe guard), and `verified:false` + `noop:true` if NOTHING in `expectedFields` moved. Returns a `result` object shaped for `seo_batches`. | Workbench; `get`/`put` are its own `wp-api.mjs` helpers, injected. |
| `validate-payload.test.mjs` | `node seo-control-plane/validate-payload.test.mjs` — incident cases covering the known failure modes. | Here (CI / pre-commit). |
| `safe-write.test.mjs` | `node seo-control-plane/safe-write.test.mjs` — clean write, no-op, drift, write error, Elementor hash change, B52 variation regeneration. | Here (CI / pre-commit). |

## Vendoring contract

DSH copies `validate-payload.mjs` and `safe-write.mjs` **verbatim** into the
Workbench and runs them as its own. The OC's copies are the SSOT: if they ever
diverge, the OC's wins and DSH re-vendors.

Before trusting a run against a newly vendored copy, check it is byte-identical
to the hash below. **The hash changes whenever the file does** — when the OC
ships a fix, DSH re-vendors, re-hashes, and only then re-runs the affected batch.

| File | `shasum -a 256` fingerprint (first 12 hex chars, 2026-10-03) |
|---|---|
| `validate-payload.mjs` | `995c06578c8d` |
| `safe-write.mjs` | `653305dd4fe8` |

Regenerate with
`shasum -a 256 seo-control-plane/validate-payload.mjs seo-control-plane/safe-write.mjs`
and compare the first 12 characters.

**Only the first 12 characters are recorded, deliberately.** It is the same
fingerprint length `LESSONS-LEARNED.md` L-29 already passes back to DSH for
re-vendoring, and 48 bits is plenty to catch an accidental divergence — while a
64-hex blob in the repo is indistinguishable from a high-entropy secret to a
reader or a scanner. (This is hygiene, not a diagnosed deploy failure:
`deno.lock` is hundreds of 64-hex digests and deploys fine. The real 2026-10-03
deploy breakage was L-46 — a lesson quoting the leaked value it was about.)

When the OC changes either file it must tell DSH, and this table must be
re-stamped in the same commit (the OC's own `op:'create'` re-runs the vendored
validator, so a stale DSH copy shows up as `validation_mismatch`).

## Two questions, not one (2026-10-03)

`safeWrite` answers two different things and returns both:

- **`ok`** — *did anything change that I did not ask to change?* No drift, no
  write error. A no-op satisfies this trivially.
- **`verified`** — *did the change I asked for actually happen?* False when
  `expectedFields` were declared and **none** of them moved (`noop:true`).

**Callers MUST gate on `verified`, not `ok`.** `ok:true, verified:false` is a
no-op — a failure to report, not a success. This was the 2026-10-03 defect: an
item submitted with no `payload` became `{}`, wrote nothing, and returned
`ok:true / verified:true`, so `seo_batches` reported `{"status":"executed",
"executed":1,"of":1}`. `seo-batch.js` now rejects an empty payload at `create`
(400) and its `op:'result'` marks a batch `partial` when any approved item is
`verified:false`.

When `expectedFields` is empty there is no stated intent, so `verified` falls
back to `ok` — a no-op alarm is never invented. A result sent without `verified`
at all (an older DSH) is treated the same way by the OC.

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
  if (!r.verified) STOP the batch and alert       # drift OR a no-op — do not continue

POST /api/seo-batch { op:'result', id, results }                  # → executed | partial
```

`expectedFields` uses dotted paths for `meta` (`meta._yoast_wpseo_title`,
`meta._elementor_data`). Any `*_elementor_data` field is compared by FNV-1a
hash, not full string.

## Comparing like with like (2026-10-03)

The image/heading parity checks and `no_new_scripts` / `no_new_tables` read the
**RAW body** on both sides via `contentString()`: our payload's `content` is a
string, but a live entity's is the REST object `{ rendered, raw }`, and
`.rendered` for an Elementor post is the **entire built page**. Comparing a raw
payload against a rendered page can never agree — every correct Elementor edit
(one that changes only `meta._elementor_data`) failed `image_count_parity`
(`0 <img> vs source 36`) and `heading_count_parity` (`0 <h2> vs source 4`). The
same applied to `.rendered`'s inline JSON-LD, which suppressed the
`no_new_scripts` check entirely.

**Do not work around this by trimming `source.content` to a bare string** — that
deletes the source-side data the check exists to compare against. Pass the whole
live entity and let the validator read `.raw`.
