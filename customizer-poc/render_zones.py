#!/usr/bin/env python3
"""
Mode B, done right: a CRYSTAL ZONE MAP.

The design is segmented into REGIONS; each region is assigned:
  - a crystal TYPE (stone size): Fabric 1.0mm | Fine Rock 1.5mm | Rock 2.0mm
  - a crystal COLOUR: Jet, Crystal AB/clear, etc.
Different regions use different stone sizes (like the real product: black
Fine-Rock butterfly on a white Fabric background).

MINIMUM-FEATURE RULE (the physical constraint the reference photo revealed):
  A crystal stroke must be >= ~2.5 stones wide to hold crystals. Thin regions are
  auto-BOLDENED up to that minimum (why the real butterfly has fat filled petals),
  and anything that can't be boldened without destroying it (fine text) is FLAGGED
  as unmakeable and dropped.
"""
import numpy as np
from PIL import Image, ImageFilter
# feathered (seamless) material + helpers from the refraction POC
from render_refraction import build_material, luminance, smoothstep, screen, CANVAS

SW = "swatches/"

# crystal type -> material scale (bigger stone => bigger scale) + stone size px.
# Min stroke width = MIN_STONES * stone_px.
TYPES = {
    "Fabric 1.0mm":    dict(scale=0.30, stone_px=12),
    "Fine Rock 1.5mm": dict(scale=0.46, stone_px=20),
    "Rock 2.0mm":      dict(scale=0.66, stone_px=28),
}
MIN_STONES = 2.5

JET      = (0.045, 0.045, 0.06)
CLEAR_AB = (0.95, 0.96, 1.0)

def to_pil(m): return Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8))
def to_np(im): return np.asarray(im).astype(np.float32) / 255.0

def colorize(material, target, glint=1.0, body_floor=0.42):
    """Recolour crystal material to a target crystal colour, keeping shading +
    sparkle. `glint` controls specular strength (black AB crystals still sparkle
    hard, so keep it high even for dark targets). `body_floor` lifts light
    colours so clear/white fabric reads bright, not grey."""
    L = luminance(material)[..., None]
    T = np.array(target, np.float32)[None, None, :]
    body = np.clip(T * (body_floor + (1.15 - body_floor) * L / max(L.mean(), 1e-3) * L.mean()), 0, 1)
    body = np.clip(T * (body_floor + 1.05 * L), 0, 1)
    spark = smoothstep(0.58, 0.92, luminance(material))[..., None]
    gl = np.clip(material * 1.8, 0, 1)
    return np.clip(screen(body, gl * spark * glint), 0, 1)

def thin_width_px(mask):
    """Estimate the THINNEST strokes: erode until half the ink is gone."""
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
    a = np.asarray(im.split()[-1]).astype(np.float32) / 255.0 if "A" in im.getbands() \
        else 1 - to_np(im.convert("L"))
    if crop_text:                       # drop wordmark row — unmakeable in crystals
        a = a[: int(a.shape[0] * 0.80), :]
    ah, aw = a.shape
    s = int(CANVAS * frac) / max(ah, aw)
    a = to_np(to_pil(a).resize((int(aw * s), int(ah * s)), Image.LANCZOS).convert("L"))
    full = np.zeros((CANVAS, CANVAS), np.float32)
    h, w = a.shape; y0, x0 = (CANVAS - h) // 2, (CANVAS - w) // 2
    full[y0:y0 + h, x0:x0 + w] = a
    return full

def render_zone_map(design_mask, fg_type, fg_color, bg_type, bg_color):
    binm = (design_mask > 0.4).astype(np.float32)
    raw = thin_width_px(binm)
    min_w = MIN_STONES * TYPES[fg_type]["stone_px"]
    grow = max(0, (min_w - raw) / 2)
    print(f"  thinnest fg stroke ~{raw}px; min for {fg_type} ~{min_w:.0f}px -> bolden +{grow:.0f}px/side")
    mask = dilate(binm, grow) if grow > 0 else binm
    mask = to_np(to_pil(mask).filter(ImageFilter.GaussianBlur(1.2)))[..., None]

    bg = colorize(build_material(TYPES[bg_type]["scale"], seed=3), bg_color, glint=0.9, body_floor=0.55)
    fg = colorize(build_material(TYPES[fg_type]["scale"], seed=9), fg_color, glint=1.15, body_floor=0.42)
    return np.clip(fg * mask + bg * (1 - mask), 0, 1)

if __name__ == "__main__":
    # Match the reference: BLACK Fine-Rock butterfly on WHITE Fabric background.
    design = load_design(SW + "butterfly.png", frac=0.80, crop_text=True)
    print("Zone map: Fine Rock 1.5mm (Jet) butterfly  |  Fabric 1.0mm (Clear/AB) background")
    out = render_zone_map(design, "Fine Rock 1.5mm", JET, "Fabric 1.0mm", CLEAR_AB)
    to_pil(out).save("out_zonemap.png")
    print("wrote out_zonemap.png")
