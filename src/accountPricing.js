import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
export async function loadAccountPricing(uid) {
  return (await getDoc(doc(db, 'account_pricing', uid))).data() || {}
}
export async function updateAccountWithPricing(uid, patch) {
  const publicPatch = { ...patch }, privatePatch = {}
  for (const field of ['corp_markup_override', 'pricing_group']) {
    if (Object.hasOwn(publicPatch, field)) {
      privatePatch[field] = publicPatch[field]
      delete publicPatch[field]
    }
  }
  const batch = writeBatch(db)
  if (Object.keys(privatePatch).length) batch.set(doc(db, 'account_pricing', uid), { ...privatePatch, updatedAt: serverTimestamp() }, { merge: true })
  batch.update(doc(db, 'users', uid), { ...publicPatch, updatedAt: serverTimestamp() })
  await batch.commit()
}
