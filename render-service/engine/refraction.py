"""Mode A — printed graphic UNDER transparent crystal (seen through it).

Each crystal is a tiny lens: the underlying graphic is refracted (facet-gradient
displacement + chromatic dispersion) and blurred, more for bigger stones. Then
the crystal's transmission + sparkle go on top. Spec §14.7.

Note: the transparent-crystal iridescence/veiling fine-tune (AB/Moonlight) is a
Phase-2 item — see spec §14.11.
"""
import numpy as np

from .core import (CANVAS, PHOTO_STONE, build_material, colorize, luminance,
                   smoothstep, screen, pil_blur, to_pil, to_np, design_mask_from_image)
from .palette import color_rgb, stone_mm


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


def render_printed(logo_img, crystal_type, bg_color, px_per_mm, top_color="CrystalAB"):
    """Composite the logo over a printed background, then view it through a
    transparent crystal layer. Returns a PIL image."""
    sp = max(4.0, stone_mm(crystal_type) * px_per_mm)

    # printed graphic = logo over the chosen background colour
    bg = np.ones((CANVAS, CANVAS, 3), np.float32) * np.array(color_rgb(bg_color))
    mask = design_mask_from_image(logo_img, frac=0.80)[..., None]
    ink = np.array(color_rgb("Jet"))                     # simple: dark ink (Phase 2: real logo colours)
    G = bg * (1 - mask) + ink * mask

    mat = build_material(sp / PHOTO_STONE, seed=5)
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
