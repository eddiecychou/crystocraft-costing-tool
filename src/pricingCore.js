import { costToHKD } from './costCurrency.js'

// Pure pricing calculations shared by the browser editor and the MCP dry-run
// path. Pricing is calculated by code, never inferred by a model.
export const DEFAULT_MARKUP = 2.0

const hasCost = value => value != null && (typeof value !== 'string' || value.trim() !== '')

export function componentUnitCostAtQty(q, orderQty) {
  if (!hasCost(q?.unit_cost)) return null
  const tiers = Array.isArray(q.volume_tiers) ? q.volume_tiers : []
  const applicable = tiers
    .filter(t => t && t.min_qty <= orderQty)
    .sort((a, b) => b.min_qty - a.min_qty)[0]
  return Number(hasCost(applicable?.unit_cost) ? applicable.unit_cost : q.unit_cost)
}

export function unitCostHKDAtQty(components, rates, orderQty) {
  let total = 0
  for (const c of components) {
    const q = c.preferred_quote
    if (!q) continue
    const unitCost = componentUnitCostAtQty(q, orderQty)
    if (unitCost == null) continue
    const converted = costToHKD(unitCost, q.unit_cost_currency, rates)
    if (converted == null) return null
    total += converted * (Number(c.qty_per_product) || 1)
  }
  return total
}

export function toolingCostHKD(components, rates) {
  let total = 0
  for (const c of components) {
    const q = c.preferred_quote
    if (!q || !q.tooling_sample_cost) continue
    const converted = costToHKD(q.tooling_sample_cost, q.tooling_sample_cost_currency, rates)
    if (converted == null) return null
    total += converted
  }
  return total
}

export function totalUnitCostAtQty(components, rates, qty) {
  const recurring = unitCostHKDAtQty(components, rates, qty)
  const tooling = toolingCostHKD(components, rates)
  if (recurring == null || tooling == null) return null
  return recurring + (qty > 0 ? tooling / qty : 0)
}
