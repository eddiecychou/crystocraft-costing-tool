#!/usr/bin/env python3
"""
Mode B v2 — per-STONE crystal zone map (owner corrections).

Fixes vs v1:
  * MIN FEATURE = 1 STONE (not 2.5). Thin strokes grow only to one crystal wide,
    so the logo stays faithful to the original design.
  * IRREGULAR EDGES. Each crystal is a whole discrete stone, so the colour
    boundary snaps to whole stones (Voronoi cells) — the black/white edge is
    ragged stone-by-stone, never a straight vector line. Bigger stones (Rock) =
    coarser/raggeder edge; 1mm Fabric = finer edge.
"""
import numpy as np
from PIL import Image, ImageFilter
from render_refraction import build_material, luminance, smoothstep, screen, CANVAS

SW = "swatches/"
TYPES = {
    "Fabric 1.0mm":    dict(scale=0.30, stone_px=12),
    "Fine Rock 1.5mm": dict(scale=0.46, stone_px=20),
    "Rock 2.0mm":      dict(scale=0.66, stone_px=28),
}
JET      = (0.045, 0.045, 0.06)
CLEAR_AB = (0.95, 0.96, 1.0)

def to_pil(m): return Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8))
def to_np(im): return np.asarray(im).astype(np.float32) / 255.0

def colorize(material, target, glint=1.0, body_floor=0.42):
    L = luminance(material)[..., None]
    T = np.array(target, np.float32)[None, None, :]
    body = np.clip(T * (body_floor + 1.05 * L), 0, 1)
    spark = smoothstep(0.58, 0.92, luminance(material))[..., None]
    gl = np.clip(material * 1.8, 0, 1)
    return np.clip(screen(body, gl * spark * glint), 0, 1)

def thin_width_px(mask):
    im = to_pil(mask).convert("L"); a0 = (np.asarray(im) > 40).sum(); n = 0
    while (np.asarray(im) > 40).sum() > 0.5 * a0 and n < 40:
        im = im.filter(ImageFilter.MinFilter(3)); n += 1
    return max(2, 2 * n)

def dilate(mask, px):
    im = to_pil(mask).convert("L")
    for _ in range(int(round(px))):
        im = im.filter(ImageFilter.MaxFilter(3))
    return to_np(im.convert("L"))

def load_design(path, frac=0.80, crop_text=True):
    im = Image.open(path)
    a = np.asarray(im.split()[-1]).astype(np.float32)/255.0 if "A" in im.getbands() else 1-to_np(im.convert("L"))
    if crop_text: a = a[: int(a.shape[0]*0.80), :]
    ah, aw = a.shape; s = int(CANVAS*frac)/max(ah, aw)
    a = to_np(to_pil(a).resize((int(aw*s), int(ah*s)), Image.LANCZOS).convert("L"))
    full = np.zeros((CANVAS, CANVAS), np.float32)
    h, w = a.shape; y0, x0 = (CANVAS-h)//2, (CANVAS-w)//2
    full[y0:y0+h, x0:x0+w] = a
    return full

def voronoi_centers(sp, seed=0):
    """For each pixel, the (y,x) of its nearest jittered stone centre."""
    H = W = CANVAS
    gy, gx = np.mgrid[0:H, 0:W]
    ni, nj = H//sp + 3, W//sp + 3
    rng = np.random.default_rng(seed)
    jy = (rng.random((ni, nj)) - 0.5) * sp * 0.7
    jx = (rng.random((ni, nj)) - 0.5) * sp * 0.7
    gi = np.clip(np.round(gy/sp).astype(int), 0, ni-1)
    gj = np.clip(np.round(gx/sp).astype(int), 0, nj-1)
    best = np.full((H, W), 1e18); bcy = np.zeros((H, W)); bcx = np.zeros((H, W))
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci = np.clip(gi+di, 0, ni-1); cj = np.clip(gj+dj, 0, nj-1)
            cy = ci*sp + jy[ci, cj]; cx = cj*sp + jx[ci, cj]
            d = (gy-cy)**2 + (gx-cx)**2
            m = d < best; best = np.where(m, d, best)
            bcy = np.where(m, cy, bcy); bcx = np.where(m, cx, bcx)
    return bcy, bcx

def render_mosaic(design, fg_type, fg_color, bg_type, bg_color):
    binm = (design > 0.4).astype(np.float32)
    raw = thin_width_px(binm)
    sp = TYPES[fg_type]["stone_px"]
    grow = max(0, (sp - raw) / 2)                      # MIN = 1 stone (gentle)
    print(f"  thinnest stroke ~{raw}px; 1 stone = {sp}px -> bolden +{grow:.0f}px/side (faithful)")
    bold = dilate(binm, grow) if grow > 0 else binm

    # snap the colour boundary to whole stones -> irregular edge
    bcy, bcx = voronoi_centers(sp, seed=5)
    scy = np.clip(np.round(bcy).astype(int), 0, CANVAS-1)
    scx = np.clip(np.round(bcx).astype(int), 0, CANVAS-1)
    region = (bold[scy, scx] > 0.5)[..., None]         # each stone entirely fg or bg

    fg = colorize(build_material(TYPES[fg_type]["scale"], seed=9), fg_color, glint=1.15, body_floor=0.42)
    bg = colorize(build_material(TYPES[bg_type]["scale"], seed=3), bg_color, glint=0.9, body_floor=0.55)
    return np.clip(np.where(region, fg, bg), 0, 1)

if __name__ == "__main__":
    design = load_design(SW + "butterfly.png", frac=0.80, crop_text=True)
    for fg_type, tag in [("Fine Rock 1.5mm", "finerock"), ("Rock 2.0mm", "rock")]:
        print(f"Zone map: {fg_type} (Jet) butterfly on Fabric 1.0mm (Clear/AB)")
        out = render_mosaic(design, fg_type, JET, "Fabric 1.0mm", CLEAR_AB)
        to_pil(out).save(f"out_mosaic_{tag}.png")
        print("  wrote out_mosaic_%s.png" % tag)
