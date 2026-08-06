// Client helpers for the crystal customizer: render (via the Netlify edge proxy
// to the Fly.io service), logo prep, and saving a design. Mirrors the palette /
// crystal types in render-service/engine/palette.py.
import { doc, setDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref as sref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage'
import { db, storage } from './firebase'

// The colour palette is NO LONGER hard-coded here — it's fetched live from
// the render service (fetchPalette below), which reads the real registry of
// photographed swatches. A hard-coded list drifted out of sync with what was
// actually photographed and made every render 500 for colours the registry
// didn't have (2026-08-06). Each palette entry is:
//   { name, hex, fabric: [backfilm names…], rock: [backfilm names…] }
// A colour is usable for a given crystal type only if that type's STYLE
// (fabric vs rock, see CRYSTAL_TYPES) has a non-empty backfilm list.
export async function fetchPalette() {
  const res = await fetch('/api/customizer-palette')
  if (!res.ok) throw new Error(`Palette unavailable (${res.status})`)
  const data = await res.json()
  return data.colors || []
}

// Crystal types (stone size). `hint` sets expectations on fine-detail survival.
// `style` maps to the registry slot the render reads: fine_rock and rock share
// the "rock" photos (same cut, different size), fabric is its own cut.
export const CRYSTAL_TYPES = [
  { value: 'fabric_1.0',    style: 'fabric', label: 'Crystal Fabric', mm: '1.0mm', hint: 'Finest stones — best for small logos and fine lines.' },
  { value: 'fine_rock_1.5', style: 'rock',   label: 'Crystal Fine Rock', mm: '1.5mm', hint: 'Balanced sparkle and detail.' },
  { value: 'rock_2.0',      style: 'rock',   label: 'Crystal Rock', mm: '2.0mm', hint: 'Largest stones, most sparkle — bold logos; fine detail is lost.' },
]
export const styleOfType = v => (CRYSTAL_TYPES.find(x => x.value === v) || {}).style || 'rock'
export const typeLabel = v => {
  const t = CRYSTAL_TYPES.find(x => x.value === v)
  return t ? `${t.label} ${t.mm}` : v
}

// Both modes are live now that real backfilm photos exist in the registry.
// zone_map: fg/bg are crystal colour NAMES (background is another crystal).
// printed: fg is the top crystal colour, bg is a BACKFILM NAME captured for
// that fg colour at the chosen style — so its options depend on the fg pick.
export const MODES = [
  { value: 'zone_map', label: 'Crystals form the logo', desc: 'Your logo is made of crystals on a crystal background.', available: true },
  { value: 'printed',  label: 'Logo under crystals',    desc: 'Your printed graphic sits under a layer of transparent crystals.', available: true },
]

// Read a logo file → a downscaled PNG data URL (alpha preserved for masking).
export function fileToPngDataUrl(file, maxPx = 1000) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('read failed'))
    fr.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/png'))
      }
      img.src = fr.result
    }
    fr.readAsDataURL(file)
  })
}

// Render a preview via the edge proxy. `selections` includes logo_png_b64 (base64,
// no data-URL prefix). Returns a PNG Blob. Throws with a readable message on error.
export async function renderPreview(selections) {
  const res = await fetch('/api/customizer-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selections),
  })
  if (!res.ok) {
    let msg = `Preview failed (${res.status})`
    // FastAPI's HTTPException body is {"detail": "..."} — this used to look
    // for {"error": "..."} instead, which every real error had, so the UI
    // only ever showed the generic "Preview failed (500)" and never the
    // actual reason (e.g. which colour/backfilm combo isn't captured yet).
    try { msg = (await res.json()).detail || msg } catch { /* non-JSON */ }
    throw new Error(msg)
  }
  return res.blob()
}

// Persist a design: upload the render PNG + logo, write customer_designs/{id}.
export async function saveDesign({ uid, customerId, productId, selections, renderBlob, logoDataUrl }) {
  const id = doc(collection(db, 'customer_designs')).id
  const renderRef = sref(storage, `renders/${uid}/${id}.png`)
  await uploadBytes(renderRef, renderBlob, { contentType: 'image/png' })
  const render_url = await getDownloadURL(renderRef)

  let logo_url = null
  if (logoDataUrl) {
    const logoRef = sref(storage, `customer_uploads/${uid}/${id}.png`)
    await uploadString(logoRef, logoDataUrl, 'data_url')
    logo_url = await getDownloadURL(logoRef)
  }

  await setDoc(doc(db, 'customer_designs', id), {
    uid,
    customer_id: customerId || null,
    product_id: productId,
    selections,
    render_url,
    logo_url,
    createdAt: serverTimestamp(),
  })
  return { id, render_url }
}
