// Check a range product's costing against the ERP's bill of materials.
//
// The ERP knows what is physically in a product (31,154 of 31,494 finished
// goods have a BOM); the app knows what things cost (the ERP's cost columns are
// empty — see V7.15_ERP_Inventory.md §4c). So the ERP can answer the one
// question a costing can't ask itself: is anything in this product not being
// costed at all?
//
// IMPORTANT: a costing covers the whole design across every plating and crystal
// colour, but the ERP keys BOMs at the full variant code — there is no bare
// `D0002-001` item, only D0002-001-CAB, -CGR, -CVL, -GAB, -GC1. So this checks
// EVERY ERP variant of the design and merges them. Checking one variant would
// both miss the plating-specific parts of the others and fail outright when the
// app can enumerate a combination the ERP doesn't stock.
//
// It reports, never edits — a costing legitimately rolls some BOM lines into
// others, so nothing here is automatically an error.
import { erpBom, erpLookup } from './erpApi'

const norm = (v) => String(v ?? '').trim().toUpperCase()

// NOTE — no fuzzy code matching here, deliberately.
//
// The app's component codes have drifted from the ERP's: FM-K(21)01-C here vs
// FM-K(21)-C there, FM-K(32).03-C vs FM-K(32)-C, FM-S(KB)1-ORNT(G) vs
// FM-S(KB)-ORNT(G). So parts that ARE costed can be reported as uncosted.
//
// Edit-distance matching was tried and removed. Because the distinguishing part
// of these codes is a short digit run — (21) vs (32) vs (5) — and the plating
// suffix is a single character, near-matching kept pairing the wrong part:
// FM-K(32)-G matched FM-K(21)-G (distance 2) in preference to the correct
// FM-K(32).03-G (distance 3), and FM-K(5)-G matched FM-K(21)-G outright. On a
// costing screen a confident wrong suggestion is worse than none, because
// someone may act on it.
//
// The real fix is aligning the codes, not guessing across them. Until then the
// panel says plainly that codes may differ and shows what is costed, so a human
// compares.

// Packaging is P-prefixed in the ERP (P-PB007ROS gift box, P-TA001 hang tag,
// P-TP028 tissue paper, P-SG001 silica gel). The app models packaging as pooled
// stock with no per-product BOM, so these are expected to be uncosted — worth
// showing, but as information rather than as an error.
const isPackaging = (code) => /^P-/i.test(String(code || ''))

// Cap the number of variants exploded. Designs here run to ~5 variants; the cap
// only guards against a pathological design issuing dozens of requests.
const MAX_VARIANTS = 12

/**
 * @param prefixes   design-level code prefixes, e.g. ['D0002-001'] (a design
 *                   sold under several crystal brands yields several)
 * @param componentCodes  codes the product costs via critical_components
 * @param crystalBomLines the costing's crystal_bom lines
 */
export async function checkBomCoverage(prefixes, componentCodes, crystalBomLines) {
  const wanted = [...new Set((prefixes || []).map(norm).filter(Boolean))]
  if (!wanted.length) return null

  // Find the ERP's own variant codes for these designs. Search by prefix rather
  // than trusting the app's enumerated SKUs — the app can produce a
  // plating/colour combination the ERP never stocked (D0002-001-CC1 does not
  // exist while five siblings do), and that is not a costing error.
  const found = []
  for (const p of wanted) {
    const rows = await erpLookup('item', { q: p, limit: 100 })
    for (const r of rows || []) {
      if (r.has_bom && norm(r.code).startsWith(p + '-')) found.push(r.code)
    }
  }
  const variants = [...new Set(found)].sort().slice(0, MAX_VARIANTS)
  if (!variants.length) return { prefixes: wanted, variants: [], parts: [], noneFound: true }

  // LEVEL 1 ONLY. Level 2 is the historical in-house process: the factory used
  // to buy raw alloy (AY: MR040/74-04A, MS100(146/1219)-04D …) and make the
  // FM metal parts itself. Those FM parts are now bought finished from vendors,
  // so the raw material below them is no longer purchased and reporting it is
  // pure noise — it was five of the ten "uncosted" lines on D0002-001.
  // Level 1 is exactly what a finished good consumes today: stones, FM parts,
  // packaging. (If in-house production ever resumes, drop this filter.)
  const parts = new Map()   // code -> { code, type, ext_qty, in:Set }
  for (const code of variants) {
    const rows = await erpBom(code)
    for (const r of (rows || []).filter((x) => Number(x.level) === 1)) {
      const key = norm(r.component_code)
      if (!parts.has(key)) {
        parts.set(key, {
          code: r.component_code, type: r.component_type, ext_qty: r.ext_qty,
          in: new Set(),
        })
      }
      parts.get(key).in.add(code)
    }
  }

  const costed = new Set((componentCodes || []).map(norm).filter(Boolean))
  const crystalLines = (crystalBomLines || []).filter((l) => l.size || l.qty)

  // Every level-1 part hangs directly off the finished good, so there are no
  // ancestors to consider and `is_assembly` is irrelevant here: FM-C(32).01-P
  // still HAS children in the ERP, but it is bought finished, so it is a leaf
  // for costing purposes and must be reported like any other purchased part.
  const buckets = { costed: [], crystals: [], packaging: [], uncosted: [] }
  for (const p of parts.values()) {
    const entry = { ...p, variants: [...p.in], shared: p.in.size === variants.length }
    if (costed.has(norm(p.code))) { buckets.costed.push(entry); continue }
    if (p.type === 'ST') { buckets.crystals.push(entry); continue }
    if (isPackaging(p.code)) { buckets.packaging.push(entry); continue }
    buckets.uncosted.push(entry)
  }

  const byShared = (a, b) => (a.shared === b.shared ? a.code.localeCompare(b.code) : a.shared ? -1 : 1)
  for (const k of ['costed', 'crystals', 'packaging', 'uncosted']) buckets[k].sort(byShared)

  return {
    prefixes: wanted,
    variants,
    total: buckets.costed.length + buckets.crystals.length
         + buckets.packaging.length + buckets.uncosted.length,
    // What the product costs, so the panel can show it next to the ERP's codes
    // — the two code sets differ and only a human can pair them.
    costedCodes: [...costed].sort(),
    ...buckets,
    // Stones are costed by size × brand here and by item code in the ERP, and
    // the code varies per colour — so they can never be matched code-to-code.
    // The honest statement is whether the counts are comparable.
    crystalMismatch:
      buckets.crystals.length > 0 && crystalLines.length === 0 ? 'none' : null,
    crystalLineCount: crystalLines.length,
  }
}
