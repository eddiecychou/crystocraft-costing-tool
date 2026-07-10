import { createInventoryClass } from './inventoryClass'

// Packaging inventory — one instance of the generic simple-inventory class
// (inventoryClass.js). Gift boxes / cartons / inserts (each an ERP code),
// stocked and consumed batch-per-order at pack time with no per-product BOM.
// Field names are unchanged from the original packaging.js (`type`).

const api = createInventoryClass({ collectionName: 'packaging', attrField: 'type' })

export const loadPackaging = api.load
export const usePackaging = api.useItems
export const savePackaging = api.save
export const deletePackaging = api.remove
export const importPackagingStock = api.importStock

export const packagingInventory = {
  ...api,
  collectionPath: 'packaging',
  noun: 'packaging item', nounPlural: 'packaging',
  attrField: 'type', attrLabel: 'Type',
  cardTitle: 'Packaging', iconKey: 'box',
  codePlaceholder: 'BOX-GIFT-01', namePlaceholder: 'Gift box', attrPlaceholder: 'Box / Carton',
  importExample: 'BOX-GIFT-01\tGift box small\t1200\nCARTON-05\tMaster carton\t340',
  order: {
    reserved: 'packaging_reserved', reservedAt: 'packaging_reserved_at',
    committed: 'packaging_committed', committedAt: 'packaging_committed_at',
    lines: 'packaging_lines', lineIdField: 'packaging_id',
    legacyIssued: 'packaging_issued', legacyLines: 'packaging_issued_lines',
  },
}
