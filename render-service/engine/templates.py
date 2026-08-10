"""Product template registry — Phase: Product template library (see
Crystal_Fabric_Studio_Spec.md §5c). A template is the foundation the later
canvas/zone/composite workstreams build against: a straight-on product
photo, a single-closed-path SVG marking the crystal application area, and
the real-world millimetre size of that area.

Deliberately NOT stored alongside the swatch registry's `crystal` key in
registry.json — different lifecycle, different shape, and colours/templates
are edited independently. Own directory, own registry file, same
disk-backed-by-Fly-volume pattern as palette.py so an admin edit survives a
redeploy without a code change.

templates_registry.json shape:
    {
      "coaster-round-80": {
        "name": "Round Coaster 80mm",
        "photo_file": "coaster-round-80.jpg",
        "svg_file": "coaster-round-80.svg",
        "width_mm": 80.0,
        "height_mm": 80.0,
        "created_at": "2026-08-11T12:00:00"
      }
    }
"""
import json
import os
import re
import shutil
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.dirname(__file__))  # render-service/
_SEED_TEMPLATES_DIR = os.path.join(_HERE, "engine", "materials", "templates")


def _templates_dir():
    data_dir = os.environ.get("SWATCH_DATA_DIR", "")
    if not data_dir:
        os.makedirs(_SEED_TEMPLATES_DIR, exist_ok=True)
        return _SEED_TEMPLATES_DIR
    target = os.path.join(data_dir, "templates")
    os.makedirs(target, exist_ok=True)
    return target


TEMPLATES_DIR = _templates_dir()
REGISTRY_PATH = os.path.join(TEMPLATES_DIR, "templates_registry.json")

# id: lowercase, digits, hyphens only — used directly in file names and URLs.
_ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

_cache = {"mtime": None, "data": None}


def _load():
    if not os.path.exists(REGISTRY_PATH):
        return {}
    mtime = os.path.getmtime(REGISTRY_PATH)
    if _cache["mtime"] != mtime:
        with open(REGISTRY_PATH) as f:
            _cache["data"] = json.load(f)
        _cache["mtime"] = mtime
    return _cache["data"]


def _write(data):
    with open(REGISTRY_PATH, "w") as f:
        json.dump(data, f, indent=2)


def list_templates():
    return _load()


def get_template(template_id):
    reg = _load()
    if template_id not in reg:
        raise KeyError(f"Unknown template {template_id!r}")
    return reg[template_id]


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s


# First-cut constraint (Crystal_Fabric_Studio_Spec.md §5c workstream 4):
# "single closed path only." Rather than a full SVG geometry parse, this
# counts top-level drawable shape elements — path/polygon/polyline/rect/
# circle/ellipse — wherever they sit in the document (nested inside a
# <g>, common from Illustrator exports). More than one means either a
# compound shape or multiple disconnected areas, neither supported yet;
# reject with a clear message rather than silently using only the first one.
_SHAPE_TAGS = ("path", "polygon", "polyline", "rect", "circle", "ellipse")


def validate_single_path_svg(svg_text):
    tags_found = []
    for tag in _SHAPE_TAGS:
        tags_found += re.findall(rf"<(?:\w+:)?{tag}[\s/>]", svg_text)
    count = len(tags_found)
    if count == 0:
        raise ValueError("SVG has no path/polygon/rect/circle/ellipse shape — nothing to use as the crystal-area outline")
    if count > 1:
        raise ValueError(
            f"SVG has {count} separate shapes — this first cut only supports a single closed path per template. "
            "Combine them into one compound path, or split this into separate templates."
        )


def save_template(template_id, *, name, width_mm, height_mm, photo_bytes, photo_ext, svg_text):
    if not _ID_RE.match(template_id):
        raise ValueError("Template id must be lowercase letters, digits and hyphens only")
    validate_single_path_svg(svg_text)

    photo_file = f"{template_id}{photo_ext}"
    svg_file = f"{template_id}.svg"
    with open(os.path.join(TEMPLATES_DIR, photo_file), "wb") as f:
        f.write(photo_bytes)
    with open(os.path.join(TEMPLATES_DIR, svg_file), "w") as f:
        f.write(svg_text)

    reg = _load()
    reg[template_id] = {
        "name": name.strip(),
        "photo_file": photo_file,
        "svg_file": svg_file,
        "width_mm": round(float(width_mm), 1),
        "height_mm": round(float(height_mm), 1),
        "created_at": reg.get(template_id, {}).get("created_at") or datetime.now(timezone.utc).isoformat(),
    }
    _write(reg)
    return reg[template_id]


def delete_template(template_id):
    reg = _load()
    if template_id not in reg:
        raise KeyError(f"Unknown template {template_id!r}")
    entry = reg.pop(template_id)
    for fn in (entry.get("photo_file"), entry.get("svg_file")):
        if fn:
            try:
                os.remove(os.path.join(TEMPLATES_DIR, fn))
            except OSError:
                pass
    _write(reg)
