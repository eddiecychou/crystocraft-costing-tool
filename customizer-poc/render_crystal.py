#!/usr/bin/env python3
"""
Crystal-fabric render proof-of-concept.

Digital twin of how the product is actually made:
  colour/graphic layer (the design)  ×  transparent-crystal MATERIAL layer.

The material (sparkle, facets, AO, AB rainbow glints) is captured ONCE from a
real product photo and reused. The design only decides which crystal COLOUR
goes where. No generative AI — deterministic and identical every run.
"""
import numpy as np
from PIL import Image

SW = "swatches/"
CANVAS = 1000

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

def build_material(scale, seed=7):
    """Tile the real crystal-rock photo to fill the canvas. `scale` controls
    apparent stone size: bigger scale = bigger stones (Crystal Rock 2mm),
    smaller = finer, denser stones (Crystal Fabric 1mm). Each tile gets a random
    flip + roll so there's no mirror/kaleidoscope repeat."""
    rng = np.random.default_rng(seed)
    tile_px = int(round(500 * scale))
    tile = load_rgb(SW + "CrystalRock_500x500.jpg", (tile_px, tile_px))
    reps = CANVAS // tile_px + 2
    def cell():
        t = tile
        if rng.random() < 0.5: t = t[:, ::-1]
        if rng.random() < 0.5: t = t[::-1, :]
        t = np.roll(t, int(rng.integers(0, tile_px)), axis=0)
        t = np.roll(t, int(rng.integers(0, tile_px)), axis=1)
        return t
    rows = [np.concatenate([cell() for _ in range(reps)], axis=1) for _ in range(reps)]
    grid = np.concatenate(rows, axis=0)
    return grid[:CANVAS, :CANVAS]

def colorize(material, target_rgb):
    """Recolour the crystal material to a target crystal colour while KEEPING its
    shading + sparkle. Dark crevices stay dark, lit facets take the colour, and
    bright glints keep the material's own rainbow (the AB effect)."""
    L = luminance(material)[..., None]
    T = np.array(target_rgb, np.float32)[None, None, :]
    # body: crevices ~0.30*T, lit stones up to ~1.45*T
    body = np.clip(T * (0.30 + 1.15 * L), 0, 1)
    # specular glints: bright points, tinted by the material's real chroma (AB).
    # Dark crystals (jet) glint dimmer than clear ones — scale by target lightness.
    t_lum = float(np.mean(target_rgb))
    glint_gain = 0.35 + 0.65 * t_lum
    sparkle = smoothstep(0.70, 0.96, luminance(material))[..., None]
    glint = np.clip(material * 1.5, 0, 1) * glint_gain   # keep rainbow flecks
    return np.clip(screen(body, glint * sparkle), 0, 1)

def load_mask(path, size):
    """Design foreground mask from a logo PNG (alpha, else darkness)."""
    im = Image.open(path)
    if "A" in im.getbands():
        a = np.asarray(im.split()[-1]).astype(np.float32) / 255.0
    else:
        g = np.asarray(im.convert("L")).astype(np.float32) / 255.0
        a = 1 - g                                  # dark ink = foreground
    m = Image.fromarray((a * 255).astype(np.uint8)).resize(size, Image.LANCZOS)
    return np.asarray(m).astype(np.float32) / 255.0

def place_mask(logo_path, canvas=CANVAS, pad=0.10):
    im = Image.open(logo_path)
    w, h = im.size
    inner = int(canvas * (1 - 2 * pad))
    s = inner / max(w, h)
    nw, nh = int(w * s), int(h * s)
    m = load_mask(logo_path, (nw, nh))
    full = np.zeros((canvas, canvas), np.float32)
    y0, x0 = (canvas - nh) // 2, (canvas - nw) // 2
    full[y0:y0 + nh, x0:x0 + nw] = m
    return full

# ── crystal colours (approx, from the swatch palette) ─────────────────────────
CLEAR_AB = (0.82, 0.83, 0.88)   # Crystal AB / clear-silver, bright
JET      = (0.05, 0.05, 0.075)  # Jet / Hematite, near-black

def render_two_tone(logo_path, fg=CLEAR_AB, bg=JET, scale=0.5):
    mat = build_material(scale)
    fg_img = colorize(mat, fg)
    bg_img = colorize(mat, bg)
    mask = place_mask(logo_path)[..., None]
    # slight sharpen of the mask edge so crystal fill reads crisply
    mask = smoothstep(0.35, 0.65, mask)
    out = fg_img * mask + bg_img * (1 - mask)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)

def save(arr, path):
    Image.fromarray(arr).save(path)
    print("wrote", path, arr.shape)

if __name__ == "__main__":
    # Hero: butterfly logo, clear/AB crystals on a jet-black crystal field
    # (mirrors the customer's zebra two-tone sample), FINE crystal (small stones).
    save(render_two_tone("swatches/butterfly.png", scale=0.42), "out_hero_fine.png")

    # Same design, COARSE Crystal Rock (2mm) — shows how stone size eats fine
    # detail. Honest resolution demonstration.
    save(render_two_tone("swatches/butterfly.png", scale=0.9), "out_rock_coarse.png")
