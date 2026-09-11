# Atelier Art Engine — Brand-to-Illustration Intelligence

**Scope note (read this first):** this protocol is for **Crystocraft product
development** — theming a real product around a specific corporate client's
brand for a proposal, mockup, gift-selector visual, or new product concept
(the Sun Life example in §6). It belongs with the Customizer / Crystal
Fabric Studio product-development area (`SKILL.md`'s "Customizer / Crystal
Fabric Studio / swatches" section, alongside `Corp_Gift_Customizer_Spec.md`
and `Crystal_Fabric_Studio_Spec.md`) — **it is not an outreach/marketing
copy tool**, and has nothing to do with Daily Drafts or `WRITING-STYLE.md`.
It's also a different producer/purpose than the external DeepSeek SEO/blog
"Artgen" engine in `MARKETING-WORKFLOW.md` §6 (zodiac/astrology blog art,
run by DSH, Operation Center as custodian only) — worth naming only because
the two happen to share real prompting technique: percentage-based
anchoring and the "rewrite the anchors, don't patch the feedback" recovery
rule below are the same idea as MARKETING-WORKFLOW.md §6.1a's
`[FOUNDATION]`/`[NARRATIVE]`/`[ANCHORS]` three-layer structure. Where the
two name an overlapping hard rule, §6.2's Product Truth stays authoritative
for actual sellable-product imagery — it's backed by `product-truth.js`'s
code classifier, not just prompt wording; this doc's "Material Truth" (§4)
is a narrower, supplier-specific instance of the same idea, not a competing
rule. Which in-repo image call this actually drives (`enhance-image.js` and
its Gemini image models, the Customizer render service, or a future
dedicated endpoint) is not yet fixed — check before assuming a specific call
site.

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

**Corollary, learned the hard way on the La Salle project (§7): never trust
Gemini's own self-reported compliance.** A result can arrive with confident
accompanying text claiming it matches the brief exactly while visibly not
matching it at all — that text is not verification. Always compare the
actual output pixels to the actual reference yourself before accepting a
result.

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

## 7. Controlled Generation — structured JSON prompting (the proven, preferred technique)

**Added 2026-09-12**, after the La Salle Primary School music box project
(`Product Development/projects/2026-09-lasalle-music-box/`) tried six
prose-Technical-Brief iterations (v2–v7) that each fixed one problem and
revealed another, then got a correct result on the first attempt after
switching to this technique. **Use this instead of a hand-written prose
Technical Brief whenever the supplier/reference has more than one existing
example to analyze** — the prose §1 structure above still describes *what*
information the brief needs, but assembling it as JSON rather than
paragraphs is what actually held up under a real image model.

This is a named, documented industry technique, not a house invention —
worth knowing the real names if researching further: **Controlled
Generation** (Google's own term for structured JSON output with the Gemini
API), **Structured/JSON Prompting** for image models, **JSON Style Guides**
/ **JSON Layout Maps**. Reference material (owner-supplied, 2026-09-12):
Google AI docs "Structured outputs" (`ai.google.dev/gemini-api/docs/structured-output`,
configuring `response_format`/`response_mime_type` with a JSON schema),
Google's "Controlled Generation with the Gemini API" Skills lab, the
`gemini-image-prompting-handbook` GitHub repo, and community write-ups on
"JSON prompts for Nano Banana" (Gemini's image-gen models) covering nested
`subject`/`visual_style`/`camera_settings` objects and bbox-coordinate
layout maps.

### The method, in order

1. **Analyze, don't assume.** Ask Gemini itself (a plain text+vision call,
   e.g. `gemini-2.5-flash` — NOT the image-generation model) to reverse-
   engineer the reference product's design into **structured JSON**
   (`response_mime_type: 'application/json'`, a fixed schema you define).
   Do this across more than one reference example if the product has an
   existing line — a single example can't tell a hard rule apart from an
   incidental choice.
2. **Compare the JSON across examples before touching the new brand's
   content.** This is where the real information is. On La Salle, two hard
   rules were invisible just from looking at the pictures and only became
   obvious once compared as structured fields: `human_figures_present:
   false` in every single reference (not a style choice — a rule every
   prose attempt had silently broken), and a measured `density_pct_frame_
   filled: 85-95` (turning a vague "looks sparse" complaint into a precise,
   checkable number).
3. **Populate a new JSON with the target brand's real elements**, field by
   field, matching the same schema — substitution, not redesign. Where the
   target has no obvious equivalent for a field (a school has no city
   landmarks for "secondary elements"), that is a genuine judgment call to
   make deliberately and record the reasoning for (see
   `lasalle-design-json.json`'s "delight element" choice — the school's
   real swimming pool, specifically chosen over a generic school symbol),
   not a gap to fill with a plausible-sounding placeholder.
4. **Send the populated JSON itself as the generation prompt** — serialize
   it, prepend one line telling the model to treat every field as a literal
   instruction, attach it alongside the actual reference images. Include a
   `layout_map` with `bbox` objects (fractional `x`/`y`/`width`/`height`,
   origin top-left) for anything needing a specific position — this
   replaces §1's inline `[X%, Y%]` notation with an explicit structured
   field, which held up noticeably better under the model than the same
   coordinates written into prose.

### Two sharp lessons, worth not re-learning

- **A reference photo containing real text/a logo will leak into the
  output even when you explicitly say not to reproduce it — describing the
  forbidden thing still invites it.** The fix that actually worked was
  physically cropping the text/logo out of the source image before
  attaching it, not writing a stronger negative instruction. (This
  independently matches an unrelated project's own art-pipeline rule,
  shared by the owner: "don't let a subject invite text," "don't name
  example objects in style text" — naming a thing, even to forbid it,
  still raises its salience to the model.)
- **Multiple reference images attached for different purposes (one for
  content, others for style only) can still bleed into each other** — a
  photorealistic-render attempt printed one reference box's own artwork
  onto a different design's lid despite being told the other images were
  "style/material reference only." State the split explicitly, but verify
  the actual result rather than trusting the instruction held (see §5's
  corollary above on self-reported compliance).

See `Product Development/projects/2026-09-lasalle-music-box/99-outcome.md`
for the full worked account, `wuhan-design-analysis.json` +
`nanjing-chongqing-xiamen-design-analysis.json` for the analysis step, and
`v8-generation.json` for the actual populated generation prompt that
produced the best result.
