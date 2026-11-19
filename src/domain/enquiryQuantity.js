// Old active Range lines saved a carton count even when the buyer chose pieces.
// Only status-exclusive modes are safe to infer from an old draft.
export function rangeOrderMode(line) {
  if (line.order_mode) return line.order_mode
  if (line.status === 'stock') return 'stock'
  if (line.status === 'concept') return 'interest'
  return ''
}

export const positiveWhole = n => Number.isSafeInteger(n) && n > 0

export function stockLimit(line, availability) {
  if (!availability?.verified) return null
  const plating = (line.plating_code || '').trim().toUpperCase()
  const colour = (line.color || '').trim().toUpperCase()
  const variants = availability.byVariant || {}
  const platings = availability.byPlating || {}
  const limit = colour && Object.keys(variants).length ? variants[plating + '|' + colour]
    : Object.keys(platings).length ? platings[plating] : availability.buildable
  return positiveWhole(limit) ? limit : 0
}

// Quantities already requested in this basket share the same stock ceiling.
// Colour-scoped BOMs publish independent variant limits; the server checks
// shared components across those colours (and across different designs).
export function remainingStock(line, availability, basket = []) {
  let remaining = stockLimit(line, availability)
  if (remaining == null || !basket.length) return remaining
  const scoped = Object.keys(availability.byVariant || {}).length > 0
  const plated = Object.keys(availability.byPlating || {}).length > 0
  let productUsed = 0
  for (const other of basket) {
    if (other === line || other.type !== 'figurine' || other.id !== line.id || rangeOrderMode(other) !== 'stock') continue
    productUsed += other.qty
    const samePlating = (other.plating_code || '') === (line.plating_code || '')
    if (scoped ? samePlating && other.color === line.color : !plated || samePlating) remaining -= other.qty
  }
  if (!scoped && Number.isFinite(availability.buildable)) remaining = Math.min(remaining, availability.buildable - productUsed)
  return Math.max(0, remaining)
}

export function quantityIssue(line, availability, basket) {
  const mode = rangeOrderMode(line)
  if (!positiveWhole(line.qty)) return 'Enter a positive whole quantity.'
  if (line.status === 'concept' && mode === 'interest') return ''
  if (!mode) return 'Choose how you would like this older selection supplied.'
  if (line.status === 'concept' || line.status === 'retired' ||
      (line.status === 'stock' && mode !== 'stock')) return 'This supply option has changed. Please reselect the design.'
  if (mode === 'mto') {
    const pack = line.pcs_per_carton
    if (!positiveWhole(pack)) return 'The carton size needs confirmation before this design can be requested by the carton.'
    return positiveWhole(line.cartons) && line.qty === line.cartons * pack ? '' : 'The carton size or quantity has changed. Please confirm the number of cartons.'
  }
  if (mode !== 'stock') return 'Please reselect the supply option.'
  const limit = remainingStock(line, availability, basket)
  if (limit === null) return 'Stock could not be confirmed. Please recheck availability.'
  return line.qty > limit ? 'Only ' + limit + ' pcs available for this selection.' : ''
}
