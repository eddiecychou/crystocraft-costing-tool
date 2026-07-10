import { createInventoryClass } from './inventoryClass'

// Crystal inventory — one instance of the generic simple-inventory class
// (inventoryClass.js). Per-colour SKUs (each an ERP code, e.g.
// BDC-8232-0014-005 = Rosaline/PI), stocked and consumed batch-per-order with
// no per-product BOM. Field names are unchanged from the original crystals.js
// (`colour`), so existing data needs no migration.

const api = createInventoryClass({ collectionName: 'crystals', attrField: 'colour' })

export const loadCrystals = api.load
export const useCrystals = api.useItems
export const saveCrystal = api.save
export const deleteCrystal = api.remove
export const importCrystalStock = api.importStock

// Config shared by the stock tab, the order-issue card, and the order-issue
// helpers. Order field names are exactly what the original crystals-2 wrote.
export const crystalInventory = {
  ...api,
  collectionPath: 'crystals',
  noun: 'crystal', nounPlural: 'crystals',
  attrField: 'colour', attrLabel: 'Colour',
  cardTitle: 'Crystal', iconKey: 'gem',
  codePlaceholder: 'BDC-8232-0014-005', namePlaceholder: 'Rosaline', attrPlaceholder: 'PI',
  importExample: 'BDC-8232-0014-005\tRosaline\t22811\nBDC-8232-0014-007\tRuby\t10512',
  order: { issued: 'crystals_issued', issuedAt: 'crystals_issued_at', lines: 'crystal_issued_lines', lineIdField: 'crystal_id' },
}
