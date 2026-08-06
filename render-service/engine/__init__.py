"""Crystal customizer render engine (deterministic, no AI).

render(params) -> PIL.Image. See ../app.py for the HTTP surface and
../../Corp_Gift_Customizer_Spec.md for the model.
"""
from .core import CANVAS
from .palette import DEFAULT_TYPE, DEFAULT_FG, DEFAULT_BG
from . import stones, refraction


def render(logo_img, mode="zone_map", crystal_type=DEFAULT_TYPE,
           panel_mm=80.0, fg_color=DEFAULT_FG, bg_color=DEFAULT_BG, message="",
           bg_crystal_type=None):
    """Dispatch to the requested render mode. `logo_img` is a PIL image.

    fg_color/bg_color mean different things depending on `mode`: for
    zone_map both are CRYSTAL colours (palette.list_crystal_colors()); for
    printed, fg_color is the transparent top CRYSTAL layer and bg_color is
    the BACKFILM NAME it's photographed against (palette.list_backfilms()) —
    resolved to a real captured photo, never a synthesized colour. See
    refraction.py's module docstring.

    bg_crystal_type is zone_map-only: the logo and background can be
    different real stone SIZES (e.g. a Jet Fine Rock logo on a Crystal AB
    Fabric 1mm background) — defaults to fabric_1.0 when not given, matching
    the prior hardcoded behaviour. Ignored in printed mode, where the
    background is a backfilm photo, not an independently-sized crystal."""
    px_per_mm = CANVAS / float(panel_mm or 80.0)
    if mode == "printed":
        return refraction.render_printed(logo_img, crystal_type, bg_color, px_per_mm, top_color=fg_color)
    # default: Mode B zone map (crystals form the logo)
    return stones.render_zone_map(logo_img, crystal_type, fg_color, bg_color, px_per_mm,
                                   bg_crystal_type=bg_crystal_type or "fabric_1.0")
