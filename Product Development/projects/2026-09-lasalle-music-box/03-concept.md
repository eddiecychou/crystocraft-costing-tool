# Stage 3 — Product Concept Spec: La Salle Primary School Music Box

**Concept name:** La Salle Landmark Music Box
**Client:** La Salle Primary School PTA (contact: Heymans Ho)
**Base product:** Xiamen Ling Er Gong Chuang dynamic music box, 88×71×42mm MDF
**Date / owner:** 2026-09-12 / Eddie

## Decisions locked in with the owner (2026-09-12)

- **Lead asset:** neither the crest alone nor the wordmark alone — pull the
  crest's **star** and the school **building's silhouette** into the
  supplier's own cityscape-collage visual language, the same way each city
  box pulls in 3–4 real local landmarks.
- **Religious imagery:** a subtle nod only. The star stays (it already
  reads as "achievement/excellence," not overtly religious to a general
  viewer) — no literal De La Salle or Christ figures from the stained
  glass/mosaic.
- **Style:** match the supplier's exact house style — flat-vector,
  semi-isometric cityscape collage, saturated color, clean black linework,
  a raised die-cut centerpiece plaque. Not a bespoke new style.
- **Text:** English only — "La Salle Primary School." No Chinese wordmark,
  no P6/year marker (not selected by the owner — if a graduation-year
  marker turns out to matter, that's a later revision, not assumed now).

## 1. Brand Deconstruction (from Stage 1, filtered by the decisions above)

- Palette: deep lacquer red + navy enamel blue (crest quarters, uniform,
  pool lanes) + warm brushed gold (star) + muted olive-laurel green
  (laurel) + porcelain white (building, PE kit).
- Motifs in play: the radiating star; the curved white school building
  silhouette; laurel (kept, as a border/frame device — holly dropped, one
  framing plant is enough at this scale); pool lane red/blue stripes as a
  secondary "school pride" motif.
- Motifs dropped per the decisions above: the open book + lamp icon, the
  Chinese characters, the Latin motto banner, De La Salle/Christ figures.
  (Available to bring back later if the school specifically asks for the
  fuller crest treatment.)
- Typography tone: resolved in favor of the energetic/playful register
  (matches "English only," no formal Latin motto on the piece).

## 2. Technical Constraints (from Stage 2)

- Material Truth: MDF body, UV-printed lid, metal wind-up knob, separate
  die-cut raised centerpiece plaque — same construction as every reference
  example.
- Size Logic: 88×71mm landscape lid, ~5:4 ratio, horizon-line composition
  (sky → skyline → foreground), centerpiece plaque right-of-center per
  the supplier's own established convention across all four references.
- Printability: flat-vector only, no gradients/texture the die-cut process
  can't hold; the plaque's own silhouette must stay clean enough to
  physically die-cut — a "La Salle Primary School" wordmark plaque (text +
  simple star accent) is well within that, an illustrated shape would not
  be.

## 3. Style Profile Selection

- [ ] `[CUTE-CHAR-V1]`
- [ ] `[EDITORIAL-SURREAL]`
- [ ] `[INK-AND-LACQUER]`
- [x] **None of these fit — using the supplier's own house style directly**,
      per the owner's explicit choice to match it rather than pick from the
      Atelier Style Library. Worth proposing as a new library entry once
      this style gets reused (candidate name: `[LANDMARK-COLLAGE-SOUVENIR]`
      — flat-vector, semi-isometric, saturated, collaged real landmarks
      around a raised die-cut nameplate).

**Why this fits:** the whole point of this base product is that it's
already a recognizable product line (Wuhan/Nanjing/Chongqing/Xiamen) — a
school souvenir that visually belongs to that same family reads as
"a real thing from a real product line," not a one-off experiment, which
matters for a PTA buying 200 of something for 12-year-olds to take home.

## 4. Composition Map (first pass)

- Sky/background: light blue, top ~30% of the lid.
- School building silhouette (the curved white facade): left-of-center,
  anchor position `[30%, 35%]` — plays the "landmark" role a pagoda/tower
  plays in the reference boxes.
- Laurel branch, translated into a left-edge framing motif: `[8%, 50%]`,
  running vertically along the left edge (echoing the crest's side
  ornament without needing the matching holly on the right).
- Centerpiece plaque — raised, die-cut, reads "La Salle Primary School":
  `[65%, 55%]`, right-of-center — matches every reference example's plaque
  position exactly.
- Star accent (the "subtle nod"): small, radiating, directly above the
  plaque at `[65%, 32%]` — echoes the crest's star without repeating the
  full crest.
- Red/blue pool-lane stripe motif: a colorful ribbon across the lower ~15%
  of the lid, `[50%, 90%]` — the one purely "school pride/fun" element,
  standing in for the balloon/ferris-wheel "delight" detail every
  reference box has somewhere.
- 2–3 small silhouette figures of jumping students, bottom-left corner,
  `[20%, 85%]` — echoes the "students jumping" photo's energy, kept small
  and silhouette-simple so it doesn't compete with the plaque as focal
  point.

## 5. One-paragraph concept summary

A La Salle Primary School music box built to sit naturally alongside the
supplier's existing city-souvenir line: a light-blue sky over the school's
own curved white building, a laurel-branch frame along the left edge
nodding to the crest without reproducing it whole, a raised die-cut
"La Salle Primary School" nameplate holding the same position every city
name does on the reference boxes, a small radiating star above it as the
one quiet echo of the school's Lasallian identity, and a playful red/blue
pool-lane ribbon with a few jumping-student silhouettes along the bottom —
recognizably La Salle, recognizably part of this product family, and
squarely in the energetic register a P6 graduation gift actually wants.

**Previous:** [`02-supplier-spec.md`](02-supplier-spec.md)
**Next:** [`04-prompts/v1-brief.md`](04-prompts/v1-brief.md)
