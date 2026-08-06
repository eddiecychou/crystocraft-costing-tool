"""Mode A — printed GRAPHIC under transparent crystal (seen through it).

Each crystal is a tiny lens: the underlying graphic is refracted (facet-gradient
displacement + chromatic dispersion) and blurred, more for bigger stones. Then
the crystal's transmission + sparkle go on top. Spec §14.7.

Rewritten 2026-08-06 (owner, second pass) after two real bugs surfaced:

1. The graphic itself IS the backfilm. There is no separate backfilm photo to
   pick — a customer uploads their own printed artwork and it sits directly
   under the crystal, at whatever colour it actually is. The prior version
   reduced the upload to a black-ink SILHOUETTE (design_mask_from_image) and
   recomposited it onto a flat colour sampled from a backfilm photo — correct
   for a plain logo, wrong for "printed graphics" (photographic/multi-colour
   artwork), which is what this mode is actually for. Now the uploaded
   image's own RGB (design_rgba_from_image, alpha-composited onto white) is
   what gets refracted — full colour survives.
2. `top_color` used to require a photo of that EXACT crystal colour captured
   against the exact backfilm chosen — and since only Crystal AB had many
   backfilms captured, every other colour threw. There's no backfilm axis to
   match against anymore (see #1), so `crystal_photo(top_color, crystal_type,
   backfilm=None)` takes whichever real photo was captured for that colour —
   every registered colour with a photo for this crystal_type's style works.

`top_color` is still the CRYSTAL layer itself (Crystal AB, Hematite, Bermuda
Blue, ...) — its own real photographed material drives both the refraction
distortion and the sparkle/transmission look.
"""
import numpy as np

from .core import (build_material, luminance,
                   pil_blur, to_pil, design_rgba_from_image)
from .palette import crystal_photo, stone_mm, DEFAULT_FG


def _refract(G, material, blur_px, refract_px):
    Gb = pil_blur(G, blur_px)
    L = pil_blur(luminance(material)[..., None], 1.0)[..., 0]
    gy, gx = np.gradient(L)
    H, W = L.shape
    ys, xs = np.mgrid[0:H, 0:W]
    out = np.empty_like(Gb)
    for c, disp in zip(range(3), (1.15, 1.0, 0.85)):     # chromatic dispersion
        sx = np.clip(xs + gx * refract_px * disp, 0, W - 1).astype(np.int32)
        sy = np.clip(ys + gy * refract_px * disp, 0, H - 1).astype(np.int32)
        out[..., c] = Gb[sy, sx, c]
    return out


def render_printed(logo_img, crystal_type, px_per_mm, top_color=DEFAULT_FG):
    """View the uploaded graphic through a transparent CRYSTAL layer
    (top_color), using that colour's own real photo as both the refracting
    material and the sparkle/transmission source. Returns a PIL image."""
    sp = max(4.0, stone_mm(crystal_type) * px_per_mm)

    top_path, top_pitch = crystal_photo(top_color, crystal_type, backfilm=None)
    mat = build_material(sp / top_pitch, seed=5, path=top_path)

    # The graphic IS the backfilm now — its own colour, alpha-composited onto
    # white (most uploads are transparent-background PNGs; opaque uploads are
    # unaffected since alpha=1 everywhere already).
    rgb, alpha = design_rgba_from_image(logo_img, frac=0.80)
    G = rgb * alpha[..., None] + np.ones_like(rgb) * (1 - alpha[..., None])
    Gr = _refract(G, mat, blur_px=sp * 0.13, refract_px=sp * 5.5)

    # Redesigned 2026-08-07 (owner, third pass): the previous version derived
    # colour from `Gr` (the refracted GRAPHIC) everywhere, with the crystal
    # material contributing only a grey luminance-based transmission factor
    # plus a sparse "sparkle" highlight mask. Two owner reports traced to that
    # same structural choice: (1) still "kind of dark" overall — a luminance
    # multiplier can only ever dim, never brighten past the graphic's own
    # colour; (2) "the AB effect is gone... your rendering only considers
    # transparent, not the crystal AB facets colours that occur randomly" —
    # correct: the material's own per-facet colour variation was discarded
    # everywhere except the rare bright-highlight fraction the sparkle mask
    # selected, and a photographed AB crystal's iridescence is NOT confined
    # to bright specular points (measured: saturation is often HIGHER in
    # its dark/mid-tones than at its brightest pixels — see git history).
    #
    # The reference is `engine/stones.py`'s Mode B, which has never had this
    # problem: it just tiles the real material photo directly, no luminance
    # dimming at all, and looks right. Mode A does the analogous thing now —
    # the material photo IS the base look, brightened for a punchy panel
    # rather than left at the raw photo's own (often dim) exposure — and
    # blends toward the refracted graphic only where the upload actually has
    # opaque ink (alpha), so a transparent-background upload still shows the
    # crystal's true random per-facet colour on its "no logo" margin instead
    # of a flat grey. Tuned against the real Crystal AB fabric AND rock
    # photos with both a dark- and light-background test graphic — verified
    # in PROJECT-PLAN.md.
    mat_b = np.clip(mat * 1.9, 0, 1)
    a3 = alpha[..., None]
    out = mat_b * (1 - a3 * 0.45) + Gr * (a3 * 0.45)
    return to_pil(np.clip(out, 0, 1))
