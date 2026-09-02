import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
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

// One-time manual mapping from a Finished-Goods SKU to its WooCommerce
// counterpart (WooStockReconcile.jsx). ChunCi's barcode (`code`, e.g.
// D0268-001-GC1 — colour/plating baked into the tail) rarely equals the Woo
// variation SKU, because most B2C products are variable products where the
// variation SKU is often left blank. So auto-matching catches only the easy
// ones; everything else is linked by hand here, once, and the link persists.
//
// Written as a targeted merge so it never disturbs the descriptor fields or
// the ledger-owned stock_qty. save()/importStock() both write from their own
// field whitelists, so neither clobbers these back out.
//   link: { woo_sku, woo_product_id, woo_variation_id }  — or null to clear
export async function setWooLink(id, link) {
  await setDoc(doc(db, 'b2c_stock', id), {
    woo_sku: link?.woo_sku ? String(link.woo_sku).trim() : '',
    woo_product_id: link?.woo_product_id ?? null,
    woo_variation_id: link?.woo_variation_id ?? null,
    woo_linked_at: link ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

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
