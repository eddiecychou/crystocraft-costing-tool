// Multiple named contacts per supplier (owner, 2026-08-28: supplier sales reps
// come and go, so more than one needs registering and a departed one kept for
// history rather than deleted).
//
// Mirrors the customers/ contacts[] pattern (src/domain/customer.js) but kept
// separate — suppliers have no domain module and this is the only piece that
// needs shared logic. Each contact is one real person with ONE of each channel
// (phone / wechat / whatsapp / email); the supplier-level phones[]/emails[]
// arrays stay as they are for general office lines.
//
// Shape: { id, name, title, phone, wechat, whatsapp, email, is_primary, active }
//
// Backward-compat: the flat supplier fields (contact_person, wechat_id,
// whatsapp) are kept as a denormalised mirror of the PRIMARY active contact so
// every existing reader keeps working — the PO form (stamps supplier_contact
// onto the PO), the supplier list, the quote picker, the ERP import.

const str = v => (v == null ? '' : String(v).trim())

export const genContactId = () =>
  `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function normalizeSupplierContact(c) {
  return {
    id: str(c?.id) || genContactId(),
    name: str(c?.name),
    title: str(c?.title),
    phone: str(c?.phone),
    wechat: str(c?.wechat),
    whatsapp: str(c?.whatsapp),
    email: str(c?.email),
    is_primary: !!c?.is_primary,
    // Missing `active` on an older/imported contact means active — only an
    // explicit false marks a departed rep.
    active: c?.active !== false,
  }
}

// The supplier's contacts as a clean array. Falls back to synthesising ONE
// primary contact from the legacy flat fields when no contacts[] exists yet,
// so a supplier that has never been re-saved still shows its contact person.
export function supplierContactsOf(supplier) {
  if (Array.isArray(supplier?.contacts) && supplier.contacts.length) {
    const list = supplier.contacts.map(normalizeSupplierContact)
    if (!list.some(c => c.is_primary && c.active)) {
      const first = list.find(c => c.active) || list[0]
      if (first) first.is_primary = true
    }
    return list
  }
  const name = str(supplier?.contact_person)
  const phone = str(supplier?.phones?.[0] ?? supplier?.phone)
  const wechat = str(supplier?.wechat_id)
  const whatsapp = str(supplier?.whatsapp)
  const email = str(supplier?.emails?.[0] ?? supplier?.email)
  if (!name && !phone && !wechat && !whatsapp && !email) return []
  return [{
    id: 'legacy', name, title: '', phone, wechat, whatsapp, email,
    is_primary: true, active: true,
  }]
}

export const primarySupplierContact = list => {
  const arr = list || []
  return arr.find(c => c.is_primary && c.active) || arr.find(c => c.active) || arr[0] || null
}

export const activeSupplierContacts   = list => (list || []).filter(c => c.active)
export const inactiveSupplierContacts = list => (list || []).filter(c => !c.active)

// The denormalised flat fields to write alongside contacts[] on save, mirroring
// the primary active contact. phones[]/emails[] are NOT touched here — those
// stay the supplier-level office lists.
export function flatFieldsFromContacts(list) {
  const p = primarySupplierContact(list)
  return {
    contact_person: p?.name || '',
    wechat_id: p?.wechat || '',
    whatsapp: p?.whatsapp || '',
  }
}

// Prepare an edited list for saving: normalise, drop fully-blank rows, and
// guarantee exactly one primary among the active contacts.
export function cleanSupplierContacts(list) {
  const out = (list || [])
    .map(normalizeSupplierContact)
    .filter(c => c.name || c.phone || c.wechat || c.whatsapp || c.email)
  const active = out.filter(c => c.active)
  if (active.length && !active.some(c => c.is_primary)) active[0].is_primary = true
  // Never leave a primary flag on an inactive contact or on more than one.
  let seenPrimary = false
  for (const c of out) {
    if (c.is_primary && c.active && !seenPrimary) { seenPrimary = true; continue }
    c.is_primary = false
  }
  if (!seenPrimary && active[0]) active[0].is_primary = true
  return out
}
