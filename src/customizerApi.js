// Client helpers for the crystal customizer: render (via the Netlify edge proxy
// to the Fly.io service), logo prep, and saving a design. Mirrors the palette /
// crystal types in render-service/engine/palette.py.
import { doc, setDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref as sref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage'
import { db, storage } from './firebase'

// Crystal colours (name = what the render service expects; hex = swatch preview).
export const CRYSTAL_COLORS = [
  { name: 'CrystalAB',        label: 'Crystal AB',        hex: '#EDEFF7' },
  { name: 'Crystal',          label: 'Crystal (clear)',   hex: '#F0F2F5' },
  { name: 'Moonlight',        label: 'Moonlight',         hex: '#E4EAF6' },
  { name: 'CrystalBlueLight', label: 'Crystal Blue Light',hex: '#C9D6EE' },
  { name: 'MetallicSilver',   label: 'Metallic Silver',   hex: '#BFC1CB' },
  { name: 'GoldenShadow',     label: 'Golden Shadow',     hex: '#C7AD80' },
  { name: 'CrystalDorado',    label: 'Crystal Dorado',    hex: '#CC9E4D' },
  { name: 'CrystalCopper',    label: 'Crystal Copper',    hex: '#B87A5C' },
  { name: 'Hematite',         label: 'Hematite',          hex: '#2E2E33' },
  { name: 'Jet',              label: 'Jet (black)',       hex: '#0D0D12' },
]
export const colorHex = name => (CRYSTAL_COLORS.find(c => c.name === name) || {}).hex || '#ccc'
export const colorLabel = name => (CRYSTAL_COLORS.find(c => c.name === name) || {}).label || name

// Crystal types (stone size). `hint` sets expectations on fine-detail survival.
export const CRYSTAL_TYPES = [
  { value: 'fabric_1.0',    label: 'Crystal Fabric', mm: '1.0mm', hint: 'Finest stones — best for small logos and fine lines.' },
  { value: 'fine_rock_1.5', label: 'Crystal Fine Rock', mm: '1.5mm', hint: 'Balanced sparkle and detail.' },
  { value: 'rock_2.0',      label: 'Crystal Rock', mm: '2.0mm', hint: 'Largest stones, most sparkle — bold logos; fine detail is lost.' },
]
export const typeLabel = v => {
  const t = CRYSTAL_TYPES.find(x => x.value === v)
  return t ? `${t.label} ${t.mm}` : v
}

export const MODES = [
  { value: 'zone_map', label: 'Crystals form the logo', desc: 'Your logo is made of crystals on a crystal background.' },
  { value: 'printed',  label: 'Logo under crystals',    desc: 'Your printed graphic sits under a layer of transparent crystals.' },
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
    try { msg = (await res.json()).error || msg } catch { /* non-JSON */ }
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
