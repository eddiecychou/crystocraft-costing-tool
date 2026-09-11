# Working Notes — how this workflow actually runs day to day

You asked for a technical opinion on three things: how to organize project
files, how to pull real information from the app instead of retyping it, and
how the requirement-gathering conversation should work before a prompt ships
to Gemini. This file is that opinion, plus the concrete layout it implies.
Unlike stages 1–4 (worksheets), this file is *how the process works*, not a
template you fill in.

## Why this needs a different shape than Sales/Production

Sales and Production are **operational**: same steps every time, one
Firestore record per thing, the app's UI already tracks status end to end.
Product development is **project-based**: every concept is a one-off with
its own mix of files (a client's brand deck, a supplier photo, three rounds
of Gemini output, a WeChat screenshot of feedback), and there's no natural
single Firestore record to hang all of that off yet (`customers/{id}/proposal/current`
is the closest thing, but it's one fixed doc for a *published* proposal, not
a working folder for getting there). Trying to force this into the app's
existing record-per-thing model right now would mean building UI for
something still being figured out. A folder-per-project structure, driven by
Claude in conversation, is the right amount of structure for where this is
today — it can graduate into real app UI later once the process has run
often enough to know what it actually needs.

## 1. Project file organization

```
Product Development/
  README.md
  01-Customer-Branding-Elements.md      ← templates (unfilled, stay generic)
  02-Supplier-Product-Specification.md
  03-Product-Concept-Spec.md
  04-Gemini-Image-Prompts.md
  05-Working-Notes.md                   ← this file
  projects/
    2026-09-sunlife-rose-crystal/
      00-brief.md            ← what you first asked for, verbatim
      01-branding.md         ← filled Stage 1, for THIS client
      02-supplier-spec.md    ← filled Stage 2, for THIS product
      03-concept.md          ← filled Stage 3
      04-prompts/
        v1-brief.md          ← the exact Technical Brief sent
        v1-result.png        ← what Gemini returned (or a link to it)
        v2-brief.md          ← after a Coordinate Correction round
        v2-result.png
      99-outcome.md          ← what happened (approved / sent to client /
                                shelved) and why — short, dated
    2026-10-xxx-next-project/
      ...
```

One folder per concept, numbered files inside so the sequence is obvious at
a glance, every prompt/result version kept (never overwritten) so you can
see the actual revision history of a design the way you'd want to for a
mold or tooling change. `99-outcome.md` matters more than it looks — it's
what makes six months of these folders actually useful later instead of
just a pile of abandoned drafts.

**Naming:** `YYYY-MM-shortslug` for the folder. Doesn't need to be clever,
needs to sort chronologically and be greppable.

## 2. Pulling real information from the app instead of retyping it

This is the part worth actually building rather than doing by hand every
time. Two different data shapes need two different approaches:

**Structured facts (Stage 2 — supplier spec)** are exactly the kind of thing
that should never be hand-typed from memory: material, dimensions, MOQ,
supplier contact. The `email-sync/` scripts already show the working pattern
for this repo — sign in as the admin user via Firebase Auth REST, then read
Firestore directly over REST with no new tooling needed
(`email-sync/common.py`'s `Firestore`/`sign_in` helpers, or the JS
equivalent). I can write a small **read-only** script in this same style
that, given a `products/{id}` or `range_components/{id}` or `supplier_quotes`
path, pulls the real material/size/MOQ/pricing fields and drops them
straight into a Stage 2 worksheet — you'd confirm/correct rather than
type from scratch. Same idea for Stage 1 if `CustomerBrand.jsx` already has
something for that client (`customers/{id}` brand fields, if any exist) —
pull it first, ask you to fill only what's actually missing.

**Unstructured material (mood boards, brand decks, supplier photos)**
doesn't live in Firestore in a form worth querying — it's PDFs/images in
Drive or attached to a supplier/customer record. For that, the practical
move is simpler: point me at it (a Drive link, a `suppliers/{id}` photo, a
pasted image) in conversation and I read it directly — no script needed,
that's just normal tool use in a session.

**My recommendation:** don't build a big automated pipeline for this yet.
Build the one small script that saves real retyping (Stage 2's structured
supplier facts), and handle everything else through conversation — asking
me to pull a specific record, or pointing me at a file — because the actual
bottleneck in product development isn't data entry, it's the judgment calls
in Stage 3 (which style profile, which composition), and no script should
be making those.

## 3. The interactive requirement-gathering pattern

This is the actual shape I'd propose for how a project starts, in a Claude
Code session:

1. **You give me the brief** — a sentence or two, like you'd give a
   colleague ("Sun Life wants a rose crystal gift, corporate feel"). I save
   it verbatim as `00-brief.md` before anything else, so the original ask
   never gets lost inside my interpretation of it.
2. **I pull what already exists** — check `CustomerBrand.jsx`/Firestore for
   this client's brand data, check the catalogue/supplier records for
   candidate base products, and tell you plainly what I found vs. what's
   missing. I do NOT guess at missing brand/supplier facts to keep moving —
   a gap here gets surfaced as a question, not filled in with something
   plausible-sounding (that's the exact failure this whole workflow exists
   to prevent).
3. **I ask you the judgment-call questions directly** — style profile fit,
   which base product if there's more than one candidate, anything Stage 1's
   worksheet flagged as "no source, low-confidence." Small number of
   focused questions, not a 20-item form — the worksheets already narrow
   down what actually needs a decision from you versus what's just a fact
   to look up.
4. **I draft Stages 1–3 from your answers + what I pulled**, show you the
   one-paragraph concept summary (Stage 3's last field) as the checkpoint —
   that's the moment to redirect before any image gets generated, since it's
   the cheapest point to change course.
5. **Only after you approve the concept summary** do I assemble the Stage 4
   Technical Brief and hand it to you (or run it, if we've wired up an
   actual Gemini call by then — see the open question below).
6. **You review the render** and either approve it or give Coordinate
   Correction feedback (§4's method) — I fold that into a `v2-brief.md`
   rather than losing the reasoning behind `v1`.

The core discipline is step 2/3's split: **facts get looked up, judgment
calls get asked** — never the reverse. That's what stops this from either
(a) me guessing at your client's brand palette from vibes, or (b) you having
to manually type in supplier specs that are already sitting in the app.

## RESOLVED — how the Gemini call actually happens (updated after the La Salle project)

**There's already a `GEMINI_API_KEY` in `.env.local`** — the same one
`enhance-image.js` uses in production. Claude can call
`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
directly via a short read-only Python/Bash script, same request shape as
that edge function (`responseModalities: ['IMAGE']`, `temperature: 0` for a
faithful/deterministic result). No manual copy-paste needed — this was the
"manual handoff" option below, superseded once it turned out the key was
already available locally. Use `gemini-2.5-flash-image` with
`gemini-3.1-flash-image` as a fallback (`enhance-image.js`'s own model
list — 2.5 is scheduled to retire 2026-10-02).

### The technique that actually produced a usable result: structured JSON Controlled Generation

Proven on the La Salle music box project (see its `99-outcome.md` for the
full account) after six prose-prompt attempts (v2-v7) each fixed one
problem and revealed another. **Do not hand-write a prose Technical Brief
as the first move — do this instead:**

1. **Analyze the reference images with Gemini itself, in structured JSON**
   (`response_mime_type: 'application/json'` on a plain `gemini-2.5-flash`
   text+vision call, NOT the image-gen model) — ask it to reverse-engineer
   the reference design(s) into a fixed schema: dominant element, secondary
   elements, filler/texture motif, the one "delight" element, how any
   nameplate/text is constructed, a layering order, a measured density
   percentage, and what's deliberately omitted. Do this for more than one
   reference example if the base product has a whole existing line (a
   single example can't tell you what's a hard rule vs. incidental).
2. **Compare the JSON across examples before touching the new brand's
   content.** This is where the real information is — La Salle's project
   found two hard, load-bearing rules (zero human figures; 85-95% frame
   density) that were invisible from just looking at the pictures and had
   been silently violated in every prose-prompt attempt.
3. **Populate a new JSON with the target brand's real elements**, field by
   field, matching the same schema — not a redesign, a substitution. Where
   the target doesn't have an obvious equivalent for a field (La Salle has
   no city landmarks for "secondary elements"), that's a real judgment call
   to make deliberately (see that project's "delight element" reasoning),
   not a gap to paper over with a generic placeholder.
4. **Send the populated JSON itself as the generation prompt** — serialize
   it, prepend one line telling the model to treat every field literally,
   attach it alongside the actual reference images. Include a `layout_map`
   with bbox (fractional x/y/width/height) coordinates for anything that
   needs a specific position — this is the "JSON as a layout map" technique
   used in the wider Gemini/Nano-Banana prompting community, not something
   specific to this repo.

**Extended after v9, same project, two more real gaps found and fixed:**

5. **Extract the BRAND's own source images with the same JSON rigor as the
   product's style references — don't describe them from memory/
   eyeballing.** v8 described the school building as "a curved white
   building" in prose; this reads as generic and is exactly what "just a
   building doesn't tell the story" (the owner's own words) was catching.
   v9 ran the actual building photo through its own structured-JSON
   extraction (`school-building-analysis.json`) and got the real floor
   count, curve direction, balcony-banding pattern, window arrangement —
   specific facts, not an impression. Do this for every brand asset that
   matters (a building, a crest, a product), not just the base product's
   own reference line.
6. **Match element count to the reference, as an explicit number, not a
   vibe.** The reference designs (Wuhan etc.) turned out to have ~10
   distinct elements each once counted from the JSON analysis (1 dominant
   + 6 secondary + filler + delight + nameplate). Earlier attempts used
   ~5 for the new brand and read as comparatively sparse/plain even after
   density was fixed — density alone (% of frame filled) isn't the same
   thing as element variety, and both matter.
7. **If the actual deliverable is a physical product, the generation
   request needs BOTH the flat "what's printed on it" content JSON AND a
   separate extraction of the real physical construction/photography** —
   material, edge treatment, hardware placement, camera angle, lighting,
   background — from the reference's own product photos. Asking for "an
   image in this style" when what's actually needed is "a photorealistic
   photo of the physical object" produces a technically-competent wrong
   deliverable (v8: a fine flat graphic when a product photo was needed).

**Four sharp, non-obvious lessons from getting there, worth not re-learning
the hard way:**

- **Don't show the model a reference photo containing real text/a logo it
  shouldn't reproduce — crop the text out of the source image before
  attaching it.** Describing it as a negative instruction ("don't
  reproduce this crest") still primes the model to reproduce it anyway;
  it happened twice (v4's building signage, v6's borrowed Wuhan content)
  before the fix — physically removing it from the source image — actually
  held. This matches an unrelated project's own art-pipeline lesson
  ("don't let a subject invite text," "don't name example objects in style
  text" — naming a thing, even to forbid it, still invites it).
- **When multiple reference images are attached for different purposes
  (one for content, others for style/material only), say so explicitly and
  expect it to still leak anyway** — v6 printed the Wuhan reference box's
  own artwork onto the lid despite being attached "for style only." Keep
  the "this one is content, these are style-only" instruction explicit, and
  verify the actual output rather than trusting the instruction held.
- **Never trust an image model's own self-reported compliance/audit text**
  (Gemini has volunteered a fidelity "audit" alongside a result that
  contradicted it, in confident detail). Always compare the actual output
  pixels to the actual reference — an AI's own grading of its own work is
  not verification.
- **This extends to structured JSON extractions too — verify them against
  known facts before using them downstream.** v9's box-construction
  extraction put the metal knob on the wrong face of the box and got the
  dimensions wrong by nearly 40% (12×9×8cm vs. the real 8.7×7.1×4.2cm from
  the spec sheet) — caught only because it was checked against ground
  truth before being fed into the generation prompt. A JSON extraction
  that parses cleanly is not the same as an extraction that's correct.

Browser-driven and wired-into-the-app remain real options if this
API-key approach ever stops being available, but direct API calls from a
short script are simpler than either and are now the default.
