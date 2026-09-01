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

- The exported bundles under `design-system/` (`design-system/v2.5/`,
  `design-system/v2-2026/`) are **reference material** — the app does **not**
  import their `tokens/*.css`. `src/index.css`'s own comment says the values
  are hand-copied in "so tokens don't depend on a dev-server restart."
  **MUST NOT** tell anyone to "use the tokens in `colors.css`/`spacing.css`"
  — there is no such file the app reads; point at `tailwind.config.js`.
  See `design-system/README.md`.
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
| **Headings** | **Questrial, weight 400 — no bold.** h1–h6 all get weight 400 from the base rule (V3); `font-bold`/`font-semibold` on a heading is drift. UPPERCASE + `letter-spacing: 0.04em` is h1–h3 only (the wordmark echo). Body copy is **also Questrial**. | base `h1..h6` |
| **Labels / kickers** | **Work Sans**, uppercase, `text-xs`, wide tracking (`.label` 0.14em / `.eyebrow` 0.18em), colour `ink-60` (#666). | `.label`, `.eyebrow` |
| **Buttons** | Work Sans, uppercase, `letter-spacing: 0.1em`, square. Primary = solid `brand-600` burgundy. One primary per view. | `.btn-primary` + the ghost/outline/reversed variants |
| **Palette** | App bg **beige** `#F7EEE3`; text **near-black** `#222`; body/secondary **mid-grey** `#666`; accent **burgundy** `brand-600 #6E2433`. Division accents: bronze/champagne (Gifts), sapphire (Crystals). | config `colors` |
| **Storefront grids** | Product grids use `.mosaic-grid` + `.mosaic-tile` (edge-to-edge tiles, 1px beige gap reads as a hairline) — **not** `.card` with gutters. | `.mosaic-*` |
| **Quiet section headings** | A subordinate heading (e.g. "Brand Assets" below a hero proposal, "Sales Invoice History" behind a collapse toggle) is **not** `text-sm font-semibold` — that's an off-vocab weight nothing else uses. It's an `.eyebrow` (Work Sans caps, `text-bronze` or `text-ink-60`), still wrapped in a real `<h2>` for semantics. | `.eyebrow` |
| **Panels/containers** | Any "card-like" wrapper (empty state, list panel, modal body) is `.card` — never a bespoke `bg-white rounded-xl border …`. `.card` already gives square corners + the hairline border; inventing the radius by hand is how `rounded-xl`/`rounded-md` sneaks back in. | `.card` |

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

**One rhythm beats local optimisation.** On the storefront, pick a single
section band and use it *everywhere* — **`py-16 md:py-24`** for landing-style
pages (HomePage), the tighter `py-12 md:py-16` for list/detail pages — even where it leaves
a short card floating in a lot of air (e.g. a one-line invite between two full
bands). A consistent page beats a page tuned section-by-section — the reader
feels the regularity. Remove a component's own ad-hoc `mt-*/mb-*` and let the
section wrapper own the spacing.

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
6. **Hover/focus feedback — ONE signal per element type.** A `bg-*` /
   `opacity` change (+ a visible `focus:ring` for keyboard). No dead
   clickable-looking things — but also no *stacked* motion. *Worked example
   (HomePage, 2026-09-01):* a Quick-Access tile ran **4** simultaneous hover
   animations (`shadow-lg` + `-translate-y` + icon-chip bg + icon `scale-110`)
   → cut to 2 coordinated colour shifts, zero transform. For an **image tile**
   the image lift (`group-hover:scale-105`) IS the affordance — don't also
   stack a shadow (`.mosaic-tile` has no border, so the reflex is to add one;
   resist). Utility rows (§3) get **no** transform at all.
7. **Responsive:** the layout holds at 375px (mobile) — check with
   `resize_window` mobile preset, per `ARCHITECTURE-RULES.md §7`.
8. **Token audit:** grep the diff for `bg-gray-`, `text-gray-`, `#`, `-[` —
   replace each with a config token.
9. **Data-derived UI reuses the single source of truth, and free data over a
   new read.** A "New" badge → `newArrivals.isNew(p)` (the one flag), not a
   local `createdAt` guess. A count on a tile → `useFavourites()`/`useCart()`
   context, which costs nothing — *never* add a Firestore read on a
   high-traffic page (the homepage) just to show a number. If the useful
   number needs a heavy query, it's probably not worth it — say so.
10. **Context over generic copy.** A hero/primary CTA should be a real
   destination, not a scroll-jump, and should use what the page already knows.
   *Example:* HomePage's hero button was "Explore the Collection" (echoed the
   heading + the section below, scrolled 200px) → now proposal-aware: "View
   your proposal" when one exists, else "Browse the catalogue" → `/shop/figurine`
   — driven by a hook the page loads anyway, no new read.
11. **Hand-rolled label → `.label`.** Grep the diff for
   `font-label uppercase tracking-wide` — if it appears more than once in a
   file, it's `.label` reinvented every time (FigurineDetail had it **4×**:
   plating/colour/quantity/gallery). Collapse to the class; it already sets
   the weight, tracking and colour, so only the `mb-*` needs to stay explicit.
12. **A `<div onClick>` that is the primary way to open something is a
   keyboard trap.** If there's no sibling `<a>`/`<button>` doing the same
   thing, add `role="button"`, `tabIndex={0}`, an Enter/Space `onKeyDown`,
   and a `focus-visible:ring`. Worked example: OrderHistoryPage's invoice
   rows opened a new tab on click only — a keyboard user could see them but
   never activate one.
13. **Dead-end empty state → one link out.** "No X yet" with nothing to do
   next reads as broken, not calm. Every empty state gets a link back into
   the catalogue (or wherever the content would come from), not just a
   sentence. Checked across Enquiry/Favourites/OrderHistory/SwatchLibrary —
   several had the sentence but no exit.

**Report format** for a polish pass (per §7a): before/after screenshot (or the
exact class deltas), the gap-consolidation ("was 4 distinct section spacings →
now 1"), the hover count ("4 animations → 2 colour shifts"), and the
token-audit result ("0 arbitrary colours"). Never "looks cleaner."

### 4a. Seeing a login-gated storefront / admin page

Most screens can't be reached without a session (`/shop/*` needs a customer,
most admin routes need admin). To get a real before/after without a login:

- **Component behind auth but data-light:** mount it in a `qa/*.html` harness
  on the Vite dev server with a fake `profile` prop; the Firestore hooks
  error → empty state, which is often the baseline you want. (`qa/home-preview.jsx`
  — HomePage in the real `CustomerLayout` + store providers.)
- **Component needs seeded data** (featured products, a proposal, counts):
  esbuild-bundle the real component with the **data layer stubbed and seeded**
  via an `onResolve`/`onLoad` plugin swapping `../firebase`, `firebase/firestore`,
  and the feature's data module for fakes. Pattern: `qa/home-preview-seeded.mjs`
  → `qa/home-preview-seeded.html` (build outputs gitignored). Then headless
  Chrome `--headless=new --screenshot` at desktop + 375px.
- **Gotchas:** the esbuild `file` loader dumps hashed asset copies next to the
  entry — gitignore `qa/*-????????.{jpg,png}`. Remote image hosts (picsum etc.)
  are blocked headless, so tiles render blank — judge *layout*, not the photo.
- **The seeded page renders unstyled (serif type, blue links, no grid) even
  though the build "succeeded."** esbuild's `.css` loader on `../src/index.css`
  just **copies the raw `@tailwind base/components/utilities` directives** —
  it does not run PostCSS/Tailwind. Fix: after the esbuild step, run the real
  CLI over the same content glob, **overwriting the seeded css last**:
  `node_modules/.bin/tailwindcss -i src/index.css -o qa/<name>-preview-seeded.css
  --content "./src/**/*.{js,jsx}","./qa/<name>-preview.jsx"`. Order matters —
  if the tailwindcss build runs before the esbuild step (or the esbuild step
  is re-run after), esbuild clobbers it back to the raw file. A screenshot
  that comes back suspiciously small/blank is usually this, not a real bug.
- **Console errors from a `file://` tab, or a tab pinned to a local-file
  preview that then refuses to `navigate()`.** Serve the `qa/` directory over
  plain HTTP instead of opening the `.html` by path — `python3 -m http.server
  5185 --directory .` (any free port), then `preview_start`/`navigate` to
  `http://localhost:5185/qa/<name>-preview-seeded.html`. Kill the server when
  done (`pkill -f "http.server 5185"`).
- **Stubbing one data module surfaces a second, unrelated import to satisfy.**
  `CustomerLayout` (used by every storefront harness) pulls in
  `customerProposal`'s `hasBrandPortalContent` and `customerAssets`/
  `customerProposal`'s `query`/`where`/`orderBy`/`limit` just to build the nav
  — a stub for one module needs every export anything in the render tree
  touches, not just the ones the page under test calls directly. Build once,
  read the esbuild "No matching export" errors, add the missing export as a
  trivial stub, rebuild — usually 1–2 more errors, not a rabbit hole.
- **Before/after compare:** `git stash push -- <file>` → rebuild → screenshot
  → `git stash pop` → rebuild again, so the working tree ends back on the new
  version. Compose side-by-side with `render-service/.venv/bin/python` (PIL is
  installed there) rather than eyeballing two separate files.

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

## 7. Mobile — the storefront IS the mobile surface

Wholesale buyers browse the portal on a phone; the OpsCenter is desktop-first
but staff still open it on the move. Two external drafts
(`MOBILE-FIRST-RESPONSIVE.md`, `PWA-BEST-PRACTICES.md`, Downloads 2026-08-22)
were reconciled here.

### 7.1 What's already built — don't reinvent it

- **The Operation Center shell (`src/components/Layout.jsx`) already has the
  full mobile treatment**: sidebar `hidden md:flex`, a `md:hidden` top bar, a
  **fixed bottom tab bar** (`fixed bottom-0 … pb-[env(safe-area-inset-bottom)]`)
  with a slide-up "More" sheet, `overscroll-contain` on `#main-scroll`,
  `pb-20 md:pb-0` on `<main>`. Any "add a mobile nav" idea for the OpsCenter
  is already done — read it first.
- **The customer portal shell (`src/customer/CustomerLayout.jsx`) now matches
  it** (2026-09-02): `<768px` hides the top strip and shows a 5-slot bottom
  bar (Home / Figurines / Corporate / Enquiry / More), cart badge on Enquiry,
  a dot on More when a hidden tab has a badge, a scrim + `rounded-xl` slide-up
  sheet for the rest. `<main>` `pb-24 md:pb-6`; footer
  `pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6`.
- **Global base rules (`src/index.css` `@layer base`)**: `overscroll-behavior-y:
  none` on body; `-webkit-tap-highlight-color: transparent` on
  `a,button,[role="button"],summary,label`; a `.no-scrollbar` utility (hides
  the bar, keeps momentum scroll) for horizontal strips.
- **iOS input-zoom is already handled** — `@media (max-width:767px) {
  input,select,textarea { font-size:16px } }` (L-… / V8.6). **MUST NOT** add a
  "shrink fonts on mobile" rule that fights it.

### 7.2 Touch targets — the pragmatic rule

The draft says "every interactive element MUST be ≥44×44px". Applied literally
to a dense wholesale catalogue that bloats every filter chip and stepper.
Instead:

- **Standalone tap target** (a nav item, a primary button, a table row that
  opens something, a bottom-bar tab) → **≥44px**. Use `min-h-[44px]`
  (+ `min-w-[44px]` for icon-only).
- **Clustered secondary controls** (a `+`/`−` stepper pair, an inline
  chip row with `gap-2`+) → **≥40px** and rely on the gap to prevent
  mis-taps. `min-h-[40px] min-w-[40px] flex items-center justify-center` on
  each button; bump the number `<input>` between them to `py-2` so the row
  lines up.
- **`.tag` filter chips are exempt** — shared with the OpsCenter's dense
  filter bars, and low mis-tap risk in a gapped, wrapping row. Left at
  `py-1.5`.

### 7.3 The horizontal-scroll nav strip (when a bottom bar is overkill)

A tablet/desktop tab strip that overflows: `.no-scrollbar` + a right-edge
`from-ink to-transparent` fade (`sm:hidden`, `pointer-events-none`) so it
reads as "more this way" not clipped, and on route change
`ref.querySelector('[aria-current="page"]').scrollIntoView({inline:'center'})`
so the active tab is never parked off-screen.

### 7.4 The audit checklist (adds to §4.7)

At 375px (`resize_window` mobile preset), per page:
- [ ] **No horizontal scroll on the page body.** `documentElement.scrollWidth
  <= clientWidth`; no element's `getBoundingClientRect().right` exceeds the
  viewport (the intentional inner scroll strips excepted). This is the
  single most common failure — check it first.
- [ ] Primary action reachable with one thumb (bottom-ish, full-width).
- [ ] Every standalone target ≥44px, clustered ≥40px (§7.2).
- [ ] Content clears the fixed bottom bar and the home indicator
  (`env(safe-area-inset-bottom)`).
- [ ] Cards visually separable (hairline / `.mosaic-grid`, not just whitespace).
- [ ] A "Back" affordance is present on every detail page.

### 7.5 PWA is a project, not an audit

The app has **no** PWA infra — no `manifest.json`, no service worker, no
`vite-plugin-pwa`, no `theme-color` meta. Adding it is a deliberate build
decision, not a polish pass. If it happens: cache the **shell** (JS/CSS/icons)
Cache-First, but **do not** Stale-While-Revalidate *operational data*
(inventory, quotes, prices) — a phone showing yesterday's stock is the same
hazard as JES's stale balance tables (see `SKILL.md` data facts). Only the
draft's §3 micro-fixes (tap-highlight, `overscroll-behavior`, `select-none`)
were worth taking now, and they're in §7.1.

## Change Log

| Date | Change |
|---|---|
| 2026-09-01 | Created. Reconciles the external `EXPERT-UI-UX-RULES.md` draft against the shipped design system: SSOT is `tailwind.config.js` + `src/index.css` (§1); the square/flat/hairline Crystocraft language (§2); storefront-vs-OpsCenter split (§3); a measurable Second-Pass checklist (§4); and the draft's factual corrections (§5). |
| 2026-09-01 | From the customer HomePage Second Pass: §4.6 gained the "one hover signal, no stacked motion" worked example; §4.9 (data-derived UI → single source + free data over a new read) and §4.10 (contextual CTA over generic) added; §3 gained the "one rhythm beats local optimisation" rule; new §4a — how to headlessly preview a login-gated storefront/admin page (`qa/home-preview.jsx` + `qa/home-preview-seeded.mjs` patterns). |
| 2026-09-02 | From the FigurineShop → SwatchLibrary batch (FigurineShop, CorporateShop, CorporateDetail, FigurineDetail, BrandPortalPage, EnquiryPage, FavouritesPage, OrderHistoryPage, SwatchLibraryPage — all done): §2 gained two rows (quiet section headings → `.eyebrow`, not `font-semibold`; any card-like wrapper → `.card`, never a bespoke `rounded-xl`/`rounded-md` container); §4 gained #11 (repeated hand-rolled `.label` markup → the class), #12 (a `<div onClick>` with no button sibling needs `role="button"`/`tabIndex`/keydown/focus-ring), #13 (every empty state needs a link out, not just a sentence). §4a gained four harness gotchas: esbuild's `.css` loader doesn't run Tailwind (seeded page renders unstyled until the real `tailwindcss` CLI runs **after** esbuild, last); serve `qa/` over `python3 -m http.server` rather than opening the `.html` by `file://` path (pinned tabs refuse to navigate, and file:// pages can render as static snapshots); stubbing a data module for the page under test often needs extra exports for what `CustomerLayout`'s own nav-visibility checks pull in (`hasBrandPortalContent`, `query`/`where`/`orderBy`/`limit`) — build, read the "No matching export" error, add, repeat; and the stash→rebuild→shoot→pop→rebuild recipe for before/after pairs, composed with `render-service/.venv`'s PIL. |
| 2026-09-02 | New §7 Mobile, from the customer-portal mobile audit (reconciling the external `MOBILE-FIRST-RESPONSIVE` / `PWA-BEST-PRACTICES` drafts): §7.1 what's already built (both shells now have a fixed bottom tab bar + "More" sheet + safe-area; global `overscroll-behavior`/`tap-highlight`/`.no-scrollbar` in `index.css`); §7.2 the pragmatic touch-target rule (44px standalone / 40px clustered / `.tag` exempt); §7.3 the scroll-nav strip pattern (`.no-scrollbar` + edge fade + active-tab `scrollIntoView`); §7.4 the 375px audit checklist; §7.5 PWA is a build decision, and never SWR operational data. |
