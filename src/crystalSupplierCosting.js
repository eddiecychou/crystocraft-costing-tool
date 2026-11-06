// Supply-only links. No costs, attachment URLs or private references are added
// to customer-readable crystal_products or their variants/images.
import { collection, doc, getDoc, getDocs, query, where, limit, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { persistRangeComponent } from './rangePersistence'
import { validCrystalId } from './domain/crystalProducts'
import { sameFirestoreValue } from './firestoreValue'

const rows = snap => snap.docs.map(d => ({ ...d.data(), id: d.id }))
export const crystalQuoteUrl = (productId, variantId, componentId, quoteId = 'new') =>
  `/crystal-components/${productId}/variants/${variantId}/costing/${componentId}/quotes/${quoteId}`
export const crystalCostingContext = (productId, variantId) => ({ crystal_product_id: productId, crystal_variant_id: variantId })

export async function loadCrystalCostings(productId) {
  if (!validCrystalId(productId)) throw Error('Choose an existing crystal product.')
  const components = rows(await getDocs(query(collection(db, 'range_components'), where('crystal_product_id', '==', productId))))
  return Promise.all(components.map(async c => ({ ...c,
    quotes: rows(await getDocs(collection(db, 'range_components', c.id, 'supplier_quotes')))
      .sort((a,b) => Number(b.is_preferred) - Number(a.is_preferred) || String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''))),
  })))
}

export async function listCrystalCostingCandidates() {
  const snap = await getDocs(query(collection(db, 'range_components'), limit(2001)))
  if (snap.size > 2000) throw Error('The component library needs a larger indexed picker before linking. No records were changed.')
  return rows(snap).sort((a,b) => String(a.code || '').localeCompare(String(b.code || '')))
}

export async function inspectCrystalCostingComponent(componentId) {
  if (!validCrystalId(componentId)) throw Error('Choose an existing cost component.')
  const ref = doc(db, 'range_components', componentId), component = await getDoc(ref)
  if (!component.exists()) throw Error('This cost component no longer exists.')
  return { ...component.data(), id: component.id, quotes: rows(await getDocs(collection(ref, 'supplier_quotes'))) }
}

const linkFields = c => ({ product: c?.crystal_product_id || '', variant: c?.crystal_variant_id || '', unit: c?.crystal_catalogue_unit || '' })

// Explicit operator-reviewed association only: the quote, attachments, preferred
// cost, component descriptor and stock fields are never copied or rewritten.
export async function linkCrystalCosting({ productId, variantId, componentId, quoteId = '', expectedLink = null }) {
  if (![productId, variantId, componentId].every(validCrystalId) || quoteId && !validCrystalId(quoteId)) throw Error('Choose valid existing records.')
  return runTransaction(db, async tx => {
    const componentRef = doc(db, 'range_components', componentId)
    const [p,v,c] = await Promise.all([
      tx.get(doc(db, 'crystal_products', productId)),
      tx.get(doc(db, 'crystal_products', productId, 'variants', variantId)),
      tx.get(componentRef),
    ])
    if (!p.exists() || !v.exists() || !c.exists()) throw Error('Product, variant or cost component no longer exists.')
    if (typeof v.data().unit !== 'string' || !v.data().unit.trim()) throw Error('The catalogue variant unit needs review before linking.')
    const before = linkFields(c.data()), wanted = { product: productId, variant: variantId, unit: v.data().unit }
    if (expectedLink && !sameFirestoreValue(before, expectedLink)) throw Error('The costing association changed. Reload before linking.')
    if (Boolean(before.product) !== Boolean(before.variant)) throw Error('This component has an incomplete crystal association. Review it before linking.')
    if (before.product && (before.product !== productId || before.variant !== variantId)) throw Error('This cost component is already linked to another crystal variant. Review that association first.')
    if (quoteId) {
      const q = await tx.get(doc(componentRef, 'supplier_quotes', quoteId))
      if (!q.exists()) throw Error('The selected quote no longer exists. No new quote was created.')
      const supplierId = q.data().supplier_id
      if (!validCrystalId(supplierId) || !(await tx.get(doc(db, 'suppliers', supplierId))).exists()) throw Error('The quote needs an existing supplier before linking.')
    }
    if (sameFirestoreValue(before, wanted)) return componentId
    tx.update(componentRef, {
      crystal_product_id: productId, crystal_variant_id: variantId,
      crystal_catalogue_unit: v.data().unit,
      crystal_product_code: p.data().code, crystal_variant_code: v.data().code,
      crystal_linked_at: serverTimestamp(),
    })
    return componentId
  })
}

// Stable per-variant ID + the existing canonical code reservation protect new
// component retries. An existing code is never silently copied or renamed.
export async function createCrystalCostingComponent(product, variant) {
  if (![product?.id, variant?.id].every(validCrystalId)) throw Error('Save the product and variant first.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(product.id + '/' + variant.id))
  const id = 'rc_cc_' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('').slice(0,28)
  const ref = doc(db, 'range_components', id), existing = await getDoc(ref)
  if (existing.exists()) {
    const c = existing.data()
    if (c.code !== String(variant.code).trim().toUpperCase() || c.crystal_product_id && (c.crystal_product_id !== product.id || c.crystal_variant_id !== variant.id)) throw Error('The internal component changed. Select its existing record for review.')
  } else {
    await persistRangeComponent(db, id, { code: variant.code, name: `${product.name} · ${variant.label}`, category: 'Crystal Components', plating_code: '', supplierId: '', supplierName: '', notes: '', images: [], lead_time_weeks: null })
  }
  await linkCrystalCosting({ productId: product.id, variantId: variant.id, componentId: id })
  return id
}
