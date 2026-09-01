# Design System — the spec of what's actually shipped (V2.5)

> The written spec of the Crystocraft Design System **as it exists in code today**,
> extracted from `tailwind.config.js` + `src/index.css`. This is the baseline any
> V3 work starts from. `UI-POLISH.md` is the *how to apply it* companion; this is
> *what it is*. The bundles in `design-system/V2.5/` and `design-system/2026-V2/`
> are visual reference only — the app imports nothing from them.
>
> **SSOT:** `tailwind.config.js` (`theme.extend`) + `src/index.css`
> (`@layer base` / `@layer components`). Fonts load from Google Fonts in
> `index.html` (`Questrial`, `Work Sans` 400/500/600, `display=swap`).

---

## 1. Token layer

### 1.1 Colour — ramps and their role

| Token | Values | What it is FOR | Notes |
|---|---|---|---|
| `brand-*` | 50 `#f5f0f1` · 100 `#f0e3e6` · 200 `#e2c2c9` · 300 `#cc94a0` · 400 `#a8556a` · **500 `#8b3347`** · **600 `#6e2433`** · 700 `#5b1c29` · 800 `#501829` · 900 `#380f1a` | The single accent — burgundy / garnet (Bespoke division). `600` = primary actions, active states, links. `500` = focus ring, hover text. `50/100` = tint backgrounds. | The **only** accent used for interaction. |
| `ink` | **DEFAULT `#222`** · 95 `#2E2E2C` · 80 `#4A4A47` · **70 `#585853`** · **60 `#666`** | Text + dark surfaces. `DEFAULT` = headings / primary text / dark nav. `80` = strong secondary. `70` = mid secondary (added V3, AA 6.2:1 on beige). `60` = body copy / **lightest AA-safe grey — the floor**. | **Ramp resolved (V3, 2026-09-02).** `70` added; dead `text-ink-30/40/50` codemodded to `-60`, `text-ink-90` → `text-ink`, dead `border-ink-10/30` → `border-warm-grey`/`border-ink-60`. `ink-95` + `graphite` remain defined but unused. |
| `ivory` / `beige` | ivory.DEFAULT = beige = `#F7EEE3` · ivory.dark `#EFE6D8` · ivory.mid `#F2EAE0` | Warm app background. `ivory.dark` = subtle inset / thumbnail wells / hover tint on white. | `beige` and `ivory.DEFAULT` are the same value — two names, back-compat. |
| `warm-grey` | `#E9E8E6` | Hairline borders, dividers, `.card` border. **The** line colour. | ~7% off beige → the intended "soft edge". |
| `bronze` | DEFAULT `#996632` · light `#B3824A` · dark `#7A4F26` | Gifts-division accent. Eyebrow kickers on some storefront pages, feature accent rules. | `#996632` on beige = **4.25:1 — fails AA for small text** (§3). |
| `gold` (champagne) | DEFAULT `#C6A664` · light `#D4BB82` · dark `#A88D4F` | Metallic-fill accent — foil, the facet-divider diamond, `.btn-outline-gold`. | **Fill only — never text** (`#C6A664` = 2.0:1). |
| `sapphire` | DEFAULT `#1C4F64` · light `#2A6A84` · dark `#163B4B` | Crystals-division accent. "from stock" notes, division theming. | Passes AA as text. |
| `platinum` | `#C9CBCC` | Placeholder / empty-icon grey (`<Gem>` / `<Package>` fallbacks). | Decorative only (1.4:1). |
| `graphite` | `#666` | Alias of `ink-60`. Rarely used. | Candidate for removal in V3. |

**Not in the config, used anyway (drift):** `gray-*` (2100+ call sites, mostly
OpsCenter — should be `ink-*` / `warm-grey`), and the semantic status set
`amber-* / emerald-* / purple-* / sky-* / red-*` (~450 sites) which are
**deliberate** for status (badges, warnings, destructive) and have no brand
equivalent — keep, but only for status.

### 1.2 Typography

| Family | Stack | Used for |
|---|---|---|
| `font-sans` / `font-serif` | **Questrial**, system-ui, -apple-system, sans-serif | Headings **and** body. (`serif` is an alias — there is no serif face.) |
| `font-label` | **Work Sans** (400/500/600), system-ui, … | `.label`, `.eyebrow`, `.badge`, `.btn`, `.tag` only. |

- **Headings (`h1–h3`, base layer):** Questrial, `text-transform: uppercase`,
  `letter-spacing: 0.04em`, `font-weight: 400`. Applied globally — every `<h1/2/3>`
  gets it, no class needed.
- **Body:** Questrial, `#222`, `-webkit-font-smoothing: antialiased`.
- **Size scale:** Tailwind default (`text-xs` 12 / `text-sm` 14 / `text-base` 16 /
  `text-lg` 18 / `text-xl` 20 / `text-2xl` 24 / `text-3xl` 30 / `text-4xl` 36).
  No custom scale. Storefront page titles = `text-xl md:text-2xl`.
- **Letter-spacing conventions:** `.label` 0.14em · `.eyebrow` 0.18em ·
  `.badge` 0.08em · `.btn` 0.1em · `.tag` 0.04em · headings 0.04em.
  Everything caps-set is Work Sans + wide tracking; body Questrial is untracked.

### 1.3 Spacing

**Tailwind default 4px scale, unmodified.** `p-1`=4 … `p-2`=8 `p-3`=12 `p-4`=16
`p-6`=24 `p-8`=32. Half-steps (`gap-1.5`, `py-2.5`) are in use and legitimate.
Storefront section band = `py-12 md:py-16`; OpsCenter cards = `p-4`/`p-6`.
**Not an 8px grid** — external drafts that say so are wrong for this repo.

### 1.4 Elevation

Config **redefines** Tailwind's own `shadow-*` names to a softer, near-black-tinted
scale — every existing `shadow-md`/`shadow-lg` call site picks it up automatically:

| Name | Value |
|---|---|
| `shadow-xs` | `0 1px 2px rgba(34,34,34,0.04)` |
| `shadow-sm` | `0 1px 3px rgba(34,34,34,0.05)` |
| `shadow-md` | `0 4px 14px rgba(34,34,34,0.07)` |
| `shadow-lg` | `0 10px 30px rgba(34,34,34,0.09)` |
| `shadow-xl` | `0 20px 50px rgba(34,34,34,0.11)` |
| `shadow-2xl` | `0 36px 80px rgba(34,34,34,0.14)` |
| `shadow-{bronze,sapphire,burgundy}` | `0 4px 20px rgba(<accent>,0.20)` — division-tinted glow |

**Posture (V2.5 "restraint over decoration"):** a resting card has **no shadow** —
1px `warm-grey` hairline only. Shadow is for genuinely floating layers (modal,
dropdown) or a deliberate hover-lift, never a resting surface.

### 1.5 Radius

**Square by default.** `.btn` / `.card` / `.badge` = `rounded-none`. `.input` =
`rounded-sm` (2px). `.tag` = `rounded-full` (it's a chip). Nothing else rounds.
`rounded-md/lg/xl` in JSX (340+ sites, OpsCenter) is **drift**.

---

## 2. Component layer (`src/index.css` `@layer components`)

Every shipped class, its anatomy, and its states. "❌" = state not defined.

### 2.1 Buttons

Base `.btn`: `inline-flex items-center justify-center gap-2 px-5 py-2 rounded-none
text-sm uppercase`, Work Sans 500, `letter-spacing 0.1em`, `transition-colors`,
`focus:outline-none focus:ring-2 focus:ring-offset-2`,
`disabled:opacity-40 disabled:cursor-not-allowed`.

| Variant | Resting | Hover | Focus ring | Disabled | Call sites |
|---|---|---|---|---|---|
| `.btn-primary` | `bg-brand-600 text-white` | `bg-brand-800` | `brand-500` | opacity-40 | ~137 |
| `.btn-secondary` | `bg-white`, `#222` text, `warm-grey` border | `bg-ivory` | `brand-500` | opacity-40 | ~160 |
| `.btn-danger` | `bg-red-800 text-white` | `bg-red-900` | `red-500` | opacity-40 | ~10 |
| `.btn-ghost` | transparent, `text-ink` | `bg-ink/5` | `brand-500` | opacity-40 | 0 |
| `.btn-outline` | transparent, `#222` text + border | `bg-ink/5` | `brand-500` | opacity-40 | 0 |
| `.btn-outline-gold` | transparent, `#C6A664` text + border | `bg-gold/10` | `gold` | opacity-40 | 0 |
| `.btn-reversed` | `bg-white text-ink` (for photos/dark) | `bg-white/90` | `white` | opacity-40 | ~2 |

- **No `:active` state on any button** (only `transition-colors` on hover).
- `.btn-ghost` / `.btn-outline` / `.btn-outline-gold` have **zero call sites** —
  added for a storefront pass, never adopted. V3: adopt or drop.
- **One primary per view** (UI-POLISH §4.2).

### 2.2 Form — `.input`

`block w-full rounded-sm border bg-white px-3 py-2 text-sm`, `#222` text,
border `rgba(34,34,34,0.20)`, `focus:ring-1 focus:ring-ink focus:border-ink`,
`shadow-none`, `transition-colors`. Placeholder `rgba(102,102,102,0.55)`.
Mobile: every native `input/select/textarea` forced to `font-size:16px` <768px
(iOS zoom fix). **No `:disabled`, no error/invalid, no success state defined** —
callers hand-roll error text below the field.

### 2.3 `.label`

`block text-xs mb-1 uppercase`, Work Sans 500, `letter-spacing 0.14em`, `#666`.
The one field-label / small-kicker primitive. (Was hand-rolled in ~4 files before
the Second-Pass sweep folded them in — UI-POLISH §4.11.)

### 2.4 `.eyebrow`

`text-xs uppercase`, Work Sans 500, `#666`, `letter-spacing 0.18em`. Section
kicker above an `<h2>`. Also the "quiet heading" treatment for a subordinate
section (UI-POLISH §2) — used in place of `font-semibold`, which is off-vocab.

### 2.5 `.card`

`bg-white rounded-none` + `1px solid #E9E8E6`. Flat, square, hairline. **The**
panel primitive — any "card-like" wrapper uses this, never a bespoke
`rounded-xl border`. No hover/active variant (a hoverable card adds
`hover:` classes at the call site; the house signal is an image
`group-hover:scale-105`, never a shadow — UI-POLISH §4.6).

### 2.6 `.badge` (+ status variants)

`inline-flex items-center px-2 py-0.5 rounded-none text-xs uppercase`,
Work Sans 500, `letter-spacing 0.08em`. Status-only, not clickable.
Variants: `.badge-concept` (purple-100/700), `.badge-sampled` (amber-100/700),
`.badge-active` (emerald-100/700), `.badge-retired` (gray-200/600).
The gray-200/600 pair in `.badge-retired` is the sanctioned neutral chip.

### 2.7 `.tag` / `.tag-clickable` / `.tag-active`

`inline-flex items-center gap-1 text-xs leading-none whitespace-nowrap
rounded-full border px-3 py-1.5`, Work Sans 400, `letter-spacing 0.04em`, `#666`,
transparent bg, border `rgba(34,34,34,0.20)`. The **clickable filter chip** —
distinct from `.badge` (square, status). `.tag-clickable` adds
`hover:bg-ink/10 hover:text-ink`; `.tag-active` = `bg-ink text-white`.
Exempt from the 40px touch-target floor (UI-POLISH §7.2) — clustered, gapped.

### 2.8 `.facet-divider` (+ `-glyph`)

`flex items-center gap-3 my-2`; `::before`/`::after` are `flex-1 h-px` in
`warm-grey`; `.facet-divider-glyph` is a 6×6 `#C6A664` square rotated 45°.
The section separator — replaces a plain `<hr>`.

### 2.9 `.mosaic-grid` / `.mosaic-tile`

`.mosaic-grid` = `grid gap-px` + `background-color: #F7EEE3` (beige, **not**
warm-grey — an incomplete last row would show a solid warm-grey block, read as
broken; found live 2026-08-20). `.mosaic-tile` = `bg-white overflow-hidden`.
The storefront product-grid treatment — edge-to-edge tiles, the 1px beige gap
reading as a hairline. Use instead of `.card` + gutters for any catalogue grid.

### 2.10 Layout utilities

- `.h-screen-dynamic` — `100vh` → `100dvh` → `calc(var(--app-vh,1vh)*100)`.
  Mobile viewport-height that tracks the address bar (Layout.jsx sets `--app-vh`
  from `visualViewport`).
- `.no-scrollbar` — hides the scrollbar, keeps momentum scroll. For horizontal
  strips (mobile tab nav, chip rows); pair with an edge fade at the call site.

### 2.11 Global base rules

`body` — beige bg, `#222`, antialiased, `overscroll-behavior-y: none`.
`a, button, [role="button"], summary, label` — `-webkit-tap-highlight-color:
transparent`. `h1–h3` — the Questrial caps treatment. `@media print` — white body.

---

## 3. Accessibility — contrast (WCAG AA = 4.5:1 body, 3:1 large)

Measured against the two real backgrounds:

| Foreground | on beige `#F7EEE3` | on white | Verdict |
|---|---|---|---|
| `ink` `#222` | 13.9 | 15.9 | ✅ AA |
| `ink-80` `#4A4A47` | 7.8 | 8.9 | ✅ AA |
| `ink-60` `#666` | **5.0** | 5.7 | ✅ AA (thin margin on beige) |
| `brand-600` `#6e2433` | 9.3 | 10.7 | ✅ AA |
| `brand-500` `#8b3347` | 6.9 | 7.9 | ✅ AA |
| `sapphire` `#1C4F64` | 7.8 | 8.9 | ✅ AA |
| `bronze` `#996632` | **4.25** | 4.9 | ⚠️ **fails AA on beige for text <18px** — large/bold only. Affects `.eyebrow text-bronze` (small caps). |
| `gold` `#C6A664` | 2.0 | 2.3 | ❌ never text — fill only |
| `platinum` `#C9CBCC` | 1.4 | 1.6 | ❌ decorative icons only |
| `text-ink-50` (≈`#7A7A7A`, **not a real token**) | 3.7 | 4.3 | ⚠️ would fail AA if it were generated — see §4.2 |
| `text-ink-40` (≈`#8C8C8C`, **not a real token**) | 2.9 | 3.4 | ❌ would fail even large |

---

## 4. Current adherence — the V3 baseline

The storefront (`src/customer/*`, ~20 files) was brought to spec by the
2026-09-01/02 Second-Pass sweep. The Operation Center (`src/pages/*` ~78,
`src/components/*`) predates the system. The **colour** drift is now cleared
(§4.1a, 2026-09-02); radius / arbitrary-size / shadow / `font-bold` drift
remain.

### 4.1 Measured drift (grep over `src/**/*.jsx`)

| Signal | Was (2026-09-02) | Now | Meaning |
|---|---|---|---|
| `gray-*` (any prefix) | **~2640** | **0** ✅ | RESOLVED — codemodded to tokens (§4.1a). |
| `rounded-md/lg/xl/2xl` | ~340 | ~340 | still open — the square-corner pass. `rounded-full` (dots/pills) is legitimate and stays. |
| `text-[Npx]` arbitrary | ~350 | ~350 | still open — one-off font sizes off the scale. |
| `shadow-md/lg/xl/2xl` | ~58 | ~58 | still open — resting shadows against the flat posture. |
| `hover:scale / hover:-translate-y` | ~16 | ~16 | still open — transforms on interactives (UI-POLISH §3). |
| `font-bold` on headings | — | ~open | headings are weight 400; `font-bold` is drift. Not yet swept. |
| `amber/emerald/purple/sky-*` | ~450 | ~450 | mostly legitimate status colour; audit for non-status use. |

### 4.1a The `gray-*` → token map (canonical — reuse for any future stragglers)

| From | To | Rationale |
|---|---|---|
| `border-gray-{50,100,200,300}` · `divide-gray-*` | `border/divide-warm-grey` | one hairline colour |
| `border-gray-400` (hover) | `border-ink-60` | visible hover line |
| `bg-gray-50` | `bg-ivory` | lightest warm fill |
| `bg-gray-100` | `bg-ivory-dark` | subtle warm inset (thumbnail wells) |
| `bg-gray-200` | `bg-warm-grey` | |
| `bg-gray-400` (opaque placeholder block) | `bg-ivory-dark` + dark text | the "reads as broken" grey block (cf. L-12 family) |
| `bg-gray-{700,800,900}` (active/dark surface) | `bg-ink` (+ `border-ink`) | the one dark surface |
| `text-gray-300` · `placeholder-gray-300` | `text/placeholder-platinum` / `-ink-60` | faint / placeholder |
| `text-gray-{400,500}` | `text-ink-60` | secondary text (the floor) |
| `text-gray-600` | `text-ink-70` | mid secondary |
| `text-gray-700` | `text-ink-80` | strong secondary |
| `text-gray-{800,900}` | `text-ink` | primary |
| status badges (`bg-gray-200 text-gray-600` = `.badge-retired`) | keep | sanctioned neutral chip |

### 4.2 Structural gaps in the token layer

1. **~~The `ink` ramp is `DEFAULT/95/80/60` but the code wants `30/40/50/70`.~~
   RESOLVED (V3, 2026-09-02) — hybrid.** `text-ink-30/40/50/70/90` and
   `border-ink-10/30` were used in ~360 JSX sites and generated **no CSS**,
   so those elements silently inherited near-black. Fix: added `ink-70`
   (`#585853`, AA 6.2:1); codemodded `text-ink-30/40/50` → `text-ink-60`
   (the AA-safe floor), `text-ink-90` → `text-ink`, `border-ink-10` →
   `border-warm-grey`, `border-ink-30` → `border-warm-grey` / `border-ink-60`.
   **Rule now: `ink-60` is the lightest grey allowed for text.** Lighter than
   that = `platinum` (decorative icons only) or a `beige`/`ivory` tint.
2. `ink-95` and `graphite` have ~0 call sites — dead tokens, drop or document.
3. `.btn-ghost` / `.btn-outline` / `.btn-outline-gold` — 0 call sites. Adopt
   (for the storefront's photo-CTA cases) or remove.
4. No `:active` on buttons, no `:disabled` / error / success on `.input` — the
   state matrix has holes every call site currently hand-fills.

---

## 5. Toward V3 — open decisions (owner's call, not rules)

None of these are "apply now" — they're the deltas a V3 would deliberately choose.

| Area | V2.5 today | V3 candidate | Source |
|---|---|---|---|
| ~~**ink ramp**~~ | ~~`DEFAULT/95/80/60`, dead `30/40/50/70`~~ | **DONE** — hybrid: added `ink-70`, codemodded the rest to `ink-60` (§4.2) | this audit |
| **Display heading tracking** | all headings `letter-spacing: 0.04em` (positive) | negative tracking (`-0.01–0.02em`) on `≥ text-3xl` display sizes; keep 0.04em for small caps | VISUAL-REFINEMENT §1 |
| **`.eyebrow` colour** | `#666` (and `text-bronze` at call sites — fails AA small) | drop `text-bronze` on small eyebrows, or darken bronze to ~`#7A4F26` (bronze.dark, ~5.6:1) | §3 |
| **Section rhythm** | storefront `py-12 md:py-16` | larger band (`py-20`/`py-24`) for landing-style pages only | VISUAL-REFINEMENT §3 |
| **Portal nav material** | flat opaque `bg-ink` (top strip + bottom bar) | `backdrop-blur` glass nav | VISUAL-REFINEMENT §4 |
| **Button `:active`** | none | a `:active` darken/press on all `.btn*` | DESIGN-SYSTEM-AUDIT §2 |
| **`.input` states** | resting + focus only | defined `:disabled`, `[aria-invalid]`, success | DESIGN-SYSTEM-AUDIT §2 |
| **OpsCenter refactor** | colour DONE (§4.1a). ~340 `rounded-*`, ~350 `text-[Npx]`, `font-bold` headings still open | square-corner + size + weight pass next | §4.1 |
| **Bundle naming** | `design-system/V2.5` vs `/2026-V2` | normalise (`v2.5` / `v2-2026` / `v3`) | housekeeping |

## Change Log

| Date | Change |
|---|---|
| 2026-09-02 | Created — the written V2.5 spec extracted from `tailwind.config.js` + `src/index.css`: token layer (§1), component inventory + partial state matrix (§2), measured WCAG contrast (§3), the OpsCenter drift baseline and the dead-`ink-*`-ramp finding (§4), and the V3 open-decision list (§5). Foundation for any V2.5→V3 work. |
| 2026-09-02 | V3 first change — **ink ramp resolved** (hybrid): added `ink-70` `#585853` (AA 6.2:1 on beige); codemodded ~360 dead `text-ink-30/40/50/90` + `border-ink-10/30` sites to real AA-safe tokens (`ink-60` is now the lightest grey allowed for text). All `ink-*` classes in `src/` now resolve. |
| 2026-09-02 | V3 — **OpsCenter colour refactor**: ~2640 `gray-*` sites across 97 files codemodded to the warm token palette per the §4.1a map (0 `gray-*` left in `src/`). Verified: full bundle + `qa/eslint.no-undef` + tailwind build (no orphan classes). **NOT visually verified** — OpsCenter pages are login-gated with no harness; the colour deltas are principled (warmer, equal-or-better contrast) but the owner should eyeball post-deploy. |
