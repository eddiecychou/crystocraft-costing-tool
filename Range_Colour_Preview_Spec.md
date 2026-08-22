# Range Variation Colour Preview — V8.8 Phase 1 Spec

Written 2026-08-22. Scope: a minimal, single-SKU experiment for generating a
crystal-colour preview of an existing range product variation, reviewed
before it can ever become customer-visible. This is **not** the batch
generator — that is future work, explicitly deferred (see §6).

## 0. Why this exists

Range products carry a fixed set of photographed variations (plating ×
crystal colour combinations). Photographing every real combination is slow
and some combinations may never be physically stocked long enough to shoot.
The ask: given one real photographed variation, generate a preview of what
it would look like in a different crystal colour, without re-shooting,
without touching the real photo, and without anything reaching a customer
until a human approves it.

## 1. What already exists (so this builds on it, not beside it)

Measured in the code, 2026-08-22:

- **There is no `skus` or `variations` collection.** A range product is a
  doc in `range_products`; each variation is an entry in that doc's embedded
  `variants[]` array, edited in `src/pages/RangeForm.jsx` (there is no
  separate "Product Variation" page — `RangeForm.jsx` *is* the editor,
  rendering a "Variations & Stock" section at
  [RangeForm.jsx:1335](src/pages/RangeForm.jsx#L1335)). SKU strings are
  never stored; `buildRangeSku()` in
  [src/rangeSku.js:8](src/rangeSku.js#L8) computes them on demand from
  fields already separate on the variant.
- **Variant shape** — `emptyVariant()`,
  [RangeForm.jsx:73-78](src/pages/RangeForm.jsx#L73):
  `brand_code, brand_name, plating_code, plating_name, crystal_code,
  crystal_name, description, running_no, ws_price_usd, stock_finished,
  packaging, engraving, image, crystal_colors: []`.
- **The correct source image for a variation is `variant.image`**, a single
  URL string. If unset, the product-level fallback is
  `form.gallery?.[0]?.url` ([RangeForm.jsx:429](src/pages/RangeForm.jsx#L429))
  — order in `gallery[]` encodes priority, "the first image is the main
  one" ([RangeForm.jsx:1119](src/pages/RangeForm.jsx#L1119)). The fallback
  is not safe to generate from: it may belong to a different plating, so
  Phase 1 requires a real `variant.image` and refuses to run without one.
- **Plating codes**: `RANGE_PLATINGS`,
  [src/constants.js:284-290](src/constants.js#L284) —
  `{code, name, dot}` for G/C/R/A/M, documented as free text, not a hard
  enum.
- **Crystal colour codes**: `RANGE_CRYSTAL_COLORS` in `constants.js` is an
  unused empty placeholder — **do not build against it.** The live system is
  the Firestore doc `settings/crystal_colors`
  ([src/crystalColors.js](src/crystalColors.js)) — `{colors: [{code, name,
  swatch?}], updatedAt}`, loaded through the `useCrystalColors()` hook.
  `swatch` (a hex) is optional and not guaranteed present for every code.
- **No SKU parser exists or is needed.** Plating and crystal colour are
  already independent fields on the variant object, never re-derived from
  the SKU string by regex.
- **No deterministic masked-compositing path exists for real product
  photos.** Two masking systems exist in the repo and neither applies here:
  render-service's `zone_render.py` masks a *design/logo* shape onto
  synthetic crystal-material tiles for the corporate customizer (see
  `Crystal_Fabric_Studio_Spec.md`) — unrelated to photographed range
  products. The Customizer spec's per-template photo zone masks
  (`templates/{id}/zones/*_mask.png`,
  `Corp_Gift_Customizer_Spec.md`) are plan-only; nothing implements them.
  Building a real crystal-region mask per range-product photo is out of
  scope for a minimal Phase 1.
- **Gemini image-edit is already used on real range-product photos.**
  [netlify/edge-functions/enhance-image.js](netlify/edge-functions/enhance-image.js)
  calls `gemini-2.5-flash-image` ("nano-banana") image-to-image, invoked
  from [RangeForm.jsx:611](src/pages/RangeForm.jsx#L611) for cleanup/
  recolour work on the same kind of photo this spec targets. No Imagen
  usage exists anywhere in the repo. **This is the building block Phase 1
  reuses** — a scoped image-edit call, not new masking infrastructure.
- **Upload path for real variation photos**: flat, no per-variant
  subfolder — `range_products/${docId}/${Date.now()}-${baseName}.${ext}`
  ([RangeForm.jsx:540-550](src/pages/RangeForm.jsx#L540)). Phase 1's
  generated assets must live somewhere this path can never collide with.

## 2. What Phase 1 actually does

On one variant's card in `RangeForm.jsx`: pick a target crystal colour from
`useCrystalColors()`, click **Generate Colour Preview**. The system calls
Gemini's image-edit model once, with a prompt scoped to: change only the
crystal colour to the target; preserve product geometry, crystal positions,
metal plating, background, lighting, and shadows exactly. The result is
stored as a **draft**, never written into `variant.image` or `gallery[]`,
and shown next to the variant with Approve/Reject controls. Approving does
not, by itself, make anything customer-visible — it only marks the draft
reviewed. Wiring an approved preview into the live variant image is
explicitly future work (§6).

## 3. Implementation notes (built 2026-08-22 — two deviations from §4/§3 above)

- **No new edge function.** `enhance-image.js` already has a `mode: 'recolor'`
  + `recolorInstructions` path built for exactly this ("apply ONLY the
  following colour change... keep everything else identical"). Phase 1
  calls that existing endpoint via the existing `enhanceProductImage()`
  client wrapper ([src/enhanceImage.js](src/enhanceImage.js)) instead of
  adding a parallel server-side path. Source-image resolution therefore
  happens client-side, matching how every other image operation in
  `RangeForm.jsx` already works (`runEnhance`, `keepEnhanced`) — the app has
  no precedent for edge functions doing server-side Firestore reads.
- **Drafts are a top-level collection, `range_colour_previews`, not a
  `range_products/{id}` subcollection.** `firestore.rules`'
  `range_products/{rangeId}/{allPaths=**}` wildcard grants `canShop()`
  customers read on every subcollection — nesting drafts there would have
  made them customer-readable before review, contradicting §0. The new
  collection has its own rule, admin-only both ways (see
  `firestore.rules`). Generated Storage objects still live under
  `range_products/{docId}/colour_previews/` (§3 below) since Storage's
  admin-only wildcard for that prefix already covers it correctly.

## 3a. Data model

Top-level Firestore collection (see §3 for why it isn't nested under
`range_products/{docId}`), one doc per (product, variant, base image,
target colour) combination:

```
range_colour_previews/{previewId}
{
  docId,                   // the range_products doc this belongs to
  variantIndex,            // which variants[] entry this was generated for
  sourceImageUrl,          // the variant.image used as input
  sourcePlatingCode,       // variant.plating_code at generation time
  sourceCrystalCode,       // variant.crystal_code at generation time (informational)
  targetCrystalCode,       // the requested new crystal colour
  status: 'generating' | 'success' | 'failed',
  reviewStatus: 'draft' | 'approved' | 'rejected',
  generatedImageUrl,       // Storage URL, set only on success
  errorMessage,            // set only on failure
  createdBy, createdAt, updatedAt,
}
```

`previewId` (the doc id, so it also serves as the idempotency key) =
`${docId}__v${variantIndex}__${sourcePlatingCode}__${targetCrystalCode}__${shortHash(sourceImageUrl)}`
(FNV-1a hash, `src/colourPreviewApi.js`). Re-clicking Generate for the same
combination overwrites the same doc and Storage object rather than
accumulating duplicates — idempotent by construction, no queue needed.

Storage path, deliberately outside the flat `range_products/{docId}/`
prefix real photos use, so a bug can never overwrite a real photo (it sits
inside the existing admin-only `range_products/{rangeId}/{allPaths=**}`
Storage rule, so no rule change was needed on the Storage side):

```
range_products/{docId}/colour_previews/{previewId}.jpg
```

## 4. Client module and UI wiring

- `src/colourPreviewApi.js` — `generateColourPreview()` (writes
  `status:'generating'`, calls `enhanceProductImage()` with `mode:'recolor'`
  and a scoped `recolorInstructions` string, uploads the result, writes
  `status:'success'|'failed'`), `useColourPreviews(docId, variantIndex)`
  (a live `onSnapshot` hook), `setReviewStatus()`.
- `src/pages/RangeForm.jsx` — a `VariantColourPreview` component (kept
  separate from the `variants.map()` body so `useColourPreviews`' hook call
  has a stable position per variant across renders, per Rules of Hooks) is
  rendered inside each variant card, below the crystal-colours picker: a
  target-colour `<select>` sourced from the same `libColors` /
  `useCrystalColors()` already used for the crystal-colour chips, a
  Generate button, and a thumbnail strip of that variant's previews with
  Draft/Approved/Rejected badges and Approve/Reject actions.

## 5. UI states

States map directly onto `status` / `reviewStatus` on the preview doc:

- **generating** — Generate button disabled while in flight; thumbnail
  slot shows a spinner placeholder.
- **success** — thumbnail with a "Draft — not visible" badge, Approve /
  Reject links.
- **failed** — thumbnail slot shows a warning icon plus the error message;
  clicking Generate again reuses the same idempotency key, so it doubles as
  Retry.
- **draft / approved / rejected** — badge on the thumbnail. Nothing in
  Phase 1 ever copies `generatedImageUrl` into `variant.image` or
  `gallery[]`; `range_colour_previews` is admin-only in `firestore.rules`
  and is never read by the customer portal, Woo sync, or PBIS export paths.

## 5a. Follow-up additions (2026-08-22, same cycle)

Two gaps surfaced during live testing:

- **No way to discard a bad result or a rejected draft.** Added `deletePreview()`
  — removes both the Firestore doc and its Storage object, not just a status
  flag. Available on every preview regardless of status. **Regenerate** is a
  separate action (re-run `generateColourPreview` for that same
  `targetCrystalCode`) rather than "delete then re-add the target in the
  dropdown" — shown only on AI-sourced previews, since a manual upload has
  nothing to regenerate.
- **Mixture crystal recipes (and any colour the team already has a real
  photo of) don't suit AI recolouring** — a mixture is a pattern of several
  crystal codes, not a single hue a text-prompt edit can approximate.
  Added `uploadColourPreview()`: skips Gemini entirely, uploads a file the
  reviewer already has straight into the same draft/review pipeline
  (`status: 'success'` immediately, `reviewStatus: 'draft'`,
  `source: 'upload'` instead of `'ai'`). Same Storage prefix, same Firestore
  collection, same Approve/Reject/Remove — the only difference from an AI
  result is where the pixels came from. The target-colour dropdown already
  lists mixture codes (`MX`, `M1`, `AX`, …) alongside single colours since
  it's sourced from the same `useCrystalColors()` library used elsewhere on
  the page, so no separate mixture-picker was needed.

## 6. Explicitly out of scope for Phase 1

Batch generation, any queue, mass backfill across the range, automatic
processing of every SKU, mixture/multi-colour-code expansion, and wiring an
approved draft into the live `variant.image`. All of these are real future
work but depend on Phase 1 proving the single-SKU loop is worth trusting.

## 7. Acceptance tests

1. Generate for a variant with a real `variant.image` and a target colour
   → doc goes generating → success, thumbnail appears; the original
   `variant.image` and `gallery[]` Storage objects are byte-identical
   before/after.
2. Re-click Generate with identical inputs → same `previewId`, no new
   Storage object, no duplicate doc.
3. Generate for a variant with no `image` set → the picker is replaced by
   "Add an image to this variation first," no call is made.
4. Force a Gemini failure (bad key / timeout) → doc reaches
   `status: 'failed'` with `errorMessage`; UI offers Retry; no partial or
   corrupt Storage object is left behind.
5. Approve/Reject only ever changes `reviewStatus` — confirm no code path
   copies `generatedImageUrl` into `variant.image` or `gallery[]`.
6. Confirm `range_colour_previews` docs/images never appear in the customer
   portal, Woo sync, or PBIS export.

## 8. Rollback plan

Entirely additive: one new client module (`src/colourPreviewApi.js`), one
new Firestore collection + rule, one new Storage prefix (already covered by
an existing rule), and a UI addition (`VariantColourPreview`) confined to
the variant card in `RangeForm.jsx`. No new edge function was added — the
existing `enhance-image.js` is reused unmodified. Rollback = revert the
`RangeForm.jsx` and `firestore.rules` diffs, delete `colourPreviewApi.js`,
optionally bulk-delete the `range_colour_previews` collection and its
Storage prefix. Nothing touches `variants[].image`, `gallery[]`, or any
existing Storage path, so there is no migration to unwind.
