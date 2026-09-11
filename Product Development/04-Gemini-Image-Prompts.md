# Stage 4 — Gemini Image Prompts

**Goal:** turn Stage 3's concept sheet into an actual Technical Brief and
send it to Gemini. This stage is a direct application of
`docs/skills/ATELIER-ART-ENGINE.md` — read that doc's §1 and §5 before
running this stage for the first time; this file just walks through
applying it to one concrete concept.

## Prerequisite

A completed Stage 3 concept sheet. Do not write a prompt from a half-filled
concept sheet, or from a client brief directly — that's the exact shortcut
this workflow exists to prevent (see the README's note on skipping to stage
4).

## Where this actually runs

Not yet wired to one specific place in the app — check
`docs/skills/ATELIER-ART-ENGINE.md`'s scope note for the current status
before assuming this drives `enhance-image.js`, the Customizer render
service, or a dedicated future endpoint. Until it's wired up, run this
manually (Claude session, or directly against Gemini) and treat the output
as a proposal image, not a production asset — it still needs the same
human sign-off any AI-generated art gets in this codebase (see
`MARKETING-WORKFLOW.md` §6's "reject-only human gate" pattern for the
equivalent posture on the marketing side).

## Worksheet — building the Technical Brief

Fill in each line from Stage 3's concept sheet, then send the assembled
brief as one block.

```
[SOURCE ANCHOR]
Base: verified_product: _______________ (the real photo/render from Stage 2)

[BRAND DECONSTRUCTION]
Brand: _______________ (client name)
Palette: _______________ (material terms, from Stage 3 §1)
Motifs: _______________ (from Stage 3 §1)

[STYLE PROFILE]
_______________ (the chosen profile from Stage 3 §3, e.g. [EDITORIAL-SURREAL])

[COMPOSITION MAP]
_______________ (percentage-based placements from Stage 3 §4, e.g.
"Crystal at [50%, 60%], Arcs radiating from [50%, 40%]")

[QA CHECKLIST]
- Primary subject present and identifiable
- Brand motif/color present and matches Stage 1's palette
- Material truth respected (no invented material — check against Stage 2)
- Product geometry/facets unchanged from the source anchor
- Negative space rule from Stage 1 respected
```

**Worked example** (from `ATELIER-ART-ENGINE.md` §6, for reference — not a
template to copy verbatim):

> Base: `verified_product: rose_crystal_v2.png`
> Brand: Sun Life (Yellow #FFD200, Blue #003366).
> Style: `[EDITORIAL-SURREAL]`.
> Task: Surround the Rose Crystal with radial golden arcs (Sun Life Motif).
> Anchors: Crystal at `[50%, 60%]`, Arcs radiating from `[50%, 40%]`.
> Constraint: Preserve the crystal's facets exactly; do not alter its
> geometry.

## When a render comes back wrong

Do **not** give generic feedback like "move the logo up" — see
`ATELIER-ART-ENGINE.md` §5, the Coordinate Correction method:

- State the exact current position: *"The Logo at `[50%, 50%]` is too
  central."*
- State the exact target position and scale change: *"Move the Logo to
  `[85%, 15%]` (top-right). Reduce its scale by 20%."*
- State the specific visual fix needed: *"Increase the contrast against the
  background."*

Rewrite the `[COMPOSITION MAP]` line with this new precision and re-send the
whole brief — don't just append the correction as a patch on top of the
brief that already failed once.

## Output

The final approved image, plus the exact Technical Brief that produced it,
should be saved with the concept (see the README's "Where filled-in
concepts should live" note) — not left only in a chat transcript. Future
revisions to this exact concept should start from the saved brief, not from
scratch.

**Previous:** [`03-Product-Concept-Spec.md`](03-Product-Concept-Spec.md)
