import { collection, doc, getDocs, query, where, limit, runTransaction, serverTimestamp } from 'firebase/firestore'
import { familyKey, punctuationKey } from './domain/rangeUpload.js'

// Shared reservation contract with the MCP. Existing code/format families must
// be corrected in place. Rules require the same claim on create/identity changes,
// including stale older forms which do not yet participate in this protocol.
export async function persistRangeFamily(db, id, payload, isNew) {
  const key = familyKey(payload)
  const matches = await getDocs(query(collection(db, 'range_products'), where('design_no', '==', payload.design_no)))
  if (matches.docs.some(d => d.id !== id && d.data().format_code === payload.format_code)) throw new Error('This design/format family already exists. Open and correct the existing product instead.')
  await runTransaction(db, async tx => {
    const ref = doc(db, 'range_products', id), claimRef = doc(db, 'range_family_claims', key)
    const current = await tx.get(ref), claim = await tx.get(claimRef)
    if (isNew === current.exists()) throw new Error(isNew ? 'Product ID already exists. Reopen it before saving.' : 'Product was removed. Reload before saving.')
    if (claim.exists() && claim.data().range_id !== id) throw new Error('Another product reserved this family. Reload and use the existing product.')
    const saved = { ...payload }
    if (!isNew && Array.isArray(payload.variants)) {
      const fresh = current.data().variants || []
      saved.variants = payload.variants.map((v, i) => {
        const live = v.id ? fresh.find(row => row.id === v.id) : fresh[i]
        return { ...live, ...v, colour_images: live?.colour_images || v.colour_images || {} }
      })
    }
    if (!claim.exists()) tx.set(claimRef, { range_id: id, design_no: payload.design_no, format_code: payload.format_code, createdAt: serverTimestamp() })
    if (isNew) tx.set(ref, { ...saved, createdAt: serverTimestamp() })
    else tx.update(ref, saved)
  })
}

// Component identity is shared with the MCP; punctuation aliases never create
// a second record. Legacy duplicates require explicit operator reconciliation.
export async function persistRangeComponent(db, id, payload) {
  const code = String(payload.code || '').trim().toUpperCase(), key = punctuationKey(code)
  if (!key || key.length > 160 || !/^[A-Z0-9][A-Z0-9 ()_.\/-]*$/.test(code)) throw new Error('Invalid component code.')
  const all = await getDocs(query(collection(db, 'range_components'), limit(2001)))
  if (all.size > 2000) throw new Error('Component index migration required before writes.')
  if (all.docs.some(d => d.id !== id && punctuationKey(d.data().code) === key)) throw new Error('A component with this exact or punctuation-equivalent code already exists. Select its canonical ID.')
  await runTransaction(db, async tx => {
    const ref = doc(db, 'range_components', id), claimRef = doc(db, 'range_component_claims', key)
    const current = await tx.get(ref), claim = await tx.get(claimRef)
    if (claim.exists() && (claim.data().component_id !== id || claim.data().code !== code)) throw new Error('Component code already reserved. Use its canonical record.')
    if (!claim.exists()) tx.set(claimRef, { component_id: id, code, createdAt: serverTimestamp() })
    tx.set(ref, { ...payload, code, ...(!current.exists() ? { createdAt: serverTimestamp() } : {}), updatedAt: serverTimestamp() }, { merge: true })
  })
  return id
}
