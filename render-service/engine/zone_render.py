"""Renders a template's user-drawn zones (engine/templates.py's `zones`,
built by admin.html's design canvas — workstream 2) as real crystal
texture, one material per zone, composited in list order (last zone drawn
on top — same convention the design canvas's own preview already uses).

This is the first thing that actually reads `zones` for anything besides
drawing a translucent preview shape. It does NOT warp onto the template's
SVG outline or paste onto the product photo — that's compositing
(workstream 5), a separate, later step. This produces the flat crystal
design layer alone, at the template's own real-mm scale, same
CANVAS-is-one-square-panel convention `panel_mm` already uses elsewhere
(engine/__init__.py) — so a template's zones render at the correct
relative stone size without inventing a second scale convention.

Each zone's ring set is rasterized with the same even-odd rule the design
canvas draws it with (a point's insideness toggles once per ring boundary
crossed) via XOR across rings — the ring geometry stored in templates.py
is authoritative; this only turns it into pixels.
"""
import numpy as np
from PIL import Image, ImageDraw

from .core import CANVAS, build_material, boost_ab_flecks, to_pil
from .palette import crystal_photo, stone_mm

_SUPERSAMPLE = 2  # rasterize at 2x then downsample — antialiases the hard-edged PIL polygon fill


def _ring_mask_px(points_px, size):
    im = Image.new("L", (size, size), 0)
    ImageDraw.Draw(im).polygon(points_px, fill=255)
    return (np.asarray(im).astype(np.float32) / 255.0)


def _zone_mask(rings, px_per_mm):
    """CANVAS x CANVAS x 1, antialiased, even-odd across rings — a hole ring
    subtracts, matching admin.html's ctx.fill('evenodd') exactly."""
    size = CANVAS * _SUPERSAMPLE
    accum = np.zeros((size, size), np.float32)
    for ring in rings:
        pts = [(p["x_mm"] * px_per_mm * _SUPERSAMPLE, p["y_mm"] * px_per_mm * _SUPERSAMPLE) for p in ring]
        if len(pts) < 3:
            continue
        m = _ring_mask_px(pts, size)
        accum = np.abs(accum - m)  # XOR for 0/1 masks == even-odd
    im = Image.fromarray((np.clip(accum, 0, 1) * 255).astype(np.uint8)).resize((CANVAS, CANVAS), Image.LANCZOS)
    return (np.asarray(im).astype(np.float32) / 255.0)[..., None]


def render_zone_layer(zones, width_mm):
    """zones: templates.py's saved shape, [{name, crystal_type, color,
    rings: [[{x_mm,y_mm}, ...], ...]}, ...]. Raises ValueError for an empty
    list, and whatever palette.crystal_photo() raises for a colour/type
    combo that was never actually photographed — same fail-loud rule as
    every other render path, no synthetic substitute."""
    if not zones:
        raise ValueError("No zones to render — draw at least one in the design canvas first")

    px_per_mm = CANVAS / float(width_mm)
    # White base: a zone list built the recommended way (using "Add
    # background zone") already covers the whole canvas, so this only
    # shows through as a bug-visibility aid if the zones don't actually
    # tile the full area — never silently invented crystal.
    canvas = np.ones((CANVAS, CANVAS, 3), np.float32)

    for zone in zones:
        mask = _zone_mask(zone["rings"], px_per_mm)
        sp = max(4.0, stone_mm(zone["crystal_type"]) * px_per_mm)
        path, pitch = crystal_photo(zone["color"], zone["crystal_type"])
        seed = abs(hash(zone["name"])) % 1000
        mat = build_material(sp / pitch, seed=seed, path=path)
        mat = boost_ab_flecks(mat)
        canvas = mat * mask + canvas * (1 - mask)

    return to_pil(np.clip(canvas, 0, 1))
