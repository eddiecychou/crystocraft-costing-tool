# DSH handoff — Elementor layout writes, 16 October 2026

Implementation commit: `3156a66390349388a10951f5868a8d119184ba9a` in `eddiecychou/crystocraft-costing-tool`.
This package contains the exact updated OC validator and dependency-free test.
Production deployment and role verification are recorded separately in
`docs/plans/ELEMENTOR-LAYOUT-WRITES-2026-10-16.md`.

## Install and verify

1. Extract the package into a temporary directory. Run `shasum -a 256 -c SHA256SUMS`
   there; every entry must report OK. Run `node validate-payload.test.mjs`;
   expected result: **144 passed, 0 failed**. No npm install or credentials needed.
2. Copy `validate-payload.mjs` and `validate-payload.test.mjs` verbatim into every
   active Workbench vendor directory, including `Deepseek Render/seo-control-plane/`
   and `SEO/seo-control-plane/`. Do not replace unrelated Workbench code or secrets.
3. Run the Workbench's existing `check-vendor-sync.mjs` against all active copies.
   Compare full hashes below. Keep `safe-write.mjs` and `yoast-indexable.mjs`
   unchanged; this release does not replace them.
4. Update the producer wiring so `allow` is passed unchanged to local
   `validatePayload` and submitted as an item option to `/api/seo-batch`.
   Never put it inside the WordPress payload. Gate on `validation.passed`, while
   retaining the original `ok:false` checks and their exception annotations in
   receipts. Do not treat an excepted result as an ordinary full validation.
5. Rebuild and submit a NEW batch for the wholesale layout. Do not replay or
   mutate failed batch `vaGCoKKzOg8pVW6K9jVy`, and do not use `--submit-anyway`
   to bypass an unresolved failed check. Review the new OC validation and exact
   payload in `/seo-review`, then obtain the normal human approval.
6. Execute only the approved exact payload. Preserve `safeWrite` backup,
   expected-field read-back, drift checks and per-field verification. Stop on
   `!ok` or `!verified`; report results to OC, including `unlanded`/errors.
7. After a layout save: clear Elementor element cache, flush CSS and purge host
   cache through the existing approved mechanism. Verify with a fresh server-side
   fetch and inspect the rendered WordPress page. A successful database write
   alone does not prove Elementor rendered correctly.

## First layout contract

Creates use collection endpoints `wp/v2/pages`, `wp/v2/posts`, or `wc/v3/products`
(optional query string/trailing slash). Execute collection creates with POST;
existing numeric entity endpoints use PUT. Do not rely on `create:true` to bypass
an existing-item endpoint's baseline requirement.

For an existing plain page, fetch the live entity with `context=edit` and pass it
as `source`. No layout is confirmed by an explicit empty string/null/empty-array
`_elementor_data` in a supported meta shape, or a complete edit entity with
positive `id`, `content.raw`, and a visible meta object/list without that key.
An empty object, rendered-only entity or partial field snapshot is not proof.
Malformed source layout JSON remains blocked. Do not fabricate or trim the live
source to satisfy the validator. If WordPress does not expose the metadata,
resolve that visibility problem rather than claiming an empty layout.

A first layout passes widget/ID/length preservation checks with a clear
"nothing to preserve" note. Its own tree must be a non-empty Elementor node
array, with unique IDs, valid node types and widget types. Existing layouts
continue to use the current preservation/append controls. This release does
not relax WPML linking, content-language or published-translation restrictions.

## Recorded exceptions

Example item options (outside `payload`):

```json
{
  "allow": [
    {"check": "seo_desc_length", "why": "Campaign wording reviewed; intentional 159-character description"}
  ]
}
```

Reasons must be non-empty strings. Duplicate entries or malformed arrays are
rejected; unknown/non-applicable checks fail validation. Invalid exception
metadata, missing baseline evidence, invalid JSON/first-layout structure and
`translation_draft_only` cannot be waived. For normal first layouts no exception
is needed. Exceptions do not approve items automatically.

`validatePayload` returns `passed`, `rawPassed`, `checks`, `ran`, `skipped` and
`overridden` (count). Applied exceptions preserve the check's original `ok:false`
and `detail`, adding `overridden:true` and `why`. OC stores them on the item and
shows the reason plus original failure at review. `passed:true, skipped:0,
overridden:0` is a full pass. Skips and exceptions must remain distinguishable.

## Exact SHA-256

- `validate-payload.mjs`: `713ceb69fd1621066f806dcc8f856446c44c8d9e8ecd1d0336761db273b2aea0`

- `validate-payload.test.mjs`: `703f987c6087a624cafd9a24d80596ae3cd6caa545012867792090f13ce06760`
