# Stage 2 — Supplier Product Specification

**Goal:** anchor the concept in something actually buildable *before* any
design decision gets made. This is what keeps the whole workflow honest with
`ARCHITECTURE-RULES.md` / `MARKETING-WORKFLOW.md` §6.2's **Product Truth**
rule — a concept that never had a real base product can't accidentally turn
into an image implying a product that doesn't exist. This corresponds to
`ATELIER-ART-ENGINE.md` §4 (Technical Constraint Mapping).

## Where the source material comes from

**MUST** be a real record, not a description from memory:

- A real component/product photo already in the catalogue (`products/…`,
  `range_components/…`), OR
- A real supplier quote (`supplier_quotes` under either tree — see
  `docs/skills/SOURCING-HUB.md` §1) with actual material/size/MOQ/pricing
  fields filled in, OR
- A supplier catalogue/sample photo attached to `suppliers/{id}` (the
  `catalogs`/`images` subcollections).

If none of these exist yet for the base item you have in mind, that's a
signal to go source it (or ask the supplier for a quote) **before**
continuing to stage 3 — don't invent a plausible-sounding spec to keep
moving.

## Worksheet

**Base product / component:** _______________
**Source record (link or ID — `products/{id}`, `range_components/{id}`,
or `supplier_quotes` entry):** _______________
**Supplier:** _______________ (`suppliers/{id}`)

### Material Truth
What is this thing actually made of? List every material genuinely used —
this becomes a hard constraint in stage 4's prompt (no plastic/organic
texture invented on a metal-and-crystal item unless explicitly requested).

- Materials: _______________
- Finish/plating (if any): _______________

### Size Logic
Real dimensions, not an assumed "standard size." The illustration's
composition has to respect this aspect ratio, not the other way around.

- Dimensions (L × W × H, or diameter): _______________
- Aspect ratio implication for composition (e.g. "tall and narrow — vertical
  compositions only"): _______________

### Printability / Production Constraints
What this supplier/process can and can't reproduce — this stops stage 4
from asking Gemini for something un-buildable (an ultra-fine gradient on a
process that can't hold it, a texture the material can't take).

- Known production limits (engraving detail level, plating color options,
  min. feature size, etc.): _______________
- MOQ / lead time (context only, not a design constraint, but worth having
  on the sheet for whoever pitches this): _______________

## Output

The three filled sections above are the **Technical Constraint Mapping**
block that feeds into Stage 3's concept sheet and becomes the `Constraint:`
line(s) in Stage 4's Technical Brief (e.g. *"Preserve the crystal's facets
exactly; do not alter its geometry"* — that line comes from here, grounded
in a real source record, not asserted freely.

**Previous:** [`01-Customer-Branding-Elements.md`](01-Customer-Branding-Elements.md)
**Next:** [`03-Product-Concept-Spec.md`](03-Product-Concept-Spec.md)
