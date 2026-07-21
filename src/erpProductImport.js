// Create a figurine range product from the ERP item master, instead of
// re-typing what JES already knows. Requested 2026-07-21 to save XiangXia the
// re-keying of FM components that are already in the ERP's BOM.
//
// WHAT THE ERP CAN AND CANNOT GIVE
//
// It gives identity and structure: the item code, its description, its image,
// and the parts list. It gives NO costs — `erp_item.srp` is 0 across the board
// and the cost columns were found empty in V7.15 §4c. So an import produces a
// product that is correctly *shaped* and entirely *uncosted*, and the costing
// stays exactly where it is today: the app's job, from supplier quotes.
//
// THE VARIANT PROBLEM, which is the whole difficulty here.
//
// A range product in the app covers a design across every plating and crystal
// colour. The ERP has no such concept — there is no bare `D0268-001` item, only
// D0268-001-CAB, -CABT, -CC1, -GAB, -GC1, -GGT. Each carries its own BOM, and
// they differ: the gold variants reference gold-plated parts, the chrome ones
// chrome. Importing a single variant would silently produce a product missing
// every part specific to the others.
//
// So this reads EVERY ERP variant of the design and merges their level-1 BOMs,
// recording which variants each part appears in. A part present in only some
// variants is still imported — it is a real part — but the preview says so,
// because that is usually plating-specific and the person importing should see
// it rather than discover it in a costing later.
//
// The same reasoning is already written down in erpBomCoverage.js, which
// checks an existing costing the same way round.
import { erpBom, erpLookup } from './erpApi'
import { loadComponents, saveComponent } from './criticalComponents'
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const norm = (v) => String(v ?? '').trim().toUpperCase()

// "D0268-001-GGT" or "D0268-001" → "D0268-001". Splitting on the first two
// segments matches how matchProductCode reads a code: design, then format.
export function designBaseOf(code) {
  const parts = norm(code).split('-')
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : parts[0] || ''
}

// "D0268-001" → { brand_code: 'D', design_no: '0268', format_code: '001' }.
// The brand letter is a single leading alpha; everything after it is the design
// number, which is why stripBrandLetters exists in criticalComponents.
export function parseDesignBase(base) {
  const [head = '', format = ''] = norm(base).split('-')
  const m = head.match(/^([A-Z]?)(.*)$/)
  return { brand_code: m?.[1] || '', design_no: m?.[2] || head, format_code: format }
}

// Item types worth importing as app components. SF is the semi-finished metal
// part (every FM-* code); ST is crystal, which the app models separately and
// deliberately does NOT auto-create — see the return value.
const COMPONENT_TYPE = 'SF'
const CRYSTAL_TYPE = 'ST'

/**
 * Read-only. Everything the import would create, for review before anything
 * is written. Never touches Firestore.
 *
 * Returns {
 *   base, name, image, variants[],
 *   components: [{ code, name, qty, inVariants[], partial, existing }],
 *   crystals:   [{ code, qty, inVariants[] }],
 *   warnings[]
 * }
 */
export async function previewErpProduct(codeOrBase) {
  const base = designBaseOf(codeOrBase)
  if (!base) return null
  const warnings = []

  // Every ERP item under this design base. Searching the base rather than the
  // full code is what finds the sibling variants.
  const found = await erpLookup('item', { q: base, limit: 100 })
  const variants = (found || [])
    .filter((r) => norm(r.code).startsWith(`${base}-`) || norm(r.code) === base)
    .filter((r) => norm(r.type) === 'FG')
  if (!variants.length) return { base, name: '', image: '', variants: [], components: [], crystals: [], warnings: ['No finished-goods item in the ERP under this code.'] }

  // Description and image come from the variants — they agree in practice
  // ("Zodiac - Pisces- Free Stand" on all six), so the first non-empty wins.
  const name = variants.find((v) => v.name)?.name || ''
  const image = variants.find((v) => v.picture1)?.picture1 || ''

  // Level 1 only. The app's critical_components are the parts actually bought
  // or made for this product; exploding deeper would import a sub-assembly's
  // internals as if they were direct parts of the figurine.
  const merged = new Map()
  for (const v of variants) {
    let rows = []
    try {
      rows = await erpBom(v.code)
    } catch {
      warnings.push(`Could not read the ERP BOM for ${v.code} — its parts are not included.`)
      continue
    }
    for (const r of rows || []) {
      if (Number(r.level) !== 1) continue
      const code = norm(r.component_code)
      if (!code) continue
      const cur = merged.get(code) || {
        code, type: norm(r.component_type), name: '',
        qty: 0, inVariants: [],
      }
      // Max, not sum: each variant is one finished piece, so the same part
      // appearing across five variants still means one per unit. Taking the
      // max keeps a genuinely higher qty (4 crystals) without multiplying it.
      cur.qty = Math.max(cur.qty, Number(r.qty) || 1)
      cur.inVariants.push(v.code)
      merged.set(code, cur)
    }
  }

  const all = [...merged.values()]
  const total = variants.length

  // Names for the parts, from the item master. One lookup per part would be
  // dozens of round trips, so this is a single search per code only for those
  // the app does not already know — see below.
  const existing = await loadComponents().catch(() => [])
  const existingByCode = new Map(existing.map((c) => [norm(c.code), c]))

  const components = all
    .filter((c) => c.type === COMPONENT_TYPE)
    .map((c) => ({
      ...c,
      existing: existingByCode.get(c.code) || null,
      // Present in some variants but not all — almost always plating-specific.
      partial: c.inVariants.length < total,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  const crystals = all
    .filter((c) => c.type === CRYSTAL_TYPE)
    .map((c) => ({ ...c, partial: c.inVariants.length < total }))
    .sort((a, b) => a.code.localeCompare(b.code))

  if (crystals.length) {
    // Not a failure — a statement of scope. The app costs crystals through
    // crystal_bom keyed by brand and colour, which carries information the ERP
    // BOM does not have, so guessing it would be worse than leaving it.
    warnings.push(`${crystals.length} crystal part${crystals.length === 1 ? '' : 's'} found. Crystals are not imported — add them in the costing's crystal BOM, where brand and colour are set.`)
  }
  const other = all.filter((c) => c.type !== COMPONENT_TYPE && c.type !== CRYSTAL_TYPE)
  if (other.length) warnings.push(`${other.length} part${other.length === 1 ? '' : 's'} of another item type were skipped: ${other.slice(0, 4).map((o) => o.code).join(', ')}${other.length > 4 ? '…' : ''}`)

  return { base, name, image, variants: variants.map((v) => v.code), components, crystals, warnings }
}

/**
 * Writes the preview. Creates the range product HIDDEN, upserts any component
 * the app does not have, and links them all as critical_components.
 *
 * Returns { productId, componentsCreated, componentsLinked }.
 */
export async function applyErpProduct(preview, { selectedCodes } = {}) {
  if (!preview?.base) throw new Error('Nothing to import.')
  const { brand_code, design_no, format_code } = parseDesignBase(preview.base)

  const take = selectedCodes
    ? preview.components.filter((c) => selectedCodes.includes(c.code))
    : preview.components

  // Components first: the product's refs carry their ids, so they must exist.
  let created = 0
  const refs = []
  for (const c of take) {
    let id = c.existing?.id
    if (!id) {
      // Only identity is written. Cost, stock and lead time are left null —
      // the ERP has none of them, and a zero would read as "free" rather than
      // "not costed yet".
      id = await saveComponent(null, {
        code: c.code,
        name: c.name || '',
        notes: `Imported from the JES item master on ${new Date().toISOString().slice(0, 10)} (BOM of ${preview.base}).`,
      })
      created += 1
    }
    refs.push({ id, code: c.code, qty_per_unit: c.qty > 0 ? c.qty : 1, plating_code: '' })
  }

  const ref = await addDoc(collection(db, 'range_products'), {
    brand_code, design_no, format_code,
    design_code: preview.base,
    description: preview.name || '',
    // HIDDEN by default, as asked. An imported product is a shell — no costing,
    // no images of our own, no marketing copy — so it must not reach a
    // catalogue or the storefront until someone has finished it and ticked
    // Visible. FigurineShop and loadBlogProducts both filter `active !== false`.
    active: false,
    status: 'concept',
    // Records where it came from, so a half-finished import is identifiable
    // later rather than looking like someone's abandoned draft.
    source: 'erp_import',
    erp_imported_at: new Date().toISOString().slice(0, 10),
    critical_components: refs,
    createdAt: serverTimestamp(),
  })

  return { productId: ref.id, componentsCreated: created, componentsLinked: refs.length }
}

// Stamp the ERP image filename onto the product once it exists. Kept separate
// because the image lives in a private bucket and needs signing to display —
// the filename alone is what is worth storing.
export async function setErpImage(productId, picture1) {
  if (!productId || !picture1) return
  await updateDoc(doc(db, 'range_products', productId), { erp_picture1: picture1 })
}
