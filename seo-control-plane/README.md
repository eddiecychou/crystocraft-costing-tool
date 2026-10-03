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
| `validate-payload.mjs` | `9d5eb99c6eda` |
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

## Status (2026-10-03)

All three control-plane defects raised by DSH are **closed and verified**. DSH re-vendored both files (hash-identical), re-ran the affected batch against the deployed validator and confirmed it **passes on its own merits** — the structural guards run, the brand check no longer false-flags, and the `before.content` workaround is no longer needed. Live in OC deploy `099aa2968`. Round-by-round record: `../docs/skills/LESSONS-LEARNED.md` L-44 (empty payload / no-op reported as success), L-45 + L-47 (the render vs the body, four call sites), L-48 (the shape asymmetry — the real cause).

## Two shapes, one entity — and a check never disappears silently (2026-10-03, L-48)

An item can carry an entity in **two shapes**, and the difference is invisible
until it silently changes what ran:

```
nested  { content, meta: { _elementor_data, _yoast_wpseo_title } }   ← the write payload, and any real REST entity
flat    { content, 'meta._elementor_data': …, 'meta._yoast…': … }    ← the `before` snapshot (dotted "touched fields" keys)
```

Only the nested shape has `meta._elementor_data`, so a flat entity passed as
`source` used to (a) leave `parseElementor(source.meta._elementor_data)` empty —
**silently disabling** `widget_count`, `element_ids_preserved` and
`length_anomaly` — and (b) have its whole Elementor JSON (50 KB in the reported
case, including container settings, image filenames and alt text that
`widgetTexts` deliberately excludes) pushed as source **text** by `payloadText`,
because the guard there skipped the key `meta` but not `meta._elementor_data`.
The gate's verdict was wrong in both directions: it skipped the three guards and
failed a correct edit on `brand_terms_preserved`.

`validatePayload` now calls `normalizeEntity()` on both `payload` and `source`,
folding dotted `meta.*` keys into a nested `meta`, so every check is
shape-agnostic and `before` is a usable `source`. That is fixed **in the
validator**, not in `seo-batch.js`'s `revalidate()`, so the Workbench's vendored
copy and any future caller get it too.

### `skipped` is a first-class outcome

| `checks[].ok` | Meaning |
|---|---|
| `true` | ran, clean |
| `false` | ran and found a problem — **or** could not run where running was mandatory (`detail` says which) |
| `null` | did not run, and not running is acceptable (`detail` says why) |

`validatePayload` returns `{ passed, checks, ran, skipped }`. `passed` still fails
only on an explicit `false`, so **nothing that passed before fails now** — but
`passed: true, skipped: 0` is a full pass and `skipped > 0` is a partial one.
Before this, those were indistinguishable, and a `passed:true` was read as a full
validation when three layout guards had not run at all.

- **A payload that writes `_elementor_data` MUST carry a usable source tree.** If
  it does not, the three layout guards report `ok:false` ("did not run — …") and
  the item is blocked. An unguarded layout write is exactly the B20/B6 harm they
  exist to stop, so this case fails rather than skips. A flat `before` with
  `meta._elementor_data` satisfies it.
- **Body-level checks skip** (never silently, never against the render) when the
  source body has no `.raw`, or when the source already contains the
  `<script>`/`<table>` being guarded.
- **`seo-batch.js`'s `create` response adds `skipped_validation`** — the count of
  items whose gate could not run every applicable check. A full pass is
  `failed_validation: 0` **and** `skipped_validation: 0`. `/seo-review` lists the
  skipped check names against the item.

**`before` is a snapshot, not an entity.** It is a record of the fields a payload
touches, kept for the audit trail and the drift fingerprint. Using one where an
entity is expected is a type error that silently disables checks — so pass a
nested `source` on every item, and treat a flat `before` as the *fallback* it is.

## Comparing like with like (2026-10-03, and its follow-up)

**One rule, four call sites.** A live entity's `content` is the REST object
`{ rendered, raw }`; `.rendered` for an Elementor post is the **entire built
page**. Everything that reads a body — or the text of one — goes through
`contentString()`, which uses `.raw` **only**:

- `image_count_parity` and `heading_count_parity`
- `srcBodyStr` for `no_new_scripts` / `no_new_tables`
- **`payloadText()`**, which feeds `brand_terms_preserved`,
  `wrong_language_chars` and `placeholder_markers`

The first three were fixed first; `payloadText()` was missed, and the render kept
being counted as *source text* — so the source always looked richer than the
payload and `brand_terms_preserved` reported terms "translated away" that were
never in the payload body to begin with (L-47).

**An absent `.raw` means "no authored body — nothing to compare".** That case
returns `''` and the body-level checks **skip**; it does *not* fall back to
`.rendered`. This matters because `wpEntity()` fetches **without
`context=edit`**, which omits `.raw` — a `.rendered` fallback would silently
restore the old behaviour for every caller that forgot the parameter.

**So: fetch `source` / `before` with `context=edit`.** Without it the body-level
checks cannot run at all. And **do not** work around a failure by trimming
`source.content` to a bare string — that suppresses the check instead of
satisfying it. Pass the whole live entity.
