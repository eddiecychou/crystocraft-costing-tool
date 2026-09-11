# Stage 3 — Product Concept Spec

**Goal:** merge Stage 1 (brand) and Stage 2 (supplier reality) into one
concept sheet, plus the two decisions unique to this stage — which Atelier
Style Library profile fits, and a first-pass composition map. This is the
document you'd actually show someone internally before going to Gemini —
Stage 4 turns it into a machine-readable prompt, but this sheet should stand
on its own as "here's the idea and why it's real."

## Prerequisite

Stage 1 and Stage 2 worksheets, filled in, for this specific client + base
product pairing. If either is missing or half-filled, finish it first —
this stage is assembly, not a place to backfill missing research.

## Worksheet

**Concept name:** _______________
**Client:** _______________ (from Stage 1)
**Base product:** _______________ (from Stage 2)
**Date / owner:** _______________

### 1. Brand Deconstruction (copied forward from Stage 1)
- Primary palette (material terms): _______________
- Core motifs (geometry): _______________
- Typography tone (structural): _______________
- Negative space rule: _______________

### 2. Technical Constraints (copied forward from Stage 2)
- Material Truth: _______________
- Size Logic: _______________
- Printability limits: _______________

### 3. Style Profile Selection
Pick ONE profile from `docs/skills/ATELIER-ART-ENGINE.md` §3 (the Atelier
Style Library), and say *why* — the target audience match is the actual
justification, not taste:

- [ ] `[CUTE-CHAR-V1]` — Youth/Gifting
- [ ] `[EDITORIAL-SURREAL]` — B2B/Corporate
- [ ] `[INK-AND-LACQUER]` — Zodiac/Heritage
- [ ] None of these fit — describe a new profile here, and consider whether
      it's worth proposing as a permanent addition to the Style Library once
      proven.

**Why this profile fits this client/audience:** _______________

### 4. Composition Map (first pass)
Rough percentage-based placement — this gets refined for real in Stage 4,
but sketch it now while the brand/product logic is fresh:

- Primary subject position: `[X%, Y%]`
- Brand motif position/origin: `[X%, Y%]`
- Negative space zone (from Stage 1's rule): _______________

### 5. One-paragraph concept summary
Write the concept in plain language, as if explaining it to Eddie in one
breath — this is what actually gets pitched; everything else on this sheet
is the reasoning behind it.

> _______________

## Output

This filled sheet is the direct input to Stage 4 — its §1–§4 map almost
one-to-one onto the Technical Brief's `[BRAND DECONSTRUCTION]`,
`[STYLE PROFILE]`, and `[COMPOSITION MAP]` sections. Keep this sheet; it's
the record of *why* the eventual image prompt looks the way it does, for
whenever a revision is needed months later and nobody remembers the
reasoning.

**Previous:** [`02-Supplier-Product-Specification.md`](02-Supplier-Product-Specification.md)
**Next:** [`04-Gemini-Image-Prompts.md`](04-Gemini-Image-Prompts.md)
