# Product Development Workflow

A step-by-step guide for taking a new product concept from "a client's brand"
to "a Gemini-ready image prompt" — the four stages below, in order. Each
stage has its own file with a fill-in-the-blanks template plus the reasoning
behind each field, so a concept can't skip a step it needs.

This workflow is **for Eddie (and Claude, when asked to help run it)** — it's
process documentation, not application code. It doesn't add any new UI or
edge function; it tells you which existing tool/doc to use at each step and
in what order, and gives you a template to fill in along the way. Nothing
here is wired into the app automatically — treat each stage's template as a
worksheet you fill by hand (or with Claude's help) per concept.

## The four stages

| # | Stage | File | In one line |
|---|---|---|---|
| 1 | Customer Branding Elements | [`01-Customer-Branding-Elements.md`](01-Customer-Branding-Elements.md) | Deconstruct the client's brand into usable visual tokens (palette, motifs, tone, negative space). |
| 2 | Supplier Product Specification | [`02-Supplier-Product-Specification.md`](02-Supplier-Product-Specification.md) | Ground the concept in what's actually buildable — material, size, MOQ, printability, from a real supplier record. |
| 3 | Product Concept Spec | [`03-Product-Concept-Spec.md`](03-Product-Concept-Spec.md) | Merge stages 1+2 into one concept sheet: base product, brand tokens, chosen style profile, composition map. |
| 4 | Gemini Image Prompt | [`04-Gemini-Image-Prompts.md`](04-Gemini-Image-Prompts.md) | Turn the concept sheet into an actual Technical Brief for Gemini, plus how to correct a failed render. |
| — | Working Notes | [`05-Working-Notes.md`](05-Working-Notes.md) | How this actually runs day to day: project folder layout, pulling real data from the app, the requirement-gathering conversation pattern. Read this once before running the workflow for real. |

Each stage feeds the next — stage 3's concept sheet is built *from* stages
1 and 2's filled-in worksheets, and stage 4's prompt is built *from* stage
3's concept sheet. Don't skip to stage 4 with a concept that never went
through 1–3; that's exactly the "generic AI output, disconnected from real
brand and supplier constraints" failure this workflow exists to prevent.

## Relationship to existing docs — read before starting

This workflow is the step-by-step *process*; the underlying protocols and
rules it leans on already exist elsewhere in the repo and are not repeated
here in full:

- **`docs/skills/ATELIER-ART-ENGINE.md`** — the actual Art-Director-to-Renderer
  protocol (Technical Brief structure, the Atelier Style Library profiles,
  the Coordinate Correction feedback method). Stage 4 of this workflow is a
  worked application of that protocol, not a separate one — read it before
  stage 4.
- **`docs/skills/ARCHITECTURE-RULES.md`** / **`docs/skills/MARKETING-WORKFLOW.md`
  §6.2** — the immutable **Product Truth** rule (`product-truth.js`): AI may
  not invent a sellable product that isn't real. Stage 2 (Supplier Product
  Specification) exists specifically so a concept is always anchored to a
  real, buildable base product before any image gets generated — this is how
  the workflow keeps Product Truth automatically rather than as an
  afterthought.
- **`docs/specs/Corp_Gift_Customizer_Spec.md`**, **`docs/specs/Crystal_Fabric_Studio_Spec.md`**,
  **`docs/plans/Customizer_Build_Plan.md`** — the product-development feature
  area this workflow's outputs are ultimately for (a customizer concept, a
  client proposal visual, a new product idea). Check these for what's
  actually built vs. still a prototype before promising a concept can be
  rendered live in the app.
- **`docs/skills/SOURCING-HUB.md`** — where real supplier records and
  quotes live (`suppliers/{id}`, `supplier_quotes`); stage 2 pulls from here,
  it doesn't invent supplier data.

## Where filled-in concepts live

Decided 2026-09-12: **kept here**, not pushed out to a customer record. Each
concept gets its own subfolder under `projects/` — see
`05-Working-Notes.md` for the actual folder layout, how to pull real data
from the app into stage 1/2 automatically, and how the requirement-gathering
conversation is meant to run before a prompt ever ships to Gemini.

## Tools

`tools/parameter-visualizer.html` — a local, standalone tool (open directly
in a browser, no server) for inspecting and editing Stage 4's JSON
extractions/generation prompts side-by-side with the reference images they
came from, with a growing cross-project vocabulary of the field names/shapes
Gemini actually uses. See `tools/README.md`. Built once hand-rolling Python
scripts for every JSON round-trip on the La Salle project (nine rounds) made
the need for a real tool obvious.
