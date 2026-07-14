# Crystal Fabric Customizer — Proof of Concept

Deterministic (no-AI) render of a design into crystal fabric, validating the
approach in `../Corp_Gift_Customizer_Spec.md` §14.

**Idea:** the product is transparent crystals on a printed/black film — a colour
layer + a crystal MATERIAL layer. Capture the material once from a real swatch
photo, composite the design through it. Identical every run, milliseconds, no
generative AI.

## Run
```
python3 -m pip install Pillow numpy
python3 render_crystal.py       # writes out_hero_fine.png + out_rock_coarse.png
```

## Files
**Mode B — crystals ARE the logo (solid two-tone):**
- `render_crystal.py` — colorize-by-luminance + sparkle overlay.
- `out_hero_fine.png` — butterfly in clear/AB crystals on jet-black (fine stones).
- `out_rock_coarse.png` — same, coarse 2mm Rock — shows fine detail loss.

**Mode A — printed graphic UNDER transparent crystal, seen through it (refraction):**
- `render_refraction.py` — lens refraction (facet-gradient displacement) + diffuse
  blur ∝ stone size + chromatic dispersion + seamless feathered tiling.
- `out_modeA_refraction.png` — montage: sharp print → 1.0/1.5/2.0mm (fine lines
  blur MORE with bigger stones — the owner's key correction, modelled).
- `out_modeA_hero.png` — teal butterfly under Fine Rock, standalone.

**Shared assets:**
- `swatches/CrystalRock_500x500.jpg` — real crystal-rock material (crystocraft.com).
- `swatches/butterfly.png` — test design (Crystocraft logo).

## Next steps (see spec §14.6–14.8)
- Composite the crystal panel into a real product photo (surface warp + re-light).
- Build the crystal-colour → RGB palette table from the swatch photos.
- Line-thickness vs stone-size legibility warning in the configurator.
- Phase-2 realism: per-stone Voronoi mosaic / magnification.
