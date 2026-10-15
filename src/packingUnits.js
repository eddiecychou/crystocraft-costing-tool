// Explicit carton snapshots win. Legacy cartons recover the unit from their
// linked order line, or an unambiguous code match. Manual legacy rows used pcs.
export function packingItemUnit(item, orderLines = []) {
  if (item.unit?.trim()) return item.unit.trim()
  const linked = item.order_line_id ? orderLines.find(l => l.id === item.order_line_id) : null
  if (linked) return linked.unit || 'pcs'
  const code = (item.item_code || '').trim().toUpperCase()
  const matches = code ? orderLines.filter(l => (l.item_code || '').trim().toUpperCase() === code) : []
  const units = [...new Set(matches.map(l => l.unit || 'pcs'))]
  return units.length > 1 ? '' : units[0] || 'pcs'
}
export function withPackingUnits(cartons, orderLines = []) {
  return cartons.map(c => ({ ...c, contents:(c.contents || []).map(i => ({...i, unit:packingItemUnit(i, orderLines)})) }))
}
export function quantityUnitTotals(lines) {
  const totals = new Map()
  for (const l of lines) {
    const unit = l.unit === '' ? 'unit not set' : l.unit || 'pcs'
    totals.set(unit, (totals.get(unit) || 0) + (Number(l.qty) || 0))
  }
  return [...totals].map(([unit,qty]) => ({unit,qty}))
}
export const quantityUnitLabel = lines => quantityUnitTotals(lines).map(l => `${Number(l.qty.toFixed(8))} ${l.unit}`).join(' · ')
export const packingQuantityLines = cartons => cartons.flatMap(c => (c.contents || []).map(i => ({qty:(Number(i.qty) || 0) * (parseInt(c.carton_count) || 1), unit:i.unit})))
