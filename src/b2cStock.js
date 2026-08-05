import { createInventoryClass } from './inventoryClass'

// B2C finished-goods stock — one instance of the generic simple-inventory
// class (inventoryClass.js). The JES retirement plan's last open item
// (JES-RETIREMENT-PLAN.md §"Finished-goods stock"): B2C is a trading
// operation, unconnected to production — stock is received, stock is sold,
// nothing links it to a production event or an order reservation. So this
// deliberately carries no `order` config (unlike crystalInventory /
// packagingInventory) — ShipmentForm never offers it for order-driven
// issue, and it should not.

const api = createInventoryClass({ collectionName: 'b2c_stock', attrField: 'category' })

export const loadB2cStock = api.load
export const useB2cStock = api.useItems
export const saveB2cStock = api.save
export const deleteB2cStock = api.remove
export const importB2cStock = api.importStock

export const b2cInventory = {
  ...api,
  collectionPath: 'b2c_stock',
  noun: 'B2C item', nounPlural: 'B2C stock',
  attrField: 'category', attrLabel: 'Category',
  cardTitle: 'B2C Finished Goods', iconKey: 'box',
  codePlaceholder: 'D0268-001-GC1', namePlaceholder: 'Butterfly Suncatcher', attrPlaceholder: 'Figurine',
  importExample: 'D0268-001-GC1\tButterfly Suncatcher\t42\nD0019-001-GC1\tDuckling\t18',
}
