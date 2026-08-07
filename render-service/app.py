"""Crystal customizer render service (Fly.io).

POST /render  -> returns an image/png preview of the customised crystal product.
GET  /health  -> liveness check.
GET  /admin   -> swatch-library admin tool (capture/crop/preview/save colours
                 without a code deploy — see engine/palette.py's registry.json).

Auth:
- /render: if RENDER_TOKEN is set, requests must send a matching
  `X-Render-Token` header (the Netlify edge proxy adds it). Unset in local
  dev, auth is skipped.
- /admin and /swatches*: HTTP Basic, gated by ADMIN_PASSWORD. If unset, the
  admin tool is disabled entirely (500) rather than left open — a swatch
  library with no password on a public Fly.io URL is a real content-tampering
  surface (anyone who finds the URL could overwrite what customers see).
"""
import base64
import io
import json
import os
import secrets

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Response, Depends, UploadFile, Form
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
from PIL import Image

import engine
from engine.core import build_material, to_pil
from engine.palette import list_crystal_colors, REGISTRY_PATH, COLORS_DIR

# Bump on every deploy that changes render behaviour — shown in /health and
# on the admin page header, so it's visible from the outside whether a given
# deploy actually landed (owner, 2026-08-06, after several redeploys in a
# row with no visible confirmation the new code was live).
app = FastAPI(title="Crystocraft Customizer Render", version="0.8.0")

RENDER_TOKEN = os.environ.get("RENDER_TOKEN", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
MAX_LOGO_BYTES = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

_basic = HTTPBasic()


def require_admin(creds: HTTPBasicCredentials = Depends(_basic)):
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=500, detail="Admin tool disabled: ADMIN_PASSWORD not set")
    ok_user = secrets.compare_digest(creds.username, "admin")
    ok_pass = secrets.compare_digest(creds.password, ADMIN_PASSWORD)
    if not (ok_user and ok_pass):
        raise HTTPException(status_code=401, detail="Bad credentials", headers={"WWW-Authenticate": "Basic"})
    return True


class RenderRequest(BaseModel):
    mode: str = Field("zone_map", description="zone_map (Mode B) | printed (Mode A)")
    crystal_type: str = "fine_rock_1.5"       # fabric_1.0 | fine_rock_1.5 | rock_2.0
    panel_mm: float = 80.0                     # real crystal-area width -> stone scale
    # fg_color/bg_color mean different things depending on `mode`: for
    # zone_map both are CRYSTAL colours (GET /swatches -> "crystal"); for
    # printed, fg_color is the transparent top CRYSTAL layer and bg_color is
    # the BACKFILM NAME it's photographed against (a real captured combo,
    # not a flat colour — see engine/refraction.py's module docstring).
    fg_color: str = "Jet"
    bg_color: str = "White"
    # zone_map only: the background's own stone size, independent of
    # crystal_type (which sizes the logo). Defaults to fabric_1.0 (matches
    # the prior hardcoded behaviour) when not given. Ignored in printed mode.
    bg_crystal_type: str = ""
    message: str = ""
    logo_png_b64: str = Field("", description="transparent PNG, base64 (data-URL prefix ok)")


def _decode_logo(b64: str) -> Image.Image:
    if not b64:
        raise HTTPException(status_code=400, detail="logo_png_b64 is required")
    if "," in b64[:64]:                        # tolerate a data-URL prefix
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="logo_png_b64 is not valid base64")
    if len(raw) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="logo too large")
    try:
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception:
        raise HTTPException(status_code=400, detail="logo is not a readable image")


@app.get("/health")
def health():
    return {"ok": True, "service": "customizer-render", "version": app.version}


@app.get("/palette")
def palette(x_render_token: str = Header(default="")):
    """The customer-facing colour palette, straight from the live registry —
    so the customizer UI never hard-codes a colour list that drifts out of
    sync with what's actually been photographed (that exact drift caused
    every render to 500 for colours the registry didn't have). Token-gated
    like /render (the Netlify edge proxy adds the header); returns, per
    crystal colour, its swatch-dot hex and the backfilm names captured for
    each style (fabric / rock). A colour is usable in zone_map for a given
    crystal type if that style's list is non-empty; in printed mode the
    style's list IS the choosable backfilms."""
    if RENDER_TOKEN and x_render_token != RENDER_TOKEN:
        raise HTTPException(status_code=401, detail="bad or missing X-Render-Token")
    out = []
    for name, e in list_crystal_colors().items():
        rgb = e.get("rgb", [0.5, 0.5, 0.5])
        hex_ = "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb)
        out.append({
            "name": name,
            "hex": hex_,
            "fabric": sorted((e.get("fabric") or {}).keys()),
            "rock": sorted((e.get("rock") or {}).keys()),
        })
    out.sort(key=lambda c: c["name"])
    return {"colors": out}


@app.post("/render")
def render(req: RenderRequest, x_render_token: str = Header(default="")):
    if RENDER_TOKEN and x_render_token != RENDER_TOKEN:
        raise HTTPException(status_code=401, detail="bad or missing X-Render-Token")

    logo = _decode_logo(req.logo_png_b64)
    try:
        img = engine.render(
            logo,
            mode=req.mode,
            crystal_type=req.crystal_type,
            panel_mm=req.panel_mm,
            fg_color=req.fg_color,
            bg_color=req.bg_color,
            message=req.message,
            bg_crystal_type=req.bg_crystal_type or None,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"render failed: {e}")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


# ── swatch-library admin ────────────────────────────────────────────────────

def _crop(im: Image.Image, cx: float, cy: float, cw: float, ch: float) -> Image.Image:
    x0, y0 = max(0, int(cx)), max(0, int(cy))
    x1, y1 = min(im.width, int(cx + cw)), min(im.height, int(cy + ch))
    if x1 - x0 < 8 or y1 - y0 < 8:
        raise HTTPException(status_code=400, detail="Crop region too small")
    return im.crop((x0, y0, x1, y1)).convert("RGB")


def _decode_upload(data: bytes) -> Image.Image:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    try:
        return Image.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(status_code=400, detail="Not a readable image")


@app.get("/admin", dependencies=[Depends(require_admin)])
def admin_page():
    path = os.path.join(os.path.dirname(__file__), "admin.html")
    with open(path) as f:
        return Response(content=f.read(), media_type="text/html")


@app.post("/admin/render-test", dependencies=[Depends(require_admin)])
async def admin_render_test(
    image: UploadFile,
    mode: str = Form("zone_map"),
    crystal_type: str = Form("fine_rock_1.5"),
    fg_color: str = Form("Jet"),
    bg_color: str = Form("White"),
    panel_mm: float = Form(80.0),
    bg_crystal_type: str = Form(""),
):
    """Runs the SAME engine.render() the live customer flow calls, straight
    from the admin tool — no product page, no customer login, no need to
    know the Netlify RENDER_TOKEN (this route is gated by ADMIN_PASSWORD
    instead, same as the rest of /admin). Exists so a bad colour/backfilm
    combo can be caught here, with the real error, before a customer hits
    it."""
    logo = _decode_upload(await image.read()).convert("RGBA")
    try:
        img = engine.render(
            logo, mode=mode, crystal_type=crystal_type,
            panel_mm=panel_mm, fg_color=fg_color, bg_color=bg_color,
            bg_crystal_type=bg_crystal_type or None,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"render failed: {e}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


def _crystal_out(name, e):
    slots = {}
    for style in ("fabric", "rock"):
        backfilms = e.get(style) or {}
        slots[style] = {
            bf: {**slot, "url": f"/swatches/image/{slot['file']}"}
            for bf, slot in backfilms.items()
        }
    return {"rgb": e["rgb"], "slots": slots}


@app.get("/swatches", dependencies=[Depends(require_admin)])
def swatches_list():
    return {
        "crystal": {name: _crystal_out(name, e) for name, e in list_crystal_colors().items()},
    }


@app.get("/swatches/backfilms", dependencies=[Depends(require_admin)])
def swatches_backfilms():
    """Every backfilm name captured anywhere in the registry — for the admin
    UI's autocomplete, so 'White' doesn't end up saved three different ways
    across colours. Not a managed entity of its own; just whatever's in use."""
    names = set()
    for e in list_crystal_colors().values():
        for style in ("fabric", "rock"):
            names.update((e.get(style) or {}).keys())
    return sorted(names)


@app.get("/swatches/image/{filename}", dependencies=[Depends(require_admin)])
def swatches_image(filename: str):
    # No path traversal: only serve a bare filename that's actually a
    # registered swatch photo slot, never an arbitrary path.
    known = set()
    for e in list_crystal_colors().values():
        for style in ("fabric", "rock"):
            for slot in (e.get(style) or {}).values():
                known.add(slot["file"])
    if filename not in known:
        raise HTTPException(status_code=404, detail="Not a registered swatch photo")
    path = os.path.join(COLORS_DIR, filename)
    with open(path, "rb") as f:
        return Response(content=f.read(), media_type="image/jpeg")


@app.post("/swatches/preview", dependencies=[Depends(require_admin)])
async def swatches_preview(
    image: UploadFile,
    crop_x: float = Form(...), crop_y: float = Form(...),
    crop_w: float = Form(...), crop_h: float = Form(...),
    pitch: float = Form(...),
    material: str = Form("fine_rock_1.5"),
    compare_name: str = Form(""),      # optional: another already-saved crystal to show alongside
    compare_style: str = Form(""),
    compare_backfilm: str = Form(""),
):
    """Crop + tile at the given pitch, exactly like a real render would, so
    the owner sees the ACTUAL result before saving — the crop-check-recrop
    cycle this whole tool exists to shortcut. If compare_* is given, shows it
    side-by-side with an already-saved REAL photo (e.g. the same colour's
    other backfilm) for consistency-checking — no synthetic compositing,
    both sides are real captures (see palette.py's 2026-07-30 rewrite: a
    backfilm is never faked by formula, only ever a real photo)."""
    from engine.palette import STONE_MM, crystal_photo as _crystal_photo

    src = _decode_upload(await image.read())
    crop = _crop(src, crop_x, crop_y, crop_w, crop_h)

    sp = max(4.0, STONE_MM.get(material, 1.5) * 12.0)  # ~80mm-panel scale, matches the app's default
    tmp_dir = "/tmp" if os.path.isdir("/tmp") else "."
    tmp_path = os.path.join(tmp_dir, f"_preview_{os.getpid()}.jpg")
    crop.save(tmp_path, format="JPEG", quality=92)
    try:
        mat = build_material(sp / max(pitch, 2.0), seed=3, path=tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    left = mat[:300, :300]

    if compare_name and compare_style and compare_backfilm:
        cmp_path, cmp_pitch = _crystal_photo(compare_name, material if compare_style == "fabric" else "rock_2.0", backfilm=compare_backfilm)
        cmp_mat = build_material(sp / max(cmp_pitch, 2.0), seed=3, path=cmp_path)
        right = cmp_mat[:300, :300]
        panel = to_pil(np.concatenate([left, np.ones((300, 6, 3), np.float32), right], axis=1))
    else:
        panel = to_pil(left)

    buf = io.BytesIO()
    panel.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


def _write_registry():
    # Compute the data BEFORE opening the file for writing: open(path, "w")
    # truncates immediately, and list_crystal_colors() goes through a cache
    # that reloads from disk whenever the file's mtime changes — including
    # from truncation. Building the dict inline inside json.dump()'s argument
    # list truncated the file first, THEN tried to re-read it (now empty) to
    # build the very data being written, corrupting registry.json to zero
    # bytes on every save. Found by actually testing a save end-to-end, not
    # just importing the module.
    data = {"crystal": list_crystal_colors()}
    with open(REGISTRY_PATH, "w") as f:
        json.dump(data, f, indent=2)


@app.post("/swatches/save", dependencies=[Depends(require_admin)])
async def swatches_save(
    name: str = Form(...),
    style: str = Form(...),                     # "fabric" | "rock" — no "generic"
    backfilm: str = Form(...),                   # e.g. "White", "Black" — the REAL backing this photo was shot against
    image: UploadFile = None,
    crop_x: float = Form(None), crop_y: float = Form(None),
    crop_w: float = Form(None), crop_h: float = Form(None),
    pitch: float = Form(None),
):
    """Adds/replaces one (style, backfilm) photo for a colour — a colour can
    have any number of backfilms captured per style, see palette.py. There is
    no film/flat-colour kind anymore: backfilm is always a real photo taken
    together with the crystal, never a separately maintained flat colour."""
    name = name.strip()
    backfilm = backfilm.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Colour name is required")
    if not backfilm:
        raise HTTPException(status_code=400, detail="Backfilm name is required — what is this crystal photographed against?")
    if style not in ("fabric", "rock"):
        raise HTTPException(status_code=400, detail="style must be 'fabric' or 'rock'")
    if pitch is None:
        raise HTTPException(status_code=400, detail="pitch is required")
    if image is None or not image.filename or None in (crop_x, crop_y, crop_w, crop_h):
        raise HTTPException(status_code=400, detail="An image and crop box are required")

    reg = list_crystal_colors()
    filename = f"{name.lower().replace(' ', '_')}_{style}_{backfilm.lower().replace(' ', '_')}.jpg"
    src = _decode_upload(await image.read())
    crop = _crop(src, crop_x, crop_y, crop_w, crop_h)
    crop.save(os.path.join(COLORS_DIR, filename), format="JPEG", quality=92)
    arr = np.asarray(crop).astype(np.float32) / 255.0
    rgb = [round(float(x), 3) for x in arr.reshape(-1, 3).mean(axis=0)]

    entry = reg.get(name) or {"rgb": rgb, "fabric": {}, "rock": {}}
    entry.setdefault("fabric", {})
    entry.setdefault("rock", {})
    entry[style][backfilm] = {"file": filename, "pitch": round(pitch, 1)}
    entry["rgb"] = rgb              # swatch-dot colour tracks whichever photo was captured most recently
    reg[name] = entry
    _write_registry()
    return {"name": name, "style": style, "backfilm": backfilm, **entry[style][backfilm], "url": f"/swatches/image/{filename}"}


@app.delete("/swatches/crystal/{name}", dependencies=[Depends(require_admin)])
def swatches_delete(name: str):
    reg = list_crystal_colors()
    if name not in reg:
        raise HTTPException(status_code=404, detail="No such colour")
    if len(reg) <= 1:
        raise HTTPException(status_code=400, detail="Can't delete the last crystal colour — the render engine needs at least one")
    del reg[name]
    _write_registry()
    return {"ok": True}


@app.delete("/swatches/crystal/{name}/{style}/{backfilm}", dependencies=[Depends(require_admin)])
def swatches_delete_photo(name: str, style: str, backfilm: str):
    """Remove one (style, backfilm) photo — NOT the same as deleting the
    whole colour. There's no fallback: after this, a render asking for this
    exact combo raises until a new photo is captured (palette.crystal_photo)."""
    reg = list_crystal_colors()
    if name not in reg:
        raise HTTPException(status_code=404, detail="No such colour")
    if style not in ("fabric", "rock"):
        raise HTTPException(status_code=400, detail="style must be 'fabric' or 'rock'")
    if backfilm not in (reg[name].get(style) or {}):
        raise HTTPException(status_code=404, detail="No such backfilm photo")
    del reg[name][style][backfilm]
    _write_registry()
    return {"ok": True}
