// V8.19 Firebase sample library; existing colour-grouped browser contract.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { listCrystalSwatches, readSwatchPhoto } from './crystalSwatches'
import { swatchesToRegistry } from './domain/crystalSwatches'

export async function fetchSwatchRegistry() {
  return swatchesToRegistry(await listCrystalSwatches())
}

// Caller revokes this object URL on replacement/unmount.
export async function fetchSwatchImageUrl(path, {signal} = {}) {
  return URL.createObjectURL(await readSwatchPhoto(path,false,signal))
}

const NOTES_COL = 'crystal_swatch_notes'

const normNotes = (id, x) => ({
  id,
  legacy_swarovski_refs: Array.isArray(x?.legacy_swarovski_refs) ? x.legacy_swarovski_refs : [],
})

export async function loadSwatchNotes(colorName) {
  const snap = await getDoc(doc(db, NOTES_COL, colorName))
  return normNotes(colorName, snap.exists() ? snap.data() : null)
}

export async function saveSwatchNotes(colorName, { legacy_swarovski_refs }) {
  await setDoc(doc(db, NOTES_COL, colorName), {
    legacy_swarovski_refs: Array.isArray(legacy_swarovski_refs) ? legacy_swarovski_refs : [],
    updated_at: serverTimestamp(),
  }, { merge: true })
}
