# Stage 4 — Gemini Image Prompts

**Goal:** turn Stage 3's concept sheet into an actual generation request and
send it to Gemini. **Updated 2026-09-12** after the La Salle Primary School
music box project (`projects/2026-09-lasalle-music-box/`) — its
`99-outcome.md` is the full worked account of what actually worked and
what didn't across nine iterations; read it before running this stage for
real, not just this file.

## Prerequisite

A completed Stage 3 concept sheet. Do not write a prompt from a half-filled
concept sheet, or from a client brief directly — that's the exact shortcut
this workflow exists to prevent (see the README's note on skipping to stage
4).

## The default method is now structured JSON Controlled Generation, not a prose brief

`docs/skills/ATELIER-ART-ENGINE.md` §7 documents this properly — read it in
full before running this stage. Short version, proven across the La Salle
project's nine iterations (v1 with no reference images at all failed hard;
v2-v7 prose prompts each fixed one problem and revealed another; v8-v9
using this JSON method succeeded on the first and second real attempts):

1. **Analyze the base product's existing reference photos into structured
   JSON**, not prose — ask a plain text+vision Gemini call
   (`gemini-2.5-flash`, NOT the image-gen model) to reverse-engineer the
   design into a fixed schema (dominant element, secondary elements, filler
   texture, one "delight" element, nameplate/text construction, layering
   order, a measured density percentage, deliberate omissions). Do this
   across more than one reference example if the product has an existing
   line — comparing examples is what surfaces a hard rule (La Salle found
   "zero human figures, always" and "85-95% density, always") that a single
   example can't distinguish from an incidental choice.
2. **Analyze the BRAND's own source images the same way — not just the
   product's style references.** This was the gap that produced a wrong
   building in an earlier round: describing "a curved white school
   building" from memory/eyeballing is not the same as extracting the
   real building's actual floor count, curve direction, window pattern,
   and roofline from its own photo via the same structured-JSON technique.
   Apply Stage 1's Brand Deconstruction Framework AND this JSON extraction
   together — the framework says what fields to capture, the JSON
   extraction is how to capture them precisely instead of from memory.
3. **Match element count/density to the reference, explicitly.** If the
   reference design has ~10 distinct elements, count them and build ~10
   real (not padded/invented) equivalents for the new brand — La Salle's
   early attempts undershot at ~5 elements and read as sparse/plain
   compared to the reference until this was made an explicit numeric
   target, not a vague "make it denser" note.
4. **Populate a new JSON with the target brand's real elements**, field by
   field, matching the reference's schema — substitution, not redesign.
   Where the target has no obvious equivalent for a field, that's a
   genuine judgment call to make deliberately and record the reasoning for
   (La Salle's "delight element" — the school's actual swimming pool,
   chosen specifically over a generic school symbol like a bus or
   graduation cap — is the worked example of this).
5. **Send the populated JSON itself as the generation prompt** — serialize
   it, prepend one line telling the model to treat every field literally,
   attach the actual reference images alongside it. Include a `layout_map`
   with `bbox` objects (fractional x/y/width/height) for anything needing
   a specific position.
6. **If the deliverable is a physical product (not flat print art), say so
   explicitly and merge in real construction/photography data**, extracted
   the same way from the reference's own product photos (material, edge
   treatment, hardware, camera angle, lighting, background) — a flat
   illustration and a photorealistic product photo are different requests,
   and asking for one when the actual need is the other produces a
   technically fine result that's still the wrong deliverable (this is
   exactly what happened between v8, a flat graphic, and v9, the actual
   photorealistic render that was needed).

**Two sharp lessons, worth not re-learning:**
- A reference photo containing real text/a logo will leak into the output
  even when explicitly told not to reproduce it — describing the forbidden
  thing still invites it. Crop it out of the source image instead.
- **Verify every extraction before using it, the same way you'd verify a
  generated result.** Gemini's own JSON extraction of the box's real
  construction put the metal knob on the wrong face and got the dimensions
  wrong by nearly 40% — caught only because the real spec sheet numbers
  were checked against it before the extraction was used downstream. Don't
  trust structured output any more automatically than prose output just
  because it parsed as valid JSON.

## Worked example — see `projects/2026-09-lasalle-music-box/04-prompts/`

`wuhan-design-analysis.json` and `nanjing-chongqing-xiamen-design-analysis.json`
(step 1) → `school-building-analysis.json`, `box-construction-analysis.json`,
`catholic-motifs-analysis.json` (step 2, brand-side extraction) →
`lasalle-design-json.json` (step 4, populated) → `v8-generation.json` /
`v9-generation.json` (step 5-6, the actual sent prompts) → `v8-result.png`
/ `v9-result.png`. Read `99-outcome.md` alongside these files for why each
version changed from the last — the files alone don't explain the
reasoning.

## Where this actually runs

`.env.local` already has a `GEMINI_API_KEY` (the same one `enhance-image.js`
uses in production) — Claude can call
`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
directly from a short read-only script
(`responseModalities: ['IMAGE']`, `temperature: 0` for a faithful/
deterministic result; `gemini-2.5-flash-image` with `gemini-3.1-flash-image`
as fallback, same model list as `enhance-image.js`). No manual copy-paste
into a browser needed. Treat every output as a proposal image, not a
production asset — it still needs the same human sign-off any AI-generated
art gets in this codebase (see `MARKETING-WORKFLOW.md` §6's "reject-only
human gate" pattern for the equivalent posture on the marketing side).

## When a render comes back wrong

Do **not** give generic feedback like "move the logo up" — see
`ATELIER-ART-ENGINE.md` §5, the Coordinate Correction method: state the
exact current position, the exact target position/scale, and the specific
visual fix needed, then rewrite the relevant JSON field(s) with that new
precision and re-send the whole prompt — don't just append the correction
as a patch on top of a prompt that already failed once. **And never trust
the model's own claim that it fixed something** (§5's corollary) — compare
the actual output to the actual reference yourself, every time.

## Output

The final approved image, plus the exact JSON (or brief) that produced it,
should be saved with the concept (see the README's "Where filled-in
concepts should live" note) — not left only in a chat transcript. Future
revisions to this exact concept should start from the saved JSON, not from
scratch.

**Previous:** [`03-Product-Concept-Spec.md`](03-Product-Concept-Spec.md)
