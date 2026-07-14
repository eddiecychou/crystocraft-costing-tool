# Corporate Gift Customizer & Preview Engine — Spec v1

**Status:** Draft for review (2026-07-14)
**Author:** Eddie + Claude
**Goal:** Let corporate customers self-serve a realistic, on-brand preview of a
gift product with **their own colours, logo, and message**, so they can show it
to their boss/colleagues and confirm the order. Attacks the #1 conversion
blocker in corporate gifting: internal sign-off needs a picture.

---

## 0. Guiding principle (read this first)

**The core preview is DETERMINISTIC compositing, not generative AI.**

Precise logo placement, exact brand colours, and legible text are things
generative models (incl. Gemini image gen) are structurally bad at — they
hallucinate, warp logos, and mangle text, differently every run. We use the
proven print-on-demand technique instead: pre-authored **product templates**
with defined zones + lighting maps, and we composite the customer's content
*through* those maps. Result: photorealistic, pixel-accurate, identical every
time, milliseconds, near-zero cost.

**Gemini is used only at the edges**, never in the critical path:
- authoring assist (help staff build templates faster),
- optional lifestyle/scene backgrounds,
- an optional "realism pass" that is never the only output.

Anything the customer scrutinises against their brand = deterministic.
Anything atmospheric/optional = AI.

---

## 1. Scope

### In scope (this spec)
- A **product template** schema (the "zones" JSON) + Storage layout.
- A deterministic **rendering pipeline** (browser live preview + high-res export).
- Customer-facing **configurator UI** inside the existing portal login.
- Staff-facing **template authoring** (MVP: form + externally-made masks).
- Integration with the existing **enquiry system** (preview → enquiry → sign-off).

### Explicitly out of scope for v1
- 3D configurators (Threekit-style). 2D photo-based compositing is more
  photorealistic per unit effort for faceted crystal/metal gifts.
- Full in-app mask-painting editor (phase 3).
- Generative AI in the customer-facing render path.
- Automatic pricing changes from customisation (preview only; pricing stays the
  existing quote/enquiry flow).

### Phase-1 MVP (one product, see §9)
One real hero product, three zone types (1 colour + 1 logo + 1 text),
deterministic client-side compositing, save + attach-to-enquiry + download.

---

## 2. Architecture

```
CUSTOMER (portal login)                          STAFF (admin)
  Configurator UI (React + Konva/WebGL)            Template Editor (admin form)
     │  live preview (deterministic)                  │  upload base + maps,
     │                                                │  define zones + defaults
     ▼                                                ▼
  customer_designs/{id}  ◄──────── Firestore ──────►  product_templates/{productId}
  render PNG + logo       ◄──────── Storage  ──────►  base / lighting / zone masks
     │
     ├─► attach to enquiry  (existing enquiries collection → admin + email)
     └─► download proposal PDF  (existing @react-pdf pipeline)

  Gemini edge functions (OPTIONAL, off critical path):
    authoring assist · background scenes · realism pass · logo bg-removal
```

Builds on infrastructure already in the app: React 18 + Vite, Firebase
(Firestore + Storage + Auth), customer portal, `@react-pdf/renderer`, Gemini
edge-function pattern, existing image-enhance/manual-adjust tooling.

---

## 3. The template model (the heart of it)

A product is customisable when it has a template. Rendering = stacking layers
**bottom → top**:

1. **Base photo** — the blank product, photographed neutrally (ideally no logo).
2. **Colour zones** — recolour a masked region while preserving its shading.
3. **Logo zones** — place the customer logo into a defined area, warped to the
   surface, then re-lit by the product's own highlights.
4. **Text zones** — render a message (font/curve/colour) into an area.
5. **Graphic zones** — like logo zones, for decorative art/patterns.
6. **Global lighting overlay** — the product's extracted highlights/shadows,
   re-applied on top to unify everything. **This layer is what sells realism.**

### 3.1 Recolour technique (preserve shading, minimal authoring)

Primary method — **HSL swap** (needs only a region mask, no separate shading map):
```
for each pixel in region (mask alpha > 0):
    out = HSL( target.H, target.S, base.L )   # keep base Lightness = keeps facets/highlights
    out = lerp(base, out, mask.alpha)
```
Because it keeps the base pixel's Lightness, metallic finishes and crystal tints
keep their highlights and shadows. Optional per-zone `blend: multiply|overlay`
and a `lightness_clamp` for finishes that need it. (Multiply mode can use an
optional authored `shading_map`, but HSL swap avoids that work for v1.)

### 3.2 Logo placement + re-lighting

- **Flat area** (pouch print, flat badge): perspective transform into a 4-point
  `quad`. Canvas/WebGL does this.
- **Curved surface** (round crystal, curved metal): a grayscale `displacement_map`
  bends the logo to the surface (the "smart object" trick). *Phase 2.*
- **Re-light:** multiply the base luminance under the logo (v1) and/or screen an
  authored `lighting_overlay` on top (v2) so the logo picks up real reflections.
- **Engraving mode:** for etched looks, don't generate — fake it deterministically
  (desaturate + frosted texture + bevel). Toggle per zone.

### 3.3 Template JSON schema

Stored at `product_templates/{productId}`. Image fields are Storage paths.

```jsonc
{
  "product_id": "abc123",              // links to existing corp `products` doc
  "version": 1,
  "base_image": "templates/abc123/base.png",
  "lighting_overlay": "templates/abc123/lighting.png",  // optional (v2 realism)
  "canvas": { "w": 2000, "h": 2000 },  // authoring resolution
  "zones": [
    {
      "id": "body",
      "type": "color",
      "label": "Body colour",
      "mask": "templates/abc123/zones/body_mask.png",   // grayscale/alpha region
      "blend": "hsl",                  // hsl | multiply | overlay
      "default_color": "#C6A664",
      "swatches": ["#C6A664","#C9CBCC","#1C1C1A"],       // suggested palette
      "lightness_clamp": [0.05, 0.95]  // optional
    },
    {
      "id": "front_logo",
      "type": "logo",
      "label": "Your logo",
      "quad": [[720,610],[1180,610],[1180,780],[720,780]], // 4 corners in canvas px
      "displacement_map": null,        // v2, for curved surfaces
      "lighting_overlay": null,        // v2, per-zone highlights
      "relight_luminance": true,       // v1 cheap re-light
      "max_px": { "w": 460, "h": 170 },
      "allowed_formats": ["png","svg","jpg"],
      "auto_remove_bg": true,
      "engrave": false
    },
    {
      "id": "message",
      "type": "text",
      "label": "Message / tagline",
      "area": { "x": 700, "y": 820, "w": 600, "h": 120 },
      "font": "Questrial",
      "default_color": "#222222",
      "align": "center",
      "curve": null,                   // optional arc path
      "max_chars": 40,
      "engrave": false
    }
  ]
}
```

Authoring one template = produce `base.png`, the zone masks, (optionally)
`lighting.png`, and fill this JSON. Masks/overlays can be made in Affinity/
Pixelmator (already owned) or with Gemini/existing enhance tooling assisting.

---

## 4. Rendering pipeline

- **Live preview (customer):** React + **Konva.js** (layers, masks via
  `globalCompositeOperation`, transforms, text) for v1 flat compositing;
  add a **WebGL** shader pass for displacement warping in v2. Updates instantly
  on every control change.
- **High-res export + PDF:** render the same layer stack to an off-screen canvas
  at print resolution, export PNG, embed in the existing `@react-pdf/renderer`
  proposal template. Keeps it client-side (reuses infra, no server compositing
  service for v1). *Tradeoff:* very large canvases stress low-end devices — cap
  export at a sane resolution (e.g. 2000px long edge) for v1; move to a
  server-side `sharp` (libvips) render if we need true print DPI later.

---

## 5. Data model

**Firestore**
- `product_templates/{productId}` — the schema in §3.3. Admin-write, portal-read.
- `customer_designs/{designId}` — a saved customisation:
  ```jsonc
  {
    "product_id": "abc123",
    "uid": "<account uid>",            // owner (customer account)
    "customer_id": "<crm id|null>",
    "selections": {
      "body": { "color": "#1C4F64" },
      "front_logo": { "logo_path": "customer_uploads/uid/logo.png" },
      "message": { "text": "Season's Greetings 2026" }
    },
    "render_path": "renders/uid/designId.png",
    "enquiry_id": "<id|null>",
    "createdAt": "<ts>", "updatedAt": "<ts>"
  }
  ```
- Corp `products/{id}` gains: `customizable: true`, `template_id` (usually = product id).

**Storage**
- `templates/{productId}/…` — base, lighting, zone masks (admin-managed).
- `customer_uploads/{uid}/…` — uploaded logos/graphics.
- `renders/{uid}/…` — exported preview PNGs.

**Security rules** (new — will need the usual manual console paste):
- `product_templates` — read: approved customer or admin; write: admin.
- `customer_designs/{id}` — read/write: owner uid or admin.
- Storage `customer_uploads/{uid}` and `renders/{uid}` — owner uid or admin.

---

## 6. Customer UX flow

1. Customisable product page → **"Customize & Preview"** button.
2. Configurator screen: **left** = live preview canvas; **right** = controls,
   one group per zone:
   - colour zone → swatches + custom picker,
   - logo zone → upload (drag/drop) with **client-side background removal**
     (`@imgly/background-removal` or similar — more reliable than Gemini for
     this) + size/format guidance,
   - text zone → text field (char-capped) + colour.
3. Preview updates live (deterministic, instant).
4. **Save preview** → writes `customer_designs` + exports render PNG.
5. **Add to enquiry** → attaches render to a new/existing enquiry (drops into the
   existing enquiries collection → admin sees it + email notification fires).
6. **Download proposal PDF** → branded one-pager to show the boss.

Trust guidance in UI: a small "indicative preview — final artwork confirmed by
our team" note, so expectations are set without undercutting the wow.

---

## 7. Staff (admin) template authoring

**MVP (form-based):** a "Customizer Template" tab on a corp product:
- upload `base.png` (+ optional `lighting.png`),
- add zones one at a time: type, label, upload mask (colour) / enter quad
  corners (logo) / enter area rect (text), set defaults + limits,
- a live admin preview using dummy content to verify placement,
- save → writes `product_templates/{id}` and flips `customizable: true`.

Masks/overlays are produced externally (Affinity/Pixelmator) for v1. **Gemini
authoring assist** (suggest zone rects from the base photo, auto-generate a
lighting layer, background-clean the base) is a fast-follow, not a blocker.

**In-app mask painter = phase 3.**

---

## 8. Where Gemini is used (all optional, off critical path)

| Use | Value | Risk if it wobbles |
|---|---|---|
| Authoring assist (zone suggest, lighting extract, base bg-clean) | Speeds staff authoring | Low — staff reviews |
| Lifestyle/scene backgrounds behind the gift | Upsell polish | Low — atmospheric |
| Optional "realism pass" on top of deterministic composite | Extra realism | Medium — **always keep deterministic version as default/fallback** |
| Customer logo background removal | Cleaner inputs | Prefer a dedicated bg-removal lib over Gemini |

---

## 9. Phase-1 MVP — concrete definition

**Product:** one real hero (candidate: the 4-in-1 USB charging cable w/ light-up
logo, or a crystal award — pick by how often it's customised).

**Zones:** 1 colour (body) + 1 logo (flat quad + cheap luminance re-light) + 1
text (message).

**Render:** deterministic, client-side Konva, export ≤2000px PNG.

**Customer can:** pick body colour, upload logo (auto bg-removed), type a
message → live preview → save → attach to enquiry + download PNG/PDF, all
self-serve, no staff, in **under 2 minutes**.

**Staff authoring:** manual — upload base + masks made in Affinity, register
zones via the admin form.

**Acceptance criteria:**
- [ ] A logged-in customer produces a boss-ready preview of the hero product
      unaided in < 2 min.
- [ ] Logo lands cleanly in-zone; body recolour preserves highlights/facets;
      message is legible.
- [ ] Preview attaches to an enquiry and appears in admin + triggers the email.
- [ ] Downloaded PDF is on-brand and presentable.
- [ ] Same inputs → identical output every time (no generative variance).

---

## 10. Phasing roadmap

- **Phase 0 — validate (staff-assisted):** build the engine + template for one
  product, but staff drives it (customer sends logo, you render in seconds).
  Confirms the workflow and quality bar before self-serve exposure. *Optional but
  recommended.*
- **Phase 1 — self-serve MVP:** §9. One product, deterministic, portal-integrated.
- **Phase 2 — realism + coverage:** displacement maps (curved surfaces), authored
  lighting overlays, engraving mode, 3–5 more hero products, optional scene
  backgrounds.
- **Phase 3 — scale authoring:** in-app mask painter + Gemini authoring assist so
  templates can be built for many products quickly; server-side `sharp` render
  for true print DPI.

---

## 11. Honest risks & mitigations

- **Template authoring is the real cost, not the code.** → Start with 1–3 hero
  products; expand only on proven demand.
- **Quality bar is unforgiving** — a slightly-off preview is worse than none
  (looks cheap, loses the deal). → Deterministic core protects quality; cap what
  we expose to what looks genuinely good.
- **Messy customer logos** (JPEG w/ background, low-res). → bg-removal + a
  transparent-PNG/vector nudge + size guidance in the uploader.
- **Scope creep** — a configurator is a product, not a weekend feature. → Tight
  MVP; resist adding zones/products until one is great.
- **Rights/storage** of uploaded logos. → owner-scoped storage, clear notice,
  never used for training.
- **Device performance** on high-res export. → cap resolution v1; server render
  later.

---

## 12. Open questions

1. Which single product for the MVP? (drives the first template)
2. Colour zones: fixed swatch palette only, or free colour picker too?
3. Do we gate the customizer to approved accounts only, or allow pending/guests
   (lead capture)?
4. PDF proposal: reuse the quote PDF layout, or a dedicated one-pager design?
5. Is a Phase-0 staff-assisted validation round worth doing first, or go straight
   to self-serve MVP?

---

## 13. Rough build estimate (engineering, not authoring)

- Template schema + Firestore/Storage wiring + rules: ~small.
- Konva deterministic renderer (colour HSL swap, logo quad, text, luminance
  re-light): ~medium — this is the core.
- Customer configurator UI + upload/bg-removal: ~medium.
- Admin template form + dummy preview: ~medium.
- Enquiry attach + PDF export (reuse existing): ~small.

Authoring the *first* template (base + masks + tuning) is a real chunk of manual
design time — budget it explicitly and separately from the code.

---

## 14. Crystal Fabric material — VALIDATED with a working proof-of-concept

**Status: proven.** A deterministic Python (Pillow/NumPy) prototype rendered the
Crystocraft butterfly logo into clear/AB crystals on a jet-black crystal field —
directly comparable to a real crystal-fabric zebra product — using only a real
crystal-rock swatch photo as the material and the logo as a mask. No generative
AI. It looks like the real product. (POC: `render_crystal.py`; source swatches
pulled from `crystocraft.com/blog/crystal-fabric/`.)

### 14.1 Why this is the strongest-validated part of the whole engine

The product's real construction, per the crystal-fabric page, is **transparent
crystals on a printed/black film** — a colour/graphic layer UNDERNEATH + a
transparent crystal layer ON TOP. That is *exactly* the compositing model here,
so the render is a **digital twin of the manufacturing**, not an approximation.
This is also the effect that's hardest to fake by hand (it's a two-layer optical
effect) — which is precisely why the engine wins over manual work.

### 14.2 New zone type: `crystal_material`

A full-panel design area rendered through a captured crystal material. Extends
the §3 zone list. Example:

```jsonc
{
  "id": "front_panel",
  "type": "crystal_material",
  "label": "Crystal fabric face",
  "area": { "x": 120, "y": 90, "w": 760, "h": 1040 },
  "material": {
    "sample": "templates/mat/crystal_rock.jpg",   // real single-colour panel photo
    "stone_mm": 2.0,                                // 1.0 Fabric | 1.5 Fine Rock | 2.0 Rock
    "sparkle": { "lo": 0.70, "hi": 0.96 }          // glint extraction thresholds
  },
  "mode": "solid",                                  // solid | printed  (see 14.3)
  "palette": ["CrystalAB","Jet","Hematite","MetallicSilver","GoldenShadow"],
  "max_colors": 4                                    // quantisation cap for `solid`
}
```

Render math (validated in the POC): `body = target × (0.30 + 1.15·L)` then
`screen(body, glint·sparkle)`, where `L` and `glint` come from the real material
photo and glint gain scales with the target crystal's lightness (jet glints
dimmer than clear). Tile the material with random flip+roll to avoid any repeat.

### 14.3 Two render modes

- **Mode A — `printed` (Crystal Printing Graphic / transparent-film crystals).**
  Customer artwork is printed *under* transparent crystals. Render = artwork ×
  crystal sparkle/AO overlay. Supports **arbitrary, continuous graphics** (mild
  contrast/palette nudge only). Easiest + most flexible → **recommended MVP target.**
- **Mode B — `solid` (Jet / Hematite / AB solid fills — the zebra look).** Colour
  is discrete per stone. Render = quantise to stocked crystal colours → (phase 2:
  snap to a per-stone Voronoi grid) → sparkle overlay. Higher fidelity, more work.

The POC demonstrates Mode B two-tone today (clear-on-jet). Continuous per-stone
Voronoi mosaic is the phase-2 realism upgrade.

### 14.4 Stone size = resolution selector (straight from the product line)

Offer the three real fabric grades; each visibly shows the customer how much fine
detail survives, so expectation-setting is built into the product's own options:

| Grade | Crystal | Stone | Best for |
|---|---|---|---|
| Crystal Fabric | 1mm sand | fine | small logos, fine lines (the butterfly outline) |
| Crystal Fine Rock | 1.5mm PP9 | medium | balanced sparkle + detail |
| Crystal Rock | 2mm PP14 | coarse | bold logos, maximum sparkle |

The POC's fine vs coarse renders make this trade-off visible directly.

### 14.5 Real quantisation palette (from the swatch page)

Snap customer colours to actual stock — no guessing:
- **Named crystals:** Crystal AB, Crystal Blue Light, Metallic Silver, Golden
  Shadow, Crystal Copper, Crystal Dorado, Hematite, Jet, Bermuda Blue,
  Meridian Blue, Volcano Blue, Chrome, Silver/Golden Shadow, …
- **Printed colours** (for Mode A underlayer): Warm Ivory, Blush Pink, Red 032 C,
  Reflex Blue C, Mint Green, Purple C, Violet C, …
- **100+ numbered Crystal Fabric swatches** (blue-light rhinestone on printed film).

Each palette entry maps to an approximate render RGB (e.g. Jet ≈ `#0D0D13`,
Crystal AB ≈ `#D1D3E0`). Build this table once from the swatch photos.

### 14.6 Impact on the MVP recommendation

Re-point the Phase-1 MVP at a **Crystal Printing Graphic** product (Mode A):
arbitrary-graphic support makes it the most flexible, most impressive first demo,
and the material/render path is already proven. The zebra-style solid two-tone
(Mode B) follows as the fidelity upgrade with the per-stone mosaic.

### 14.7 Refraction model for Mode A (owner correction — VALIDATED)

Owner feedback (correct, and now modelled): a graphic printed *under* transparent
crystal is **not sharp** — each crystal is a tiny lens, so fine lines **blur and
displace**, and **bigger stones refract more**. A crisp overlay looks fake.

Modelled in the POC (`render_refraction.py`), physically motivated:
1. **Diffuse scatter** → Gaussian blur of the underlying graphic, radius ∝ stone size.
2. **Lens refraction** → warp the graphic along the crystal facet gradients
   (displacement field from the material's luminance gradient), magnitude ∝ stone size.
3. **Chromatic dispersion** → displace R/G/B by slightly different amounts → the
   coloured edge-fringing real crystals produce.
4. **Transmission + sparkle** → crevices darken, stone bodies transmit the print,
   specular glints screen on top.

Result: fine lines soften progressively 1.0mm → 1.5mm → 2.0mm, matching the real
product. Seamless material via feathered-overlap (Hann-window) tiling — a hard
tile grid shows up as refraction artifacts, so seamlessness matters here.

**Practical rule this surfaces (build into the configurator):** legibility depends
on **line thickness vs stone size**. The engine should measure the artwork's
thinnest strokes and **recommend / warn a stone grade** ("this logo's fine lines
need 1.0mm Crystal Fabric; on 2.0mm Rock they'll blur"). That guidance is a
genuine sales aid and prevents disappointing physical samples — it falls straight
out of the refraction model.

### 14.8 Honest gaps still open (what a production Mode A adds)

- **Surface mapping:** the POC renders a flat crystal panel. Production composites
  it into the actual product photo's panel area (e.g. the MagSafe wallet face),
  warped to its perspective + re-lit by the product's own highlights (§3.2).
- **Per-stone mosaic/magnification:** each stone slightly magnifies the graphic
  under its centre; the POC does displacement + blur but not true per-stone
  Voronoi magnification. A refinement, not a blocker.
- **Per-crystal-type material:** clear/AB vs jet vs coloured crystals each want
  their own captured material (or a tint of one). The POC uses a single rock photo.
- **Refraction from a real normal map** rather than a luminance-gradient proxy —
  marginal realism gain, more authoring.

These are realism refinements; the core "graphic × refracting crystal material,
stone-size-dependent" pipeline is proven.

### 14.9 Crystal Zone Map + minimum-feature rule (Mode B — owner reference)

Owner reference photo (black Fine-Rock butterfly on white Fabric background),
plus two corrections, define how Mode B must work.

**Mode B is a REGION map, not a bitmap.** The design reduces to a few labelled
regions; each region is assigned a crystal **TYPE (stone size)** and a crystal
**COLOUR**:

```jsonc
{
  "type": "crystal_zone_map",
  "regions": [
    { "id": "logo", "crystal_type": "fine_rock_1.5", "color": "Jet",
      "source": "customer_logo", "min_feature_action": "bolden" },
    { "id": "field", "crystal_type": "fabric_1.0", "color": "CrystalAB",
      "role": "background" }
  ]
}
```

**Owner correction 1 — minimum feature = 1 STONE (not 2.5).** The goal is to stay
as faithful to the original logo as possible. A stroke only needs to grow to **one
crystal wide** (a single line of stones); anything already ≥1 stone is left
untouched. Over-boldening destroys the design — keep it gentle.

| Crystal type | Stone | Min stroke = 1 stone |
|---|---|---|
| Crystal Fabric | 1.0mm | ~1.0mm |
| Crystal Fine Rock | 1.5mm | ~1.5mm |
| Crystal Rock | 2.0mm | ~2.0mm |

Only features **thinner than one stone** are boldened up to one stone; features
that can't survive even that (fine text) are **flagged unmakeable** and dropped.

**Owner correction 2 — edges are IRREGULAR, not straight.** Because each crystal
is a whole discrete stone, the colour boundary must **snap to whole stones**: the
design is quantised onto a per-stone **Voronoi cell grid** (jittered stone centres
at the region's stone size), and each stone takes a single colour. The black/white
edge therefore zig-zags stone-by-stone — raggeder for Rock 2.0mm, finer for Fabric
1.0mm — never a clean vector line. This is essential to realism, not optional.

**Enforcement + render pipeline (validated in `render_mosaic.py`):**
1. Measure each region's thinnest stroke; bolden only sub-one-stone features up to
   one stone (POC: butterfly outline 10px → 20px for 1.5mm fine rock — faithful).
2. Build a jittered Voronoi stone grid at the region's stone size; assign each
   whole stone to fg/bg by its centre → **irregular, stone-quantised edges**.
3. Flag unmakeable features (text, sub-stone detail) and min gaps/islands (≥1 stone).
4. Composite each region's own crystal material (stone-size scale + colour).
   Black crystals keep strong specular glints (black AB sparkles hard); light
   colours use a lifted body floor so Fabric reads bright white, not grey.
   Seamless material via feathered-overlap tiling.

**Configurator UX implication:** after upload, show the customer the *faithful,
palette-snapped, stone-quantised* preview — what's actually manufacturable, with
the real ragged crystal edges — not their raw artwork. Surface min-feature
warnings inline. This is exactly the "will this work in crystals?" answer buyers
need. (Superseded: the earlier 2.5-stone min was wrong — it is 1 stone.)

### 14.10 Stone-size consistency (owner correction — edge MUST match stone size)

Owner caught a structural bug: the ragged edge was ~3–5× the visible stone size.

**Cause:** two *independent* stone scales — the fill came from the scaled rock
*photo* (one stone size), the edge from a *separate* Voronoi grid (a different
size). In reality they are the **same stones**, so they must be the same size.

**Rule (non-negotiable):**
1. **Tie stone size to real millimetres:** `stone_px = stone_mm × px_per_mm`,
   where `px_per_mm = canvas_px / panel_width_mm`. So a 1.5mm Fine Rock stone is
   the correct physical fraction of the panel, not an arbitrary pixel guess.
2. **One stone grid drives BOTH** the crystal texture *and* the colour-region
   edge. Never let the fill texture and the edge come from different scales.

**Two valid implementations (both in the POC):**
- **Procedural** (`render_stones.py` `render`) — each Voronoi cell *is* a stone,
  shaded procedurally. Edge == stone size by construction; looks a bit
  diagrammatic. Best when you need guaranteed correctness.
- **Hybrid (recommended)** (`render_stones.py` `render_hybrid`) — realistic photo
  fill, but the photo is scaled so its stones == `stone_px`, and the edge Voronoi
  uses the *same* `stone_px`. Photo-real AND edge==stone size. This is the path.

Validated: Fine Rock 1.5mm → 30px stones, Rock 2.0mm → 40px stones; the edge
notches match the visible stones in the background at both grades.

**Still open (honest):** the black Fine-Rock fill reads a little flat — needs a
real black-crystal material photo (or stronger black specular) to show per-stone
faceting like the reference. Structure is correct; black material is a tuning item.

### 14.11 Crystal material fidelity — open tuning notes (owner domain input)

Not yet modelled; captured for the next realism pass. The current POC treats
crystal colour too flatly — real crystals are transparent with iridescent facets.

**Per-coating appearance (all TRANSPARENT — graphic below shows through):**
- **Crystal (plain):** clear/transparent; facet triangles carry a **slight
  rainbow** from light refraction (subtle, not coloured glass).
- **Crystal AB (Aurora Borealis):** transparent with a strong iridescent coating —
  facet triangles flash **yellow / purple / orange / blue**. The showiest.
- **Moonlight:** transparent with a **slight bluish** coating — iridescent but
  **less drastic than AB**.

**Modelling implication:** these tops are **not opaque colours**. Model each as a
mostly-transparent layer = (a) high transmission of the graphic below, (b) a faint
overall tint (none / AB-multichroma / Moonlight-blue), and (c) **per-facet
iridescent speculars** — the bright facet triangle gets a hue that varies by
coating (rainbow for AB, subtle for plain, bluish for Moonlight). Drive the facet
hue from the facet normal/angle so it shifts as in real refraction, not a flat wash.

**Mode A (printed graphic under crystal):** the **blur/refraction is about right**.
What needs fine-tuning is the **transparent top layer** — right now the crystal
veils the graphic too much and lacks the AB/Moonlight iridescent facet flashes.
Target: graphic below reads clearly, with transparent crystals adding sparkle +
the correct per-coating iridescence on top. (Mode A crystals are usually Crystal /
AB / Moonlight precisely because they're transparent.)

**Action for next pass:** build a small per-coating "facet iridescence" model
(hue-by-angle) + raise Mode A transmission; ideally capture real Crystal / AB /
Moonlight swatch photos to sample true facet colours rather than synthesising them.
