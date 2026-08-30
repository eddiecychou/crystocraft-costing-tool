// Merge two duplicate supplier records into one (owner, 2026-08-30). Same idea
// as domain/customer.js's mergeCustomers, but suppliers are wired into more
// places, so read the checklist below before touching this.
//
// A supplier id is referenced by:
//   • purchase_orders.supplier_id            (+ denormalised supplier_name /
//                                             _name_cn / _erp_code / _address /
//                                             _contact snapshot on each PO)
//   • {any}/supplier_quotes/*.supplier_id    (+ supplier_name) — a COLLECTION
//     GROUP under two parents:
//       products/{p}/components/{c}/supplier_quotes/*   (corp-gift BOM quotes)
//       range_components/{rc}/supplier_quotes/*         (figurine BOM quotes)
//   • range_components/*.supplierId          (top-level "current supplier"
//                                             pointer on the component doc)
//   • range_components/*.preferred_supplier_name — a DENORMALISED name copied
//     from the preferred quote (see criticalComponents.js denormFrom); refreshed
//     here only when it currently matches the duplicate's name.
//   • suppliers/{id}/{catalogs,images,videos} subcollections — moved wholesale.
//     Their Storage objects keep their existing getDownloadURL token URLs, so
//     only the Firestore docs move (same trade-off as the customer Brand
//     Gallery merge).
//
// Firestore rules already authorise the collection-group supplier_quotes
// read+write for staff (`match /{path=**}/supplier_quotes/{quoteId}`), and
// SupplierDetail already runs the exact same collectionGroup query, so no new
// index is needed.

import {
  collection, collectionGroup, doc, getDoc, getDocs, query, where,
  writeBatch, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  supplierContactsOf, normalizeSupplierContact, cleanSupplierContacts, genContactId,
} from './supplierContacts'

const str = v => (v == null ? '' : String(v).trim())
const CHUNK = 400

// Blank-only fill: the survivor keeps everything it has; these come across from
// the duplicate only where the survivor's own value is empty.
const MERGE_SCALAR_FIELDS = [
  'name_cn', 'erp_code', 'category', 'country', 'province', 'city', 'address',
  'wechat_id', 'whatsapp', 'contact_person', 'notes',
  'default_currency', 'default_payment_terms',
  'website_url', 'shop_1688_url', 'product_1688_url',
  'taobao_shop_url', 'taobao_product_url', 'alibaba_shop_url', 'alibaba_product_url',
]
const MERGE_ARRAY_FIELDS = ['phones', 'emails']

const unionArrays = (a, b) => {
  const seen = new Set()
  const out = []
  for (const v of [...(a || []), ...(b || [])]) {
    const k = str(v).toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k); out.push(str(v))
  }
  return out
}

// extra_links = [{ id, label, url }] — union by URL.
const unionLinks = (a, b) => {
  const seen = new Set()
  const out = []
  for (const l of [...(a || []), ...(b || [])]) {
    const url = str(l?.url).toLowerCase()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ id: str(l.id) || `lk_${Math.random().toString(36).slice(2, 9)}`, label: str(l.label), url: str(l.url) })
  }
  return out
}

// Merge the duplicate's contacts into the survivor's, skipping anyone who's
// clearly the same person (same email, or same name when neither has an email).
// The survivor's primary stays primary.
function mergeContacts(survivorContacts, duplicateContacts) {
  const survivor = (survivorContacts || []).map(normalizeSupplierContact)
  const seenEmail = new Set(survivor.map(c => c.email.toLowerCase()).filter(Boolean))
  const seenName = new Set(survivor.map(c => c.name.toLowerCase()).filter(Boolean))
  const usedIds = new Set(survivor.map(c => c.id))
  const out = [...survivor]
  for (const raw of (duplicateContacts || [])) {
    const c = normalizeSupplierContact(raw)
    const e = c.email.toLowerCase()
    const n = c.name.toLowerCase()
    const dupe = (e && seenEmail.has(e)) || (!e && n && seenName.has(n))
    if (dupe) continue
    // Fresh id for anything coming from the duplicate — both records' legacy
    // fold-in produces the literal id 'legacy', and two of those would collide
    // (the exact bug customer.js's dedupeContactIds was written for).
    let id = c.id
    if (!id || id === 'legacy' || usedIds.has(id)) id = genContactId()
    usedIds.add(id)
    out.push({ ...c, id, is_primary: false })
    if (e) seenEmail.add(e)
    if (n) seenName.add(n)
  }
  // The survivor's own fold-in can also carry id 'legacy'; give it a real id
  // now that it's being persisted into an actual contacts[] array.
  return cleanSupplierContacts(out.map(c => (c.id === 'legacy' ? { ...c, id: genContactId() } : c)))
}

function fieldsToFillFrom(survivor, duplicate) {
  const out = {}
  for (const f of MERGE_SCALAR_FIELDS) {
    if (!str(survivor[f]) && str(duplicate[f])) out[f] = duplicate[f]
  }
  for (const f of MERGE_ARRAY_FIELDS) {
    const merged = unionArrays(survivor[f], duplicate[f])
    if (merged.length !== (survivor[f] || []).length) out[f] = merged
  }
  const links = unionLinks(survivor.extra_links, duplicate.extra_links)
  if (links.length !== (survivor.extra_links || []).length) out.extra_links = links

  const survContacts = supplierContactsOf(survivor)
  const merged = mergeContacts(survContacts, supplierContactsOf(duplicate))
  if (merged.length !== survContacts.length) out.contacts = merged
  return out
}

// Every supplier_quotes doc (both parent trees) that points at `supplierId`.
async function supplierQuoteDocs(supplierId) {
  const snap = await getDocs(
    query(collectionGroup(db, 'supplier_quotes'), where('supplier_id', '==', supplierId)),
  )
  const corp = [], range = []
  snap.docs.forEach(d => {
    if (d.ref.path.split('/')[0] === 'range_components') range.push(d)
    else corp.push(d)
  })
  return { all: snap.docs, corp, range }
}

async function relatedDocs(supplierId) {
  const [poSnap, quotes, compPtrSnap] = await Promise.all([
    getDocs(query(collection(db, 'purchase_orders'), where('supplier_id', '==', supplierId))),
    supplierQuoteDocs(supplierId),
    getDocs(query(collection(db, 'range_components'), where('supplierId', '==', supplierId))),
  ])
  return { poSnap, quotes, compPtrSnap }
}

// Read-only. Lets the modal show what a merge would move before anyone commits.
export async function previewSupplierMerge(duplicateId, survivorId) {
  if (duplicateId === survivorId) throw new Error('Cannot merge a supplier into itself.')
  const [dupSnap, survSnap] = await Promise.all([
    getDoc(doc(db, 'suppliers', duplicateId)),
    getDoc(doc(db, 'suppliers', survivorId)),
  ])
  if (!dupSnap.exists() || !survSnap.exists()) throw new Error('Supplier not found.')
  const duplicate = { id: duplicateId, ...dupSnap.data() }
  const survivor = { id: survivorId, ...survSnap.data() }

  const { poSnap, quotes, compPtrSnap } = await relatedDocs(duplicateId)
  const [catalogsSnap, imagesSnap, videosSnap] = await Promise.all([
    getDocs(collection(db, 'suppliers', duplicateId, 'catalogs')),
    getDocs(collection(db, 'suppliers', duplicateId, 'images')),
    getDocs(collection(db, 'suppliers', duplicateId, 'videos')),
  ])

  return {
    duplicate, survivor,
    fieldsToFill: fieldsToFillFrom(survivor, duplicate),
    poCount: poSnap.size,
    corpQuoteCount: quotes.corp.length,
    rangeQuoteCount: quotes.range.length,
    componentPointerCount: compPtrSnap.size,
    catalogsCount: catalogsSnap.size,
    imagesCount: imagesSnap.size,
    videosCount: videosSnap.size,
  }
}

async function moveSubcollection(sub, fromId, toId) {
  const snap = await getDocs(collection(db, 'suppliers', fromId, sub))
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const d of snap.docs.slice(i, i + CHUNK)) {
      batch.set(doc(db, 'suppliers', toId, sub, d.id), d.data())
      batch.delete(d.ref)
    }
    await batch.commit()
  }
  return snap.size
}

// Execute the merge. Repoints every PO, BOM supplier-quote and component
// pointer from the duplicate to the survivor, fills the survivor's blank
// fields, moves the media subcollections, then deletes the duplicate.
export async function mergeSuppliers(duplicateId, survivorId) {
  const preview = await previewSupplierMerge(duplicateId, survivorId)
  const { poSnap, quotes, compPtrSnap } = await relatedDocs(duplicateId)

  // Effective survivor identity AFTER blank-fill — so PO snapshots below use
  // the right erp_code/address even if the survivor was missing them.
  const survName = str(preview.survivor.name)
  const survNameCn = str(preview.fieldsToFill.name_cn ?? preview.survivor.name_cn)
  const survErp = str(preview.fieldsToFill.erp_code ?? preview.survivor.erp_code)
  const survAddr = str(preview.fieldsToFill.address ?? preview.survivor.address)
  const dupName = str(preview.duplicate.name)

  // 1. Fill the survivor's blanks (up front, independent of the loops below).
  if (Object.keys(preview.fieldsToFill).length > 0) {
    await updateDoc(doc(db, 'suppliers', survivorId), {
      ...preview.fieldsToFill, updatedAt: serverTimestamp(),
    })
  }

  // 2. purchase_orders — repoint id AND refresh the denormalised snapshot
  //    (these two records are the same company, so the survivor's details are
  //    the canonical ones; a PO's printed supplier block should not keep the
  //    duplicate's name). Only overwrite a snapshot field when the survivor
  //    actually has a value — never blank a PO's supplier block.
  const poSnapshot = { supplier_id: survivorId }
  if (survName) poSnapshot.supplier_name = survName
  if (survNameCn) poSnapshot.supplier_name_cn = survNameCn
  if (survErp) poSnapshot.supplier_erp_code = survErp
  if (survAddr) poSnapshot.supplier_address = survAddr
  for (let i = 0; i < poSnap.docs.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const d of poSnap.docs.slice(i, i + CHUNK)) batch.update(d.ref, poSnapshot)
    await batch.commit()
  }

  // 3. supplier_quotes (both parent trees) — repoint id + refresh name.
  const quotePatch = survName
    ? { supplier_id: survivorId, supplier_name: survName }
    : { supplier_id: survivorId }
  for (let i = 0; i < quotes.all.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const d of quotes.all.slice(i, i + CHUNK)) batch.update(d.ref, quotePatch)
    await batch.commit()
  }

  // 4. range_components top-level pointer + its denormalised preferred name.
  //    componentIds touched by the quote repoint OR carrying the pointer.
  const rcIds = new Set(compPtrSnap.docs.map(d => d.id))
  quotes.range.forEach(d => rcIds.add(d.ref.path.split('/')[1]))
  const rcIdArr = [...rcIds]
  for (let i = 0; i < rcIdArr.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const rcId of rcIdArr.slice(i, i + CHUNK)) {
      const cur = compPtrSnap.docs.find(d => d.id === rcId)?.data() || null
      const patch = {}
      if (cur && str(cur.supplierId) === duplicateId) {
        patch.supplierId = survivorId
        if (dupName && survName && str(cur.supplierName) === dupName) patch.supplierName = survName
      }
      // preferred_supplier_name is denormalised from the preferred quote —
      // refresh only when it currently shows the duplicate's name (i.e. this
      // component was actually sourced from the dup). Guarded on a non-empty
      // dupName so a nameless broken duplicate can't blank-match everything.
      // Needs a read since the pointer-query snapshot doesn't include
      // components reached only via a repointed quote.
      const rcSnap = cur ? null : await getDoc(doc(db, 'range_components', rcId))
      const rcData = cur || rcSnap?.data()
      if (dupName && survName && rcData && str(rcData.preferred_supplier_name) === dupName) {
        patch.preferred_supplier_name = survName
      }
      if (Object.keys(patch).length) batch.update(doc(db, 'range_components', rcId), patch)
    }
    await batch.commit()
  }

  // 5. Move the media subcollections.
  await moveSubcollection('catalogs', duplicateId, survivorId)
  await moveSubcollection('images', duplicateId, survivorId)
  await moveSubcollection('videos', duplicateId, survivorId)

  // 6. Delete the duplicate.
  await deleteDoc(doc(db, 'suppliers', duplicateId))
  return preview
}
