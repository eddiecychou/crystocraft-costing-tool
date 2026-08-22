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



---

# Phase 2 Spec — from approved preview to usable everywhere it's needed

Written 2026-08-22, same cycle, revised after discussing where a promoted
photo would actually surface (§P2.0). Supersedes the earlier "promote into
`gallery[]`" draft below this line in git history — that design was wrong
for one concrete reason found while tracing the render code: `gallery[]`
feeds the storefront carousel directly, so anything appended to it is
immediately customer-visible in the main gallery, which conflicts with the
owner's requirement (§P2.3c) that the main gallery stay curated and not be
diluted by early-tier photos.

## P2.0 What already exists, and why it changes the plan

Traced through the actual render code, 2026-08-22:

- **Range/figurine invoice lines are currently *forbidden* from having an
  image at all — deliberately.** [ShipmentForm.jsx:977-982](src/pages/ShipmentForm.jsx#L977):
  *"Figurine lines are deliberately excluded (owner, 2026-08-01): a range
  product's gallery shot won't reflect the specific plating × crystal-colour
  combination ordered, so offering one would put a subtly wrong picture on
  an invoice."* This is exactly the problem Phase 1 solves — a correctly
  captioned, colour-matched photo removes the reason for the exclusion, but
  only for the specific colours that actually have one.
- **Product matching on invoice/PI/shipment lines stops at the product,
  never the variant.** `matchRangeProduct()` → `matchProductCode()`
  ([criticalComponents.js:255-266](src/criticalComponents.js#L255)) only
  matches the first one or two SKU segments (`{design}-{format}`) against
  `range_products` — the trailing `{plating}{colour}{running}` segment is
  never parsed out. `matched_product_ref` therefore carries a product id
  only, no plating/colour. **A new small parser is needed** to read the
  variant's plating+colour off the line's own `item_code`, which is already
  present on the line — nothing needs to change upstream, this is purely
  additive.
- **`LineImagePicker.jsx`** (used by Shipment/Proforma/Sales Invoice) and
  **`ProductImagePicker`** in [QuoteDetail.jsx:780](src/pages/QuoteDetail.jsx#L780)
  (used by quotes) **both only ever query `products/{id}/images`** — the
  corp-gift collection. Neither has any path to `range_products` today.
  Both need extending, not replacing — same picker UI, wider data source.
- **`crystal_colors[]`** on each variant (§1 above, the chip picker at
  [RangeForm.jsx:1464](src/pages/RangeForm.jsx#L1464)) is already exactly
  the "colours we sell this plating in" list you curate by hand. Per your
  answer to P2 point 2, that curation *is* the customer-visible-colour
  review step — no new whitelist field is needed, just discipline in
  keeping that list to only what's actually sold.

## P2.1 The core design decision: a new field, not `gallery[]`

Two different bars apply to a promoted photo, and they must not share
storage:

- **"Usable"** — good enough to attach to an invoice/quote/PI line (small,
  thumbnail-sized, tolerant of imperfection per your point 1) or to show a
  customer picking a colour on the product page (point 2, "depending on
  quality"). Low ceremony to produce.
- **"Gallery-grade"** — good enough for the main storefront carousel
  (point 3, explicitly the highest bar, added deliberately later and one
  photo at a time so it never dilutes the existing gallery).

**New field on each variant: `variant.colour_images` — a map, `{ [crystalCode]: url }`.**
Approving a colour preview (AI-generated or uploaded) writes into this map,
keyed by `targetCrystalCode`. It is never read by `FigurineShop.jsx`'s
listing carousel or `RangeCatalogueExport.jsx`'s catalogue hero — both of
those only ever read `gallery[]`, so nothing here touches the storefront
gallery surfaces at all. Promotion to `gallery[]` is a distinct, later,
explicit action (§P2.4c) — not something Phase 2a/2b do automatically.

## P2.2 Data model

```
range_products/{id}
  variants: [{
    ...existing fields (§1 above),
    colour_images: { [crystalCode]: url },   // NEW — "usable", not gallery-grade
  }]
```

`range_colour_previews/{previewId}` (§3a above) gains the same `'used'`
`reviewStatus` value as before, set when a draft is promoted into
`colour_images` — same audit-trail reasoning as the earlier draft of this
section.

Storage: promoted files move out of `colour_previews/` into the same flat
`range_products/${docId}/` prefix real photos already use (via the
existing `uploadFile()`, [RangeForm.jsx:663](src/pages/RangeForm.jsx#L663))
— once "used" it's a real product photo indistinguishable from a camera
shot, same reasoning as before, just landing in `colour_images` instead of
`gallery[]`.

## P2.3 Three build slices, in your priority order

### P2.3a — Invoice / Quote / PI (highest priority, smallest lift)

- Extend `LineImagePicker.jsx` and `QuoteDetail.jsx`'s `ProductImagePicker`:
  when `matched_product_ref.collection === 'range_products'` (or the
  quote's `product_id` resolves to one), read that product's variant's
  `colour_images` map instead of (or alongside) the corp-gift `images`
  subcollection.
- New small parser reads the plating+colour suffix off the line's own
  `item_code` (§P2.0) to know *which* colour_images entry to highlight as
  the match — but the picker still shows the whole map and lets staff pick
  manually, same as corp-gift today. A parse miss just means no
  pre-highlighted match, never a blocked line.
- **Image stays fully optional, exactly as it is for corp-gift lines today**
  — this lifts the 2026-08-01 exclusion for range lines only where a
  `colour_images` entry exists for that plating+colour; it does not force
  anything and never blocks creating an invoice, PI, or quote.
- **Inline generation** — an in-picker "Generate Colour Preview" (or
  "Upload photo") action, reusing `colourPreviewApi.js` unchanged, so a
  missing colour photo can be produced without leaving the invoice/PI/quote
  screen. On success it both writes into `colour_images` (via the same
  "approve → usable" step as §P2.2) and immediately becomes pickable —
  staff doesn't have to close the picker and reopen it.

### P2.3b — Customer portal colour-accurate hero

- In `FigurineDetail.jsx`, when a customer selects a `crystal_colors` chip
  for the current variant, look up `variant.colour_images[code]` and show
  it as the hero if present, falling back to the existing
  `selVariant.image || gallery[0]` behaviour otherwise. This is new
  selection logic — nothing today matches a photo to a specific crystal
  colour on the customer-facing page.
- Deliberately gated by your existing `crystal_colors[]` curation (§P2.0) —
  a colour with a `colour_images` entry still only appears as pickable to
  a customer if it's also still ticked in that variant's `crystal_colors`
  list. Removing an uncommon colour from that list (your review step) hides
  it from customers regardless of whether a preview exists for it.

### P2.3c — Main gallery ("Add to Gallery →", separate and later)

- A distinct action, only ever available from an entry already sitting in
  `colour_images` (i.e. already cleared the "usable" bar) — copies it into
  `gallery[]` with the SKU caption convention already documented in the
  Images section's hint text ([RangeForm.jsx:1240](src/pages/RangeForm.jsx#L1240)).
  One photo, one deliberate click, never automatic — this is the piece
  that keeps the main gallery from being diluted, per your explicit
  instruction. Held for last, and likely needs its own quality bar/checklist
  before you start using it, which isn't designed yet.

## P2.4 Security

No new attack surface in any slice: `colour_images` writes go through the
same `updateDoc(range_products/{id})` path already gated
`allow write: if isAdmin()`; the extended pickers only add a **read** path
into `range_products` (already `allow read: if canShop()`, and pickers are
admin-only screens regardless); inline generation reuses
`colourPreviewApi.js` and the `range_colour_previews` admin-only rule
unchanged.

## P2.3d Correction (2026-08-23) — Approve and "mark usable" collapsed into one step

Built as two separate clicks (Approve, then a distinct Mark usable →),
mirroring 'draft' → 'approved' → 'used' as three real states. Live use
showed this was pure friction: there's no scenario where a preview is
correctly "approved" but deliberately withheld from being usable — the two
always happen together. `RangeForm.jsx`'s Approve button on a `draft`
preview now calls `markUsable()` directly, skipping 'approved' as a
resting state (the value still exists for any pre-existing doc stuck there
before this fix, which keeps a legacy Mark usable → button until it's
cleared). Same principle applies to the inline generate/upload flow in
`RangeColourImagePicker` (§P2.3a) — seeing the one result and choosing to
use it directly on the invoice/PI/quote line already **is** the review, so
it also calls `markUsable()` immediately. That inline flow had a second,
separate bug fixed at the same time: it was writing to
`variant.colour_images` via `promoteColourImage()` without ever marking the
source `range_colour_previews` doc `used`, so a photo generated from
inside a PI looked like an untouched 'draft' if you later opened the
product's own edit page — confusing, and inconsistent with the product-page
path. Both call sites now go through the same `markUsable()`.

## P2.3e Replacing a bad AI result (2026-08-23) — supersede, and a real bug it surfaced

Asked directly: "if AI generate cannot do it right, I need to be able to
upload an image to replace it." Since `deletePreview()` refuses to touch a
`used` preview (§P2.3a note above), replacing one already worked
mechanically — pick the same target colour again, Upload/Generate a new
attempt, Approve it, and `markUsable()` overwrites `colour_images[code]`
with the new URL. What didn't work: the *old* entry kept its "Usable"
badge forever, showing two "Usable" thumbnails for one colour with no way
to tell which one anything actually points at.

`markUsable()` now demotes any other preview for the same
(docId, variantIndex, targetCrystalCode) sitting at `reviewStatus: 'used'`
to a new value, `'superseded'`, right after promoting the new one — a
plain query on `range_colour_previews`, no composite Firestore index
needed (pure equality filters, same shape as `useColourPreviews`'s
existing query). A superseded doc's file is left alone — untouched, not
deleted — so any invoice/PI/quote line or customer view that already
picked it keeps working exactly as before (see §P2.0's "line_image is a
snapshot at pick time, never a live reference" reasoning); superseded is
purely about what gets *offered* going forward, and unlike `used`, it CAN
be removed via `deletePreview()` once nothing needs it as history.

Building this surfaced a real bug that would have undermined it:
`generateColourPreview()`'s doc/Storage-object id is deterministic on
purpose, keyed by (product, variant, plating, target colour) — clicking
Generate again for a colour already marked usable would have silently
overwritten that exact live-referenced file mid-flight, before any
re-approval, rather than creating a fresh attempt to review. Fixed by
checking the existing doc's `reviewStatus` first: only `used` or
`superseded` docs force a fresh, timestamp-suffixed id; anything still
mid-review (`draft`/`failed`/`rejected`) keeps reusing the same id exactly
as before, so repeat clicks while iterating on a draft still don't pile up
duplicates.

## P2.3f Finding a "dedicated" variant on the customer portal (2026-08-23)

Traced live: D0002-001-GGT and D0002-001-CAB were correctly marked usable
and correctly stored on their own variant's `colour_images`, but never
appeared for a customer. Cause was pre-existing, not new: this product
carries a *second*, near-duplicate "Chrome" variant and a second "Gold"
variant, each existing only to price one pricier colour on its own row —
the pattern the Variations & Stock hint text already documents ("For a
colour that costs more, add a separate variation with its own price").
[FigurineDetail.jsx:262](src/customer/FigurineDetail.jsx#L262) rendered
only `plating_name || plating_code` for every row, so the dedicated row
looked identical to the general one — same label, distinguishable only by
an unlabelled price difference a customer had no reason to click into.

Fixed by naming the colour(s) whenever a variant is narrow enough
(≤2 `crystal_colors`) to clearly be one of these dedicated rows, e.g.
"Chrome — Crystal AB" instead of a second bare "Chrome". Applies to any
product using this pattern, not just 0002-001 — the gap existed before
this feature, colour previews just made it visible for the first time.

## P2.3g The bigger bug P2.3f's investigation actually found (2026-08-23)

Smoke-testing the P2.3f label fix against real data (fetched D0002-001's
saved doc directly via the Firestore REST API, using the app's own ID
token, rather than trusting the admin UI) turned up something worse: AB and
GT showed "Usable" in `RangeForm.jsx`, but `variant.colour_images` on the
**saved document** was empty for both. The product-page's `onPromote`
callback ([RangeForm.jsx:1727](src/pages/RangeForm.jsx#L1727)) only ever
called `patchVariant()` — a local `setForm` patch, the same optimistic-
edit-gated-by-Save-Changes pattern every other image action on this page
correctly uses. But unlike a gallery caption or a variant photo, approving
a colour preview looks final and irreversible in the UI (badge flips to
"Usable" immediately) — there is no visual cue telling the admin they still
need to separately remember to scroll down and click **Save Changes** for
it to actually persist. Whether Save Changes had been clicked was the
entire difference between C1/PI (persisted) and AB/GT (silently not) —
same button, same click, no error, no warning.

Fixed by having `onMarkUsable()` call `promoteColourImage()` directly,
same as the inline invoice/PI/quote picker already does — colour_images
writes are now durable the moment "Approve → usable" is clicked, from
either surface, matching what the UI already implies happened. The local
`patchVariant()` call stays too, purely so the open form's own state stays
visually in sync without needing a refetch.

0002-001's already-broken AB/GT entries were repaired live via the same
`promoteColourImage()` call, using the URLs already sitting in their
(otherwise perfectly fine) `range_colour_previews` docs — nothing needed
regenerating.

## P2.3h Save Changes was overwriting colour_images with stale state (2026-08-23)

Direct fallout of P2.3g's fix: once `onMarkUsable()` started writing
`colour_images` straight to Firestore, that field could change on the
server while `RangeForm.jsx`'s own `form` state — loaded once via `getDoc`
at page-open, never a live listener — had no idea. The very next Save
Changes click (for any reason, unrelated to colour previews) rebuilt the
entire `variants` array from that stale local state and overwrote the
document with it, silently reverting every `colour_images` entry on the
product, not just a recently-approved one. Confirmed live: a single Save
wiped C1/PI/AB/GT all at once on D0002-001.

Fixed in `handleSave()` — right before building the save payload, it now
re-fetches the current document and takes each variant's `colour_images`
from *that*, not from local state, matched by array index. Every other
field in the form still saves from local state exactly as before; only
this one field is now impossible for a stale form to regress, because nothing
else writes to `range_products` from outside this form while it's open.
0002-001 was repaired live a second time, same technique as P2.3g (URLs
were still sitting untouched in their `range_colour_previews` docs).

## P2.5 Acceptance tests

1. A range invoice/PI/quote line with no matching `colour_images` entry
   creates/saves exactly as it does today — no new required step, no
   blocked save.
2. A range line whose parsed plating+colour has a `colour_images` entry
   shows it pre-highlighted in the picker; picking it sets `line_image`
   exactly like a corp-gift selection does today.
3. Generating a photo from inside the picker (AI or upload) lands it in
   `colour_images` and makes it immediately pickable in the same session,
   without navigating to the product's edit page.
4. On `FigurineDetail.jsx`, selecting a crystal-colour chip that has a
   `colour_images` entry AND is still in `crystal_colors[]` shows that
   photo as the hero; removing the code from `crystal_colors[]` removes it
   from the customer-facing picker even if the image still exists.
5. Nothing in P2.3a/P2.3b ever writes to `gallery[]` — confirm the main
   storefront carousel and catalogue PDF are unaffected until P2.3c's
   explicit "Add to Gallery" is used.
6. "Add to Gallery →" only offers entries already present in
   `colour_images`; the resulting `gallery[]` entry behaves like any other
   (reorder, set-as-main, caption, remove).

## P2.6 Rollback plan

Additive at every slice: P2.3a adds a data source branch to two existing
pickers plus a small new SKU-suffix parser (no changes to existing
matching behaviour); P2.3b adds a lookup in `FigurineDetail.jsx` with a
same-as-before fallback; P2.3c adds one button. `colour_images` is a new
optional field — omitting it entirely leaves every current behaviour
exactly as it is today. Rollback per slice = revert that slice's diff;
none of the three depend on the others being deployed.
