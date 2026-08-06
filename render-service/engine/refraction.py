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

from .core import (CANVAS, build_material, luminance,
                   smoothstep, screen, pil_blur, to_pil, design_rgba_from_image)
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

    L = luminance(mat)
    lo, hi = np.percentile(L, 3), np.percentile(L, 99)
    Ln = np.clip((L - lo) / (hi - lo + 1e-6), 0, 1)
    # Retuned 2026-08-06 (owner: "crystal fabric is too opaque to show the
    # background, fine rock is okay"). Root cause: Crystal AB's fabric photo
    # is much brighter/lower-contrast than its rock photo (measured mean
    # luminance 0.86 vs 0.74, tightly clustered near-white) — the old
    # params (0.55 floor, sparkle from 0.64, glint*1.7) treated that near-
    # uniform brightness as sparkle almost everywhere, screening the graphic
    # to near-white. Lower floor + narrower/higher sparkle band + lower
    # glint gain means only genuinely bright specular points read as
    # sparkle, regardless of the material photo's own average brightness —
    # tuned against both a fabric_1.0 and a fine_rock_1.5 render of the same
    # graphic; the rock result got moderately richer/darker, not worse.
    trans = (0.20 + 0.80 * Ln)[..., None]                # transparent crystal passes the print
    base = np.clip(Gr * trans, 0, 1)
    sparkle = smoothstep(0.85, 0.995, L)[..., None]
    glint = np.clip(mat * 0.9, 0, 1)
    out = screen(base, glint * sparkle)
    return to_pil(np.clip(out, 0, 1))
