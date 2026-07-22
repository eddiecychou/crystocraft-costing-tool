// Crystal bill of materials for a range product.
//
// Crystals decompose in a way components do not. A figurine needs a fixed set
// of *positions* — "thirteen 14mm octagons and nine 18 chatons" — and the
// colourway decides what fills them. That is why the ERP carries 34 rows per
// product where one row would do here.
//
// Shape stored on the product:
//
//   crystal_components: {
//     positions: [{ shape: 'octagon', size: '14', qty: 13 }, ...],
//     mixes:     { MX: [{ code: 'BDC-8232-0014-002', qty: 8 }, ...], ... },
//     source:    'erp' | 'manual',
//     derived_at: ISO string,
//   }
//
// A *mono* colourway needs no recipe: every position takes that one colour, and
// the crystal item is looked up by (shape, size, colour). Only *mixes* need an
// explicit list, because there is no rule that says how MX splits.
//
// Derived from the ERP item master (raw.itemdetail) — see
// migration/derive_crystal_bom.py. 277 of 280 product+plating combinations
// agree on their positions across every colourway they have been built in.

// Pattern number -> physical shape. Kept in step with the SHAPE table in
// migration/derive_crystal_bom.py; if one changes, change both.
//
// Only patterns whose shape is actually known belong here. An earlier version
// defaulted everything else to 'octagon', which described Swarovski 8102 (an
// oval) and Asfour 1032 as octagons. Unknown patterns are labelled '#8015'
// rather than guessed: shape is what decides whether two stones are
// interchangeable, so a wrong one is worse than none.
const SHAPE_BY_PATTERN = {
  1028: 'chaton', 1088: 'chaton',
  8016: 'octagon', 8116: 'octagon', 8232: 'octagon', 8249: 'octagon',
  1080: 'octagon', 1032: 'octagon', 8115: 'octagon', 8149: 'octagon',
  8102: 'oval',
  3130: 'heart',
}

// Offered in the position dropdown. Free text is allowed too, because the ERP
// carries shapes nobody has classified yet (almond, cashew, snowflake, leaf…).
export const SHAPES = ['octagon 2h', 'octagon 1h', 'chaton', 'oval 2h', 'oval 1h', 'heart']

// 'BDC-8232-0014-002' -> { family: 'BDC-8232', pattern: '8232', size: '14',
//                          suffix: '002', shape: 'octagon' }
// Sizes are stored inconsistently in the ERP ('0014' and '14' are the same
// stone), so leading zeros come off.
export function parseCrystalCode(code) {
  const parts = String(code || '').trim().toUpperCase().split('-')
  if (parts.length < 3) return null
  const [family, size, suffix] = parts.length >= 4
    ? [`${parts[0]}-${parts[1]}`, parts[2], parts[3]]
    : [parts[0], parts[1], parts[2]]
  const pattern = family.split('-').pop()
  return {
    family, pattern, suffix,
    size: size.replace(/^0+/, '') || size,
    shape: SHAPE_BY_PATTERN[pattern] || '',
  }
}

export const positionKey = (shape, size) => `${shape}|${size}`

export function emptyCrystalBom() {
  return { positions: [], mixes: {}, source: 'manual', derived_at: '' }
}

export function normaliseCrystalBom(raw) {
  const b = raw && typeof raw === 'object' ? raw : {}
  const positions = (Array.isArray(b.positions) ? b.positions : [])
    .map(p => ({
      shape: String(p.shape || '').trim(),
      size: String(p.size || '').trim(),
      qty: Number(p.qty) || 0,
    }))
    .filter(p => p.shape && p.size)
  const mixes = {}
  for (const [code, lines] of Object.entries(b.mixes || {})) {
    if (!Array.isArray(lines)) continue
    mixes[String(code).toUpperCase()] = lines
      .map(l => ({ code: String(l.code || '').trim().toUpperCase(), qty: Number(l.qty) || 0 }))
      .filter(l => l.code)
  }
  return {
    positions, mixes,
    source: b.source === 'erp' ? 'erp' : 'manual',
    derived_at: b.derived_at || '',
  }
}

export const totalStones = bom =>
  (bom?.positions || []).reduce((n, p) => n + (Number(p.qty) || 0), 0)

// Index the crystal stock list for (shape, size, colour) lookup. Several items
// can share a key when two suppliers stock the same stone in the same colour —
// Bohemia 8232/14 Crystal and Swarovski 8016/14 Crystal are both (octagon, 14,
// C1). Both are returned; the caller decides.
export function indexCrystals(crystals) {
  const idx = new Map()
  for (const c of crystals || []) {
    const p = parseCrystalCode(c.code)
    if (!p || !p.shape) continue
    const colour = String(c.colour || '').trim().toUpperCase()
    if (!colour) continue
    const k = `${p.shape}|${p.size}|${colour}`
    if (!idx.has(k)) idx.set(k, [])
    idx.get(k).push(c)
  }
  return idx
}

/**
 * What one unit of this product needs, in a given colourway.
 *
 * Returns { lines, unresolved }. `lines` are { code, qty, crystal } for stones
 * that resolved to a real inventory item. `unresolved` explains every position
 * or mix line that did not, because a crystal requirement that silently
 * disappears is worse than one that shows up as a question — the shortage is
 * only discovered at the bench.
 */
export function crystalRequirement(bom, colour, crystals) {
  const b = normaliseCrystalBom(bom)
  const col = String(colour || '').trim().toUpperCase()
  const lines = []
  const unresolved = []
  const byCode = new Map((crystals || []).map(c => [String(c.code || '').toUpperCase(), c]))

  const mix = b.mixes[col]
  if (mix) {
    for (const l of mix) {
      const crystal = byCode.get(l.code)
      if (crystal) lines.push({ code: l.code, qty: l.qty, crystal })
      else unresolved.push({ reason: 'not-in-inventory', code: l.code, qty: l.qty })
    }
    return { lines, unresolved }
  }

  // No recipe. If the colourway is a mix code the product offers but nobody has
  // defined, say so rather than treating it as a colour and resolving nonsense.
  if (isMixCode(col)) {
    unresolved.push({ reason: 'mix-not-defined', code: col, qty: totalStones(b) })
    return { lines, unresolved }
  }

  const idx = indexCrystals(crystals)
  for (const p of b.positions) {
    const hits = idx.get(`${p.shape}|${p.size}|${col}`) || []
    if (hits.length) lines.push({ code: hits[0].code, qty: p.qty, crystal: hits[0], alternatives: hits.slice(1) })
    else unresolved.push({ reason: 'no-stone-for-colour', shape: p.shape, size: p.size, colour: col, qty: p.qty })
  }
  return { lines, unresolved }
}

// MX / M1..M8 / AX / A1..A5 / GX / G1..G4 are recipe labels, not colours. They
// sit in the same crystal_colors array as PI and RE, so they have to be told
// apart by pattern.
export const isMixCode = code => /^(M[X0-9]|A[X0-9]|G[X0-9])$/.test(String(code || '').toUpperCase())
