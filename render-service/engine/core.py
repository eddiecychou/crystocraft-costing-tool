"""Shared render math + crystal material (ported from the validated POC).

Everything is deterministic numpy/PIL — no generative AI. See
../../Corp_Gift_Customizer_Spec.md §14 for the model.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

CANVAS = 1000
MATERIAL_PATH = os.path.join(os.path.dirname(__file__), "materials", "crystal_rock.jpg")
# Measured: a stone in the bundled crystal-rock photo is ~36 px across.
PHOTO_STONE = 36.0


# ── image helpers ─────────────────────────────────────────────────────────────
def to_pil(m):
    return Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8))

def to_np(im):
    return np.asarray(im).astype(np.float32) / 255.0

def load_rgb(path, size=None):
    im = Image.open(path).convert("RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0

def luminance(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def screen(a, b):
    return 1 - (1 - a) * (1 - b)

def pil_blur(arr, radius):
    if radius <= 0:
        return arr
    a = arr[..., 0] if (arr.ndim == 3 and arr.shape[2] == 1) else arr
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    out = np.asarray(im.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
    return out[..., None] if (arr.ndim == 3 and arr.shape[2] == 1) else out

def dilate(mask, px):
    im = to_pil(mask).convert("L")
    for _ in range(int(round(px))):
        im = im.filter(ImageFilter.MaxFilter(3))
    return to_np(im.convert("L"))

def thin_width_px(mask):
    """Estimate the thinnest strokes: erode until half the ink is gone."""
    im = to_pil(mask).convert("L")
    a0 = (np.asarray(im) > 40).sum()
    n = 0
    while (np.asarray(im) > 40).sum() > 0.5 * a0 and n < 40:
        im = im.filter(ImageFilter.MinFilter(3))
        n += 1
    return max(2, 2 * n)


# ── crystal material (feathered-overlap tiling, seamless) ─────────────────────
def build_material(scale, seed=7):
    rng = np.random.default_rng(seed)
    tile_px = max(8, int(round(500 * scale)))
    src = load_rgb(MATERIAL_PATH, (tile_px, tile_px))
    win = np.outer(np.hanning(tile_px), np.hanning(tile_px))[..., None] + 1e-3
    step = max(1, int(tile_px * 0.5))
    H = W = CANVAS + tile_px
    accum = np.zeros((H, W, 3), np.float32)
    wsum = np.zeros((H, W, 1), np.float32)

    def cell():
        t = src
        if rng.random() < 0.5:
            t = t[:, ::-1]
        if rng.random() < 0.5:
            t = t[::-1, :]
        t = np.roll(t, int(rng.integers(0, tile_px)), axis=0)
        return np.roll(t, int(rng.integers(0, tile_px)), axis=1)

    for y in range(0, CANVAS, step):
        for x in range(0, CANVAS, step):
            accum[y:y + tile_px, x:x + tile_px] += cell() * win
            wsum[y:y + tile_px, x:x + tile_px] += win
    return (accum / np.maximum(wsum, 1e-3))[:CANVAS, :CANVAS]


def colorize(material, target, glint=1.0, body_floor=0.42):
    """Recolour crystal material to a target crystal colour, keeping shading +
    sparkle. `glint` = specular strength; `body_floor` lifts light colours so
    clear/white reads bright, not grey. (Iridescence tuning is Phase 2.)"""
    L = luminance(material)[..., None]
    T = np.array(target, np.float32)[None, None, :]
    body = np.clip(T * (body_floor + 1.05 * L), 0, 1)
    spark = smoothstep(0.58, 0.92, luminance(material))[..., None]
    gl = np.clip(material * 1.8, 0, 1)
    return np.clip(screen(body, gl * spark * glint), 0, 1)


# ── design mask from an uploaded logo (PIL image) ─────────────────────────────
def design_mask_from_image(logo_img, frac=0.80):
    """Foreground mask centred on the canvas from a logo PIL image (alpha, else
    darkness)."""
    im = logo_img
    if "A" in im.getbands():
        a = np.asarray(im.split()[-1]).astype(np.float32) / 255.0
    else:
        a = 1 - to_np(im.convert("L"))
    ah, aw = a.shape
    s = int(CANVAS * frac) / max(ah, aw)
    a = to_np(to_pil(a).resize((max(1, int(aw * s)), max(1, int(ah * s))), Image.LANCZOS).convert("L"))
    full = np.zeros((CANVAS, CANVAS), np.float32)
    h, w = a.shape
    y0, x0 = (CANVAS - h) // 2, (CANVAS - w) // 2
    full[y0:y0 + h, x0:x0 + w] = a
    return full
