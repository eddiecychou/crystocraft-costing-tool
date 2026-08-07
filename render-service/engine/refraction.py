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

from .core import (build_material, luminance, boost_ab_flecks,
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

    # The graphic IS the backfilm — its own colour, alpha-composited onto
    # white (most uploads are transparent-background PNGs; opaque uploads are
    # unaffected since alpha=1 everywhere already). Lower blur/refraction than
    # before keeps the printed graphic SHARP — the real product's print reads
    # crisp under the crystal, not smeared (owner, 2026-08-07: "the actual
    # object is bright and clean and sharp").
    rgb, alpha = design_rgba_from_image(logo_img, frac=0.80)
    G = rgb * alpha[..., None] + np.ones_like(rgb) * (1 - alpha[..., None])
    Gr = _refract(G, mat, blur_px=sp * 0.10, refract_px=sp * 3.0)

    # Rewritten 2026-08-07 (owner, fourth pass) against a REAL photo of the
    # finished product (a bright white AB-crystal MagSafe card): it is bright,
    # clean, and sharp — a vivid printed graphic seen THROUGH clear crystal,
    # its white areas bright white with occasional random rainbow flecks, NOT
    # a dark tinted overlay. Two prior attempts each fixed one half and broke
    # the other:
    #   - deriving colour from the crystal photo everywhere + defaulting to
    #     the Black-backfilm capture (to make AB colour visible) turned the
    #     whole panel dark/blurred — wrong base look entirely;
    #   - the White-backfilm capture is the right bright base, but its AB
    #     colour is faint, so a naive blend lost the iridescence the owner
    #     wanted back.
    # This version keeps the GRAPHIC as the base (bright, sharp, full colour),
    # applies the crystal photo only as (a) a stone TEXTURE multiplier centred
    # on 1.0 — light/dark facet shading that darkens nothing overall — and
    # (b) real AB colour FLECKS screen-added only where the photo already has
    # meaningful chroma (a ramp on |chroma|), so white/grey stone stays white
    # and contributes brightness, while the genuine coloured flecks pop.
    # `top_color`'s White-backfilm photo (palette.py's default) is correct
    # again — no Black-backfilm swap needed. Tuned against the real Crystal
    # AB fabric AND rock White photos with the owner's own graphic.
    L = luminance(mat)
    tex = (1.0 + (L / (L.mean() + 1e-6) - 1.0) * 0.9)[..., None]   # facet shading, mean≈1
    base = np.clip(Gr * tex, 0, 1)
    out = boost_ab_flecks(base, source=mat)                       # AB colour flecks from the crystal
    return to_pil(np.clip(out, 0, 1))
