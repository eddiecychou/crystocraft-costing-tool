"""Crystal customizer render engine (deterministic, no AI).

render(params) -> PIL.Image. See ../app.py for the HTTP surface and
../../Corp_Gift_Customizer_Spec.md for the model.
"""
from .core import CANVAS
from .palette import DEFAULT_TYPE, DEFAULT_FG, DEFAULT_BG
from . import stones, refraction


def render(logo_img, mode="zone_map", crystal_type=DEFAULT_TYPE,
           panel_mm=50.0, fg_color=DEFAULT_FG, bg_color=DEFAULT_BG, message=""):
    """Dispatch to the requested render mode. `logo_img` is a PIL image."""
    px_per_mm = CANVAS / float(panel_mm or 50.0)
    if mode == "printed":
        return refraction.render_printed(logo_img, crystal_type, bg_color, px_per_mm)
    # default: Mode B zone map (crystals form the logo)
    return stones.render_zone_map(logo_img, crystal_type, fg_color, bg_color, px_per_mm)
