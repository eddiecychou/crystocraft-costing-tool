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

## Open question — how does the Gemini call actually happen?

Right now nothing in this repo lets me directly trigger a Gemini image
generation call on your behalf as a tool — `enhance-image.js` calls Gemini
server-side from the app itself (with an image source + auth), not from a
Claude Code session. Three real options, in rough order of effort:

- **Manual handoff (works today, zero build):** I produce the finished
  Technical Brief text, you paste it into Gemini (AI Studio / the
  "nano-banana" image model) yourself, save the result into the project
  folder. Slower, but needs nothing new.
- **Browser-driven (small build):** I use the Browser pane to drive
  Gemini's web UI directly with the assembled brief, screenshot the result
  back into the project folder myself. Cuts out the copy-paste step.
- **Wired into the app (real build, later):** a dedicated edge function
  (or extending `enhance-image.js`) that this workflow calls directly,
  the same way `generate-outreach-drafts.js` calls DeepSeek — the "proper"
  long-term answer, but only worth it once the manual process has run
  enough times to know what the function actually needs to accept.

I'd start with the manual handoff and only build further once you've felt
the friction of doing it by hand a few times — building the wired-in
version now would be guessing at requirements the same way this whole
workflow is designed to avoid.
