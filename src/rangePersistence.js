import { collection, doc, getDocs, query, where, limit, runTransaction, serverTimestamp } from 'firebase/firestore'
import { familyKey, punctuationKey } from './domain/rangeUpload.js'
import { sameFirestoreValue } from './firestoreValue.js'

export const RANGE_COSTING_HOLD_REASON_LIMIT = 240

export const isB0016CostingHold = product =>
  product?.design_no === '0016' && product?.format_code === '000'

export function rangeCostingHoldReason(product) {
  if (isB0016CostingHold(product)) return 'B0016 pricing is on hold pending assembly and packaging costs.'
  return product?.pricing_hold?.active === true
    ? product.pricing_hold.reason || 'A costing hold is active.'
    : ''
}

function costingConflictSnapshot(costing = {}) {
  const { published_at, ...terms } = costing || {}
  // The UI shows a local time immediately after saving a server timestamp.
  return { terms, published: published_at != null }
}

function withLatestRangeHold(message, product) {
  const { design_no, format_code, pricing_hold } = product
  return Object.assign(new Error(message), { latestHold: { design_no, format_code, pricing_hold } })
}

export function publishRangeCosting(db, id, { originalCosting, costing, markup }) {
  const ref = doc(db, 'range_products', id)
  return runTransaction(db, async tx => {
    const current = await tx.get(ref)
    if (!current.exists()) throw new Error('Product was removed. Reopen the latest record before publishing.')
    const product = current.data()
    const reason = rangeCostingHoldReason(product)
    if (reason) throw withLatestRangeHold(reason, product)
    if (!sameFirestoreValue(costingConflictSnapshot(originalCosting), costingConflictSnapshot(product.costing))) {
      throw new Error('Costing changed in another tab. Your draft is still here. Review the latest costing before publishing.')
    }
    tx.update(ref, { costing: { ...costing, published_at: serverTimestamp(), markup_used: markup } })
  })
}

export function setRangeCostingHold(db, id, { previousHold, active, reason = '', uid }) {
  const ref = doc(db, 'range_products', id)
  const text = active ? reason.trim() : ''
  if (active && (!text || text.length > RANGE_COSTING_HOLD_REASON_LIMIT)) {
    throw new Error(`Enter a hold reason of up to ${RANGE_COSTING_HOLD_REASON_LIMIT} characters.`)
  }
  return runTransaction(db, async tx => {
    const current = await tx.get(ref)
    if (!current.exists()) throw new Error('Product was removed. Reopen the latest record before changing the hold.')
    const product = current.data()
    if (isB0016CostingHold(product)) throw withLatestRangeHold(rangeCostingHoldReason(product), product)
    const latest = product.pricing_hold
    if (latest?.active !== previousHold?.active || latest?.reason !== previousHold?.reason) {
      throw withLatestRangeHold('The costing hold changed in another tab. Review the current hold before saving.', product)
    }
    const hold = { active, reason: text, updated_by: uid }
    tx.update(ref, { pricing_hold: { ...hold, updated_at: serverTimestamp() } })
    return hold
  })
}

// Shared reservation contract with the MCP. Existing code/format families must
// be corrected in place. Rules require the same claim on create/identity changes,
// including stale older forms which do not yet participate in this protocol.
export async function persistRangeFamily(db, id, payload, isNew) {
  const key = familyKey(payload)
  const matches = await getDocs(query(collection(db, 'range_products'), where('design_no', '==', payload.design_no)))
  const duplicate = matches.docs.find(d => d.id !== id && d.data().format_code === payload.format_code)
  if (duplicate) throw Object.assign(new Error('This design/format family already exists. Open and correct the existing product instead.'), { existingRangeId: duplicate.id })
  await runTransaction(db, async tx => {
    const ref = doc(db, 'range_products', id), claimRef = doc(db, 'range_family_claims', key)
    const current = await tx.get(ref), claim = await tx.get(claimRef)
    if (isNew === current.exists()) throw new Error(isNew ? 'Product ID already exists. Reopen it before saving.' : 'Product was removed. Reload before saving.')
    if (claim.exists() && claim.data().range_id !== id) throw Object.assign(new Error('Another product reserved this family. Reload and use the existing product.'), { existingRangeId: claim.data().range_id })
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
