# Customizer Render Service (Fly.io)

Server-side Python that renders the crystal customizer preview. The browser never
runs this — the React portal (via a Netlify edge proxy) POSTs the customer's
selections and gets a PNG back. Deterministic numpy/PIL, no generative AI.

Design: `../Corp_Gift_Customizer_Spec.md` · Plan: `../Customizer_Build_Plan.md`

## Layout
```
app.py              FastAPI: POST /render, GET /health
engine/
  __init__.py       render(logo, mode, crystal_type, panel_mm, fg, bg) -> PIL image
  core.py           shared math + crystal material (feathered tiling, colorize, masks)
  palette.py        crystal colour -> RGB, crystal type -> stone mm
  stones.py         Mode B — crystal zone map (logo made of crystals)
  refraction.py     Mode A — printed graphic under transparent crystal
  materials/crystal_rock.jpg   real swatch used as the material
requirements.txt · Dockerfile · fly.toml
```

## Run locally
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8080
# then:
curl -s -X POST localhost:8080/render \
  -H 'Content-Type: application/json' \
  -d "{\"mode\":\"zone_map\",\"crystal_type\":\"fine_rock_1.5\",\"fg_color\":\"Jet\",\"bg_color\":\"CrystalAB\",\"logo_png_b64\":\"$(base64 -i engine/materials/../../../customizer-poc/swatches/butterfly.png)\"}" \
  -o preview.png
```
`test_local.py` renders a sample without the server (quick sanity check):
```
python test_local.py            # writes test_zone_map.png + test_printed.png
```

## Request contract — `POST /render`
```jsonc
{
  "mode": "zone_map",            // zone_map (Mode B) | printed (Mode A)
  "crystal_type": "fine_rock_1.5", // fabric_1.0 | fine_rock_1.5 | rock_2.0
  "panel_mm": 50,                // real crystal-area width -> stone scale
  "fg_color": "Jet",             // palette names, see engine/palette.py
  "bg_color": "CrystalAB",
  "message": "",
  "logo_png_b64": "..."          // transparent PNG (bg removed client-side), base64
}
```
Response: `image/png`.

## Deploy to Fly.io
```
# one-time
fly launch --no-deploy            # creates the app from fly.toml (pick a free name)
fly secrets set RENDER_TOKEN=$(openssl rand -hex 24)   # shared secret

# each deploy
fly deploy

fly logs                          # watch
curl https://<app>.fly.dev/health
```
Scale-to-zero is on (`min_machines_running = 0`) — near-zero cost when idle, a
few-second cold start on the first request after idle.

## Auth
If `RENDER_TOKEN` is set, `/render` requires a matching `X-Render-Token` header
(added server-side by the Netlify edge proxy in Phase 1). Unset locally = open.

## Status
Phase 0 — the service only. Not wired into the app yet. Crystal iridescence
(AB/Moonlight) and Mode A veiling are Phase-2 fidelity items (spec §14.11).
