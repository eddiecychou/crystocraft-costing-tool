"""Swatch library — every material-type x colour combination, rendered from
real photos (no synthetic recolouring — see engine/palette.py), laid out as
one inspectable contact sheet.

Rewritten 2026-07-30: dropped the old "coating vividness, light vs dark
neighbour" section entirely — that simulated iridescence on a recoloured
generic photo, which no longer exists now that every colour is its own real
photo. Two sections now:
  A. Material type x Colour — every real colour, every stone-size type.
  C. Graphic beneath crystal (Mode A) — which material to use per product.

Run: python swatch_gallery.py   ->  swatch_gallery.png (+ swatch_gallery/*.png
                                     for full-res individual chips)
"""
import os
from PIL import Image, ImageDraw, ImageFont

from engine.core import build_material, to_pil
from engine.palette import list_crystal_colors, STONE_MM, crystal_photo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "swatch_gallery")
os.makedirs(OUT_DIR, exist_ok=True)

CHIP = 220
LABEL_H = 26
PAD = 10


def _font(size):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
    except Exception:
        return ImageFont.load_default()


F_LABEL = _font(13)
F_HEAD = _font(17)


def material_chip(material, color_name, size=CHIP, save_as=None):
    """A flat tile of one real colour photo, scaled to `material`'s stone
    size, using that material's fabric/rock style override if captured."""
    sp = max(4.0, STONE_MM.get(material, 1.5) * (size / 18.0))
    path, pitch = crystal_photo(color_name, material)
    mat = build_material(sp / pitch, path, seed=hash((material, color_name)) % 1000)
    im = to_pil(mat[:size, :size])
    if save_as:
        im.save(os.path.join(OUT_DIR, save_as))
    return im


def labeled(im, text, w=None, font=F_LABEL):
    w = w or im.width
    canvas = Image.new("RGB", (w, im.height + LABEL_H), "white")
    canvas.paste(im, ((w - im.width) // 2, 0))
    d = ImageDraw.Draw(canvas)
    tw = d.textlength(text, font=font)
    d.text(((w - tw) / 2, im.height + 5), text, fill="black", font=font)
    return canvas


def section_header(w, text):
    im = Image.new("RGB", (w, 34), "white")
    d = ImageDraw.Draw(im)
    d.text((0, 6), text, fill="black", font=F_HEAD)
    return im


def hstack(images, pad=PAD):
    h = max(im.height for im in images)
    w = sum(im.width for im in images) + pad * (len(images) - 1)
    canvas = Image.new("RGB", (w, h), "white")
    x = 0
    for im in images:
        canvas.paste(im, (x, 0))
        x += im.width + pad
    return canvas


def vstack(images, pad=PAD):
    w = max(im.width for im in images)
    h = sum(im.height for im in images) + pad * (len(images) - 1)
    canvas = Image.new("RGB", (w, h), "white")
    y = 0
    for im in images:
        canvas.paste(im, (0, y))
        y += im.height + pad
    return canvas


def build_section_a():
    materials = list(STONE_MM.keys())
    colors = list(list_crystal_colors().keys())
    header = hstack([Image.new("RGB", (CHIP, LABEL_H), "white")] +
                     [labeled(Image.new("RGB", (CHIP, 0), "white"), c, w=CHIP) for c in colors])
    rows = []
    for material in materials:
        cells = [labeled(Image.new("RGB", (CHIP, LABEL_H), "white"), material, w=CHIP, font=F_HEAD)]
        for color in colors:
            chip = material_chip(material, color, save_as=f"A_{material}_{color}.png")
            cells.append(labeled(chip, "", w=CHIP))
        rows.append(hstack(cells))
    return vstack([section_header(header.width, "A. Material type x Colour (real photos, no recolouring)")] + rows)


def _test_glyph(size=300):
    im = Image.new("L", (size, size), 255)
    d = ImageDraw.Draw(im)
    n = 6
    step = size // n
    for i in range(n):
        for j in range(n):
            if (i + j) % 2 == 0:
                d.rectangle([i * step, j * step, (i + 1) * step, (j + 1) * step], fill=0)
    d.ellipse([size * 0.3, size * 0.3, size * 0.7, size * 0.7], fill=128)
    return im


def build_section_c():
    from engine.refraction import render_printed
    glyph = _test_glyph()
    px_per_mm = 1000 / 80.0
    cells = []
    for material in STONE_MM.keys():
        im = render_printed(glyph.convert("RGB"), material, "White", px_per_mm)
        im = im.resize((CHIP * 2, CHIP * 2))
        im.save(os.path.join(OUT_DIR, f"C_printed_{material}.png"))
        cells.append(labeled(im, f"graphic under {material}", w=im.width, font=F_HEAD))
    row = hstack(cells)
    return vstack([section_header(row.width, "C. Graphic beneath crystal (Mode A) — which material to use per product")] + [row])


if __name__ == "__main__":
    a = build_section_a()
    c = build_section_c()
    full = vstack([a, c], pad=30)
    full.save(os.path.join(HERE, "swatch_gallery.png"))
    print(f"wrote swatch_gallery.png ({full.width}x{full.height}) and {OUT_DIR}/*.png individual chips")
