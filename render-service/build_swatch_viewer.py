"""Builds a single self-contained HTML page (swatch_viewer.html) embedding
every swatch chip as a base64 JPEG, with filters and a lightbox.

Rewritten 2026-07-30: colours are now real photos (engine/palette.py), no
synthetic recolouring or coating simulation — the old "coating vividness"
section is gone because there's no longer a synthetic coating to compare.

Run: python build_swatch_viewer.py  ->  swatch_viewer.html
"""
import base64
import io
import json
import os

from PIL import Image, ImageDraw

from engine.core import build_material, to_pil
from engine.palette import list_crystal_colors, STONE_MM, crystal_photo
from engine.refraction import render_printed

HERE = os.path.dirname(os.path.abspath(__file__))
CHIP = 240


def data_uri(im, quality=84):
    buf = io.BytesIO()
    im.convert("RGB").save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def material_chip(material, color_name, size=CHIP):
    sp = max(4.0, STONE_MM.get(material, 1.5) * (size / 18.0))
    path, pitch = crystal_photo(color_name, material)
    mat = build_material(sp / pitch, path, seed=hash((material, color_name)) % 1000)
    return to_pil(mat[:size, :size])


def hex_of(name):
    r, g, b = list_crystal_colors()[name]["rgb"]
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def test_glyph(size=300):
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


def build_items():
    items = []
    materials = list(STONE_MM.keys())
    colors = list(list_crystal_colors().keys())

    for material in materials:
        for color in colors:
            chip = material_chip(material, color)
            items.append({
                "section": "A", "material": material, "color": color,
                "label": f"{color} on {material}",
                "hex": hex_of(color),
                "src": data_uri(chip),
            })

    glyph = test_glyph()
    px_per_mm = 1000 / 80.0
    for material in materials:
        im = render_printed(glyph.convert("RGB"), material, "White", px_per_mm)
        im = im.resize((CHIP, CHIP), Image.LANCZOS)
        items.append({
            "section": "C", "material": material, "color": "White (printed graphic)",
            "label": f"Graphic beneath {material}",
            "hex": "#c9c9c9",
            "src": data_uri(im),
        })

    return items


if __name__ == "__main__":
    items = build_items()
    print(f"built {len(items)} chips")
    template_path = os.path.join(HERE, "swatch_viewer_template.html")
    with open(template_path) as f:
        template = f.read()
    out = template.replace("__SWATCH_DATA__", json.dumps(items))
    out_path = os.path.join(HERE, "swatch_viewer.html")
    with open(out_path, "w") as f:
        f.write(out)
    print(f"wrote {out_path} ({os.path.getsize(out_path) / 1e6:.1f} MB)")
