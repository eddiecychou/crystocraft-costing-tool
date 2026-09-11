# Stage 1 — Customer Branding Elements

**Goal:** turn a client's brand into concrete, usable visual tokens *before*
anyone talks about a specific product or image. This is the Brand
Deconstruction Framework from `docs/skills/ATELIER-ART-ENGINE.md` §2, applied
as a worksheet — fill this in first, every time, even if it feels obvious for
a brand you know well. A skipped step here is exactly what produces a
"generic AI" result later.

## Where the source material comes from

Pull from what actually exists for this client, in this order of trust:

1. **The client's own brand guideline** (PDF/deck), if they've sent one — the
   highest-confidence source.
2. **The client's existing packaging/marketing materials** — actual hex
   codes and logos, not memory.
3. **`CustomerBrand.jsx`** (`/customers/:id/brand`) — if this client already
   has a Brand Gallery entry in the app, check it first; someone may have
   already captured this.
4. Only as a last resort, describe from memory/observation — and flag it as
   low-confidence in the worksheet below so stage 3 knows not to treat it as
   verified.

## Worksheet

**Client:** _______________
**Source used (guideline / materials / CustomerBrand.jsx / memory):** _______________

### Primary Palette
List each brand color as a hex code, THEN convert it to a descriptive
material term — this is the actual translation Gemini needs, not the hex
code itself (Gemini doesn't reliably reason from hex → material).

| Hex | Descriptive material term |
|---|---|
| e.g. `#FFD200` | e.g. "Polished Amber Glow" |
| | |
| | |

### Core Motifs
The actual *geometry* of the brand — not "their logo is a sun," but what
that implies structurally: symmetry, line weight, repetition.

- Motif: _______________
- Geometry translation (e.g. "Circular Sun" → "Radial symmetry, golden
  concentric arcs"): _______________

### Typography Tone
The "weight" the brand carries, translated into a material/structural term a
renderer can use (not a font name — Gemini can't read font files).

- Brand's typographic personality (bold/corporate, delicate/luxury,
  playful/rounded, etc.): _______________
- Structural translation (e.g. "Bold Corporate" → "Heavy, grounded
  structures"): _______________

### Negative Space Rule
How the brand "breathes" — how much empty space it's comfortable with, and
where.

- Brand's spacing personality (e.g. "High-end Minimalist," "Busy/maximalist,"
  "Balanced"): _______________
- Translation (e.g. "High-end Minimalist" → "60% unoccupied space on the
  left"): _______________

## Output

The four filled sections above are the **Brand Deconstruction** block that
feeds directly into Stage 3's concept sheet and Stage 4's
`[BRAND DECONSTRUCTION]` line in the Technical Brief. Don't paraphrase this
again in stage 3 — copy it forward as-is.

**Next:** [`02-Supplier-Product-Specification.md`](02-Supplier-Product-Specification.md)
