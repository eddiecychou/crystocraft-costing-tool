# Crystocraft Design System

> *Craftsmanship that catches the light — since 1958*

A single source of truth for the Crystocraft brand: architecture, colour, typography, art direction, components, and digital structure. For designers, developers, and suppliers.

---

## Company & Product Context

**Crystocraft** is a Hong Kong-based premium gifting and crystal manufacturing house, founded in 1958 as *United Art* by master metalsmith Mr. Chou — pioneer of the *cold-stamping* technique. The brand's signature product, the **Butterfly Suncatcher**, originated the butterfly mark that still anchors the identity. The **Crystocraft** trademark was formalised in 2003.

The brand story is: **masters both metal and crystal, in-house** — a combination no competitor owns. When Swarovski discontinued its crystal supply in 2020–21, Crystocraft built its own rather than compromise.

### Brand Architecture — a Branded House

One master brand, three divisions differentiated by descriptor only:

| Division | Descriptor | Business | Audience |
|---|---|---|---|
| Flagship | **Crystocraft** *(no descriptor)* | Consumer giftware, wholesale & retail | Gift buyers, collectors, wholesalers |
| B | **Crystocraft Crystals** | Crystal components & crystal fabric | Designers, jewellers, lighting, fashion, interiors |
| C | **Crystocraft Bespoke Gifting** | Custom corporate gifts, awards & keepsakes | Corporate buyers, marketing/procurement |

**Backstage (never market-facing):** United Art (holding entity, UA-ProductManager app), Dazzle Crystal Cut & Smooth-Spin (product technologies).

### Taglines
- **Master:** *Craftsmanship that catches the light*
- **Gifts:** *Made to be treasured*
- **Crystals:** *Brilliance, crafted to standard*
- **Bespoke:** *From brief to brilliance*

---

## Sources Provided

| Asset | Path |
|---|---|
| Brand guidelines (full) | `uploads/Crystocraft-Brand-Guidelines.md` |
| Logo — stacked | `assets/logos/logo-stacked.jpg` |
| Logo — horizontal | `assets/logos/logo-horizontal.jpg` |
| Logo mark (butterfly) | `assets/logos/logo-mark.png` |

No Figma file or codebase was provided. All design decisions are derived from the brand guidelines document above.

---

## Content Fundamentals

### Tone & Voice
- **Authoritative but warm.** The craft speaks first; never boastful.
- **"We" for heritage and capability;** "you" for direct customer address.
- Third division (Bespoke) is the most direct and efficient — "fast, at any scale, managed end-to-end."
- The Crystals division is the most technical — precise, specification-forward.
- The Gifts division is the most editorial — generous, celebratory, human.

### Casing & Style
- **Body copy:** sentence case throughout.
- **Eyebrow / kicker labels:** ALL CAPS, wide-tracked (echoes the wordmark's letter-spacing). Used as section labels, product categories, division names.
- **Headings (H1–H3):** UPPERCASE Questrial — the wordmark-echo treatment, weight 400. H4 and all body copy: sentence case.
- **Heritage:** always "since 1958" — never "for 65+ years" (stales immediately).
- **"Crystocraft"** is never abbreviated. "Crystal" lowercase unless part of a formal product name.

### Vocabulary Rules
- Use **"the premium Swarovski alternative"** in page headlines and SEO copy (not in lockup/tagline).
- Keep "Swarovski" out of taglines for trademark cleanliness.
- **Dazzle Crystal Cut** and **Smooth-Spin** are *features/technologies*, not brands — lowercase "cut" and "spin" in context.
- **UA-ProductManager** is internal only — never consumer-facing.

### Emoji & Special Characters
- **No emoji** in any brand communication.
- **No unicode decorative characters** as icons.
- The "O" crosshair in the wordmark (⊕) is part of the fixed, trademarked logo — never reproduced as a standalone character.

### Copy Examples
```
Craftsmanship that catches the light.
Gifts that catch the light.
Made to be treasured.
Brilliance, crafted to standard.
The brilliance lives on.
From brief to brilliance.
Your brand, beautifully crafted.
Premium origins made to our standard.
Quality kept alive when the rest of the market chased cost.
```

---

## Visual Foundations

### Colour System
See `tokens/colors.css` for all tokens.

**System palette (every division):**
- **Near-Black** `#222222` — primary text, headings, dark sections
- **Mid Grey** `#666666` — body copy, descriptions
- **Warm Grey** `#E9E8E6` — backgrounds, dividers, hairlines
- **Beige** `#F7EEE3` — warm section background
- **White** `#FFFFFF` — page backgrounds, reversed text

**Metallic finishes (print & packaging, shared):**
- **Ink Black** `#1C1C1A` — deepest dark, foil base, packaging
- **Champagne Gold** `#C6A664` — premium metallic finish, foil, engraving
- **Platinum** `#C9CBCC` — secondary metallic, borders, fine details

**Division accents (the one differentiating cue):**
- **Gifts** — Bronze Gold `#996632` — warm, celebratory (Topaz register) · light bg Beige `#F7EEE3`
- **Crystals** — Sapphire `#1C4F64` — cool, precise, modern · light bg `#F0F5F8`
- **Bespoke** — Burgundy `#6E2433` — deep, authoritative (Garnet register) · light bg `#F5F0F1`

Harmony: all three accents are deep, muted jewel tones in the same register, so the family feels cohesive. The accent is the **only** colour that changes between divisions — everything else is shared.

**Usage:**
- Logo lockup stays **monochrome** always. Accents appear only in full-colour web/print.
- Crystals division: use sapphire sparingly — lots of ink, ivory, and white space. Restraint signals a serious manufacturer.

### Typography
See `tokens/typography.css` for all tokens. Fonts load from `tokens/fonts.css` via Google Fonts.

**Two-typeface system — consistent across all pages and all divisions:**
- **Questrial** — all headings (H1–H4) **and** body copy. Geometric monoline sans that echoes the wordmark's construction; ships a single 400 weight.
- **Work Sans** — eyebrow labels, captions, badges, buttons, and small UI. Carries the wide-tracked caps that signal the brand.

**Type scale:** H1 36 / H2 30 / H3 24 (all uppercase, 400) · H4 20 (normal case) · Body 16/22 · Label 12 uppercase.

**Per-division emphasis:**
- **Gifts** — generous, editorial spacing
- **Crystals** — tabular figures (`font-variant-numeric: tabular-nums`, Work Sans) for aligned spec numbers
- **Bespoke** — balanced, authoritative

**Eyebrow/kicker style:** `var(--eyebrow-*)` tokens. Work Sans uppercase at `--text-xs` (12px), ~0.92px tracking. The signature section label — its **colour signals the division** (Bronze / Sapphire / Burgundy).

### Backgrounds & Layout
- Two background tones: **Near-Black** `#222222` (dark sections, hero) and **Beige** `#F7EEE3` / **White** (light sections). No busy patterns.
- Photography is the background — never clip-art or illustration.
- **Generous white space.** Section padding: `--space-20` to `--space-24` (80–96px) vertically.
- Max-width: `--container-xl` (1280px) for content, `--container-2xl` (1440px) for full-bleed.
- Fixed sticky nav header across all divisions.

### Animation & Interaction
- **Subtle, fade-based transitions.** `ease` or `ease-in-out`, 150–200ms for micro-interactions.
- **No decorative looping animations.** No bouncy or playful physics.
- Hover on buttons: slight darken (primary) or fills (outline/ghost). `opacity: 0.85` as fallback.
- Hover on cards: `translateY(-2px)` + deeper shadow.
- Press/active: `scale(0.98)` on buttons and clickable cards.

### Cards
- Background: white or beige. **1px hairline border** (`--color-border`). **Flat by default** — no drop shadow; hairlines and the border do the separating.
- A whisper of elevation (`--shadow-md`) appears only on hover for interactive cards, or on genuinely floating surfaces (modals, popovers).
- Border radius: **0** (square corners) for major cards and product containers. Small radius (`--radius-xs` 2px) for chips/tags only.
- No coloured left-border cards. No gradient card backgrounds.

### Shadows
See `tokens/shadows.css`. **Restraint over decoration: hairline rules are the preferred separator, not shadows.** Elevation is kept whisper-soft and reserved for floating surfaces. Accent glows (`--shadow-bronze`, `--shadow-sapphire`, `--shadow-burgundy`) for featured elements only.

### Imagery (Art Direction)
- **"Light is the hero."** Directional, controlled studio/macro photography — real sparkle off facets, glints off mirror-finish metal.
- Tonal backgrounds (Near-Black, Beige) so light reads.
- No models, no lifestyle scenes (Gifts). Object-forward.
- **Crystals division:** crisp, cool-neutral, edge-lit. Ordered grids, technical callouts.
- **Bespoke division:** brand-in-context; Brief→Render→Finished sequence.
- AI used *only* for context/scene backgrounds and customisation previews — never for product photography.
- Colour temperature: **warm gold catchlights** for Gifts; **cool-neutral, precise** for Crystals; **rich, deep executive warmth** for Bespoke.

### Borders
- Hairline dividers between sections: 1px, `--color-border` or `--color-border-mid`.
- Division descriptor sits below wordmark, separated by a thin hairline rule at ~40% cap height.

### Transparency & Blur
- Used sparingly. No frosted-glass effects.
- Badge/tag backgrounds use low-opacity fills of the accent colour (10–12%).
- Overlays: semi-transparent near-black `rgba(34,34,34,0.6)` for image overlays.

---

## Iconography

No proprietary icon set was provided. The brand's visual language implies:

- **Stroke weight:** thin-to-medium, consistent with the butterfly mark and wordmark (neither ultra-thin nor bold).
- **Style:** clean, geometric line icons — no filled silhouettes. Echoes the monoline logo mark and Questrial's geometric character.
- **CDN substitution used:** [Lucide Icons](https://lucide.dev/) — thin-stroke, consistent geometry. Load via `<script src="https://unpkg.com/lucide@latest"></script>`.
- **FLAG:** No official Crystocraft icon set was supplied. Lucide is a placeholder. Supply an icon font or SVG set to replace.

**Logo assets** (see `assets/logos/`):
- `logo-stacked.jpg` — butterfly mark above CRYSTOCRAFT wordmark; primary lockup
- `logo-horizontal.jpg` — butterfly mark left of wordmark; compact horizontal use
- `logo-mark.png` — butterfly mark only (256×256 transparent PNG); for favicons, seals, embossed use

**Rules:**
- The logo is **never modified** — fixed trademarked asset.
- **Monochrome primary lockup** (black/white). Accents appear in the system *around* the logo — never inside the mark.
- Descriptor (CRYSTALS / BESPOKE GIFTING) set below wordmark in letter-spaced Work Sans caps, separated by a hairline rule, always single-colour (black or white) — never the division accent.

---

## Index / Manifest

```
styles.css               ← Global CSS entry point (import this one file)
tokens/
  fonts.css              ← Google Fonts @import (Questrial + Work Sans)
  colors.css             ← All colour tokens (foundation, division accents, semantic)
  typography.css         ← Font families, type scale, spacing, eyebrow presets
  spacing.css            ← Space scale, border radii, container widths
  shadows.css            ← Elevation + accent shadow tokens
assets/
  logos/
    logo-stacked.jpg     ← Primary stacked lockup
    logo-horizontal.jpg  ← Horizontal lockup
    logo-mark.png        ← Butterfly mark only (256×256 PNG)
components/
  core/
    Button               ← Primary action button (primary/secondary/ghost/outline/reversed)
    Badge                ← Status/category labels (gifts/crystals/bespoke/solid)
    Tag                  ← Pill-shaped category tags (outlined, clickable)
    Divider              ← Horizontal rule with optional label (default/gold/bold)
  forms/
    Input                ← Text input with label, hint, error states (underline/boxed)
    Select               ← Dropdown select with same styling as Input
  display/
    Card                 ← Container card (default/ivory/dark, paddings, hoverable)
    TrustSeal            ← SVG circular authentication/heritage seals
guidelines/
  colors-*.card.html     ← Colour swatch specimen cards
  type-*.card.html       ← Typography specimen cards
  spacing.card.html      ← Spacing scale card
  radius-shadows.card.html ← Radius + shadow card
  brand-*.card.html      ← Logo, divisions, trust seals brand cards
templates/
  gifts/index.html       ← crystocraft.com — Gifts flagship hub
  crystals/index.html    ← crystocraft.com/crystals — Crystals B2B hub
  bespoke/index.html     ← crystocraft.com/bespoke — Bespoke Gifting hub
  blog/index.html        ← Editorial / heritage article layout
  catalogue/index.html   ← Filterable product catalogue
```
