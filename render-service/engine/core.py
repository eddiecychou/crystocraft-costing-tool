"""Shared render math + crystal material (ported from the validated POC).

Everything is deterministic numpy/PIL — no generative AI. See
../../Corp_Gift_Customizer_Spec.md §14 for the model.
"""
import numpy as np
from PIL import Image, ImageFilter

CANVAS = 1000


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

def boost_ab_flecks(base, source=None, gain=8.0, lo=0.04, ramp=0.10):
    """Screen the real but faint AB (Aurora Borealis) colour flecks of a
    White-backfilm crystal photo onto `base`, without adding an overall
    colour cast.

    A White-backed AB swatch is mostly bright near-neutral stone with
    occasional strongly-coloured facet flecks. A flat saturation boost tints
    the whole thing (the neutral stone has a slight warm bias that blows up);
    instead this takes each pixel's own chroma (`source` minus its luminance)
    scaled by a ramp on that chroma's MAGNITUDE — so a near-neutral pixel
    (|chroma| < lo) contributes nothing and only genuine flecks get pushed —
    and screen-adds it (additive, never darkens). `source` is the crystal
    material to read flecks FROM (defaults to `base` when they're the same
    image, e.g. Mode B where the material itself is the surface); Mode A
    passes the crystal material separately since its `base` is the graphic."""
    src = base if source is None else source
    L = luminance(src)
    chroma = src - L[..., None]
    cmag = np.abs(chroma).sum(-1, keepdims=True)
    fleck = np.clip((cmag - lo) / ramp, 0, 1)
    return screen(base, np.clip(chroma * gain * fleck, 0, 1))

def apply_facet_relief(base, mat, hi_gain=0.5, lo_gain=0.35):
    """Make individual crystal FACETS visible on `base` — the raised/faceted
    diamond-cut structure real crystal photos show, not just a flat colour
    wash. Owner (2026-08-07), on the previous version: "the dark one is
    losing the crystal texture... the lighter one, it will be better if the
    facets are more clear."

    A plain multiply-by-luminance shading (tried first) is imperceptible on
    a dark base — multiplying near-zero values by anything near 1 barely
    changes them, so the texture vanished exactly on the pixels the owner
    flagged. This instead reads relief from `mat`'s own per-pixel luminance
    deviation (normalized by its OWN mean/std, so it self-calibrates per
    photo): facet PEAKS (bright, `hi`) are SCREEN-added as highlights, which
    brightens regardless of how dark `base` already is; facet VALLEYS (dark,
    `lo`) are multiplied in as shading. The combination reads as a real
    faceted surface on both a bright and a dark base — verified against both
    a dark-background and a white-background test graphic."""
    L = luminance(mat)
    Lc = (L - L.mean()) / (L.std() + 1e-6)
    hi = np.clip(Lc, 0, 2.0)[..., None]
    lo = np.clip(-Lc, 0, 2.0)[..., None]
    out = np.clip(base * (1 - lo * lo_gain), 0, 1)
    return screen(out, hi * hi_gain)

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
def build_material(sp, pitch_px, path, seed=7, patch_stones=5.0):
    """Tiles the photo at `path` (a real crystal-colour swatch — see
    palette.py's registry) into a seamless CANVAS x CANVAS material, with
    ONE real stone rendering as `sp` pixels.

    `pitch_px` is how many pixels one stone spans in `path`'s own native
    resolution (measured in the capture tool by clicking across a real
    stone — see admin.html's "Measure a stone"). Fixed 2026-08-11: the
    previous version took a single pre-divided `scale = sp/pitch_px` and
    resized the WHOLE photo to `500*scale` — which means pitch_px cancels
    out of the final apparent stone size algebraically (final size reduces
    to `500*sp/photo_width`), so the measured pitch had ZERO effect on the
    render; actual stone size instead tracked the uploaded photo's
    incidental resolution. Symptoms this caused, both confirmed real:
    changing a zone from fine_rock_1.5 to rock_2.0 looked identical (a
    SEPARATE caching bug made this worse, but the underlying size math was
    also never right), and one colour rendered as a near-flat colour wash
    with no visible facets at all — its source photo's resolution happened
    to collapse `tile_px` down near the 8px floor, and resizing an ENTIRE
    photo to 8x8 blurs out every bit of texture.

    Fixed by cropping a `patch_stones`-stones-wide patch out of the photo,
    ANCHORED to pitch_px, before resizing — so the crop always contains a
    known number of real stones regardless of the photo's raw resolution,
    and resizing it to `sp*patch_stones` pixels necessarily makes each
    stone span `sp` pixels, independent of anything about the source file
    except the actual measured pitch."""
    rng = np.random.default_rng(seed)
    im_full = Image.open(path).convert("RGB")
    w0, h0 = im_full.size
    pitch_px = max(1.0, float(pitch_px))
    crop_px = max(8, min(int(round(pitch_px * patch_stones)), w0, h0))
    cx, cy = w0 / 2.0, h0 / 2.0
    left = int(round(max(0, min(w0 - crop_px, cx - crop_px / 2.0))))
    top = int(round(max(0, min(h0 - crop_px, cy - crop_px / 2.0))))
    crop = im_full.crop((left, top, left + crop_px, top + crop_px))

    tile_px = max(8, int(round(sp * patch_stones)))
    src = np.asarray(crop.resize((tile_px, tile_px), Image.LANCZOS)).astype(np.float32) / 255.0
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


# colorize() (luminance-recolour + synthetic HSV iridescence coating) was
# removed 2026-07-30. It recoloured one generic photo toward a target hue —
# the owner correctly identified that a recolour can't invent a different
# colour's actual sparkle density/facet character, which do genuinely differ
# per colour. Replaced by real per-colour photos (palette.list_crystal_colors()),
# loaded directly via build_material(path=...) — see stones.py. If you're
# looking for the old coating math, it's in git history, not gone silently.


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


# ── full-colour graphic (not reduced to a silhouette) from an uploaded image ──
def design_rgba_from_image(logo_img, frac=0.80):
    """Same centring/scaling as design_mask_from_image, but keeps the FULL
    colour content instead of collapsing to a single-colour mask — for
    printed mode, where the uploaded graphic itself is what's seen through
    the crystal (not a logo silhouette recoloured to one ink tone). Returns
    (rgb, alpha) each CANVAS x CANVAS; alpha is 1.0 everywhere for an image
    with no alpha channel (opaque graphic fills its own bounding box)."""
    im = logo_img.convert("RGBA")
    ah, aw = im.height, im.width
    s = int(CANVAS * frac) / max(ah, aw)
    im = im.resize((max(1, int(aw * s)), max(1, int(ah * s))), Image.LANCZOS)
    h, w = im.height, im.width
    y0, x0 = (CANVAS - h) // 2, (CANVAS - w) // 2
    rgb_full = np.ones((CANVAS, CANVAS, 3), np.float32)   # white outside the graphic's bounds
    a_full = np.zeros((CANVAS, CANVAS), np.float32)
    arr = to_np(im)                                        # H x W x 4, RGBA
    rgb_full[y0:y0 + h, x0:x0 + w] = arr[..., :3]
    a_full[y0:y0 + h, x0:x0 + w] = arr[..., 3]
    return rgb_full, a_full
