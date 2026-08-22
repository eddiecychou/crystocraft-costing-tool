import { useState, useEffect } from 'react'
import { doc, setDoc, updateDoc, onSnapshot, collection, query, where, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from './firebase'
import { enhanceProductImage } from './enhanceImage'

// V8.8 Phase 1 — one-SKU crystal-colour preview experiment. See
// Range_Colour_Preview_Spec.md. Reuses the existing Gemini recolor endpoint
// (enhanceImage.js, mode 'recolor') that already ships for plating/crystal
// touch-ups on real range-product photos — no new AI plumbing.
//
// Drafts live in a TOP-LEVEL collection, not a range_products/{id} subcollection:
// firestore.rules' `range_products/{rangeId}/{allPaths=**}` wildcard grants
// canShop() customers read access to every subcollection, which would make
// draft previews readable before review. range_colour_previews is admin-only,
// front to back (see firestore.rules).
const COLLECTION = 'range_colour_previews'

// Deterministic, dependency-free string hash (FNV-1a) — only needs to be
// stable and short, not cryptographic.
function shortHash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// One doc per (product, variant, source image, target colour) combination —
// re-generating the same combination reuses this id instead of piling up
// duplicates, which is what makes Generate idempotent without a queue.
export function previewId({ docId, variantIndex, sourcePlatingCode, targetCrystalCode, sourceImageUrl }) {
  return [
    docId,
    `v${variantIndex}`,
    (sourcePlatingCode || 'X').trim().toUpperCase(),
    (targetCrystalCode || 'X').trim().toUpperCase(),
    shortHash(sourceImageUrl || ''),
  ].join('__')
}

function recolorInstructions({ sourceCrystalName, targetCrystalName, targetSwatchHex }) {
  const from = sourceCrystalName ? ` (currently ${sourceCrystalName})` : ''
  const hex = targetSwatchHex ? ` (reference colour ${targetSwatchHex})` : ''
  return (
    `Change ONLY the crystal stones${from} to ${targetCrystalName}${hex}. ` +
    `Do not change the metal plating colour, the product shape, the crystal ` +
    `positions/sizes, the background, or the lighting and shadows.`
  )
}

// Kicks off one generation. Writes 'generating' immediately, then
// 'success'/'failed' once the model responds. Never touches variant.image
// or gallery[] — the result is a draft the reviewer must act on separately.
export async function generateColourPreview({
  docId, variantIndex, sourceImageUrl, sourcePlatingCode, sourceCrystalCode,
  sourceCrystalName, targetCrystalCode, targetCrystalName, targetSwatchHex, createdBy,
}) {
  if (!sourceImageUrl) throw new Error('This variation has no image to generate from.')
  const id = previewId({ docId, variantIndex, sourcePlatingCode, targetCrystalCode, sourceImageUrl })
  const ref = doc(db, COLLECTION, id)
  await setDoc(ref, {
    docId, variantIndex, sourceImageUrl,
    sourcePlatingCode: (sourcePlatingCode || '').trim().toUpperCase(),
    sourceCrystalCode: (sourceCrystalCode || '').trim().toUpperCase(),
    targetCrystalCode: (targetCrystalCode || '').trim().toUpperCase(),
    status: 'generating',
    reviewStatus: 'draft',
    generatedImageUrl: '',
    errorMessage: '',
    createdBy: createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  try {
    const data = await enhanceProductImage(sourceImageUrl, {
      mode: 'recolor',
      recolorInstructions: recolorInstructions({ sourceCrystalName, targetCrystalName, targetSwatchHex }),
    })
    const blob = await (await fetch(`data:${data.mimeType || 'image/png'};base64,${data.image}`)).blob()
    const path = `range_products/${docId}/colour_previews/${id}.jpg`
    await uploadBytes(storageRef(storage, path), blob, { contentType: blob.type || 'image/png' })
    const generatedImageUrl = await getDownloadURL(storageRef(storage, path))
    await updateDoc(ref, { status: 'success', generatedImageUrl, updatedAt: serverTimestamp() })
  } catch (err) {
    await updateDoc(ref, { status: 'failed', errorMessage: err.message || 'Generation failed.', updatedAt: serverTimestamp() })
    throw err
  }
}

export async function setReviewStatus(id, reviewStatus) {
  await updateDoc(doc(db, COLLECTION, id), { reviewStatus, updatedAt: serverTimestamp() })
}

// Live list of previews for one variant, newest first.
export function useColourPreviews(docId, variantIndex) {
  const [previews, setPreviews] = useState([])
  useEffect(() => {
    if (!docId) return
    const q = query(collection(db, COLLECTION), where('docId', '==', docId), where('variantIndex', '==', variantIndex))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setPreviews(rows)
    })
    return unsub
  }, [docId, variantIndex])
  return previews
}
