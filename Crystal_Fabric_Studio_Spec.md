# Crystal Fabric Studio — V7.22 Plan

Written 2026-08-06. Origin: a Perplexity-drafted brief
(`CrystalFabricPlan.md`, kept on the owner's Desktop as the origin note, not
the build contract) proposing a "Crystal Fabric Studio" — a product
configurator plus a swatch library for designers who used to buy Swarovski
components. This version is reconciled against the actual codebase: it
corrects the draft where it duplicates or contradicts something already
built, and narrows scope to what the business evidence actually supports.

## 0. Why this exists

Crystocraft has secured a crystal fabric supplier (ex-Swarovski engineer,
real manufacturing capability) at a moment when Swarovski itself discontinued
most of its component lines (~2020). Three proof deals already closed on this
exact story — a yacht interior company, a horse-racing helmet/boot maker, a
perfume bottle brand — all previously sourced from Swarovski. That is real
demand evidence, not a hypothesis.

The draft frames this as two tracks: (1) use crystal fabric in Crystocraft's
own products, (2) sell crystal fabric as raw material to designers who need a
Swarovski replacement. Track 2 is the new business line and the one with no
tooling behind it today. Track 1 is not new — see §1.

## 1. What already exists (so we build on it, not beside it)

Measured in the code, 2026-08-06 — **this is the section the draft could not
have written, since it was authored without seeing the repo:**

- **The configurator (draft's "Track 1 MVP") is already built and live.**
  `src/customer/customizer/CrystalFabricCustomizer.jsx` +
  `src/customer/CustomizerPage.jsx` + `src/customizerApi.js` render a
  customer's uploaded logo onto a product using the crystal-fabric engine.
  Dispatch is by `customizer_type` on the product doc
  (`src/customizerEngines.js`), currently gated `available: true` for
  `crystal_fabric` and wired from `CorporateDetail.jsx`. **Status per
  CLAUDE.md: on hold.** Confirm it still renders correctly before extending
  it — it hasn't been touched in a while.
- **The render engine is a real physically-based model, not a flat overlay.**
  `render-service/` (Fly.io) — `engine/core.py`, `refraction.py`, `stones.py`,
  `palette.py` — implements the two-layer crystal/backfilm composition the
  draft describes in §4.3, already.
- **27 photographed swatches exist**, keyed in
  `render-service/engine/materials/colors/registry.json` by crystal colour →
  {fabric, rock} → {file, pitch}. An admin swatch-authoring tool already
  exists (`render-service/admin.html`, `app.py`'s `swatches_save` /
  `swatches_delete` / `swatches_preview` endpoints) — swatches are not added
  by hand-editing JSON.
- **The real option model is colour × type × mode, not "effect" × "density."**
  `customizerApi.js`:
  - `CRYSTAL_COLORS` — 8 real colours (White, Jet, Red, Pink, LightPink,
    Violet, Peach, Hematite), each with an actual photographed swatch behind
    it.
  - `CRYSTAL_TYPES` — stone size: `fabric_1.0` / `fine_rock_1.5` / `rock_2.0`,
    matching the business's own "Crystal Fabric / Fine Rock / Rock" naming.
  - `MODES` — `zone_map` ("crystals form the logo") vs `printed` ("logo under
    crystals").
  - **This list was rebuilt on 2026-07-30 specifically to remove invented
    option names** (`CrystalAB`, `Moonlight`, `CrystalBlueLight`,
    `MetallicSilver`, `GoldenShadow`, `CrystalDorado`, `CrystalCopper`) that
    had no photographic backing — the render was recolouring one generic
    photo toward each name, which can shift hue but cannot reproduce a
    different colour's actual sparkle and facet character. See the comment at
    the top of `customizerApi.js` for the full reasoning. **This is a
    decision the business already made and paid to fix once — do not
    reintroduce invented option names.**
- **Pricing is deliberately per-customer, never public.** `customer_prices`
  subcollections carry price tiers per customer per product; raw cost never
  reaches the browser (`CorporateDetail.jsx`'s `customer_prices/{uid}` read,
  `CorporateShop.jsx`'s card pricing). Nothing in the app publishes an
  indicative price band to an anonymous or unauthenticated visitor.

## 2. Where the draft's technical design should be discarded

The draft's `CrystalSwatch` interface (`effect: "AB" | "Clear" | "Other"`,
`density: "Low" | "Medium" | "High"`) reinvents the option model this repo
already tore out five weeks ago, for the same reason: those are words, not
photographs. **Do not adopt it.** Any new swatch/material record extends the
existing `CRYSTAL_COLORS` × `CRYSTAL_TYPES` × backfilm shape, keyed the same
way `registry.json` already keys real swatch photos.

The draft's public "Approx price band" on the configurator conflicts with the
per-customer pricing model in §1. Keep the configurator ending at a quote
request, not a number.

## 3. Scope

**In scope (Phase 1 — re-enable + extend Track 1, cheap): DONE 2026-08-06**
- Confirmed the existing engine renders correctly end-to-end: ran
  `render-service/test_local.py` against the deployed engine code and a
  fresh HTTP round-trip against `app.py`'s `/render` locally. **Zone-map
  mode** ("crystals form the logo") works — real photographed crystal
  texture composing into the logo shape.
- **Found a live bug in the process**: **printed mode** ("logo under
  crystals") throws for every colour — `engine/palette.py`'s
  `crystal_photo()` requires a photo of the chosen crystal colour captured
  against the chosen backfilm, and every colour in `registry.json` only has
  `'Unspecified'` captured. Not a code bug — the engine correctly refuses to
  fake a photo — a photography gap. Fixed by hiding printed mode from the
  customer-facing UI (`MODES` in `customizerApi.js` gained an `available`
  flag, `CrystalFabricCustomizer.jsx` filters to it) until backfilm-specific
  photos exist. Re-enable by flipping `available: true` once they do.
- Enabled `customizer_type: 'crystal_fabric'` on the two `status: active`
  hero products already matching the draft's suggestion: "Crystal Fine Rock
  Magsafe Wallet Stand" and "Spinning Glass with Crystal Fabric on Stainless
  Steel Coaster" — both previously had the field unset (customizer wasn't
  linked from anywhere live before this).
- NOT verified: actual click-through in the customer portal (login-gated for
  the assistant) — worth a real pass on both products before telling
  customers about it.

**In scope (Phase 2 — the actual new work: Track 2, swatch library):**
- A swatch library page (`SwatchLibrary` under `src/customer/` for portal
  designers, or admin-only first — see §5) built on the *existing*
  `CRYSTAL_COLORS` / `CRYSTAL_TYPES` / backfilm data, not a new schema.
- Filters: crystal type, colour family, mode (zone_map/printed
  availability), recommended use-case (a new free-text tag field, since
  nothing today records "apparel trim" vs "helmet panel").
- Swatch detail page: photographed macro image (already exist in
  `render_service/swatch_gallery/`), plus 1–2 example renders reusing the
  same render endpoint the configurator calls, with `productTemplateId:
  "flat"` (swatch-only view, no product mockup).
- A `legacySwarovskiRefs: string[]` field added to the swatch record from day
  one — cheap now, expensive to retrofit, and it's the hook the "Match my old
  Swarovski" feature needs later.
- Sample-request as the primary call-to-action on a swatch detail page (name,
  company, email, product/use-case, notes) — **not** a price band. Stores to
  Firestore, same lead-capture shape as the existing enquiry cart.

**Explicitly out of scope for V7.22** (see §4 for why):
- "Match my old Swarovski" photo-upload matcher.
- Designer Project Board / pinned-swatch export packs.
- Public indicative price bands anywhere in the flow.
- Funnel analytics (configuration-started → lead-submitted conversion, etc.).

## 4. What the draft missed, and what changes the plan

**Physical samples are the actual conversion event, not a rendered PNG.** No
designer specs a crystal material off a screen image — they need a swatch
card in hand. Nothing in the original draft addresses sample-request
logistics or what a sample costs to produce and ship. The swatch detail page
in §3 makes "request a sample" the primary action, not a secondary link,
because that is where a Track 2 deal actually starts.

**A credible library is a few hundred swatches; today there are 27.** Every
addition is a real photo shoot under controlled lighting — a render off a
made-up name is exactly the mistake `customizerApi.js` already walked back
from once. This is the real cost centre of Track 2 and the draft doesn't
budget for it. Photographing new colour/backfilm combinations is a
prerequisite to the library being worth showing anyone, not a Phase-2
nice-to-have.

**Supplier concentration risk.** The whole Track 2 pitch rests on one
ex-Swarovski engineer at one factory. Positioning publicly as *the*
Swarovski replacement partner is a promise that depends entirely on that one
relationship holding. Not a code question, but worth the owner's explicit
judgement before Track 2 goes external-facing (§5's admin-first phasing
exists partly to buy time on this).

**The highest-value first user of the swatch library is Crystocraft's own
sales side, not an anonymous designer.** Deals close by conversation
(yacht/helmet/perfume all did). An admin-facing swatch library the owner or a
sales rep can pull up mid-call to assemble a credible, branded material
proposal in five minutes is the same tooling as the public version, aimed
differently, and has exactly one user to get right before opening it to
strangers.

## 5. Rollout

1. **Phase 1** (cheap, do first): verify + un-park the existing configurator;
   extend to 1–2 more products.
2. **Phase 2a** (admin-only): swatch library on existing schema, used
   internally on sales calls. This is where the "few hundred swatches" cost
   gets paid down gradually, and where supplier-risk exposure stays at zero.
3. **Phase 2b** (portal-facing, only once 2a is actually being used
   internally): open swatch library to logged-in linked designer/distributor
   accounts, sample-request CTA, curated Swarovski-legacy-ref lookup
   (text-only, no photo matcher).
4. **Not scheduled**: Project Board, photo-based Swarovski matcher, public
   price bands, funnel analytics. Revisit only if Phase 2b shows real
   external usage that these would meaningfully improve.

## 5a. Phase 2a — corrected implementation plan (2026-08-11)

The owner brought a Perplexity-drafted implementation packet for Phase 2a.
It got the shape of the feature right (admin-facing swatch browser, filters,
detail view, use-case/legacy-ref metadata) but was written without the repo
open and got several concrete things wrong: it invents a `src/admin/`
directory that doesn't exist in this app (admin pages live in `src/pages/`,
routed from `src/App.jsx`); it re-imports `CRYSTAL_COLORS` as a static array
from `customizerApi.js`, which was deliberately removed on 2026-07-30 in
favour of fetching the palette live, for the exact reason a duplicate static
list would cause here again — drift against what's actually photographed; it
proposes seeding a *new* Firestore collection with the full colour × type ×
backfilm cross product, duplicating data the render-service's own
`registry.json` already owns; it calls `crystal_photo()` with
`backfilm="Unspecified"`, which doesn't match any real captured slot and
would 404 every swatch; and its image URLs
(`crystocraft.com/swatch_gallery/*.jpg`) aren't real — swatch photos live on
the Fly.io persistent volume, served through `app.py`'s own endpoints.

**What Phase 2a actually needs, corrected:**

- **No new photo data store.** `render-service/app.py` already has
  everything a browsing tool needs: `GET /swatches` (full registry, every
  colour's fabric/rock slots with `url`s), `GET /swatches/image/{filename}`
  (serves the actual photo), `GET /swatches/backfilms`. All admin-gated by
  `ADMIN_PASSWORD` HTTP Basic auth already, built for `admin.html`'s
  photo-capture workflow. Phase 2a's browsing page reads the same registry
  through the same endpoints — it does not re-seed it into Firestore, and it
  does not touch `render-service/` at all (no Fly deploy needed for this
  phase).
- **One new Netlify edge function, `swatch-library.js`**, proxying those two
  GET routes — same shape as the existing `customizer-palette.js` proxy, but
  gated on the caller being a signed-in Firebase **admin** (same
  `isAdmin(uid, idToken, projectId)` check `erp.js` already uses), not a
  shared render token. It holds a new server-side secret,
  `RENDER_ADMIN_PASSWORD` (must equal the Fly service's `ADMIN_PASSWORD`),
  and sends it as the HTTP Basic credential (`admin` / that password) when
  calling Fly — the browser never sees Fly's admin password, same pattern
  `erp.js` uses to keep the Supabase service key server-side.
- **One new Firestore collection, `crystal_swatch_notes/{colorName}`** —
  admin-only (`allow read, write: if isAdmin();`, matching the `crystals`
  collection's existing rule right next to it), holding only the metadata
  that has no other home: `recommended_use_cases: string[]`,
  `legacy_swarovski_refs: string[]`. Keyed by colour name only, not the full
  colour×type×backfilm product — the photos already carry that granularity
  in the registry; the notes are a business judgement about the colour, not
  the individual photo.
- **One new page, `src/pages/SwatchLibrary.jsx`**, route `/swatch-library`,
  nav entry in `src/components/Layout.jsx`. Grid of crystal colours (swatch
  photo, hex dot, captured styles/backfilms) with type/search filters; a
  detail panel showing every captured photo for that colour plus an
  editable recommended-use-cases / legacy-Swarovski-refs form, writing to
  `crystal_swatch_notes`.
- **No render-on-demand preview in this phase.** The original broader
  Phase-2 scope (§3) mentioned example renders on the swatch detail page —
  trimmed here to keep Phase 2a cheap and internal-only, consistent with
  §5's "admin-first, buy time on supplier-risk" reasoning. The captured
  macro photo is enough for a sales call; a rendered example can follow in
  2b if it's actually asked for.
- **No sample-request CTA in this phase** — that's still 2b, portal-facing,
  per §5's existing phasing. This page has exactly one user type: internal
  staff on a sales call.

## 5b. Phase 2b — portal-facing (2026-08-11)

Shipped the same day as 2a's carousel/notes refinements, at the owner's
call: "I want to make it simple and grant every approved portal customer
[access] because the product rendering part will be related to corp gift
and Crystocraft gift customers." No new "designer/distributor" account
type — every approved `role: 'customer'` account gets it, riding on the
existing corporate-gift customer base rather than a separate onboarding
flow.

- **`/api/swatch-library` widened from admin-only to `canShop()`-equivalent**
  (admin OR approved customer) — the registry is swatch photos, not
  pricing/margin data, so the same posture `products/` reads already use
  was the right bar, not the ERP endpoint's admin-only one. Same Basic-auth
  proxy to Fly underneath; the browser still never sees
  `RENDER_ADMIN_PASSWORD`.
- **`crystal_swatch_notes` read opened to `isApprovedCustomer()`** — the
  legacy-Swarovski-reference list only has a point if a designer can
  actually see it. Writes stay admin-only.
- **New page, `src/customer/SwatchLibraryPage.jsx`**, route
  `/shop/swatches`, nav entry in `CustomerLayout.jsx`. Same grid/carousel
  as the admin page (shared visual pattern, separate file — the two have
  different data-editing permissions and it wasn't worth a shared
  abstraction for one component). Detail panel shows the captured photos
  and read-only legacy refs, no editing UI.
- **Sample-request CTA, not a price band** — per §4's standing call that a
  physical sample is the actual conversion event. Adds a `type:
  'swatch_sample'` line to the SAME enquiry cart Corporate/Figurine Gifts
  use (`useCart`, `store.jsx`), not a direct Firestore submit — first
  version submitted straight to Firestore on its own and, owner 2026-08-11,
  didn't show up under the portal's Enquiry tab the way adding a product
  does. Now goes through the normal `/shop/enquiry` review-and-send flow
  like everything else in the cart.
- **Not built, and now formally out of scope** (owner, 2026-08-11): "Match
  my old Swarovski" photo matcher — dropped entirely, not deferred.
  Designer Project Board — superseded by the existing Customer Brand
  Gallery (`src/customer/BrandGalleryPage.jsx`), which already does the
  "designer's saved collection" job. Sample logistics (cost/shipping
  workflow) — not needed per the owner; the enquiry-cart CTA is the whole
  loop, fulfilment happens off-app like every other enquiry.

## 5c. Product template library (2026-08-11) — foundation for the physical design workbench

The owner brought a much larger follow-on spec: a "physical design
workbench" covering five workstreams — (1) a real-millimetre canvas with
drag/resize/undo, (2) admin-drawn polygon zones replacing the two hard-coded
crystal_fabric zone-map regions, (3) unifying zone-map and printed mode into
one workspace, (4) an admin-managed product template library (photo + SVG
outline + real mm size), (5) composite rendering that warps the crystal
layer onto the SVG outline and pastes it into the product photo, eliminating
manual Photoshop compositing.

That doc corrected one of its own claims before I could: "today's live
zone-map customizer has five zones per product, defined in code" doesn't
match `render-service/engine/stones.py` — the real `crystal_fabric`
zone-map mode is a two-region split (a logo-shaped mask vs. everything
else), not five hard-coded zones. The "5 zone type" concept (colour/logo/
text/graphic, admin-authored mask templates) is real, but belongs to the
*other*, never-built engine — `surface_print` in `customizerEngines.js`,
designed in `Corp_Gift_Customizer_Spec.md` and marked `available: false`.
This plan effectively proposes building `surface_print` for real, redesigned
around live SVG zone-drawing, and merging it with the working
`crystal_fabric` engine.

Given the size (a new interactive drawing canvas, new Python compositing —
SVG-mask rasterizing, warp, alpha-composite — none of which exists yet, new
Fly-volume template storage, new admin tooling), the owner chose to build
**only workstream 4 first** — the product template library — since
everything else needs a real template (photo + SVG + mm size) to work
against.

**What shipped (admin-only, no drawing UI, no zones, no compositing yet):**

- **`render-service/engine/templates.py`** (new) — its own registry file
  (`templates_registry.json`), own directory on the Fly volume (sibling to
  `colors/`, same `SWATCH_DATA_DIR`-backed durability pattern
  `engine/palette.py` already established). Deliberately not merged into
  the swatch registry — different lifecycle, different shape.
- **First-cut constraint enforced server-side**: `validate_single_path_svg()`
  counts top-level shape elements (`path`/`polygon`/`polyline`/`rect`/
  `circle`/`ellipse`) anywhere in the document (including nested in a `<g>`,
  common from Illustrator exports) and rejects anything but exactly one —
  per the plan's own "single closed path only" limitation for this version.
  The admin.html uploader also does a client-side count for instant
  feedback, but the server check is the real gate.
- **New endpoints in `app.py`** (admin-gated, same `ADMIN_PASSWORD` HTTP
  Basic pattern as `/swatches*`): `GET /templates` (list), `GET
  /templates/image/{filename}` / `GET /templates/svg/{filename}` (serve,
  path-traversal-safe — only registered filenames are servable), `POST
  /templates/save` (name, width_mm, height_mm, photo, svg), `DELETE
  /templates/{id}`.
- **New "🗂️ Product templates" section in `admin.html`** — self-contained
  editor swap (same pattern `testRenderShell()` already used for the
  render-test tool), list of saved templates with thumbnails, upload form.
  Render service version bumped 0.9.0 → 0.10.0.
- **Not built yet, and each is its own future phase**: the real-mm drawing
  canvas (workstream 1), user-drawn zones replacing the fixed logo/
  background split (workstream 2), mode unification (workstream 3), and
  the warp-and-composite render step (workstream 5) — none of these read
  or write the new template registry yet. A saved template today has no
  consumer.
- **Verified working live** (owner, 2026-08-11): saved a real "Round
  Coaster" template (85×85mm) via the admin tool and confirmed it lists
  correctly with a thumbnail — not just a parse-check, the actual upload/
  save/list round trip.

## 5d. Canvas & positioning overhaul (2026-08-11) — workstream 1

The first consumer of a saved template. A "Design" button on each template
row in the admin Templates section opens a canvas showing the template's
own product photo at the correct real-millimetre scale (a 10mm grid with
50mm labels, computed from `pxPerMM = displayWidthPx / template.width_mm`),
onto which the admin can drop a graphic and drag it to reposition, or drag
a corner handle to resize (aspect-locked by default, a checkbox frees it).
Undo/redo is a plain snapshot stack of `{x, y, w, h}` in mm, pushed on
drag-start and popped on Cmd/Ctrl-independent Undo/Redo buttons — no
keyboard shortcuts wired yet.

Deliberately simplified against the original workstream description in two
ways, both worth knowing before workstream 2 builds on this:

- **The whole product photo stands in for the template's mm extent.** The
  SVG outline saved alongside the template isn't read or drawn here at
  all — this phase only proves out the drag/resize/grid/undo mechanics.
  Workstream 2 (user-drawn zones) is where the SVG boundary actually
  becomes load-bearing, both as the zone-drawing canvas boundary and later
  as the composite clipping mask.
- **The "thin-line constraint warning" is a placement-size heuristic, not
  real stroke-width detection.** It warns when the graphic's placed width
  or height drops under a flat 4mm floor — it has no way to inspect actual
  line thickness inside the uploaded artwork itself. Genuine fine-detail
  detection (measuring the thinnest stroke in the source image) is a
  materially harder computer-vision problem and wasn't attempted; flagged
  here so the warning isn't mistaken for something it isn't.
- **Nothing persists.** No save button, no Firestore/registry write — this
  is proof-of-mechanics only, matching the "prerequisite to everything
  else" framing in the original plan rather than a shippable authoring
  tool on its own.

Render service version bumped 0.10.0 → 0.11.0, then 0.11.1 (bug fix,
below), then 0.12.0 (SVG overlay, below), then 0.13.0 (manual alignment
controls, below).

**Bug found and fixed same day**: resize handles didn't respond to drag at
all (move worked fine). Root cause: the canvas element has `max-width:100%`
(global admin.html CSS), so its on-screen size can be smaller than its
internal pixel resolution — mouse coordinates need scaling by
`canvas.width / boundingRect.width`, same as the existing swatch editor's
`toCanvasXY()` already does. Move's hit region is the whole placed
rectangle, big enough to survive the resulting offset; the 9px corner
handles weren't. Fixed with a shared `dcToCanvasXY()` helper used by both
mousedown and mousemove.

**SVG outline overlay added same day**, owner: "it doesn't see the svg area,
and the svg area doesn't have the alignment with the actual product image."
The canvas now optionally draws the saved SVG stretched over the whole
photo at 50% opacity (toggleable). This is a diagnostic overlay, not a real
coordinate mapping — there is still no registration/anchor step between the
SVG's own coordinate space and the photo's, so it's drawn on the bald
assumption the SVG was traced at the same pixel size as the photo. If it
visibly doesn't line up, that's the SVG having been authored at a different
canvas size than the photo, not a bug in this overlay — the fix is
re-exporting the SVG sized to match the photo, not code. A real anchored
mapping (crop offset + scale, stored with the template) is a fair
candidate for workstream 2, once zones need the SVG boundary to actually
be load-bearing rather than just visually checked.

**Manual alignment controls added same day**, owner: "need to be able to
resize the svg, now there is no way to resize so that it fits the product
behind." Rather than wait for a real registration step, added exactly
three numbers the admin dials in by eye — scale (%) and X/Y offset (mm) —
applied to the overlay (anchored at the photo's centre so scaling grows/
shrinks symmetrically), with live preview and a "Save alignment" button.
Persisted per template as `svg_scale`/`svg_offset_x_mm`/`svg_offset_y_mm`
via a new `POST /templates/{id}/align` endpoint
(`templates.py`'s `save_alignment()`) — remembered next time the template
is opened, not just for the current session. This IS the "real anchored
mapping" flagged as workstream-2 material above, just built now, minimally
(uniform scale + offset, no rotation or non-uniform stretch), because the
owner needed it to actually check a template rather than wait.

Render service version 0.12.0 → 0.13.0, then 0.14.0 (opacity control,
below).

**Overlay opacity made adjustable same day**, owner: "make the overlay
image some transparent so that we know what is the svg area." The fixed
50% opacity wasn't enough to see through in practice — likely because the
uploaded SVG embeds a full reference raster alongside the traced path
(a common Illustrator "trace over a photo" export), which reads as a
mostly-opaque image rather than a thin line. Added a fourth alignment
number, Overlay opacity (%), live-adjustable and persisted alongside
scale/offset via the same `/templates/{id}/align` endpoint
(`svg_opacity`, defaults to 50%).

Render service version 0.13.0 → 0.14.0.

**Graphic opacity added same day**, owner: "I can see the opacity of the
svg, but I don't see the opacity for the image overlay on it" — the
placed graphic (the customer logo/photo being positioned) sits on top of
the SVG overlay and had no way to see through it either. Added a
"Graphic opacity (%)" control next to the aspect-lock checkbox, same
live-redraw pattern as the SVG's opacity field. Deliberately NOT
persisted — unlike the SVG's alignment numbers, the placed graphic itself
isn't saved anywhere in this phase (see this section's earlier note on
"nothing persists" for the graphic), so its opacity is view-only for the
current session, reset each time a template is reopened.

Render service version 0.14.0 → 0.14.1.

## 5e. User-definable zones (2026-08-11) — workstream 2

Owner said "please go ahead" once alignment tooling was confirmed working
— proceeding to the next dependency-ordered workstream from the original
plan (§5's rollout order) rather than re-asking, since the direction was
already set.

Adds a "✏️ Draw zone" toggle to the design canvas: while active, clicking
the photo places polygon vertices (min 3) instead of dragging the
graphic; "Finish zone" closes it and attaches a name, crystal type
(fabric_1.0/fine_rock_1.5/rock_2.0 — the real `STONE_TYPES` from
`engine/palette.py`, not invented values) and crystal colour (populated
live from `GET /swatches`, filtered to colours actually captured for that
type's style — same filtering logic the customer-facing customizer
already does in `CrystalFabricCustomizer.jsx`). Up to 5 zones per
template (`MAX_ZONES` in `templates.py`, matching the original plan's own
first-cut limit), each a translucent coloured polygon on the canvas,
cycling through 5 fixed colours by slot index. Persisted via new `POST
/templates/{id}/zones` (`templates.py`'s `save_zones()`), replacing the
whole list each save, same pattern the swatch registry's writes already
use.

**Deliberately still just geometry + material assignment — no crystal
rendering of a zone happens anywhere yet.** That's compositing work
(workstream 5): today a saved zone is `{name, crystal_type, color,
points: [{x_mm, y_mm}, ...]}` and nothing reads it back except the
design canvas that drew it. The two hard-coded regions in the live
`crystal_fabric` zone-map engine (`stones.py`'s logo/background split)
are completely untouched — this doesn't replace them yet, it only proves
out an admin can now define arbitrary per-product zone geometry instead
of it being fixed in code, which was the actual point of workstream 2 per
§3/§0.

Render service version 0.14.1 → 0.15.0.

**Zone-drawing gated on a placed graphic, same day**, owner: "I think need
to overlay the graphic in order to draw this. So the workflow need to add
a image first." The "Draw zone" button is now disabled until a graphic
has been uploaded and placed — zones are meant to be traced with the
actual logo/graphic visible as a reference (where it really sits), not
drawn blind against the bare product photo. The hint text changes from
"upload a graphic first" to the drawing instructions once one's loaded.

Render service version 0.15.0 → 0.15.1.

## 6. Open questions for the owner

- Photography budget/cadence for growing past 27 swatches — who shoots them,
  how often. (Owner, 2026-08-11: not a build item, just a reminder that the
  library only grows if someone keeps shooting.)
- Which workstream (1/2/3/5) is next for the physical design workbench, once
  the template library above has real templates in it to build against.
