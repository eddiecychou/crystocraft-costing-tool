// Customer product documents cannot establish live component availability.
// Keep internal stock, costs and the legacy migration behind supply permissions.
export function customerProductAvailability(product, { defaultPartsLeadWeeks = 6 } = {}) {
  const status = product?.status
  const base = { buildable: null, byPlating: {}, leadWeeks: null }
  if (status === 'concept') return { ...base, customerPromise: 'Concept — enquire to register interest.' }
  if (status === 'retired') return { ...base, buildable: 0, customerPromise: 'Retired — no stock remaining.' }
  const note = (product?.delivery_note || '').trim()
  if (note) return { ...base, customerPromise: note }
  if (status === 'stock') return { ...base, customerPromise: 'Final stock — availability and quantity confirmed on enquiry. No re-runs.' }
  if (Array.isArray(product?.critical_components) && product.critical_components.length) {
    return { ...base, customerPromise: 'Made to order — availability and lead time confirmed on enquiry.' }
  }
  const weeks = Number(defaultPartsLeadWeeks) + (Number(product?.lead_time_weeks) || 2)
  const moq = Number(product?.moq) > 0 ? `, MOQ ${Number(product.moq)}` : ''
  return { ...base, leadWeeks: weeks, customerPromise: `Made to order — ~${weeks} weeks${moq}.` }
}
