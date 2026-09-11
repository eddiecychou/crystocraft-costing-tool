# Technical Brief v2 — La Salle Primary School Music Box (background only)

**Scope change from v1** (see `../99-outcome.md` for why): Gemini is no
longer asked to draw the crest, the star, or the "La Salle Primary School"
plaque at all. It draws the illustrated *background scene only*. The
logo/star and the plaque get composited in afterward from the real assets
— because the plaque was always a separate die-cut physical piece in
production anyway (`../02-supplier-spec.md`), so there was never a good
reason to ask an image model to hand-draw a logo it can't trace exactly.

## Attach these images

1. `references/school-building-streetview.jpg` — **[BUILDING REFERENCE]**
2. `references/supplier-box-wuhan-front.jpg` — **[STYLE + FORM REFERENCE]**
3. `references/supplier-box-nanjing-3stack.jpg` — **[STYLE REFERENCE]**

**Do NOT attach `school-crest.jpg` or `school-logo.svg` this time** — there
is nothing for Gemini to do with them now that it isn't drawing the logo.
Attaching them again risks the same failure (the model tries to "helpfully"
work them into the scene and redraws them anyway).

## Generation settings

Same as v1: temperature as low as possible (0, or the interface's
minimum).

```
[SOURCE ANCHOR]
Base: reference_style_match — the supplier's own city-souvenir music box
line, 88mm x 71mm MDF lid, landscape orientation. New illustration, no
existing product photo to edit.

[BRAND DECONSTRUCTION]
Client: La Salle Primary School (Hong Kong).
Palette: deep lacquer red, navy enamel blue, warm brushed gold, muted
olive-laurel green, porcelain white / light-blue sky.
Motifs in this render: the curved white modern school building silhouette;
a laurel branch as a left-edge frame; red/blue pool-lane stripes as a
playful accent; small silhouette figures of jumping students.
DO NOT draw: any star, any shield/crest shape, any text, any plaque/badge/
medallion shape, any logo of any kind. Leave the area around [65%, 55%]
and [65%, 32%] EMPTY / clear background — that space is reserved for a
separate asset that will be added afterward, not by you. Do not fill it
with your own decorative element.

[STYLE PROFILE]
Match the supplier's own established house style exactly (flat-vector,
semi-isometric cityscape-collage illustration, saturated candy-bright
color, clean black linework, soft cel-shading — NOT anime/storybook
soft-shaded rendering, NOT a drop-shadow/bevel badge aesthetic anywhere in
the image). Look specifically like references/supplier-box-wuhan-front.jpg's
linework weight and flat color fills, not a softer illustration style.

[COMPOSITION MAP]
- Sky: light blue, top 30% of frame.
- School building silhouette: anchor at [30%, 35%], landmark role.
- Laurel branch frame: vertical, left edge, [8%, 50%].
- RESERVED EMPTY SPACE for the plaque (added later, not by you): roughly
  [50-80%, 40-70%] — keep this area as simple background (sky/empty),
  not empty in the sense of a hole, just uncluttered enough that a plaque
  can be placed on top of it afterward without fighting other detail.
- RESERVED EMPTY SPACE for the star (added later, not by you): roughly
  [55-75%, 20-42%] — same instruction, keep it visually simple/uncluttered.
- Pool-lane red/blue stripe ribbon: across the lower 15% of the frame,
  centered around [50%, 90%].
- 2-3 small silhouette figures of jumping students: bottom-left, [20%, 85%],
  simple flat silhouettes, matching the supplier reference's level of
  detail (not individually detailed faces/uniforms).
- Aspect ratio: ~5:4 landscape (88mm x 71mm).

[QA CHECKLIST]
- NO star, shield, plaque, badge, medallion, or text anywhere in the image
  — this is the single most important check for this version. If the model
  drew anything in the reserved zones, that's a FAILURE, not a bonus.
- School building silhouette present and recognizable as the actual curved
  facade (compare to references/school-building-streetview.jpg).
- Laurel frame present on the left edge, not overwhelming the scene.
- Pool-lane red/blue stripe motif present in the lower band.
- Jumping-student silhouettes present, simple, small, bottom-left.
- Linework and color-fill style genuinely matches
  references/supplier-box-wuhan-front.jpg — flat, saturated, clean-outlined
  — specifically NOT the softer/anime-shaded look v1 produced.
- Reserved zones (plaque area, star area) are visually simple/calm, ready
  to have something placed on top.
```

## After generation — the compositing step

1. Save Gemini's background result as `v2-result-background.png`.
2. Composite the real crest star + a cleanly typeset "La Salle Primary
   School" plaque on top, in the reserved zones — either:
   - Ask Claude to build an HTML/SVG mockup compositing the real
     `references/school-crest.jpg` (or a cropped/isolated version of just
     the star) onto the background, as a fast way to *preview* the final
     look before any production artwork is commissioned, or
   - Hand off to whoever does final production artwork (Illustrator/Figma)
     to composite the real vector logo properly for print.
3. Log the result in `../99-outcome.md`.

**Previous:** [`v1-brief.md`](v1-brief.md) (rejected — see `../99-outcome.md`)
