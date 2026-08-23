import { useState, useEffect } from 'react'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, serverTimestamp, runTransaction } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
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
  let id = previewId({ docId, variantIndex, sourcePlatingCode, targetCrystalCode, sourceImageUrl })
  // The id (and therefore the Storage path) is deterministic on purpose —
  // repeat clicks while a draft is still being iterated on should reuse the
  // same doc, not pile up duplicates. But once a doc has been promoted
  // ('used') or demoted from that ('superseded'), colour_images may already
  // point at this exact file: silently overwriting it here would change a
  // live-referenced image out from under anything already using it, before
  // any re-approval. Mint a fresh id instead once that's happened.
  const prior = await getDoc(doc(db, COLLECTION, id))
  if (prior.exists() && ['used', 'superseded'].includes(prior.data().reviewStatus)) {
    id = `${id}__${Date.now().toString(36)}`
  }
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
    source: 'ai',
    createdBy: createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  try {
    // Gemini is occasionally flaky on the very first call for a given
    // session/image (observed live, 2026-08-22) — enhanceProductImage
    // already retries once on a platform *timeout*, but a clean 5xx error
    // response doesn't match that check, so retry once more here too
    // before giving up and marking the doc failed.
    const recolor = { mode: 'recolor', recolorInstructions: recolorInstructions({ sourceCrystalName, targetCrystalName, targetSwatchHex }) }
    let data
    try { data = await enhanceProductImage(sourceImageUrl, recolor) }
    catch { data = await enhanceProductImage(sourceImageUrl, recolor) }
    const blob = await (await fetch(`data:${data.mimeType || 'image/png'};base64,${data.image}`)).blob()
    const path = `range_products/${docId}/colour_previews/${id}.jpg`
    await uploadBytes(storageRef(storage, path), blob, { contentType: blob.type || 'image/png' })
    const generatedImageUrl = await getDownloadURL(storageRef(storage, path))
    await updateDoc(ref, { status: 'success', generatedImageUrl, updatedAt: serverTimestamp() })
    return { id, generatedImageUrl }
  } catch (err) {
    await updateDoc(ref, { status: 'failed', errorMessage: err.message || 'Generation failed.', updatedAt: serverTimestamp() })
    throw err
  }
}

export async function setReviewStatus(id, reviewStatus) {
  await updateDoc(doc(db, COLLECTION, id), { reviewStatus, updatedAt: serverTimestamp() })
}

// Promotes an approved (AI or uploaded) preview from the colour_previews/
// Marks an approved preview 'used' and hands back its existing URL for the
// caller to write into variant.colour_images (this module never touches
// range_products itself, same boundary as generate/upload above).
//
// Does NOT copy the file to a new Storage path. An earlier version tried to
// fetch() the download URL client-side and re-upload it — Firebase Storage
// download URLs aren't CORS-enabled for cross-origin fetch (only for <img>
// tags, which don't need it), so that threw in every browser, not just
// locally. There's also no reason to copy: colour_images is deliberately
// the lower "usable" tier (§P2.1), not the gallery-grade tier where "must
// look like a real photo, not a draft artifact" mattered — the file can
// keep living under colour_previews/. Because of this, deletePreview()
// refuses to delete a 'used' preview: doing so would break the live
// variant.colour_images reference pointing at the same file.
export async function markUsable(preview) {
  await setReviewStatus(preview.id, 'used')
  // Only one preview should ever look "usable" for a given (variant, colour)
  // at a time — demote any other one so the list doesn't show two "usable"
  // thumbnails when a replacement has been approved (V8.8, 2026-08-23). The
  // demoted doc is untouched otherwise: its file stays put, so any invoice/
  // PI/quote/portal view that already picked it keeps working — 'superseded'
  // only changes what's offered going forward, and (unlike 'used') CAN be
  // removed via deletePreview() once nothing needs it as history.
  if (preview.docId != null && preview.variantIndex != null && preview.targetCrystalCode) {
    const q = query(collection(db, COLLECTION),
      where('docId', '==', preview.docId),
      where('variantIndex', '==', preview.variantIndex),
      where('targetCrystalCode', '==', preview.targetCrystalCode),
      where('reviewStatus', '==', 'used'))
    const snap = await getDocs(q)
    await Promise.all(snap.docs.filter(d => d.id !== preview.id).map(d => setReviewStatus(d.id, 'superseded')))
  }
  return preview.generatedImageUrl
}

// Discards a preview outright — for a bad AI attempt or an upload the
// reviewer no longer wants. Removes the Storage object too, not just the
// Firestore doc, so rejected drafts don't linger in the bucket. Refuses on
// a 'used' preview — markUsable() above points variant.colour_images at
// this exact file rather than copying it, so deleting it here would break
// that live reference.
export async function deletePreview(preview) {
  if (preview.reviewStatus === 'used') {
    throw new Error("Can't remove — this photo is marked usable and may be referenced by a variant.")
  }
  try {
    await deleteObject(storageRef(storage, `range_products/${preview.docId}/colour_previews/${preview.id}.jpg`))
  } catch (err) {
    if (err.code !== 'storage/object-not-found') throw err
  }
  await deleteDoc(doc(db, COLLECTION, preview.id))
}

// For a mixture/multi-colour crystal recipe (or any colour the team already
// has a real photo of), skip Gemini entirely — upload the existing photo
// straight in as a draft, same review gate as an AI attempt. Not
// idempotent like generateColourPreview: each upload is a deliberate,
// distinct action, so it always gets a fresh id.
export async function uploadColourPreview({
  docId, variantIndex, sourcePlatingCode, targetCrystalCode, file, createdBy,
}) {
  if (!file) throw new Error('No file selected.')
  const id = [
    docId, `v${variantIndex}`,
    (sourcePlatingCode || 'X').trim().toUpperCase(),
    (targetCrystalCode || 'X').trim().toUpperCase(),
    'upload', Date.now().toString(36),
  ].join('__')
  const path = `range_products/${docId}/colour_previews/${id}.jpg`
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type || 'image/jpeg' })
  const generatedImageUrl = await getDownloadURL(storageRef(storage, path))
  await setDoc(doc(db, COLLECTION, id), {
    docId, variantIndex, sourceImageUrl: '',
    sourcePlatingCode: (sourcePlatingCode || '').trim().toUpperCase(),
    sourceCrystalCode: '',
    targetCrystalCode: (targetCrystalCode || '').trim().toUpperCase(),
    status: 'success',
    reviewStatus: 'draft',
    generatedImageUrl,
    errorMessage: '',
    source: 'upload',
    createdBy: createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id, generatedImageUrl }
}

// For a real photo that's already sitting in the product's gallery[] — no
// need to re-upload a duplicate file, just point a new draft at the
// existing Storage URL directly. `deletePreview()` on one of these safely
// no-ops on the Storage delete (storage/object-not-found, already caught)
// since there's no colour_previews/ object for it to own.
export async function pickGalleryColourPreview({
  docId, variantIndex, sourcePlatingCode, targetCrystalCode, galleryUrl, createdBy,
}) {
  if (!galleryUrl) throw new Error('No gallery image selected.')
  const id = [
    docId, `v${variantIndex}`,
    (sourcePlatingCode || 'X').trim().toUpperCase(),
    (targetCrystalCode || 'X').trim().toUpperCase(),
    'gallery', Date.now().toString(36),
  ].join('__')
  await setDoc(doc(db, COLLECTION, id), {
    docId, variantIndex, sourceImageUrl: '',
    sourcePlatingCode: (sourcePlatingCode || '').trim().toUpperCase(),
    sourceCrystalCode: '',
    targetCrystalCode: (targetCrystalCode || '').trim().toUpperCase(),
    status: 'success',
    reviewStatus: 'draft',
    generatedImageUrl: galleryUrl,
    errorMessage: '',
    source: 'gallery',
    createdBy: createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id, generatedImageUrl: galleryUrl }
}

// Writes {crystalCode: url} into one variant's colour_images map on the
// range_products doc itself. Firestore field paths can't index into array
// elements (`variants.0.colour_images.PI` isn't addressable), so this is a
// read-modify-write of the whole `variants` array — same pattern
// RangeForm.jsx's own handleSave already uses for this doc. Used by the
// inline "generate from within an invoice/quote/PI" flow (Phase 2 §P2.3a),
// where there's no open form to optimistically patch like RangeForm has.
// Transactional (code review, 2026-08-23) — a plain getDoc-then-updateDoc
// here was the same failure class as the V8.8 Save Changes bug: two
// concurrent promotions (two admins approving different colours on the
// same product, or this overlapping a RangeForm save) could both read the
// same variants array and last-write-wins, silently dropping one colour.
// Firestore transactions retry automatically on a detected conflict, so
// this closes that race without needing to restructure colour_images out
// of the array (a bigger schema change, not justified for what's still a
// low-concurrency admin workflow).
export async function promoteColourImage(docId, variantIndex, crystalCode, url) {
  const ref = doc(db, 'range_products', docId)
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Product not found.')
    const variants = [...(snap.data().variants || [])]
    if (!variants[variantIndex]) throw new Error('Variation not found.')
    variants[variantIndex] = {
      ...variants[variantIndex],
      colour_images: { ...(variants[variantIndex].colour_images || {}), [crystalCode]: url },
    }
    tx.update(ref, { variants })
  })
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
