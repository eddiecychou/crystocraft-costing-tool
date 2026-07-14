"""Crystal customizer render service (Fly.io).

POST /render  -> returns an image/png preview of the customised crystal product.
GET  /health  -> liveness check.

Auth: if RENDER_TOKEN is set in the env, requests must send a matching
`X-Render-Token` header (the Netlify edge proxy adds it). If unset (local dev),
auth is skipped.
"""
import base64
import io
import os

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field
from PIL import Image

import engine

app = FastAPI(title="Crystocraft Customizer Render", version="0.1.0")

RENDER_TOKEN = os.environ.get("RENDER_TOKEN", "")
MAX_LOGO_BYTES = 8 * 1024 * 1024


class RenderRequest(BaseModel):
    mode: str = Field("zone_map", description="zone_map (Mode B) | printed (Mode A)")
    crystal_type: str = "fine_rock_1.5"       # fabric_1.0 | fine_rock_1.5 | rock_2.0
    panel_mm: float = 50.0                     # real crystal-area width -> stone scale
    fg_color: str = "Jet"
    bg_color: str = "CrystalAB"
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
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"render failed: {e}")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")
