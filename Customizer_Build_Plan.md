# Customizer — Build Plan (for review, no app code yet)

Implementation plan for the customer-facing crystal customizer. Design rationale
is in `Corp_Gift_Customizer_Spec.md`; this doc is the **how/where to build it**.

**Decisions locked (owner):**
- Render engine runs **server-side in Python on Fly.io** (reuse the validated
  numpy/PIL engine; browser never runs it).
- **Plan approved before writing app code.**
- Entry from the **product page → dedicated `/customize/:productId` route**.
- MVP product = the **crystal-fabric custom panel** we've prototyped (Mode B zone
  map first; Mode A printed-graphic as a follow-up).

---

## 1. Architecture

```
Customer browser (React portal)
  │  1. build selections (crystal type, fg/bg colour, logo, message)
  │  2. POST inputs  ─────────────►  Netlify edge fn  /api/customizer-render
  │                                     │  (adds Fly secret, server-side only)
  │                                     ▼
  │                                  Fly.io Python render service  POST /render
  │                                     │  runs engine/ (ported render_stones etc.)
  │  ◄──── preview PNG ────────────────┘  returns image
  │  3. show preview
  │  4. Save  ──► customer_designs/{id} (Firestore) + renders/{uid}/{id}.png (Storage)
  │  5. Add to enquiry ──► existing enquiries flow (admin + email)
```

**Why the Netlify edge proxy:** keeps the Fly.io auth token off the client and
reuses the existing edge-function pattern. Browser → Netlify edge → Fly.io. The
edge fn just forwards the JSON and streams back the PNG (well within the 30s cap;
a render is ~1–3s).

**UX for the ~1–3s render:** an explicit **"Update preview"** button (not
render-on-every-keystroke) for the MVP — cheapest and clearest. Debounced
auto-update can come later. A spinner covers the wait.

---

## 2. Fly.io Python render service (new repo/folder `render-service/`)

Kept **separate** from the React app (its own deploy). Structure:

```
render-service/
  app.py            # FastAPI: POST /render, GET /health
  engine/
    __init__.py
    stones.py       # ported render_stones hybrid (Mode B zone map)
    refraction.py   # ported Mode A (printed graphic under crystal)
    palette.py      # crystal colour -> RGB + iridescence params
    materials/      # crystal swatch photos bundled in the image
  requirements.txt  # fastapi, uvicorn, numpy, pillow, python-multipart
  Dockerfile
  fly.toml          # app name, [http_service], auto_stop/auto_start = scale-to-zero
  README.md
```

**Endpoint contract** `POST /render`:
```jsonc
// request
{
  "template_id": "crystal_panel_v1",
  "mode": "zone_map",              // zone_map (B) | printed (A)
  "crystal_type": "fine_rock_1.5", // fabric_1.0 | fine_rock_1.5 | rock_2.0
  "panel_mm": 50,                  // real crystal-area width -> stone px scale
  "fg_color": "Jet",
  "bg_color": "CrystalAB",
  "message": "",
  "logo_png_b64": "..."           // transparent PNG (bg already removed client-side)
}
// response: image/png (the preview)
```

**Auth:** shared secret header (`X-Render-Token`) that only the Netlify edge fn
knows (Fly secret + Netlify env var). Reject anything else.

**Cost/perf:** `auto_stop_machines`/`auto_start_machines` = scale-to-zero, one
`shared-cpu-1x` machine. Idle = ~free; cold start a few seconds on first request.
Render itself is fast CPU numpy. Add a simple in-memory LRU on (inputs hash) so
re-rendering identical settings is instant.

**Phase 0 milestone:** deploy, `curl POST /render` with a test logo, get a PNG
back. No app wiring yet.

---

## 3. Firebase data model

**Firestore**
- `product_templates/{productId}` — customizer config:
  ```jsonc
  {
    "mode": "zone_map",
    "panel_mm": 50,
    "crystal_types": ["fabric_1.0","fine_rock_1.5","rock_2.0"],
    "palette": ["CrystalAB","Jet","Hematite","MetallicSilver","Moonlight"],
    "defaults": { "crystal_type": "fine_rock_1.5", "fg": "Jet", "bg": "CrystalAB" },
    "logo_area": { "x":.., "y":.., "w":.., "h":.. },   // where the logo sits
    "active": true
  }
  ```
  Corp `products/{id}` gains `customizable: true` + `template_id`.
- `customer_designs/{designId}` — `{ uid, customer_id, product_id, selections,
  render_url, enquiry_id, createdAt }`.

**Storage**
- `customer_uploads/{uid}/…` (uploaded logos), `renders/{uid}/…` (saved previews).
  (Crystal swatch materials live in the Fly image, not Storage.)

**Security rules (need the usual manual console paste):**
- `product_templates` — read: approved customer or admin; write: admin.
- `customer_designs/{id}` — read/write: owner uid or admin.
- Storage `customer_uploads/{uid}` + `renders/{uid}` — owner uid or admin.

---

## 4. React app changes (customer portal)

New:
- `src/customer/CustomizerPage.jsx` — route `/customize/:productId` (gated to
  approved customers). Holds selections, preview image, loading/error state.
- `src/customer/customizer/CrystalTypeSelector.jsx` — Fabric / Fine Rock / Rock,
  each showing the detail-vs-sparkle trade-off note.
- `src/customer/customizer/ColorPalette.jsx` — fg + bg crystal colour pickers
  (snap to the template palette).
- `src/customer/customizer/LogoUpload.jsx` — drag/drop; **client-side background
  removal** (`@imgly/background-removal`) + size/format guidance.
- `src/customer/customizer/MessageInput.jsx` — char-capped text (Mode A/text).
- `src/customizerApi.js` — `renderPreview(selections)` → calls the edge fn;
  `saveDesign()` / `attachToEnquiry()`.

Edge fn:
- `netlify/edge-functions/customizer-render.js` — proxy to Fly.io (adds token),
  registered in `netlify.toml` as `/api/customizer-render`.

Product page:
- Add a **"Customize & Preview →"** button on the customizable product's detail
  page (only when `product.customizable`), linking to `/customize/:id`.

Enquiry:
- Reuse the existing enquiry cart/submit; a saved design attaches its
  `render_url` (+ selections summary) as a line/attachment so it lands in admin
  and the email — same path the portal already uses.

---

## 5. Phasing

- **Phase 0 — render service (no app wiring):** port engine → Fly.io → `/render`
  returns a PNG for test inputs. Prove it end-to-end with curl.
- **Phase 1 — MVP flow (Mode B):** edge proxy + CustomizerPage + controls + logo
  upload + "Update preview" + Save + Add-to-enquiry + product-page button. One
  product (crystal panel). Rules pasted.
- **Phase 2 — fidelity + Mode A:** iridescence tuning (AB/Moonlight, darker-bg
  rule), printed-graphic mode, PDF proposal one-pager, debounced auto-preview.
- **Phase 3 — scale:** more products/templates, staff template authoring UI.

---

## 6. Risks / honest notes

- **Render fidelity isn't finished** (crystal iridescence, Mode A veiling). The
  service can improve *independently* of the UI — Phase 1 ships the flow; the
  engine keeps getting better behind the same endpoint. But a not-yet-boss-ready
  preview undersells it, so Phase 2 fidelity matters before a hard launch.
- **Template authoring for product #1** is manual: define the logo area + panel_mm
  + material for the crystal panel. Small, but real setup work.
- **Fly.io is new infra** to run/monitor (separate from Netlify). Scale-to-zero
  keeps cost near-zero; cold starts add a few seconds occasionally.
- **Rules paste** required for the two new collections + Storage paths (owner).
- **Logo quality:** customers upload messy logos; bg-removal + guidance mitigate,
  but some inputs will still need staff cleanup.

---

## 7. What I'd build first once approved

Phase 0 only: the `render-service/` folder (FastAPI + ported engine + Dockerfile +
fly.toml + README with deploy steps), runnable locally and on Fly.io, returning a
PNG. Nothing in the live app yet. You review the preview quality from real inputs,
then we wire Phase 1.
