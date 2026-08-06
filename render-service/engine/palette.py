"""Crystal colours and types.

Schema rewritten 2026-07-30 (second pass) per the owner: backfilm is NOT a
separate flat colour composited onto a crystal photo by formula. "Crystal AB
on white backfilm" and "Crystal AB on black backfilm" are each a REAL,
separately photographed swatch — the crystal is translucent enough that the
backing genuinely changes what you see, not just its tint (confirmed against
the owner's own reference photos: same AB crystal, white vs. black backing,
visibly different sparkle character, not a recolour of each other). So a
crystal colour's photo isn't keyed by style (fabric/rock) alone — it's keyed
by (style, backfilm name), and every real combination the business uses needs
its own capture. There is no math that fakes a missing combination; capture
it in /admin or the render raises (same fail-loud rule as everywhere else in
this module).

registry.json shape:
    {
      "crystal": {
        "AB": {
          "rgb": [r, g, b],                 # nominal swatch-dot colour, not render input
          "fabric": { "White": {file, pitch}, "Black": {file, pitch}, ... },
          "rock":   { "White": {file, pitch}, ... }
        }
      }
    }

fine_rock_1.5 and rock_2.0 share the "rock" slot (owner: "Fine Rock is the
same as Rock except 1.5mm vs 2.0mm" — same cut, different size); fabric_1.0
always uses "fabric", a genuinely different cut/mix.

Mode B (stones.py, two crystal-colour zones, no printed graphic) doesn't
involve a backfilm choice at all — it calls crystal_photo() without one, which
picks whichever backfilm variant happens to be captured (fail-loud if none
is). Mode A (refraction.py, a graphic viewed through crystal) DOES care —
the backfilm the graphic sits on is the whole point of the effect — so it
always passes the specific backfilm name through.

The registry lives in registry.json, not a hardcoded dict — see the admin
tool (app.py's /admin routes). Reloaded on every access (see _registry())
rather than cached at import time, so an admin edit takes effect on the very
next render, not the next restart. Where registry.json itself lives depends
on SWATCH_DATA_DIR — see fly.toml / README.md for the Fly.io volume that
makes edits durable across deploys.
"""
import json
import os
import shutil

_HERE = os.path.dirname(__file__)
MATERIALS_DIR = os.path.join(_HERE, "materials")           # legacy TYPE reference photos — unused by the render path now, kept for history
_SEED_COLORS_DIR = os.path.join(MATERIALS_DIR, "colors")   # the git-committed starting set


def _seeded_colors_dir():
    data_dir = os.environ.get("SWATCH_DATA_DIR", "")
    if not data_dir:
        return _SEED_COLORS_DIR
    target = os.path.join(data_dir, "colors")
    if not os.path.exists(os.path.join(target, "registry.json")):
        os.makedirs(target, exist_ok=True)
        for fn in os.listdir(_SEED_COLORS_DIR):
            shutil.copy2(os.path.join(_SEED_COLORS_DIR, fn), os.path.join(target, fn))
    return target


COLORS_DIR = _seeded_colors_dir()
REGISTRY_PATH = os.path.join(COLORS_DIR, "registry.json")

DEFAULT_FG = "Jet"
DEFAULT_BG = "White"          # a BACKFILM NAME now (Mode A default), not a crystal colour

# crystal type -> (stone diameter in mm, which slot it reads). fine_rock_1.5
# and rock_2.0 deliberately share "rock" — see module docstring.
STONE_TYPES = {
    "fabric_1.0":    {"mm": 1.0, "style": "fabric"},
    "fine_rock_1.5": {"mm": 1.5, "style": "rock"},
    "rock_2.0":      {"mm": 2.0, "style": "rock"},
}
DEFAULT_TYPE = "fine_rock_1.5"
STONE_MM = {k: v["mm"] for k, v in STONE_TYPES.items()}   # back-compat for direct STONE_MM.get(type) callers

_UNSPECIFIED_BACKFILM = "Unspecified"   # migration bucket only — see _migrate()

_cache = {"mtime": None, "data": None}


def _migrate(data):
    """Three generations, all in-memory only (caller decides whether to
    persist):
      1. pre-2026-07-30 flat {name: {file,rgb,pitch}}
      2. same-day generic/fabric/rock, one photo per style (no backfilm axis)
      3. current: fabric/rock each hold {backfilm_name: {file,pitch}}
    Generations 1-2 had exactly one real photo per style with no recorded
    backfilm, so they migrate into a single "Unspecified" bucket — honest
    about not knowing what backing was actually in that photo, rather than
    guessing "White"."""
    if "crystal" not in data and "film" not in data:
        crystal = {}
        for name, e in data.items():
            if {"file", "rgb", "pitch"}.issubset(e.keys()):
                slot = {"file": e["file"], "pitch": e["pitch"]}
                crystal[name] = {"rgb": e["rgb"], "fabric": {_UNSPECIFIED_BACKFILM: slot}, "rock": {_UNSPECIFIED_BACKFILM: slot}}
        return {"crystal": crystal}

    crystal = {}
    for name, e in data.get("crystal", {}).items():
        rgb = e.get("rgb", [0.5, 0.5, 0.5])
        out = {"rgb": rgb}
        for style in ("fabric", "rock"):
            slot = e.get(style) or (e.get("generic") if style == "fabric" else None)
            if not slot:
                out[style] = {}
            elif "file" in slot:
                # generation 2: one flat slot, no backfilm axis
                out[style] = {_UNSPECIFIED_BACKFILM: slot}
            else:
                # already generation 3: {backfilm_name: {file, pitch}, ...}
                out[style] = slot
        crystal[name] = out
    return {"crystal": crystal}


def _registry():
    """Reloaded whenever registry.json changes on disk (checked by mtime, not
    re-read every call — this function runs on every render)."""
    mtime = os.path.getmtime(REGISTRY_PATH)
    if _cache["mtime"] != mtime:
        with open(REGISTRY_PATH) as f:
            raw = json.load(f)
        _cache["data"] = _migrate(raw)
        _cache["mtime"] = mtime
    return _cache["data"]


def list_crystal_colors():
    return _registry()["crystal"]


def _crystal_entry(name):
    reg = list_crystal_colors()
    if name not in reg:
        # Deliberately NOT a silent fallback to a default colour — a stale
        # name once fell back to Jet silently and rendered an all-black
        # canvas with no error at all.
        raise ValueError(f"Unknown crystal colour {name!r} — must be one of {sorted(reg)}")
    return reg[name]


def color_rgb(name):
    """Crystal colour's nominal approximate RGB (swatch-dot display, Mode A's
    ink colour) — NOT used as a render input for the crystal material itself,
    that always comes from a real photo via crystal_photo()."""
    return tuple(_crystal_entry(name)["rgb"])


def list_backfilms(name, crystal_type=DEFAULT_TYPE):
    """Backfilm names actually captured for this colour at this crystal_type's
    style — what the admin/customer UI should offer, not a fixed global list
    (different colours can have different backfilms captured)."""
    e = _crystal_entry(name)
    style = STONE_TYPES.get(crystal_type, STONE_TYPES[DEFAULT_TYPE])["style"]
    return sorted((e.get(style) or {}).keys())


def crystal_photo(name, crystal_type, backfilm=None):
    """(path, pitch) for this colour at this crystal_type's style (fabric or
    rock), against a specific backfilm. Two real callers:
      - Mode B (stones.py) doesn't care which backfilm — no graphic sits
        behind these zones — so it calls with backfilm=None and gets a
        representative captured photo (see the Black/White preference
        below), not a chosen one.
      - Mode A (refraction.py) always passes backfilm=None too now (the
        uploaded graphic itself is the backfilm — see its module docstring)
        — same representative-photo path as Mode B.
    Raises if that exact (style, backfilm) was never captured — no synthetic
    substitute, ever."""
    e = _crystal_entry(name)
    style = STONE_TYPES.get(crystal_type, STONE_TYPES[DEFAULT_TYPE])["style"]
    slots = e.get(style) or {}
    if not slots:
        raise ValueError(f"{name!r} has no {style} photo captured yet — add one in /admin")
    if backfilm is None:
        # A colour's AB/iridescent character reads far more vividly against
        # a dark backing than a white one — same stones, same coating, but
        # white backfilm reflects enough ambient light to wash the rainbow
        # out (confirmed 2026-08-06 against real captures: Crystal AB on
        # White read as near-colourless "clear crystal"; the same colour on
        # Black showed strong teal/gold/purple shimmer). Since backfilm=None
        # means "just show this crystal's own real character" — not a
        # specific customer-chosen backing — Black is the more honest
        # representative photo whenever it exists. Falls back to White, then
        # to whatever else was captured, rather than an arbitrary dict order.
        slot = slots.get('Black') or slots.get('White') or next(iter(slots.values()))
    else:
        slot = slots.get(backfilm)
        if not slot:
            raise ValueError(
                f"{name!r} has no {style} photo captured against backfilm {backfilm!r} — "
                f"captured backfilms for this colour: {sorted(slots)}. Add one in /admin."
            )
    return os.path.join(COLORS_DIR, slot["file"]), slot["pitch"]


def stone_mm(crystal_type):
    return STONE_TYPES.get(crystal_type, STONE_TYPES[DEFAULT_TYPE])["mm"]
