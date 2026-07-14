#!/usr/bin/env python3
"""
Mode A — printed graphic UNDER transparent crystal, seen THROUGH the stones.

Physical model (the missing piece from v1):
  * Each crystal is a tiny lens → it refracts/displaces the bit of graphic under
    it. We derive a displacement field from the crystal facet gradients and warp
    the underlying graphic along it. Chromatic dispersion (R/G/B displaced
    differently) gives the coloured edge fringing crystals produce.
  * Diffuse scatter → Gaussian blur of the graphic, radius ∝ stone size.
  * BIGGER stones refract + blur MORE. So each grade (1.0 / 1.5 / 2.0 mm) gets
    stronger displacement + blur → fine lines soften progressively.
Then the crystal's own transmission (dark crevices) + sparkle glints go on top.
"""
import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont

SW = "swatches/"
CANVAS = 1000

def load_rgb(path, size=None):
    im = Image.open(path).convert("RGB")
    if size: im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0

def luminance(rgb): return rgb @ np.array([0.299, 0.587, 0.114], np.float32)
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def screen(a, b): return 1 - (1 - a) * (1 - b)
def pil_blur(arr, radius):
    if radius <= 0: return arr
    a = arr[..., 0] if (arr.ndim == 3 and arr.shape[2] == 1) else arr
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    out = np.asarray(im.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
    return out[..., None] if (arr.ndim == 3 and arr.shape[2] == 1) else out

def build_material(scale, seed=7):
    """Feathered-overlap tiling: each stamp is blended with a Hann window so there
    are NO hard seams (a hard grid would show up as lens artifacts in refraction)."""
    rng = np.random.default_rng(seed)
    tile_px = int(round(500 * scale))
    src = load_rgb(SW + "CrystalRock_500x500.jpg", (tile_px, tile_px))
    win = np.outer(np.hanning(tile_px), np.hanning(tile_px))[..., None] + 1e-3
    step = max(1, int(tile_px * 0.5))
    H = W = CANVAS + tile_px
    accum = np.zeros((H, W, 3), np.float32); wsum = np.zeros((H, W, 1), np.float32)
    def cell():
        t = src
        if rng.random() < 0.5: t = t[:, ::-1]
        if rng.random() < 0.5: t = t[::-1, :]
        t = np.roll(t, int(rng.integers(0, tile_px)), axis=0)
        return np.roll(t, int(rng.integers(0, tile_px)), axis=1)
    for y in range(0, CANVAS, step):
        for x in range(0, CANVAS, step):
            accum[y:y+tile_px, x:x+tile_px] += cell() * win
            wsum[y:y+tile_px, x:x+tile_px] += win
    return (accum / np.maximum(wsum, 1e-3))[:CANVAS, :CANVAS]

def refract(G, material, blur_px, refract_px):
    """Blur (diffuse scatter) then warp the graphic along the crystal facet
    gradients (lens refraction), with per-channel chromatic dispersion."""
    Gb = pil_blur(G, blur_px)
    L = luminance(material)
    L = pil_blur(L[..., None], 1.0)[..., 0]          # de-noise the field a touch
    gy, gx = np.gradient(L)                            # facet slopes → lens direction
    H, W = L.shape
    ys, xs = np.mgrid[0:H, 0:W]
    out = np.empty_like(Gb)
    for c, disp in zip(range(3), (1.15, 1.0, 0.85)):  # chromatic dispersion R>G>B
        sx = np.clip(xs + gx * refract_px * disp, 0, W - 1).astype(np.int32)
        sy = np.clip(ys + gy * refract_px * disp, 0, H - 1).astype(np.int32)
        out[..., c] = Gb[sy, sx, c]
    return out

# per-grade refraction params: bigger stone → bigger scale, more blur, more refract
GRADES = {
    "Crystal Fabric 1.0mm":   dict(scale=0.34, blur=1.6, refract=90),
    "Crystal Fine Rock 1.5mm":dict(scale=0.50, blur=3.2, refract=150),
    "Crystal Rock 2.0mm":     dict(scale=0.72, blur=5.5, refract=230),
}

def crystal_over_print(G, grade):
    p = GRADES[grade]
    mat = build_material(p["scale"])
    Gr = refract(G, mat, p["blur"], p["refract"])
    L = luminance(mat)
    lo, hi = np.percentile(L, 3), np.percentile(L, 99)
    Ln = np.clip((L - lo) / (hi - lo + 1e-6), 0, 1)
    # Transmission: transparent crystal passes most of the print; crevices only
    # mildly darken. Higher floor keeps it bright (crystal-over-white reads light).
    trans = (0.55 + 0.55 * Ln)[..., None]
    base = np.clip(Gr * trans, 0, 1)
    # Sparkle: brighter, more glints — this is a crystal product, sparkle sells it.
    sparkle = smoothstep(0.64, 0.95, L)[..., None]
    glint = np.clip(mat * 1.7, 0, 1)
    out = screen(base, glint * sparkle)
    return np.clip(out, 0, 1)

def make_printed_graphic():
    """A printed graphic with FINE LINES: butterfly + wordmark, teal ink on ivory."""
    bg = np.ones((CANVAS, CANVAS, 3), np.float32) * np.array([0.97, 0.95, 0.90])
    logo = Image.open(SW + "butterfly.png")
    a = np.asarray(logo.split()[-1]).astype(np.float32) / 255.0
    a = np.asarray(Image.fromarray((a*255).astype(np.uint8)).resize((int(CANVAS*0.8), int(CANVAS*0.8*847/800)), Image.LANCZOS)).astype(np.float32)/255.0
    full = np.zeros((CANVAS, CANVAS), np.float32)
    h, w = a.shape; y0, x0 = (CANVAS-h)//2, (CANVAS-w)//2
    full[y0:y0+h, x0:x0+w] = a
    ink = np.array([0.05, 0.32, 0.38])                # deep teal
    return bg * (1 - full[..., None]) + ink * full[..., None], full

def label(img_arr, text):
    im = Image.fromarray((np.clip(img_arr,0,1)*255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    try: f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
    except Exception: f = ImageFont.load_default()
    d.rectangle([0, 0, CANVAS, 52], fill=(20, 20, 24))
    d.text((16, 8), text, fill=(255, 255, 255), font=f)
    return np.asarray(im).astype(np.float32)/255.0

if __name__ == "__main__":
    G, _ = make_printed_graphic()
    panels = [label(G, "Printed graphic (sharp, before crystal)")]
    for grade in GRADES:
        panels.append(label(crystal_over_print(G, grade), grade + "  —  refracted + blurred"))
    montage = np.concatenate(panels, axis=1)
    Image.fromarray((montage*255).astype(np.uint8)).save("out_modeA_refraction.png")
    # also a standalone hero at the medium grade
    Image.fromarray((crystal_over_print(G, "Crystal Fine Rock 1.5mm")*255).astype(np.uint8)).save("out_modeA_hero.png")
    print("wrote out_modeA_refraction.png (montage) + out_modeA_hero.png")
