# UI Polish — from functional to Crystocraft-grade

> How to take a screen from "the data is on the page" to "this looks like
> Crystocraft built it." Read `SKILL.md` first. This is the **visual** companion
> to `ARCHITECTURE-RULES.md` — same rule-first, measurable posture (§7a "measure
> before you change" applies to every change here).
>
> **Origin note.** This reconciles an external `EXPERT-UI-UX-RULES.md` draft
> (Downloads, 2026-08-22) against what this repo actually ships. That draft's
> *spirit* (a mandatory second pass; whitespace as a value; token discipline;
> CTA restraint) is kept. Its factual errors are corrected here (§1, §5) — it
> named token files the app doesn't import, reversed the font roles, and pushed
> a rounded/asymmetric "editorial" treatment that fights the shipped square/flat
> design system and is wrong for the internal ops screens.

---

## 1. The design system IS the SSOT — and it lives in two files

**Authoritative token source:** `tailwind.config.js` (`theme.extend`) +
`src/index.css` (`@layer base` / `@layer components`). Nothing else.

- The folders `Crystocraft Design System V2.5/` and `…2026V2/` are **untracked
  reference material** — the app does **not** import their `tokens/*.css`.
  `src/index.css`'s own comment says the values are hand-copied in "so tokens
  don't depend on a dev-server restart." **MUST NOT** tell anyone to "use the
  tokens in `colors.css`/`spacing.css`" — point at `tailwind.config.js`.
- **MUST** use config tokens, never arbitrary Tailwind palette classes.
  `bg-brand-600` / `text-ink-60` / `border-warm-grey` — never `bg-blue-500`,
  `text-gray-700`, `#hexvalue` in JSX.
- Spacing is the **Tailwind default 4px scale** (config doesn't override it),
  which matches the V2.5 `--space-*` tokens. Stay on the scale: `p-2 p-3 p-4
  p-6 p-8` — never `p-[13px]`.

## 2. The Crystocraft visual language (what "on brand" means here)

These are facts from `index.css` — match them, don't reinvent them:

| Element | The rule | Class |
|---|---|---|
| **Corners** | **Square.** Buttons/cards/badges are `rounded-none`. Inputs are `rounded-sm` (4px). Only clickable filter chips are `rounded-full`. **MUST NOT** round a card or button "to soften it." | `.card`, `.btn`, `.badge`, `.input`, `.tag` |
| **Elevation** | **Flat.** A resting card is a 1px `warm-grey` (#E9E8E6) hairline, **no shadow**. Shadows (softened globally) are only for a genuinely floating layer (modal, dropdown) or a hover-lift. | `.card` |
| **Dividers** | Hairline `#E9E8E6`. For a section break, the `.facet-divider` (hairline + tiny 45°-rotated champagne diamond), not a heavy `<hr>`. | `.facet-divider` |
| **Headings** | **Questrial, UPPERCASE, `letter-spacing: 0.04em`, weight 400.** h1–h3 get this automatically. Body copy is **also Questrial** (`font-sans`). | base `h1,h2,h3` |
| **Labels / kickers** | **Work Sans**, uppercase, `text-xs`, wide tracking (`.label` 0.14em / `.eyebrow` 0.18em), colour `ink-60` (#666). | `.label`, `.eyebrow` |
| **Buttons** | Work Sans, uppercase, `letter-spacing: 0.1em`, square. Primary = solid `brand-600` burgundy. One primary per view. | `.btn-primary` + the ghost/outline/reversed variants |
| **Palette** | App bg **beige** `#F7EEE3`; text **near-black** `#222`; body/secondary **mid-grey** `#666`; accent **burgundy** `brand-600 #6E2433`. Division accents: bronze/champagne (Gifts), sapphire (Crystals). | config `colors` |
| **Storefront grids** | Product grids use `.mosaic-grid` + `.mosaic-tile` (edge-to-edge tiles, 1px beige gap reads as a hairline) — **not** `.card` with gutters. | `.mosaic-*` |

## 3. Two surfaces, two treatments — do not mix them

| | **Storefront / Portal** (`src/customer/*`) | **Operation Center** (everything else in `src/`) |
|---|---|---|
| Purpose | premium brand experience, low density | a fast internal workbench, high density |
| Whitespace | generous — sections can breathe (`py-12`+, `gap-8`) | tight and rhythmic — `p-4`/`p-6` cards, `gap-3`/`gap-4` rows. **Density is a feature.** |
| Layout | editorial: hero imagery, `.mosaic-grid`, occasional deliberate asymmetry | predictable: left-aligned forms, full-width tables, consistent card stacks |
| Motion | tasteful reveal/hover is welcome | **no `scale` / transform on list rows or buttons** (layout jitter on long lists). Hover = `bg-*` tint or `opacity` only. |
| Type scale | can go large for impact | restrained: `text-xl`/`text-2xl` page title, `text-sm` body, `text-xs` labels |

**MUST NOT** apply "2× the padding", "offset the content into `col-start-2`",
or "add `hover:scale-95` to everything" (from the external draft) to an
Operation Center screen — it degrades scannability of the data those screens
exist to show. Those ideas belong to the storefront, sparingly.

## 4. The Second Pass — mandatory, and measurable

A screen is **not done** when the data renders. Do a deliberate second pass and
report the before/after (§7a — an impression is not evidence). Check, in order:

1. **Vertical rhythm.** Every gap between sibling blocks is a value on the 4px
   scale, and repeated structures (rows, cards, form fields) use the **same**
   gap. *Check:* list the distinct vertical gaps in the main column — if there
   are more than ~3 different values, consolidate.
2. **One primary action.** Exactly one high-contrast element in view — the
   primary CTA (`bg-brand-600`). Everything else is `.btn-secondary` / ghost /
   link. *Check:* count solid-burgundy (or solid-dark) elements on screen — must
   be ≤ 1 per task area.
3. **Alignment grid.** Every left edge in a column lands on the same x. Labels,
   values, inputs, section titles — one ruler. *Check:* eyeball a vertical line
   down the card's left padding; nothing should poke past or fall short.
4. **Label/value hierarchy.** Labels are `.label` (Work Sans caps, `ink-60`);
   values are `text-sm` `ink` (#222). A label must never out-weigh its value.
5. **Empty / loading / error states exist** and use the same card + `.eyebrow`
   voice as the populated state — not a bare "No data".
6. **Hover/focus feedback** on every interactive element: a `bg-*` or `opacity`
   change + a visible `focus:ring` (keyboard). No dead clickable-looking things.
7. **Responsive:** the layout holds at 375px (mobile) — check with
   `resize_window` mobile preset, per `ARCHITECTURE-RULES.md §7`.
8. **Token audit:** grep the diff for `bg-gray-`, `text-gray-`, `#`, `-[` —
   replace each with a config token.

**Report format** for a polish pass (per §7a): before/after screenshot (or the
exact class deltas), the gap-consolidation ("was 5 distinct vertical gaps → now
3"), and the token-audit result ("0 arbitrary colours"). Never "looks cleaner."

## 5. Corrections to the external draft (do NOT follow these as written)

| External draft says | Do this instead |
|---|---|
| "Headings = Questrial, body = Work Sans" | Questrial for **both** headings and body; Work Sans **only** for `.label` / `.eyebrow` / buttons. |
| "Consistent corner radii 4px or 8px" | Match `index.css`: cards/buttons/badges **square** (`rounded-none`); inputs `rounded-sm`; chips `rounded-full`. Don't invent an 8px. |
| "Use tokens in `colors.css` / `spacing.css`" | Those aren't imported. Use `tailwind.config.js` tokens. |
| "Increase padding 2× everywhere" | Storefront: generous. Operation Center: stay on the 4px scale, density is intentional. |
| "Asymmetric / offset `col-start-2` for visual tension" | Storefront only, rarely. Operation Center forms/tables stay predictable and left-aligned. |
| "`hover:scale-95` / `opacity-80` on all interactives" | No transforms on list rows/buttons. Hover = `bg-*` tint or `opacity`; always pair with `focus:ring`. |
| "Soft shadows" | Already done globally (V2.5 softened the whole `shadow-*` scale). A resting card has **no** shadow — hairline only. |

## 6. Class-ordering convention (the one bit of the draft worth keeping)

Group Tailwind classes in a stable order so diffs stay readable:
**layout** (`flex grid …`) → **spacing** (`p- m- gap-`) → **size** (`w- h-`) →
**typography** (`text- font- tracking- leading-`) → **visual** (`bg- border-
shadow- rounded-`) → **state** (`hover: focus: disabled:`).

## Change Log

| Date | Change |
|---|---|
| 2026-09-01 | Created. Reconciles the external `EXPERT-UI-UX-RULES.md` draft against the shipped design system: SSOT is `tailwind.config.js` + `src/index.css` (§1); the square/flat/hairline Crystocraft language (§2); storefront-vs-OpsCenter split (§3); a measurable Second-Pass checklist (§4); and the draft's factual corrections (§5). |
