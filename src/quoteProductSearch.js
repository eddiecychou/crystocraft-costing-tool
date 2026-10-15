// Old Gift Range lines without a variant index only identify a SKU. Keep them
// excluded conservatively; indexed lines exclude only the exact source variant.
export function filterQuoteChoices(choices, search, existingKeys = []) {
  const existing = new Set(existingKeys)
  const term = String(search || '').trim().toLowerCase()
  return choices.filter(p => !existing.has(p.key) && !existing.has(p.legacyKey)
    && (!term || [p.name, p.category, p.sku, p.detail, p.design_code]
      .some(value => String(value || '').toLowerCase().includes(term))))
}
