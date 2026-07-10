// Purchase Order helpers — shared by the editor, detail, and print views.
// A PO is a point-in-time snapshot: supplier details are denormalised onto the
// doc so a PO prints identically even after the supplier record is edited.

export const emptyLine = () => ({
  _uid: 'ln_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  code: '', description: '', qty: '', unit: 'pcs', unit_price: '',
  linked: null,   // optional { type:'corp'|'range', product_id?, component_id, label }
})

// Per-line amount = qty × unit price (0 when either is blank/invalid).
export const lineAmount = ln => {
  const q = Number(ln.qty), p = Number(ln.unit_price)
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0
}

// Roll a PO's lines + deposit into the numbers shown everywhere.
export function poTotals(po) {
  const lines = po?.lines || []
  const subtotal = lines.reduce((s, ln) => s + lineAmount(ln), 0)
  const totalQty = lines.reduce((s, ln) => s + (Number(ln.qty) || 0), 0)
  const depPct = Number(po?.deposit_pct)
  const deposit = Number.isFinite(depPct) && depPct > 0 ? subtotal * (depPct / 100) : 0
  const balance = subtotal - deposit
  return { subtotal, totalQty, deposit, balance }
}

// Strip UI-only fields and coerce numeric strings before writing to Firestore.
export function cleanLines(lines) {
  return (lines || [])
    .filter(ln => (ln.code || ln.description || ln.qty || ln.unit_price))
    .map(ln => {
      const out = {
        code: (ln.code || '').trim(),
        description: (ln.description || '').trim(),
        qty: Number(ln.qty) || 0,
        unit: ln.unit || 'pcs',
        unit_price: Number(ln.unit_price) || 0,
      }
      if (ln.linked?.component_id) {
        out.linked = {
          type: ln.linked.type || 'corp',
          component_id: ln.linked.component_id,
          label: ln.linked.label || '',
          ...(ln.linked.product_id ? { product_id: ln.linked.product_id } : {}),
        }
      }
      return out
    })
}

// Unique component ids linked anywhere on the PO — denormalised onto the doc so
// a component page can find its POs with a single array-contains query.
export function linkedComponentIds(lines) {
  return [...new Set((lines || []).map(ln => ln.linked?.component_id).filter(Boolean))]
}
