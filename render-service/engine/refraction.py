"""Mode A — printed graphic UNDER transparent crystal (seen through it).

Each crystal is a tiny lens: the underlying graphic is refracted (facet-gradient
displacement + chromatic dispersion) and blurred, more for bigger stones. Then
the crystal's transmission + sparkle go on top. Spec §14.7.

`top_color` is the CRYSTAL layer itself (AB, Moonlight, Colorado, Bermuda,
... — must be one of the transparent/coated crystal colours for the "seen
through it" effect to make sense), and `bg_color` is the BACKFILM name the
crystal sits on (e.g. "White", "Black") — NOT a flat colour composited by
formula. Per the owner (2026-07-30, second pass): the same crystal colour on
a different real backfilm is a genuinely different photographed swatch — the
translucent crystal changes the sparkle character, not just the tint — so
`crystal_photo(top_color, crystal_type, backfilm=bg_color)` must resolve to
an ACTUAL captured combo photo (raises if that combo was never captured; see
palette.py). Its average colour, not a separately-maintained flat-colour
registry, is what an uploaded graphic's ink sits against — grounding the
"what's behind the graphic" colour in the real photo instead of an assumed
number.

Note: the transparent-crystal iridescence/veiling fine-tune (AB/Moonlight) is a
Phase-2 item — see spec §14.11.
"""
import numpy as np

from .core import (CANVAS, build_material, load_rgb, luminance,
                   smoothstep, screen, pil_blur, to_pil, to_np, design_mask_from_image)
from .palette import color_rgb, crystal_photo, stone_mm, DEFAULT_FG


def _refract(G, material, blur_px, refract_px):
    Gb = pil_blur(G, blur_px)
    L = pil_blur(luminance(material)[..., None], 1.0)[..., 0]
    gy, gx = np.gradient(L)
    H, W = L.shape
    ys, xs = np.mgrid[0:H, 0:W]
    out = np.empty_like(Gb)
    for c, disp in zip(range(3), (1.15, 1.0, 0.85)):     # chromatic dispersion
        sx = np.clip(xs + gx * refract_px * disp, 0, W - 1).astype(np.int32)
        sy = np.clip(ys + gy * refract_px * disp, 0, H - 1).astype(np.int32)
        out[..., c] = Gb[sy, sx, c]
    return out


def render_printed(logo_img, crystal_type, bg_color, px_per_mm, top_color=DEFAULT_FG):
    """Composite the logo over the REAL captured backfilm, then view it
    through a transparent CRYSTAL layer (top_color) using that same real
    photo as the material. Returns a PIL image."""
    sp = max(4.0, stone_mm(crystal_type) * px_per_mm)

    top_path, top_pitch = crystal_photo(top_color, crystal_type, backfilm=bg_color)
    mat = build_material(sp / top_pitch, seed=5, path=top_path)

    # The graphic's ink sits against this backfilm's own average colour —
    # sampled from the real captured combo photo, not a separately-maintained
    # flat-colour guess (see module docstring).
    backfilm_rgb = load_rgb(top_path).reshape(-1, 3).mean(axis=0)
    bg = np.ones((CANVAS, CANVAS, 3), np.float32) * backfilm_rgb
    mask = design_mask_from_image(logo_img, frac=0.80)[..., None]
    ink = np.array(color_rgb("Jet"))                     # simple: dark ink (Phase 2: real logo colours)
    G = bg * (1 - mask) + ink * mask
    Gr = _refract(G, mat, blur_px=sp * 0.13, refract_px=sp * 5.5)

    L = luminance(mat)
    lo, hi = np.percentile(L, 3), np.percentile(L, 99)
    Ln = np.clip((L - lo) / (hi - lo + 1e-6), 0, 1)
    trans = (0.55 + 0.55 * Ln)[..., None]                # transparent crystal passes the print
    base = np.clip(Gr * trans, 0, 1)
    sparkle = smoothstep(0.64, 0.95, L)[..., None]
    glint = np.clip(mat * 1.7, 0, 1)
    out = screen(base, glint * sparkle)
    return to_pil(np.clip(out, 0, 1))
