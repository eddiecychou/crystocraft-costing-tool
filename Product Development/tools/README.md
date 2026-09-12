# Product Development Tools

Local, standalone tools for running the workflow in `../04-Gemini-Image-Prompts.md`
— not part of the costing-tool app itself, and not published anywhere. Open
directly in a browser (double-click the `.html` file, or drag it into a tab);
no server, no build step, no dependencies.

## `parameter-visualizer.html`

Built 2026-09-12, after nine rounds of hand-rolled Python scripts on the La
Salle music box project made it clear this needed a real tool instead of
eyeballing raw JSON and running one-off scripts for every Gemini call.
**v2 (same day): rebuilt around image-first pairing** — an early version let
JSON and images be loaded/linked independently, which was the wrong model:
in practice a JSON analysis should never exist except as something derived
FROM a specific image, so the tool now enforces that instead of leaving it
to a dropdown you have to remember to set.

**The whole loop now runs inside this one page — no more going back and
forth with separate scripts:**

1. **Load an image.** This creates a "pair" (its own tab) with no JSON yet.
2. **Analyze it with Gemini, right there.** Pick a prompt preset (design
   analysis / building extraction / construction+photography extraction /
   cultural motif extraction — the actual prompts proven on the La Salle
   project) or write your own, hit Analyze, and the resulting JSON is
   created FROM that image and stays permanently paired with it. Never a
   separate load-and-link step.
3. **Click any field that carries position data** (`bbox:
   {x,y,width,height}` fractions, or `position_pct: [x,y]` + optionally
   `size_pct_of_frame`) and see it highlighted directly on the image — this
   is what makes "where did Gemini think this element was" stop being
   guesswork.
4. **Edit any value inline** — for correcting an extraction before it's used
   downstream (see the La Salle project's own corrected
   `box-construction-analysis.json`: Gemini's raw extraction had the wrong
   knob position and a ~40%-wrong dimension).
5. **Generate an actual image from the (possibly edited) JSON, still in the
   same tab** — sends the JSON as the literal prompt plus this pair's own
   image as the source anchor, optionally with other loaded images
   included as extra style/reference material. The result can be saved as
   a brand-new pair (to inspect, re-analyze, or run through another
   Coordinate Correction round) or downloaded directly.
6. **A growing cross-project vocabulary** (`vocabulary.json`, sits alongside
   this tool, git-tracked) — load it, browse/search known field names with
   their type/description/example, and use **"Scan into vocabulary"** on any
   analyzed JSON to find fields not yet recorded, review them, and merge the
   ones worth keeping. Export and commit so the next product-dev project
   starts from everything learned so far.

### The Gemini API key

**No key is ever typed into this page or stored in browser storage.** Click
**"🔑 Load .env.local…"** and pick the repo's own `.env.local` file (repo
root) — the tool reads `GEMINI_API_KEY=` straight out of it, in memory, for
that session only. Same key `enhance-image.js` uses in production; nothing
new to generate or manage.

### Workflow

1. Open the tool. Load `vocabulary.json` if you want the browser populated
   with what's already known, and load `.env.local` so Analyze/Generate work
   without interruption.
2. Load an image. Analyze it. Inspect, edit, correct.
3. Generate from the edited JSON if the project needs an actual rendered
   result, not just the analysis.
4. Before moving on, "Scan into vocabulary" on anything that used field
   names/shapes not seen before, merge the useful ones, export, and commit
   the updated `vocabulary.json` back to this folder.
5. Export any edited/generated files into the project's own `04-prompts/`
   folder (not into this `tools/` folder — this folder holds the tool and
   the shared vocabulary, not per-project data).

### Known limitations (v2)

- No auto-save — if you close the tab with unexported edits, they're gone.
  Export early and often.
- "Re-open saved analysis…" (loading a previously-exported JSON) tries to
  re-match it to an already-loaded image by filename; if there's no match it
  loads as a detached, flagged (⚠) tab until you attach an image to it.
- The vocabulary "merge" step dumps new fields into an
  `uncategorized_<filename>` bucket — recategorize by hand in
  `vocabulary.json` when it's convenient, the tool doesn't do this for you.
- `position_pct`-only highlights (no `size_pct_of_frame`) draw a fixed small
  box around the point, not the model's actual intended extent — treat it as
  "roughly here," not precise.
- The Gemini API key lives only in that browser tab's memory — reload the
  page and you'll need to load `.env.local` again. Deliberate, not a bug:
  avoids the key ever touching persistent browser storage.
