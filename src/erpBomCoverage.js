// Check a range product's costing against the ERP's own bill of materials.
//
// The ERP knows what is physically in a product (99% of finished goods have a
// BOM); the app knows what things cost (the ERP's cost columns are empty — see
// V7.15_ERP_Inventory.md §4c). So the ERP can answer one question the costing
// can't ask itself: "is anything in this product not being costed at all?"
//
// This reports. It never changes a costing — the ERP BOM is the manufacturing
// bill, and a costing legitimately rolls some of it into other lines.
import { erpBom } from './erpApi'

const norm = (v) => String(v ?? '').trim().toUpperCase()

// Packaging codes are P-prefixed in the ERP (P-PB007ROS gift box, P-TA001 hang
// tag, P-TP028 tissue paper, P-SG001 silica gel). The app models packaging as
// pooled stock with no per-product BOM, so these are expected to be uncosted —
// worth showing, but as information rather than as an error.
const isPackaging = (code) => /^P-/i.test(String(code || ''))

/**
 * @param sku              an ERP item code (the app's SKU format matches it)
 * @param componentCodes   codes the product costs via critical_components
 * @param crystalBomLines  the costing's crystal_bom lines
 */
export async function checkBomCoverage(sku, componentCodes, crystalBomLines) {
  const rows = await erpBom(sku)
  if (!rows || !rows.length) return null

  const costed = new Set((componentCodes || []).map(norm).filter(Boolean))
  const crystalLines = (crystalBomLines || []).filter((l) => l.size || l.qty)

  // A part is accounted for if IT is costed, or if any ASSEMBLY above it is —
  // costing "the base plate" covers the sheet metal inside it, and reporting
  // that sheet as uncosted would be a false alarm. explode_bom returns `path`,
  // the chain of codes from the root, which is what makes this checkable.
  const coveredByAncestor = (r) =>
    (r.path || []).some((p) => costed.has(norm(p)))

  const buckets = { costed: [], crystals: [], packaging: [], uncosted: [] }
  for (const r of rows) {
    const code = r.component_code
    if (costed.has(norm(code))) { buckets.costed.push(r); continue }
    if (coveredByAncestor(r)) continue          // rolled up into a costed parent
    // Otherwise only leaves are reportable: an assembly that isn't costed will
    // have its own children reported, so listing both would double-count.
    if (r.is_assembly) continue
    if (r.component_type === 'ST') { buckets.crystals.push(r); continue }
    if (isPackaging(code)) { buckets.packaging.push(r); continue }
    buckets.uncosted.push(r)
  }

  return {
    sku,
    total: leaves.length,
    ...buckets,
    // Crystals are costed by size × brand, not by ERP stone code, so they can
    // never be matched code-to-code. The most we can honestly say is whether
    // the counts are in the same ballpark.
    crystalMismatch:
      buckets.crystals.length > 0 && crystalLines.length === 0
        ? 'none'
        : buckets.crystals.length !== crystalLines.length
        ? 'count'
        : null,
    crystalLineCount: crystalLines.length,
  }
}
