const classes = [
  { collection: 'range_components', key: 'components', label: 'Metal components', lines: 'component_lines', legacy: 'issued_lines', id: 'component_id' },
  { collection: 'crystals', key: 'crystals', label: 'Crystals', lines: 'crystal_lines', legacy: 'crystal_issued_lines', id: 'crystal_id' },
  { collection: 'packaging', key: 'packaging', label: 'Packaging', lines: 'packaging_lines', legacy: 'packaging_issued_lines', id: 'packaging_id' },
]

export function closureStock(order, movements) {
  return classes.map(kind => {
    const net = new Map(), consumed = new Map()
    let invalid = false
    for (const movement of movements) {
      const item = movement.ref.parent.parent
      if (item.parent.id !== kind.collection) continue
      const { reserved_qty, qty, type } = movement.data()
      if (!Number.isFinite(reserved_qty ?? 0) || (['reserve', 'release', 'produce'].includes(type) && !Number.isFinite(reserved_qty))) invalid = true
      net.set(item.id, (net.get(item.id) || 0) + (reserved_qty ?? 0))
      if (type === 'produce' || type === 'issue' || (type === 'adjustment' && movement.id.startsWith('reverse_produce_'))) {
        if (!Number.isFinite(qty)) invalid = true
        consumed.set(item.id, (consumed.get(item.id) || 0) - (qty ?? 0))
      }
    }
    const committed = order[`${kind.key}_committed`] || order[`${kind.key}_issued`]
    const reserved = order[`${kind.key}_reserved`] && !committed
    const lines = order[kind.lines]?.length ? order[kind.lines] : (order[kind.legacy] || [])
    const matches = (balances, expected) => {
      if (!Array.isArray(expected)) return false
      const quantities = new Map()
      for (const line of expected) {
        const id = line?.[kind.id], qty = Number(line?.qty)
        if (!id || !Number.isFinite(qty) || qty <= 0) return false
        quantities.set(id, (quantities.get(id) || 0) + qty)
      }
      for (const [id, qty] of balances) if (Math.abs(qty - (quantities.get(id) || 0)) >= 1e-7) return false
      return [...quantities].every(([id, qty]) => Math.abs(qty - (balances.get(id) || 0)) < 1e-7)
    }
    const interrupted = order[`${kind.key}_stock_pending`] || invalid ||
      !matches(net, reserved ? lines : []) || !matches(consumed, committed ? lines : []) ||
      ((reserved || committed) && !lines.length)
    return { label: kind.label, state: interrupted ? 'review' : reserved ? 'reserved' : committed ? 'consumed' : 'clear' }
  })
}
