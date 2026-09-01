# Crystocraft Design System — reference exports

Two exported design-system bundles, kept here as **reference material**, newest
last:

| Folder | What it is |
|---|---|
| `2026-V2/` | The "2026 V2" export — tokens, component specs, guidelines, templates. |
| `V2.5/` | The V2.5 export — same shape as 2026-V2 plus a few extras (`thumbnail.html`, a composition guideline card, a `templates/proposal` set). The palette/typography/spacing values in `tailwind.config.js` and `src/index.css` were hand-copied from **this** bundle's `tokens/*.css`. |

> **Binaries are not tracked.** The `assets/logos/`, `uploads/`, `screenshots/`
> and `.thumbnail` files are gitignored — they're duplicates of the real logo
> assets in `src/assets/`, and a byte sequence inside the logo JPEGs collides
> with an env-var value, which trips Netlify's secret scanner. They stay on
> disk locally; only the text (tokens, component `.jsx`/`.d.ts`, guidelines
> `.html`, `.md`) is in git.

## These are NOT what the app runs on

The **authoritative** design system is:

- `tailwind.config.js` → `theme.extend` (colours, fonts, shadow scale)
- `src/index.css` → `@layer base` / `@layer components` (`.btn*`, `.input`,
  `.card`, `.tag`, `.badge`, `.label`, `.eyebrow`, `.mosaic-*`, the mobile
  base rules)
- `docs/skills/UI-POLISH.md` — the written companion (visual language, the
  Second-Pass checklist, §7 Mobile)

Nothing in `src/` imports from these folders. `src/index.css`'s own comment
explains why the token values are copied in rather than `@import`-ed: "so
tokens don't depend on a dev-server restart." Treat `tokens/*.css` in here as
**a record of where a value came from**, not a live source. In particular
there is no `colors.css` / `spacing.css` the app reads — external drafts that
say "use the tokens in `colors.css`" are wrong about this repo.

## Toward V3

Any V3 work starts by writing `docs/skills/DESIGN-SYSTEM.md` — the spec of
what V2.5 actually *is*, extracted from the config + CSS (token roles,
component inventory, hover/active/disabled/focus matrix) — then deciding the
deltas. These bundles are the visual reference for that; the code is the
source of truth.
