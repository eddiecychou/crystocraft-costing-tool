"""Mode B — crystal ZONE MAP (the logo made of crystals).

Rules validated with the owner (spec §14.9, §14.10):
  * min feature = 1 stone (faithful to the logo; only sub-stone strokes boldened),
  * irregular, stone-quantised edge (Voronoi cells),
  * stone size == the SAME grid that fills the texture (mm-tied), so the ragged
    edge matches the visible stones.
Hybrid: realistic photo fill (scaled so its stones == stone_px) + edge Voronoi at
the same stone_px.
"""
import numpy as np

from .core import (CANVAS, PHOTO_STONE, build_material, colorize, dilate,
                   thin_width_px, to_pil, design_mask_from_image)
from .palette import color_rgb, stone_mm, DEFAULT_TYPE


def _stone_centers(sp, seed=0):
    """Per-pixel nearest jittered stone-centre coords (for whole-stone colouring)."""
    H = W = CANVAS
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float64)
    ni, nj = int(H // sp + 3), int(W // sp + 3)
    rng = np.random.default_rng(seed)
    jy = (rng.random((ni, nj)) - 0.5) * sp * 0.8
    jx = (rng.random((ni, nj)) - 0.5) * sp * 0.8
    gi = np.clip(np.round(gy / sp).astype(int), 0, ni - 1)
    gj = np.clip(np.round(gx / sp).astype(int), 0, nj - 1)
    F1 = np.full((H, W), 1e18)
    cy = np.zeros((H, W))
    cx = np.zeros((H, W))
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci = np.clip(gi + di, 0, ni - 1)
            cj = np.clip(gj + dj, 0, nj - 1)
            ccy = ci * sp + jy[ci, cj]
            ccx = cj * sp + jx[ci, cj]
            d = (gy - ccy) ** 2 + (gx - ccx) ** 2
            m = d < F1
            F1 = np.where(m, d, F1)
            cy = np.where(m, ccy, cy)
            cx = np.where(m, ccx, cx)
    return cy, cx


def render_zone_map(logo_img, crystal_type, fg_color, bg_color,
                    px_per_mm, bg_type="fabric_1.0"):
    """Hybrid Mode B render. Returns a PIL image."""
    fg_sp = max(4.0, stone_mm(crystal_type) * px_per_mm)
    bg_sp = max(4.0, stone_mm(bg_type) * px_per_mm)

    design = design_mask_from_image(logo_img, frac=0.80)
    binm = (design > 0.4).astype(np.float32)
    raw = thin_width_px(binm)
    grow = max(0, (fg_sp - raw) / 2)                     # MIN = 1 stone (faithful)
    bold = dilate(binm, grow) if grow > 0 else binm

    # photo fill scaled so its stones == the real stone size
    fg_mat = build_material(fg_sp / PHOTO_STONE, seed=9)
    bg_mat = build_material(bg_sp / PHOTO_STONE, seed=3)

    # edge Voronoi at the SAME fg stone size -> edge raggedness == stone size
    cy, cx = _stone_centers(fg_sp, seed=9)
    scy = np.clip(np.round(cy).astype(int), 0, CANVAS - 1)
    scx = np.clip(np.round(cx).astype(int), 0, CANVAS - 1)
    region = (bold[scy, scx] > 0.5)[..., None]

    fg = colorize(fg_mat, color_rgb(fg_color), glint=1.15, body_floor=0.42)
    bg = colorize(bg_mat, color_rgb(bg_color), glint=0.9, body_floor=0.55)
    return to_pil(np.clip(np.where(region, fg, bg), 0, 1))
