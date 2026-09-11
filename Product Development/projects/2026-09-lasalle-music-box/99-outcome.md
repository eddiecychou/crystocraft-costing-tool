# Outcome Log

## v1 — 2026-09-12 — REJECTED (logo fidelity failure)

Run manually by the owner in Gemini, with `04-prompts/v1-brief.md`'s text +
the 4 attached reference images, temperature set low as instructed.

**Gemini's own response included a self-written "Execution Verification &
Composition Audit"** claiming full compliance — e.g. "the five-pointed
radiant star... retains the geometry, dual-color bisected point styling,
and radiating ray background from the source reference." **This claim is
false.** Comparing the actual output to `04-prompts/references/school-crest.jpg`:

- **Star (the one hard "do not modify" rule):** the crest's star is a
  sharp, thin, many-pointed radiating burst in solid gold/white/orange with
  no outline. The output star is a chunky 8-point compass-style star with a
  visible dark outline, alternating flat blue/gold fill — a different
  shape, different construction, different color logic. Not a close call —
  a different star.
- **Centerpiece plaque:** the brief asked for a plaque styled like the
  supplier's own flat, organic-silhouette nameplates ("WUHAN", "南京" —
  see `references/supplier-box-wuhan-front.jpg`). Gemini invented its own
  rounded-arch badge/medallion shape with a drop-shadow bevel effect — not
  a die-cuttable flat plaque, not matching the reference style, and not
  matching the composition brief's `[65%, 55%]` positioning (it reads as a
  separate free-floating badge, not integrated into the scene the way the
  reference boxes' plaques are).
- **Overall linework/rendering:** softer, more anime/cel-shaded than the
  flat-vector cartoon style in the supplier references — closer to a
  generic "storybook illustration" than the specific house style the brief
  asked to match.
- **What DID work:** the building silhouette is a reasonable likeness of
  the real curved facade; the laurel branch and jumping-student silhouettes
  are present roughly where asked; the palette (red/blue/gold/green) is in
  the right family.

## Root cause (not a prompting-skill problem)

Text-to-image models do not reliably **trace** a pasted reference image —
they reinterpret it, even when explicitly told not to, and then (as seen
here) will confidently claim fidelity in their own accompanying text
regardless of whether it's true. This is exactly the risk the brief itself
flagged ("a real risk with image-generation models, which tend to redraw
everything they're shown") — it happened. **Never trust an image model's
own self-reported compliance/audit text as verification** — always check
the actual pixels against the actual reference, the way this log just did.

## Decision — the fix is a scope change, not a better prompt

The crest/star was always going to be manufactured as a **separate die-cut
physical piece** in production (see `02-supplier-spec.md`) — it never
strictly needed Gemini to render it at all. **v2 removes the logo/star/
plaque from what Gemini is asked to draw entirely.** Gemini's job becomes
just the illustrated background scene (building, laurel, pool stripe,
student silhouettes) in the supplier's house style; the real crest and a
cleanly-typeset "La Salle Primary School" plaque get composited in
afterward from the actual vector/photo assets — the same way the
supplier's own physical product actually gets made (a separately printed/
die-cut layer, not a hand-illustrated one). See `04-prompts/v2-brief.md`.

## v2-v7 — 2026-09-12 — iterative corrections, real progress but structurally wrong

Ran via direct Gemini API calls (not manual browser copy-paste — a
`GEMINI_API_KEY` already exists in `.env.local`, same one `enhance-image.js`
uses, so this session called `generateContent` directly with
`responseModalities: ['IMAGE']` and `temperature: 0`, matching that
function's own request shape).

- **v2** (background-only, logo excluded): worked as scoped — no invented
  logo — but far too sparse (large empty sky) and jumping-student
  silhouettes rendered as a bordered pictogram icon box, not integrated art.
- **v3** (Coordinate Correction edit of v2): fixed the laurel side but
  re-introduced a small star despite the exclusion rule, and stayed sparse.
- **v4** (fresh generation, density instructions added): much denser and
  better-integrated jumping figures, BUT copied the real crest + Chinese/
  English name onto the building's entrance signage — because the building
  reference photo itself shows that signage, and describing it (even to say
  "leave it blank") still invited the model to reproduce it.
- **v5** (edit of v4, blank the signage): fixed cleanly — first fully
  logo-free, reasonably dense result.
- **v6** (first photorealistic product-photo attempt, using v5 as the "print
  this" reference + supplier photos for material/lighting): construction
  quality (MDF texture, laser-cut edges, metal knob, studio lighting/
  camera angle) was excellent and genuinely close to the supplier's own
  photography — but the model printed the *Wuhan* reference box's actual
  cherry-blossom/ferris-wheel artwork onto the lid instead of the La Salle
  content, evidently treating the style-reference photos as content sources
  too.
- **v7** (same photoreal approach, explicit "image 1 is the ONLY content
  source, the rest are material/lighting references only"): fixed the
  content mixup — correct La Salle scene, still photorealistic, no
  fabricated logo. Best result up to that point, but the flat-art content
  itself was judged "awful" — too sparse/plain compared to the supplier
  line's actual density.

**Root causes identified this round, both traced to specific technique
gaps, not random model flakiness:**
1. Describing a real-world reference photo's visible text/logo — even as a
   negative instruction ("don't reproduce this") — still primes the model
   to reproduce it. The fix that actually worked: physically crop the
   signage out of the reference photo before attaching it
   (`references/school-building-NOSIGN.jpg`), so there's nothing to invite.
   This mirrors a documented lesson from an unrelated project's own art
   pipeline (`GENERATE-ART-SKILL.md`, shared by the owner): "don't let a
   subject invite text," and "don't name example objects in style text."
2. Multiple reference images with their own strong content (the Wuhan box's
   actual scene) can leak into the output even when only their *style* was
   wanted — needs an explicit "these images are for style/material only,
   ignore their content" instruction, and even then isn't fully reliable.

## v8 — 2026-09-12 — SUCCESS via structured JSON Controlled Generation

**This is the technique that actually worked**, per the owner's explicit
direction: stop hand-writing prose prompts; instead (a) ask Gemini itself
to analyze the supplier references and return **structured JSON**
(`response_mime_type: 'application/json'`), (b) tweak that JSON's fields to
substitute La Salle's real brand elements for the city-specific content,
(c) send the populated JSON itself as the generation prompt (serialized,
with a literal `layout_map` of bbox-coordinate object placements), rather
than translating it into paragraphs by hand. This is the documented
"Controlled Generation" / "structured JSON prompting" pattern for Gemini
image models.

**Two-step analysis, both saved:**
- `wuhan-design-analysis.json` — single-design JSON dissection (dominant
  landmark, secondary elements, filler motif, delight element, nameplate
  construction, layering order, density%, deliberate omissions).
- `nanjing-chongqing-xiamen-design-analysis.json` — same schema applied to
  three more designs, confirming which fields are a consistent HARD RULE
  across the whole product line vs. specific to one city.

**Two hard rules only became visible from this structured comparison, and
both had been silently broken in every v1-v7 attempt:**
- `human_figures_present: false` in **all four** reference designs. Not a
  style preference — a rule. Every earlier version's jumping-student
  silhouettes violated it.
- `density_pct_frame_filled: 85-95` in all four. Confirmed the "too sparse"
  complaint on v2/v3/v7 was a precise, measurable deviation, not a vague
  aesthetic judgment.

**`lasalle-design-json.json`** — the populated version: La Salle's real
building as the dominant landmark, real campus features as secondary
elements, laurel/greenery as filler texture, and — the one real judgment
call — the school's actual competitive swimming pool (with its own real
"We Are The CHAMPION" banner) chosen as the "delight element," specifically
because the design-theory analysis warned against forcing a generic
school-symbol (bus, graduation cap) onto a formula whose whole point is ONE
true, specific, slightly surprising local detail (Chongqing's hotpot bowl,
Xiamen's record player) — a genuine detail about *this* school, not a
generic symbol of "a school."

**`v8-generation.json`** — the actual prompt sent to Gemini: a JSON object
with `subject`/`visual_style`/`layout_map` (bbox object placements)/
`camera_settings`/`hard_exclusions` keys, serialized and sent as the text
part alongside the cropped building photo (`school-building-NOSIGN.jpg`)
and two supplier style references.

**Result (`v8-result.png`): the best result of the whole project.** Dense,
correctly-styled, zero human figures, zero fabricated logo/text, the real
building + real pool + real Hong Kong context, genuinely reads as part of
the same product family as the Wuhan/Nanjing/Chongqing/Xiamen line.

**Remaining known gaps, not yet fixed:**
- Laurel branch didn't render distinctly — left side is generic dense
  bushes instead.
- Output came back square (1024×1024), not the requested 5:4 landscape
  `camera_settings.aspect_ratio`.
- Thin white margin instead of true edge-to-edge bleed (matters for actual
  print, not for a concept preview).
- Logo/nameplate still deliberately absent — per the owner's decision this
  gets composited in separately (Photoshop) rather than fought for through
  the image model.

## v9 — 2026-09-12 — SUCCESS: actual photorealistic render, precise brand extraction, element-count parity

Two real gaps the owner identified in v8, both addressed:

1. **v8 was flat lid artwork, not a rendered product photo.** The owner
   asked for what the supplier's OWN reference photos are: photographs of
   the real physical object, not print-ready graphics.
2. **The building was described in my own prose, not extracted via the same
   JSON-analysis rigor applied to the supplier references.** Fixed by
   running the same `response_mime_type: 'application/json'` extraction
   technique on the brand's own source images, not just the style
   references.

**New extractions, all saved:**
- `school-building-analysis.json` — the real building's architecture read
  directly from `school-building-streetview.jpg`: exact floor count (8),
  curve direction, balcony-banding pattern, window ribbon arrangement,
  roofline, ground-floor canopy, materials — specific, not "a curved white
  building."
- `box-construction-analysis.json` — the box's real physical construction
  and the supplier's actual product photography, extracted from
  `supplier-box-wuhan-front.jpg` + `supplier-box-spec-sheet.jpg` +
  `supplier-box-knob-detail.jpg`. **Caught and corrected two factual errors
  in Gemini's own extraction before using it** — it placed the knob on the
  box's bottom (wrong; every reference shows it on a side wall) and gave
  dimensions of 12×9×8cm (wrong; the spec sheet says 8.7×7.1×4.2cm,
  verified ground truth). Another instance of the standing rule: verify an
  extraction against known facts before trusting it, the same as never
  trusting a self-reported compliance claim.
- `catholic-motifs-analysis.json` — per the owner's explicit request to
  include Catholic/Lasallian elements (reversing the earlier "subtle nod
  only" scope decision), extracted abstractable motifs from the previously-
  excluded stained-glass and mosaic images — specifically WITHOUT the human
  figures in those images (Christ, students) — landing on a Latin cross
  silhouette with the mosaic's radiating-arch pattern as the one motif that
  reads as Catholic/Lasallian without depicting a person.

**Element-count parity:** the owner pointed out Wuhan's design has ~10
distinct elements (1 dominant + 6 secondary + filler + delight + nameplate)
while the project had only been using ~5. `v9-generation.json` explicitly
lists 10 elements matched to real, verifiable La Salle facts: the building
(dominant), entrance canopy, sports court, the real mosaic mural on a
nearby building wall (`school-building-mural.jpg`), the Kowloon skyline,
the Catholic cross motif, laurel, holly (the crest's other heraldic side
ornament, previously dropped), street trees, and the pool+trophy delight
element — no padding with invented content, every element traced to a real
source.

**Result (`v9-result.png`):** the best result of the entire project.
Genuinely photorealistic — correct laser-cut charred-edge texture, correct
knob position, correct box proportions, studio lighting/shadow matching the
supplier's own photography — with a dense, richly-detailed lid graphic
carrying real La Salle elements at a density and element-count comparable
to the Wuhan reference, zero human figures, zero fabricated logo/text.

**Minor remaining gaps:** laurel rendered on both left and right edges
(mirrored) rather than laurel-left/holly-right as specified; the sports
court element is mostly cropped out of frame on the left edge. Neither is
severe enough to warrant another full round without the owner's direction
on priority.
