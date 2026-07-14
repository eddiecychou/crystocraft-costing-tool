#!/usr/bin/env python3
"""
Mode B v3 — the STONE is the atomic unit (fixes edge/stone-size mismatch).

Owner caught it: the ragged edge didn't match the visible stone size (3-5x off).
Cause: the fill texture (scaled rock PHOTO) and the edge (separate Voronoi grid)
were two different stone sizes. In reality they're the SAME stones.

Fix: ONE jittered stone grid, sized from real mm, drives BOTH:
  - the faceted crystal texture (each Voronoi cell is rendered as one stone), and
  - the colour-region edge (each whole stone takes one colour).
So edge raggedness == stone size, by construction. Stone size is tied to the
panel's physical size: stone_px = stone_mm * PX_PER_MM.
"""
import numpy as np
from PIL import Image, ImageFilter
from render_refraction import luminance, smoothstep, screen, CANVAS, build_material
from render_mosaic import to_pil, to_np, colorize, dilate, thin_width_px, load_design

# Measured: a stone in CrystalRock_500x500.jpg is ~36 px across.
PHOTO_STONE = 36.0

SW = "swatches/"

# Physical scale: assume the design panel is ~50 mm wide, shown at 1000 px.
PX_PER_MM = CANVAS / 50.0                 # 20 px per mm
STONE_MM = {"Fabric 1.0mm": 1.0, "Fine Rock 1.5mm": 1.5, "Rock 2.0mm": 2.0}
def stone_px(t): return max(4.0, STONE_MM[t] * PX_PER_MM)

JET      = (0.05, 0.05, 0.065)
CLEAR_AB = (0.95, 0.96, 1.0)

def hue_rgb(h):
    return np.stack([0.5 + 0.5*np.cos(2*np.pi*(h - p)) for p in (0.0, 0.33, 0.66)], -1)

def stone_field(sp, seed=0):
    """Return per-pixel: F1 (dist to nearest stone centre), F2 (2nd nearest),
    the nearest centre (cy,cx), and that stone's random value. One jittered grid
    at spacing `sp` == the real stone size."""
    H = W = CANVAS
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float64)
    ni, nj = int(H//sp + 3), int(W//sp + 3)
    rng = np.random.default_rng(seed)
    jy = (rng.random((ni, nj)) - 0.5) * sp * 0.8
    jx = (rng.random((ni, nj)) - 0.5) * sp * 0.8
    cr = rng.random((ni, nj))
    gi = np.clip(np.round(gy/sp).astype(int), 0, ni-1)
    gj = np.clip(np.round(gx/sp).astype(int), 0, nj-1)
    F1 = np.full((H, W), 1e18); F2 = np.full((H, W), 1e18)
    cy = np.zeros((H, W)); cx = np.zeros((H, W)); crand = np.zeros((H, W))
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci = np.clip(gi+di, 0, ni-1); cj = np.clip(gj+dj, 0, nj-1)
            ccy = ci*sp + jy[ci, cj]; ccx = cj*sp + jx[ci, cj]
            d = np.sqrt((gy-ccy)**2 + (gx-ccx)**2)
            newmin = d < F1
            F2 = np.where(newmin, F1, np.minimum(F2, d))
            cy = np.where(newmin, ccy, cy); cx = np.where(newmin, ccx, cx)
            crand = np.where(newmin, cr[ci, cj], crand)
            F1 = np.where(newmin, d, F1)
    return F1, F2, cy, cx, crand

def crystal_material(sp, seed=0):
    """Procedural bed of faceted clear crystals from the stone grid: dark crevices
    between stones, beveled bright interiors, a specular glint per stone, subtle
    AB rainbow. Stone size == sp exactly."""
    F1, F2, cy, cx, crand = stone_field(sp, seed)
    ridge = F2 - F1                                   # 0 at stone borders
    seam = smoothstep(0.0, 0.12*sp, ridge)            # dark seam between stones
    bevel = np.clip(ridge/(0.45*sp), 0, 1)            # rounded, bright interior
    glint = np.exp(-(F1/(0.26*sp))**2) * (0.55 + 0.45*crand)   # specular near centre
    mono = np.clip((0.30 + 0.55*bevel)*seam + 0.9*glint, 0, 1)
    mat = np.repeat(mono[..., None], 3, axis=2)
    ab = glint[..., None] * 0.30 * (hue_rgb(crand) - 0.6)      # rainbow on glints
    return np.clip(mat + ab, 0, 1), cy, cx

def render(design, fg_type, fg_color, bg_type, bg_color):
    binm = (design > 0.4).astype(np.float32)
    raw = thin_width_px(binm); sp = stone_px(fg_type)
    grow = max(0, (sp - raw)/2)                        # min = 1 stone
    print(f"  {fg_type}: stone={sp:.0f}px, thin stroke~{raw}px -> bolden +{grow:.0f}px")
    bold = dilate(binm, grow) if grow > 0 else binm

    fg_mat, cy, cx = crystal_material(sp, seed=9)      # fg stones (also define the edge)
    bg_mat, _, _   = crystal_material(stone_px(bg_type), seed=3)
    scy = np.clip(np.round(cy).astype(int), 0, CANVAS-1)
    scx = np.clip(np.round(cx).astype(int), 0, CANVAS-1)
    region = (bold[scy, scx] > 0.5)[..., None]         # whole fg stones -> edge = stone size

    fg = colorize(fg_mat, fg_color, glint=1.2, body_floor=0.40)
    bg = colorize(bg_mat, bg_color, glint=0.95, body_floor=0.55)
    return np.clip(np.where(region, fg, bg), 0, 1)

def render_hybrid(design, fg_type, fg_color, bg_type, bg_color):
    """Photo-real fill, but photo stone size AND edge Voronoi both locked to the
    same mm-derived stone size -> realistic AND edge==stone size."""
    binm = (design > 0.4).astype(np.float32)
    raw = thin_width_px(binm); sp = stone_px(fg_type)
    grow = max(0, (sp - raw)/2)
    bold = dilate(binm, grow) if grow > 0 else binm
    # photo material scaled so its stones == the real stone size
    fg_mat = build_material(sp / PHOTO_STONE, seed=9)
    bg_mat = build_material(stone_px(bg_type) / PHOTO_STONE, seed=3)
    # edge Voronoi at the SAME fg stone size
    _, _, cy, cx, _ = stone_field(sp, seed=9)
    scy = np.clip(np.round(cy).astype(int), 0, CANVAS-1)
    scx = np.clip(np.round(cx).astype(int), 0, CANVAS-1)
    region = (bold[scy, scx] > 0.5)[..., None]
    fg = colorize(fg_mat, fg_color, glint=1.15, body_floor=0.42)
    bg = colorize(bg_mat, bg_color, glint=0.9, body_floor=0.55)
    return np.clip(np.where(region, fg, bg), 0, 1)

if __name__ == "__main__":
    d = load_design(SW + "butterfly.png", frac=0.80, crop_text=True)
    for t, tag in [("Fine Rock 1.5mm", "finerock"), ("Rock 2.0mm", "rock")]:
        to_pil(render(d, t, JET, "Fabric 1.0mm", CLEAR_AB)).save(f"out_stones_{tag}.png")
        h = render_hybrid(d, t, JET, "Fabric 1.0mm", CLEAR_AB)
        to_pil(h).save(f"out_hybrid_{tag}.png")
        Image.fromarray((h[250:500, 250:600]*255).astype(np.uint8)).save(f"out_hybrid_{tag}_zoom.png")
        print(f"  wrote out_stones_{tag}.png + out_hybrid_{tag}.png (+ _zoom)")
