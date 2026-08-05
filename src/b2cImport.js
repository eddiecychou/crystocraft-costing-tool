// Pure parser for ChunCi's B2C finished-goods stock export (卡斯库存 … .XLS,
// opened in WPS/Excel and pasted in). Kept free of any firebase import so it is
// unit-testable on its own; b2cStock.js re-exports it and wires it to the
// Finished Goods inventory class.
//
// The columns sit in a fixed layout but we key off the header row BY NAME, not
// position, so a reordered export still imports. Every row is an absolute count
// (a stock-take); the same code appearing under two warehouses is summed and
// both warehouses recorded in the note.

// Strip the trailing category code JES appends, e.g. "音乐盒系列.[01]" → "音乐盒系列".
export const cleanCategory = v => String(v || '').replace(/\s*\.\[\d+\]\s*$/, '').trim()

const HEADERS = {
  code:      ['条码', 'barcode', 'code', 'sku'],
  name:      ['商品名称', 'name', 'product'],
  category:  ['类别', 'category'],
  qty:       ['库存数量', 'qty', 'quantity', 'stock'],
  retail:    ['零售价', 'retail', 'price'],
  warehouse: ['仓库', 'warehouse'],
}
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null }

export function parseFinishedGoodsPaste(text) {
  const rows = String(text || '').split(/\r?\n/).map(l => l.split('\t').map(c => c.trim()))

  // Locate the header row: the first that carries a recognisable code column AND
  // a qty column (skips the title rows above the table).
  const matchCol = (cells, aliases) => cells.findIndex(c => aliases.includes(c))
  let hi = -1, idx = null
  for (let i = 0; i < rows.length; i++) {
    if (matchCol(rows[i], HEADERS.code) !== -1 && matchCol(rows[i], HEADERS.qty) !== -1) {
      hi = i
      idx = {}
      for (const key of Object.keys(HEADERS)) idx[key] = matchCol(rows[i], HEADERS[key])
      break
    }
  }
  if (hi === -1) return []

  const at = (cells, i) => (i >= 0 && i < cells.length ? cells[i] : '')
  const byCode = {}
  for (let i = hi + 1; i < rows.length; i++) {
    const cells = rows[i]
    const code = at(cells, idx.code).toUpperCase()
    if (!/\d/.test(code)) continue   // no code → footer/blank row
    const qty = num(at(cells, idx.qty))
    const wh  = at(cells, idx.warehouse)
    const c = byCode[code] || (byCode[code] = {
      code, name: at(cells, idx.name), category: cleanCategory(at(cells, idx.category)),
      retail_price: num(at(cells, idx.retail)), stock_qty: 0, _warehouses: new Set(),
    })
    if (qty != null) c.stock_qty += qty        // sum across warehouses
    if (wh) c._warehouses.add(wh)
  }

  return Object.values(byCode).map(c => ({
    code: c.code, name: c.name, category: c.category, size: '',
    retail_price: c.retail_price,
    notes: c._warehouses.size ? `仓库: ${[...c._warehouses].join(' + ')}` : '',
    stock_qty: c.stock_qty,
  }))
}
