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

## 6. Open questions for the owner

- Does Crystocraft (or the owner personally) actually hold enough Swarovski
  article-number knowledge to seed a legacy-ref lookup table, or does that
  live with the supplier? This gates whether the curated-mapping half of
  "Match my old Swarovski" is buildable at all in Phase 2b.
- What does a sample actually cost to produce and ship, and is that
  absorbed, charged, or minimum-order-gated? Needed before "request a
  sample" can be a real CTA rather than a form that goes nowhere.
- Photography budget/cadence for growing past 27 swatches — who shoots them,
  how often.
