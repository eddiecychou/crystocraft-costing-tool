import { createInventoryClass } from './inventoryClass'
import { parseFinishedGoodsPaste } from './b2cImport'

// B2C finished-goods stock — one instance of the generic simple-inventory
// class (inventoryClass.js). The JES retirement plan's last open item
// (JES-RETIREMENT-PLAN.md §"Finished-goods stock"): B2C is a trading
// operation, unconnected to production — stock is received, stock is sold,
// nothing links it to a production event or an order reservation. So this
// deliberately carries no `order` config (unlike crystalInventory /
// packagingInventory) — ShipmentForm never offers it for order-driven
// issue, and it should not.
//
// retail_price is ChunCi's China-market retail price (¥), kept for reference
// only — the export/SRP the sales team quotes is derived from the wholesale
// price (× 3.5 or higher), NOT from this number. Stored so the number that
// came with the stock isn't lost, not as a selling price.

const api = createInventoryClass({
  collectionName: 'b2c_stock',
  attrField: 'category',
  extraFields: [{ key: 'retail_price', num: true }],
})

export const loadB2cStock = api.load
export const useB2cStock = api.useItems
export const saveB2cStock = api.save
export const deleteB2cStock = api.remove
export const importB2cStock = api.importStock

export const b2cInventory = {
  ...api,
  parsePaste: parseFinishedGoodsPaste,
  retailField: 'retail_price',
  collectionPath: 'b2c_stock',
  noun: 'finished good', nounPlural: 'finished goods',
  attrField: 'category', attrLabel: 'Category',
  cardTitle: 'Finished Goods', iconKey: 'box',
  codePlaceholder: 'D0268-001-GC1', namePlaceholder: 'Butterfly Suncatcher', attrPlaceholder: 'Figurine',
  importExample: '(paste ChunCi’s 卡斯库存 export, including its header row — 条码 / 商品名称 / 类别 / 库存数量 / 零售价 / 仓库 are read by name)',
}
