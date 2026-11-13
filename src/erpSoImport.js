// Cross-check a parsed PI against the ERP's own sales order.
//
// The PI the team uploads IS the JES sales order (SO), and its lines already
// exist as structured rows in the ERP mirror — so AI-parsing a PDF of them is
// recovering data we hold. This compares the two and lets the ERP's version
// win, which removes extraction errors and stops the app keeping a re-parsed
// copy that can drift from the original.
//
// Freshness caveat: the mirror is only as current as the last sync, so an SO
// raised today may not be there. That is why this AUGMENTS the parser rather
// than replacing it — no match, no change, nothing breaks.
import { erpLines } from './erpApi'
import { numOrNull, str } from './domain/validation.js'
import { DEFAULT_ORDER_LINE_UNIT } from './shippingModel.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Item codes are compared loosely: the parser reads them off a PDF, so case
// and stray whitespace differ constantly and are not real discrepancies.
const normCode = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')

// Money/qty compared with a small tolerance — a parsed "2.320" and an ERP
// 2.32 are the same number, and float noise shouldn't read as a difference.
const near = (a, b) => {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a - b) < 0.005
}

// ERP line -> the app's line shape (see shipping.js normalisation).
export function lineFromErp(r, i) {
  return {
    line_no: num(r.seq) ?? i + 1,
    item_code: (r.item_code || '').trim(),
    description: (r.description || '').trim(),
    qty_ordered: num(r.qty),
    unit: str(r.unit),
    unit_price: num(r.unit_price),
  }
}

export async function fetchErpSoLines(soNo) {
  const code = String(soNo || '').trim()
    // The PI may show "SO260026" or a messier reference; keep it conservative
    // and only look up something that looks like an SO number.
  if (!/^SO[0-9]{4,10}$/i.test(code)) return null
  const { rows } = await erpLines('sales_order', code.toUpperCase())
  if (!rows || !rows.length) return null
  return rows.map(lineFromErp)
}

function groupByItemCode(lines) {
  const groups = new Map()
  for (const line of lines) {
    const code = normCode(line.item_code)
    if (!code) continue
    if (!groups.has(code)) groups.set(code, [])
    groups.get(code).push(line)
  }
  return groups
}

// Repeated codes can identify different variants or charges. Use an exact,
// one-to-one quantity and price match before carrying over any of their units.
function matchingDraftLine(erpLine, erpGroup, draftGroup) {
  if (!draftGroup.length) return null
  if (erpGroup.length === 1 && draftGroup.length === 1) return draftGroup[0]
  const qty = numOrNull(erpLine.qty_ordered)
  const price = numOrNull(erpLine.unit_price)
  if (qty == null || price == null) return null
  const sameAmounts = line => numOrNull(line.qty_ordered) === qty && numOrNull(line.unit_price) === price
  const candidates = draftGroup.filter(sameAmounts)
  return candidates.length === 1 && erpGroup.filter(sameAmounts).length === 1 ? candidates[0] : null
}

export function adoptErpLineUnits(erpLines, draftLines) {
  const erpByCode = groupByItemCode(erpLines)
  const draftByCode = groupByItemCode(draftLines)
  const defaultedLineNumbers = []
  const lines = erpLines.map((line, index) => {
    const code = normCode(line.item_code)
    const draft = matchingDraftLine(line, erpByCode.get(code) || [], draftByCode.get(code) || [])
    const unit = str(line.unit) || str(draft?.unit)
    if (!unit) defaultedLineNumbers.push(line.line_no ?? index + 1)
    return { ...line, unit: unit || DEFAULT_ORDER_LINE_UNIT }
  })
  return { lines, defaultedLineNumbers }
}

// Compare parsed lines against the ERP's, matched on item code.
// Returns { erpLines, same, differing, onlyParsed, onlyErp }.
export function diffLines(parsed, erp) {
  const byCode = new Map()
  for (const l of erp) {
    const k = normCode(l.item_code)
    if (k) byCode.set(k, l)
  }

  const same = []
  const differing = []
  const onlyParsed = []
  const seen = new Set()

  for (const p of parsed || []) {
    const k = normCode(p.item_code)
    const e = k ? byCode.get(k) : null
    if (!e) { onlyParsed.push(p); continue }
    seen.add(k)
    const fields = []
    if (!near(num(p.qty_ordered), e.qty_ordered)) {
      fields.push({ field: 'qty', parsed: p.qty_ordered, erp: e.qty_ordered })
    }
    if (!near(num(p.unit_price), e.unit_price)) {
      fields.push({ field: 'unit price', parsed: p.unit_price, erp: e.unit_price })
    }
    if (fields.length) differing.push({ item_code: e.item_code, fields })
    else same.push(e.item_code)
  }

  const onlyErp = erp.filter((e) => !seen.has(normCode(e.item_code)))
  return { same, differing, onlyParsed, onlyErp }
}
