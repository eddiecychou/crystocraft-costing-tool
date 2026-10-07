# seo-control-plane/ — shared contract artifacts

Reference implementations for the OC ⟷ DeepSeek Workbench control plane
(`docs/skills/SEO-CONTROL-PLANE.md`). The validator and write wrapper are
dependency-free ESM that the DeepSeek Workbench **vendors verbatim**; the
read-only corpus helper is imported by the OC's SEO state edge function.

The OC owns them (they're the SSOT for "what a safe WordPress write looks
like"). When a new failure mode appears, add a check here, run the tests,
commit — then the Workbench re-vendors.

| File | What | Runs where |
|---|---|---|
| `validate-payload.mjs` | The validation gate. Also accepts item-level `expectedNewIds`, `appendOnly`, and `acceptPreexistingOverCap`. Distinguishes growth from unchanged over-cap content and declared appends. | Workbench before a write; OC re-runs it on batch creation. |
| `safe-write.mjs` | The write wrapper. Re-reads and compares each concrete requested field with its requested value; a changed-but-wrong or empty result is `ok:false`, `verified:false`, `unlanded`. Yoast meta writes require a confirmed indexable invalidation callback. | Workbench; I/O is injected. |
| `corpus-language.mjs` | Script-ratio audit for *existing* published bodies and Elementor text; shared with `/api/seo-state` `op:'corpus'`. | OC read-only admin route. |
| `yoast-indexable.mjs` | Guarded WP-CLI deletion of the matching Yoast indexable row after a Yoast meta write lands. | Workbench, with its own `runWpCli(argv)` transport to the WordPress host. |
| `validate-payload.test.mjs` | `node seo-control-plane/validate-payload.test.mjs` — incident cases covering the known failure modes. | Here (CI / pre-commit). |
| `safe-write.test.mjs` | `node seo-control-plane/safe-write.test.mjs` — exact product and post/page Yoast read-back, no-op, drift, Elementor hash change, B52 variation regeneration. | Here (CI / pre-commit). |

## Vendoring contract

DSH copies `validate-payload.mjs`, `safe-write.mjs`, and `yoast-indexable.mjs` **verbatim** into the
Workbench and runs them as its own. The OC's copies are the SSOT: if they ever
diverge, the OC's wins and DSH re-vendors.

Before trusting a run against a newly vendored copy, check it is byte-identical
to the hash below. **The hash changes whenever the file does** — when the OC
ships a fix, DSH re-vendors, re-hashes, and only then re-runs the affected batch.

| File | `shasum -a 256` fingerprint (first 12 hex chars, 2026-10-06) |
|---|---|
| `validate-payload.mjs` | `57e397f1b810` |
| `safe-write.mjs` | `8e4d16f4f195` |
| `yoast-indexable.mjs` | `28eba647fe55` |

Regenerate with
`shasum -a 256 seo-control-plane/validate-payload.mjs seo-control-plane/safe-write.mjs seo-control-plane/yoast-indexable.mjs`
and compare the first 12 characters.

**Only the first 12 characters are recorded, deliberately.** It is the same
fingerprint length `LESSONS-LEARNED.md` L-29 already passes back to DSH for
re-vendoring, and 48 bits is plenty to catch an accidental divergence — while a
64-hex blob in the repo is indistinguishable from a high-entropy secret to a
reader or a scanner. (This is hygiene, not a diagnosed deploy failure:
`deno.lock` is hundreds of 64-hex digests and deploys fine. The real 2026-10-03
deploy breakage was L-46 — a lesson quoting the leaked value it was about.)

When the OC changes a vendored artifact it must tell DSH, and this table must be
re-stamped in the same commit (the OC's own `op:'create'` re-runs the vendored
validator, so a stale DSH copy shows up as `validation_mismatch`).

The Workbench's `check-vendor-sync.mjs` must compare **all active**
`seo-control-plane/` vendor directories, not just the directory containing the
checker. In the current Workbench layout, both `Deepseek Render/seo-control-plane/`
(imported by `dsh-client.mjs`) and `SEO/seo-control-plane/` are active. Its
artifact list must include `yoast-indexable.mjs` alongside the validator,
safe-write wrapper, and vendored validator test. Discover directories named
`seo-control-plane` under the Workbench root, ignore backup/archive folders,
and fail if any active copy is missing or differs. The OC cannot edit that
Workbench-owned checker (see `MARKETING-WORKFLOW.md` §6.0).

### Workbench wiring status — closed 2026-10-06

DSH reported the producer-side follow-up complete after OC commit `6e7be4f`:

- `validate-payload.mjs` `57e397f1b810`, `safe-write.mjs` `8e4d16f4f195`,
  `yoast-indexable.mjs` `28eba647fe55`, and `validate-payload.test.mjs`
  `a21100a463dd` are byte-identical in both active Workbench vendor directories.
- `check-vendor-sync.mjs` now includes the Yoast helper, checks both active
  directories, reports `in sync`, and runs the 135 validator assertions.
- `dsh-client.mjs` now sends the exact reviewed payload unchanged, extracts the
  numeric WordPress ID from the endpoint pathname (before any query string),
  stops on either `!ok` or `!verified`, and retains remote-shell quoting.
- The Workbench smoke suite passed 12/12: product `meta_data[]` persisted and
  invalidated once; a successful PUT echo with an unchanged fresh GET failed as
  `unlanded`; and the `wp/v2` nested-meta case verified.

Two title batches prepared with the obsolete product `{meta:{…}}` body are
invalid artifacts. They must be rebuilt as `meta_data[]` and reviewed again;
they must not be replayed or converted after approval.

## Two questions, not one (2026-10-03)

`safeWrite` answers two different things and returns both:

- **`ok`** — *did the write pass all safety checks?* No drift, no write error,
  no requested-value mismatch, and (for Yoast meta) confirmed invalidation.
- **`verified`** — *did the change I asked for actually happen?* False when
  `expectedFields` were declared and **none** of them moved (`noop:true`).

**Callers MUST gate on `verified`, not `ok`.** A no-op or wrong read-back is a
failure to report, not a success. This was the 2026-10-03 defect: an
item submitted with no `payload` became `{}`, wrote nothing, and returned
`ok:true / verified:true`, so `seo_batches` reported `{"status":"executed",
"executed":1,"of":1}`. `seo-batch.js` now rejects an empty payload at `create`
(400) and its `op:'result'` marks a batch `partial` when any approved item is
`verified:false`.

When the payload is empty there is no stated intent, so `verified` falls
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
  r = await safeWrite({ get: wpGet, put: wpPut, invalidateYoastIndexable, id, endpoint, payload, expectedFields })
  results.push({ index, ...r.result })
  if (!r.verified) STOP the batch and alert       # drift OR a no-op — do not continue

POST /api/seo-batch { op:'result', id, results }                  # → executed | partial
```

`expectedFields` uses dotted paths for `meta` (`meta._yoast_wpseo_title`,
`meta._elementor_data`) **for either wire carrier**. A `wc/v3` product writes
`{ meta_data: [{ key: '_yoast_wpseo_title', value: 'New title' }] }` and a fresh
product GET must return that key/value in `meta_data[]`. A `wp/v2` post/page
writes `{ meta: { _yoast_wpseo_title: 'New title' } }` and its fresh GET must
return the value in `meta`. `safeWrite` reads either carrier but cannot make a
WooCommerce endpoint accept the wrong body; the reviewed payload must already
be the exact REST write body. A successful PUT echo is not a post-read. If a
`wp/v2` Yoast key is not exposed through REST, fail closed or inject an
authoritative supported transport. Layout drift fingerprints use FNV-1a; requested-value
verification compares the actual full value. For Yoast writes, wire the
callback to `deleteYoastIndexable({ id, endpoint, runWpCli })`; `runWpCli` must
execute argv on the WordPress host and reject non-zero exits. The helper uses
`wp db prefix` and deletes only the matching `object_id`, `object_type='post'`,
and `object_sub_type`, then confirms the row count is zero. A missing or
unconfirmed callback blocks success; this repo does **not** have WordPress-host
WP-CLI access and cannot execute that deletion on its own.
For SSH transports, quote **each** WP-CLI argv element for the remote shell:
`execFileSync('ssh', ['-F', config, host, remoteCommand])` protects the local
shell only; SSH's remote shell otherwise splits SQL at spaces. See the
reference `remoteQuote` implementation in `DSH-BRIEFING.md` §5.

## Three shapes for one entity — and per-field verification (2026-10-03, L-50/L-51/L-52)

An entity reaches the control plane in three shapes, and **all three must be
understood**:

```
nested       { meta: { _elementor_data } }            WP posts/pages
flat         { 'meta._elementor_data': … }            the `before` snapshot (dotted keys)
WooCommerce  { meta_data: [{ key, value }] }          wc/v3 products — meta is a LIST
```

`normalizeEntity()` folds all of them into `meta` (precedence: `meta_data[]` →
nested `meta` → dotted `meta.*`), and `safe-write.mjs`'s `get()` resolves a
dotted `meta.<key>` path from `meta_data[]` too. Before this, a **product**
payload looked textless: `brand_terms_preserved` falsely failed and
`widget_count` / `element_ids_preserved` / `length_anomaly` **did not run at
all** — a silently smaller check set, not an error.

### Verification is per FIELD, not per item

`safeWrite` compares each concrete payload field with `before` and the post-read, and returns:

| field | meaning |
|---|---|
| `supplied` | the payload supplies a concrete value for this field, even if it matched `before` |
| `landed` | the value differs after the write |
| **`unlanded`** | asked, but the post-read is **not equal to the requested value** — including changed-but-wrong or empty |

`ok` and `verified` both fail when `unlanded` is nonempty; `verified = ok && !noop`. A payload where `description`
lands and `meta._elementor_data` silently does not is **not** verified, and the
error names the field. An absent payload value asks for nothing; a supplied
same-value field must still read back correctly. Over-declaring
`expectedFields` (a permission list) stays safe. `unlanded` is carried into
the `seo_batches` item, the `op:'result'` handler
and the review UI.

### A source that is present but incomplete is worse than none

Body-level checks compare only the fields **both** sides carry
(`sharedBody`). If the intersection is empty — a `before` carrying only
`_elementor_data`, or a source fetched without `context=edit` — the check
**skips with a reason** instead of running against an empty baseline. Otherwise a
page's existing `<table>` is reported as newly introduced, or a meta-only write is
reported as an image wipe. Pass a complete source: both the body fields the write
touches *and* `context=edit`.

## The zh-hant guard is derived, not curated (2026-10-03, L-49)

`SIMPLIFIED` is **3,803 characters derived from OpenCC's `STCharacters.txt`** —
not a hand-picked list. It replaced a 193-character one that measured **4.9%
coverage** (it missed `订 礼`, so `訂製`/`禮品` passed) and contained **seven
characters that are valid Traditional** (`云 厂 叶 后 广 征 种`, as in 皇后/征戰),
so it rejected correct text.

Derivation rule: `s` is simplified-only when the mapping changes it
(`trad[0] !== s`) **and** `s` never appears on the traditional side of any
mapping — which excludes the ambiguous forms automatically (台 只 里 后 云 谷 回
价 …) and needs no hand-written exemption list. `床 秘 群 峰` are additionally
excluded because OpenCC's ST dictionary also normalises **orthographic variants**
(`床 -> 牀`), where the left-hand character is standard Traditional.

**Do not hand-edit it.** `node scripts/derive-zh-hant-simplified.mjs --check`
re-derives from the dictionary and fails if the committed list has drifted.
Regenerating needs `STCharacters.txt` (Apache-2.0); a cached copy normally sits at
`"$HOME/Developer/Deepseek Workbench/.tools/opencc/STCharacters.txt"`.

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
