# Atelier Art Engine — Brand-to-Illustration Intelligence

**Scope note (read this first):** this protocol is for **Claude-directed,
client-brand illustration work** — e.g. theming a real Crystocraft product
around a specific corporate client's brand (the Sun Life example in §6) for
a proposal, mockup, or gift-selector visual. This is a **different producer
and purpose** than the external DeepSeek SEO/blog "Artgen" engine documented
in `docs/skills/MARKETING-WORKFLOW.md` §6 (zodiac/astrology blog art, run by
DSH, Operation Center as custodian only). The two share real prompting
technique — percentage-based anchoring and the "rewrite the anchors, don't
patch the feedback" recovery rule below are the same idea as
MARKETING-WORKFLOW.md §6.1a's `[FOUNDATION]`/`[NARRATIVE]`/`[ANCHORS]`
three-layer structure — but **where the two name an actual overlapping hard
rule, §6.2's Product Truth is the authoritative one**: it's backed by
`product-truth.js`'s code classifier, not just prompt wording. This doc's
"Material Truth" (§4) is a narrower, supplier-specific instance of the same
idea, not a competing rule. Which in-repo image call this actually drives
(`enhance-image.js` and its Gemini image models, `generate-blog.js`, or a
future dedicated endpoint) is not yet fixed — check `enhance-image.js`'s
model list (`gemini-2.5-flash-image` / `gemini-3.1-flash-image`, see its own
deprecation-tracking comment) before assuming a specific call site.

This skill defines the "Art Director-to-Renderer" protocol. In the
Crystocraft ecosystem, Claude acts as the Art Director (analyzing brand
intent and logic) and Gemini acts as the Renderer (executing precise
visuals). It prevents "generic AI" outputs by anchoring every design in real
brand elements and supplier constraints.

## 1. The Director-to-Renderer Protocol

Gemini is a "silent executor." It does not ask questions; it simply renders.
Therefore, Claude MUST provide a Technical Brief, not just a creative
prompt.

**The Technical Brief Structure:**

1. **[SOURCE ANCHOR]** — the base product/image from the supplier or
   catalogue.
2. **[BRAND DECONSTRUCTION]** — specific colors, icons, and motifs of the
   target client.
3. **[STYLE PROFILE]** — the specific art style from the Atelier Style
   Library (§3).
4. **[COMPOSITION MAP]** — precise placement of elements using
   percentage-based coordinates `[X%, Y%]`.
5. **[QA CHECKLIST]** — the criteria by which the resulting image will be
   judged.

## 2. Brand Deconstruction Framework

Before prompting Gemini, Claude MUST deconstruct the target brand into
Visual Tokens:

- **Primary Palette** — convert hex codes to descriptive material terms
  (e.g. "Sun Life Yellow" → "Polished Amber Glow").
- **Core Motifs** — the geometry of the brand (e.g. "Circular Sun" →
  "Radial symmetry, golden concentric arcs").
- **Typography Tone** — the "weight" of the brand (e.g. "Bold Corporate" →
  "Heavy, grounded structures").
- **Negative Space Rule** — how the brand "breathes" (e.g. "High-end
  Minimalist" → "60% unoccupied space on the left").

## 3. The Atelier Style Library (V3)

Use these pre-verified profiles to ensure aesthetic consistency:

**Profile: `[CUTE-CHAR-V1]`** (Target: Youth/Gifting)
- Visual Grammar: soft rounded edges, expressive large eyes, tactile "felt"
  or "soft porcelain" textures.
- Color Logic: pastels with high-saturation accents.
- Lighting: soft global illumination, no harsh shadows.

**Profile: `[EDITORIAL-SURREAL]`** (Target: B2B/Corporate)
- Visual Grammar: cut-paper relief, surreal juxtapositions (e.g. a tree
  growing from a crystal), high-contrast depth.
- Color Logic: tinted shadows (e.g. navy shadows instead of black),
  metallic highlights.
- Lighting: dramatic directional light, "Atelier" material depth.

**Profile: `[INK-AND-LACQUER]`** (Target: Zodiac/Heritage)
- Visual Grammar: fluid brushstrokes, gold leaf accents, traditional
  lacquerware textures.
- Color Logic: deep black/vermilion base with metallic gold/bronze accents.

## 4. Technical Constraint Mapping (Supplier-Grounded)

Design is not "free." It must be **deliverable**.

- **Material Truth** — if the supplier only does metal and crystal, the
  illustration must reflect these materials. No plastic or organic textures
  unless explicitly requested. (A specific instance of MARKETING-WORKFLOW.md
  §6.2's Product Truth rule, not a separate one.)
- **Size Logic** — if the product is 50×50mm, the illustration's central
  focus must respect that aspect ratio.
- **Printability** — avoid ultra-fine gradients that cannot be reproduced on
  physical products.

## 5. The "Feedback Loop" Correction Protocol

When Gemini fails, do NOT give generic feedback. Use the Coordinate
Correction method:

- **Bad feedback:** "Move the logo up."
- **Atelier feedback:** "The Logo at `[50%, 50%]` is too central. Move the
  Logo to `[85%, 15%]` (top-right). Reduce its scale by 20%. Increase the
  contrast against the background."

This is the same failure-recovery rule as MARKETING-WORKFLOW.md §6.1a:
rewrite the anchor/coordinate layer with more specificity, don't patch a
vague instruction onto an already-failed prompt.

## 6. Execution Example (Claude-to-Gemini)

**User intent:** "Make a Sun Life themed gift design using our Rose
Crystal."

**Claude's Technical Brief to Gemini:**
> Base: `verified_product: rose_crystal_v2.png`
> Brand: Sun Life (Yellow #FFD200, Blue #003366).
> Style: `[EDITORIAL-SURREAL]`.
> Task: Surround the Rose Crystal with radial golden arcs (Sun Life Motif).
> Anchors: Crystal at `[50%, 60%]`, Arcs radiating from `[50%, 40%]`.
> Constraint: Preserve the crystal's facets exactly; do not alter its
> geometry.
