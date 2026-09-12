# Product Development Tools

Local, standalone tools for running the workflow in `../04-Gemini-Image-Prompts.md`
— not part of the costing-tool app itself, and not published anywhere. Open
directly in a browser (double-click the `.html` file, or drag it into a tab);
no server, no build step, no dependencies.

## `parameter-visualizer.html`

Built 2026-09-12, after nine rounds of hand-rolled Python scripts on the La
Salle music box project made it clear this needed a real tool instead of
eyeballing raw JSON. What it does:

- **Load one or more JSON files** (an analysis extraction, or a generation
  prompt) — each gets its own tab.
- **Load one or more reference images** and link each JSON file to the image
  it was extracted from or generated from.
- **Click any field that carries position data** (`bbox: {x,y,width,height}`
  fractions, or `position_pct: [x,y]` + optionally `size_pct_of_frame`) and
  see it highlighted directly on the linked image — this is what makes
  "where did Gemini think this element was" stop being guesswork.
- **Edit any value inline** and export the edited JSON back out — for
  building a corrected version of an extraction (see the La Salle project's
  own corrected `box-construction-analysis.json` for why this matters:
  Gemini's raw extraction had the wrong knob position and wrong dimensions).
- **A growing cross-project vocabulary** (`vocabulary.json`, sits alongside
  this tool, git-tracked) — load it, browse/search known field names with
  their type/description/example, and use **"Scan into vocabulary"** on any
  loaded JSON to find fields not yet recorded, review them, and merge the
  ones worth keeping. Export the updated file and commit it so the next
  project — any product-dev project, not just this one — starts from
  everything learned so far instead of re-discovering it.

### Workflow

1. Open the tool. Load `vocabulary.json` first if you want the browser
   populated with what's already known.
2. Load the JSON + image files for whatever you're working on.
3. Inspect, edit, correct.
4. Before moving on, click "Scan into vocabulary" on anything that used field
   names/shapes not seen before, merge the useful ones, export, and commit
   the updated `vocabulary.json` back to this folder.
5. Export any edited JSON files back into the project's own
   `04-prompts/` folder (not into this `tools/` folder — this folder holds
   the tool and the shared vocabulary, not per-project data).

### Known limitations (v1)

- No auto-save — if you close the tab with unexported edits, they're gone.
  Export early and often.
- The vocabulary "merge" step dumps new fields into an
  `uncategorized_<filename>` bucket — recategorize by hand in
  `vocabulary.json` when it's convenient, the tool doesn't do this for you.
- `position_pct`-only highlights (no `size_pct_of_frame`) draw a fixed small
  box around the point, not the model's actual intended extent — treat it as
  "roughly here," not precise.
