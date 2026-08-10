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

from .core import (build_material, luminance, apply_facet_relief,
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
    mat = build_material(sp, top_pitch, top_path, seed=5)

    # The graphic IS the backfilm — its own colour, alpha-composited onto
    # white (most uploads are transparent-background PNGs; opaque uploads are
    # unaffected since alpha=1 everywhere already). Lower blur/refraction than
    # before keeps the printed graphic SHARP — the real product's print reads
    # crisp under the crystal, not smeared (owner, 2026-08-07: "the actual
    # object is bright and clean and sharp").
    rgb, alpha = design_rgba_from_image(logo_img, frac=0.80)
    G = rgb * alpha[..., None] + np.ones_like(rgb) * (1 - alpha[..., None])
    Gr = _refract(G, mat, blur_px=sp * 0.10, refract_px=sp * 3.0)

    # Rewritten 2026-08-07 (owner, fourth+fifth pass) against real photos of
    # the finished product: bright, clean, sharp — a vivid printed graphic
    # seen THROUGH clear crystal with visible individual facets, NOT a dark
    # tinted overlay and NOT a flat colour wash. Keeps the GRAPHIC as the
    # base (bright, sharp, full colour); the crystal photo contributes
    # visible facet relief — see apply_facet_relief()'s docstring for why a
    # plain multiply wasn't enough. `top_color`'s White-backfilm photo
    # (palette.py's default) is the correct bright base; no Black-backfilm
    # swap needed.
    #
    # boost_ab_flecks() (real AB colour flecks screen-added from mat's own
    # chroma) disabled 2026-08-11 (owner: "everything except jet black is
    # off," and even real Crystal AB itself didn't look right with it).
    # Renders the real photographed material's relief directly instead —
    # revisit properly calibrated AB sparkle later, don't re-guess a
    # threshold.
    out = apply_facet_relief(Gr, mat)
    return to_pil(np.clip(out, 0, 1))
