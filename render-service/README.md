# Customizer Render Service (Fly.io)

Server-side Python that renders the crystal customizer preview. The browser never
runs this — the React portal (via a Netlify edge proxy) POSTs the customer's
selections and gets a PNG back. Deterministic numpy/PIL, no generative AI.

Design: `../Corp_Gift_Customizer_Spec.md` · Plan: `../Customizer_Build_Plan.md`

## Layout
```
app.py              FastAPI: POST /render, GET /health, GET /admin + /swatches* (swatch library)
admin.html           the /admin page itself — upload, crop, live-preview, save a colour swatch
engine/
  __init__.py       render(logo, mode, crystal_type, panel_mm, fg, bg) -> PIL image
  core.py           shared math + crystal material (feathered tiling, masks)
  palette.py        crystal colour registry (real photos, see below) + crystal type -> stone mm
  stones.py         Mode B — crystal zone map (logo made of crystals)
  refraction.py     Mode A — printed graphic under transparent crystal
  materials/        TYPE swatches (fabric_1.0 / fine_rock_1.5 / rock_2.0) — git-tracked, stone SIZE reference
  materials/colors/ COLOUR swatches + registry.json — see "Swatch library" below
swatch_gallery.py · build_swatch_viewer.py   contact-sheet / interactive HTML QA tools, run after any swatch change
requirements.txt · Dockerfile · fly.toml
```

## Run locally
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
ADMIN_PASSWORD=devpass uvicorn app:app --reload --port 8080
# then:
curl -s -X POST localhost:8080/render \
  -H 'Content-Type: application/json' \
  -d "{\"mode\":\"zone_map\",\"crystal_type\":\"fine_rock_1.5\",\"fg_color\":\"Jet\",\"bg_color\":\"White\",\"logo_png_b64\":\"$(base64 -i ../customizer-poc/swatches/butterfly_icon.png)\"}" \
  -o preview.png
```
`test_local.py` renders a sample without the server (quick sanity check):
```
python test_local.py            # writes test_zone_map.png + test_printed.png
```

## Request contract — `POST /render`
```jsonc
{
  "mode": "zone_map",              // zone_map (Mode B) | printed (Mode A)
  "crystal_type": "fine_rock_1.5", // fabric_1.0 | fine_rock_1.5 | rock_2.0 — stone SIZE
  "panel_mm": 80,                  // real crystal-area width -> stone px scale
  "fg_color": "Jet",               // colour names — see GET /swatches, or engine/materials/colors/registry.json
  "bg_color": "White",
  "message": "",
  "logo_png_b64": "..."            // transparent PNG (bg removed client-side), base64
}
```
Response: `image/png`. An unrecognised `fg_color`/`bg_color` is a 500, not a
silent fallback — see the "Unknown crystal colour" `ValueError` in
`palette.py` if you're wondering why (a stale colour name once fell back to
Jet silently and rendered an all-black canvas with no error at all).

## Swatch library (`/admin`)

Every crystal colour is a real cropped photo, not a hue-recoloured generic
material — see `engine/palette.py`'s module docstring for why that matters
(a recolour can shift hue but can't reproduce a different colour's actual
sparkle density/facet character). `/admin` is the tool for managing that
photo library without a code deploy:

- Upload a photo, drag a crop box over a clean flat patch, adjust the stone-pitch
  slider — the preview panel shows the ACTUAL tiled render at that pitch, live,
  so you're judging the real result instead of guessing.
- Save to add a new colour or replace an existing one's photo/pitch.
- Takes effect on the very next render — `palette.py` reloads `registry.json`
  whenever its mtime changes, not just at process start.

Gated by HTTP Basic auth (`username: admin`, password = `ADMIN_PASSWORD`). The
tool is disabled entirely (returns 500) if `ADMIN_PASSWORD` isn't set — a
swatch library with no password on a public URL is a real tampering surface.

**Where the data lives** depends on `SWATCH_DATA_DIR`:
- unset (local dev) → edits go straight into this repo's own
  `engine/materials/colors/` — you'll see them in `git status`, which is
  expected, not a bug.
- set (Fly.io prod, `/data`) → a mounted persistent Volume, seeded once from
  the git-committed swatches on first boot. **Without the volume, every
  deploy silently rolls back any admin edits** — see fly.toml's header
  comment for the one-time `fly volumes create` step.

After adding/editing swatches, re-run the QA tools to sanity-check the whole
library at a glance:
```
python swatch_gallery.py        # swatch_gallery.png contact sheet
python build_swatch_viewer.py   # swatch_viewer.html — filterable, zoomable
```

## Deploy to Fly.io
```
# one-time
fly launch --no-deploy
fly volumes create swatch_data --region nrt --size 1
fly secrets set RENDER_TOKEN=$(openssl rand -hex 24)
fly secrets set ADMIN_PASSWORD=<a real password>

# each deploy
fly deploy

fly logs                          # watch
curl https://<app>.fly.dev/health
```
Scale-to-zero is on (`min_machines_running = 0`) — near-zero cost when idle, a
few-second cold start on the first request after idle.

## Auth
- `/render`: if `RENDER_TOKEN` is set, requests need a matching
  `X-Render-Token` header (added server-side by the Netlify edge proxy).
  Unset locally = open.
- `/admin`, `/swatches*`: HTTP Basic, gated by `ADMIN_PASSWORD` (see above).

## Status
Phase 1 — wired into the customer portal (`/customize/:productId`). Crystal
colours are now real photographed swatches (2026-07-30), managed via
`/admin`. Mode A (printed-graphic) veiling fidelity is still a Phase-2 item
(spec §14.11).
