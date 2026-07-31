"""Mode B — crystal ZONE MAP (the logo made of crystals).

Rules validated with the owner (spec §14.9, §14.10):
  * min feature = 1 stone (faithful to the logo; only sub-stone strokes boldened),
  * irregular, stone-quantised edge (Voronoi cells).
Hybrid: realistic photo fill (scaled so its stones == stone_px) + edge Voronoi,
anti-aliased.

The edge Voronoi grid is FINER than the fill's own stone pitch (fg_sp/2.2,
changed 2026-07-30 against real product photos) — a boundary that only turns
once per stone read as shattered glass, not a hand-set crystal edge. The fill
sparkle pattern is still full stone size; only the boundary curve's
resolution changed, plus a small blur to remove pixel-level staircase noise
on top of that.

Colour handling rewritten 2026-07-30: fg_color/bg_color now each load their
OWN real photo (palette.list_crystal_colors()) directly — no more colorize()
luminance-recolour. A recolour can shift hue but can't invent a different
colour's actual sparkle density/facet character, which do genuinely differ
photo to photo (confirmed: White and Red crops look nothing alike beyond
hue). crystal_type controls stone SIZE (mm -> px) AND, separately, which
photo OVERRIDE a colour uses (fabric vs rock — see palette.py's module
docstring for why fine_rock_1.5/rock_2.0 share one "rock" style while
fabric_1.0 gets its own).
"""
import numpy as np

from .core import CANVAS, build_material, dilate, thin_width_px, to_pil, design_mask_from_image, pil_blur
from .palette import crystal_photo, stone_mm


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


def render_zone_map(logo_img, crystal_type, fg_color, bg_color, px_per_mm):
    """Hybrid Mode B render. Returns a PIL image.

    Background stone SIZE is always fabric scale (1.0mm) regardless of
    crystal_type — that parameter sizes the FOREGROUND (logo) only. The logo
    stays confined to its own region by the Voronoi `region` mask below."""
    fg_sp = max(4.0, stone_mm(crystal_type) * px_per_mm)
    bg_sp = max(4.0, stone_mm("fabric_1.0") * px_per_mm)

    design = design_mask_from_image(logo_img, frac=0.80)
    binm = (design > 0.4).astype(np.float32)
    raw = thin_width_px(binm)
    grow = max(0, (fg_sp - raw) / 2)                     # MIN = 1 stone (faithful)
    bold = dilate(binm, grow) if grow > 0 else binm

    # Each colour is its own real photo — see palette.list_crystal_colors() —
    # loaded directly and scaled to the target stone size, with no recolour
    # step. fg uses the requested crystal_type's style (fabric/rock); bg is
    # always fabric style, matching its always-fabric SIZE above.
    fg_path, fg_pitch = crystal_photo(fg_color, crystal_type)
    bg_path, bg_pitch = crystal_photo(bg_color, "fabric_1.0")
    fg_mat = build_material(fg_sp / fg_pitch, seed=9, path=fg_path)
    bg_mat = build_material(bg_sp / bg_pitch, seed=3, path=bg_path)

    # Edge quantisation is deliberately FINER than the fill's own stone size
    # (fg_sp/2.2): comparing against real product photos (2026-07-30), a
    # boundary quantised at one full stone per zigzag step reads as shattered
    # glass, not a hand-set crystal edge — the "no feature thinner than 1
    # stone" rule above is about the FILL (a logo detail can't be thinner than
    # a stone), it was never a requirement that the boundary itself only turn
    # once per stone. The sparkle fill pattern (fg_mat/bg_mat) is untouched —
    # still full stone size — only the edge curve's resolution changed.
    cy, cx = _stone_centers(fg_sp / 2.2, seed=9)
    scy = np.clip(np.round(cy).astype(int), 0, CANVAS - 1)
    scx = np.clip(np.round(cx).astype(int), 0, CANVAS - 1)
    region_hard = bold[scy, scx].astype(np.float32)

    # Anti-alias on top of that: `region_hard` is a per-pixel nearest-cell
    # lookup with ZERO smoothing between adjacent pixels, which adds a
    # staircase on top of the quantisation above. A gentle blur removes that
    # pixel-level noise without hiding the (now finer) quantised curve itself.
    region = pil_blur(region_hard[..., None], radius=1.4)

    return to_pil(np.clip(fg_mat * region + bg_mat * (1 - region), 0, 1))
