# Technical Brief v1 — La Salle Primary School Music Box

Assembled from `../03-concept.md` per `docs/skills/ATELIER-ART-ENGINE.md` §1.
Not yet sent to Gemini — see this project's outcome log once it has been.

## Attach these images with the text brief

See `references/README.md` for the full index and reasoning. The short
version — attach these four, in this order:

1. `references/school-crest.jpg` — **[LOGO REFERENCE — DO NOT MODIFY]**
2. `references/school-building-streetview.jpg` — **[BUILDING REFERENCE]**
3. `references/supplier-box-wuhan-front.jpg` — **[STYLE + FORM REFERENCE]**
   (the single most important one — style, box form, and composition
   layout all in one image)
4. `references/supplier-box-nanjing-3stack.jpg` — **[STYLE REFERENCE]**
   (confirms the style across more than one example)

Do NOT attach `school-stainedglass-NOTUSED.jpg` or
`school-mosaic-NOTUSED.jpg` — see the owner's religious-imagery decision in
`../03-concept.md`. Do NOT attach `school-students-jumping.jpg` to an actual
generation call — see `references/README.md`'s note on real identifiable
children.

## Hard rule — the logo is fixed, not a starting point

**The crest (and any element drawn from it, including the star used in this
composition) must be reproduced EXACTLY as shown in
`references/school-crest.jpg` — do not redraw, restyle, simplify, recolor,
reinterpret, or "improve" it.** Treat it as a fixed asset to place into the
scene at the correct position/scale, the same way a real production process
would place a die-cut logo piece — not as creative inspiration for a
Gemini-drawn version of a star. If the model cannot place the exact logo
asset directly (a real risk with image-generation models, which tend to
redraw everything they're shown), say so explicitly in the output/response
rather than silently substituting an invented star — that's a v2 problem to
solve deliberately (e.g. compositing the real logo in afterward), not one to
paper over with a close-enough redraw.

## Generation settings

**Temperature as low as possible** (0, or the minimum the interface allows)
— per `enhance-image.js`'s own precedent for "faithful" modes in this
codebase (see `docs/skills/MARKETING-WORKFLOW.md`), low temperature is what
keeps a model from drifting away from a detailed brief like this one. Low
temperature is NOT the same as low quality — it constrains *how much the
model improvises*, not how polished the render looks; a highly-specified
brief like this one (exact colors, exact positions, exact reference images)
is exactly the case where low temperature helps rather than produces
something flat, because there's nothing worth improvising here that the
brief hasn't already decided. If the output looks stiff or low-effort at
temperature 0, that's a brief-specificity problem to fix in a v2 (add more
concrete detail), not a reason to raise the temperature and let the model
guess.

```
[SOURCE ANCHOR]
Base: reference_style_match — the supplier's own city-souvenir music box
line (Wuhan/Nanjing/Chongqing/Xiamen examples), 88mm x 71mm MDF lid,
landscape orientation. This is a NEW illustration (no existing product
photo to edit) built to match that established house style exactly — not
a controlled_product_edit of a single source image.

[BRAND DECONSTRUCTION]
Client: La Salle Primary School (Hong Kong).
Palette: deep lacquer red (#8E1A1D-ish), navy enamel blue, warm brushed
gold, muted olive-laurel green, porcelain white background/sky.
Motifs: a radiating star (school crest's star, used sparingly); a curved
white modern school building silhouette; a laurel branch as a left-edge
frame; red/blue pool-lane stripes as a playful accent.
Explicitly EXCLUDED: the full crest/shield, the Chinese characters, the
Latin motto, the open book + lamp icon, any literal De La Salle or Christ
figures (owner's decision, 2026-09-12 — subtle nod only, no reproduced
religious figures).

[STYLE PROFILE]
Match the supplier's own established house style exactly (flat-vector,
semi-isometric cityscape-collage illustration, saturated candy-bright
color, clean black linework, soft cel-shading, no photoreal or painterly
rendering) — same family as the Wuhan/Nanjing/Chongqing/Xiamen reference
boxes. Not one of the Atelier Style Library's three named profiles; treated
as its own reference-matched style for this brief.

[COMPOSITION MAP]
- Sky: light blue, top 30% of frame.
- School building silhouette: anchor at [30%, 35%], landmark role.
- Laurel branch frame: vertical, left edge, [8%, 50%].
- Raised centerpiece plaque, reading "La Salle Primary School": [65%, 55%],
  right-of-center, styled as a separate die-cut layered element the way
  every reference box's city-name plaque sits proud of the lid (this plaque
  will be a SEPARATE die-cut physical piece in production — render it as a
  distinct layered/raised element in the illustration, not flush with the
  background).
- Star accent: small, radiating, directly above the plaque, [65%, 32%].
- Pool-lane red/blue stripe ribbon: across the lower 15% of the frame,
  centered around [50%, 90%].
- 2-3 small silhouette figures of jumping students: bottom-left, [20%, 85%],
  kept simple/small, secondary to the plaque.
- Aspect ratio: ~5:4 landscape (88mm x 71mm).

[QA CHECKLIST]
- Star matches references/school-crest.jpg's actual star EXACTLY (same
  point count, proportions, ray pattern) — not a generic five-point star or
  a reinterpreted version. This is the single most important check — a
  close-enough star is a FAILURE, not a minor variance.
- School building silhouette present and recognizable as a curved modern
  facade (not a generic tower/pagoda).
- Star present but small/secondary — not the dominant element.
- Laurel frame present on the left edge, not overwhelming the scene.
- Centerpiece plaque clearly reads "La Salle Primary School" and looks like
  a separate raised/layered element, with a clean enough silhouette to be
  physically die-cut.
- Pool-lane red/blue stripe motif present in the lower band.
- Jumping-student silhouettes present but small, not competing with the
  plaque for focal attention.
- Overall palette matches: lacquer red, navy blue, warm gold, laurel green,
  porcelain white/light-blue sky.
- NO crest/shield shape, NO Chinese characters, NO Latin motto text, NO
  book+lamp icon, NO literal De La Salle or Christ figures anywhere in
  frame.
- Style reads as flat-vector cityscape-collage, matching the
  Wuhan/Nanjing/Chongqing/Xiamen reference boxes' house style — not
  photoreal, not painterly, not a different illustration style.
```

## Status

**Image package ready, not yet run.** `references/` now holds the full,
labeled set (17 files, indexed in `references/README.md`). Per
`docs/skills/ATELIER-ART-ENGINE.md`'s scope note and this workflow's own
"Open question" in `05-Working-Notes.md`, there is still no direct tool call
from this session to Gemini — the manual handoff path applies: attach the
four images listed above, paste the text block below, set temperature to 0
(or the interface's minimum), save the result as `v1-result.png` alongside
this file, and log the outcome in `../99-outcome.md`. Given the "logo must
not be modified" hard rule above, **check the star against
`references/school-crest.jpg` specifically before accepting any result** —
that's the one thing most likely to drift even at low temperature.
