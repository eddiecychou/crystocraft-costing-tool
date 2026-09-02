// RBAC rules test (V8.14 flat-staff model) — proves that a `staff` account is
// granted EXACTLY the collections its users/{uid}.modules[] list implies, is
// denied everything else, cannot self-escalate, and that admin + customer are
// unchanged. Covers both firestore.rules and storage.rules. Needs a real JRE
// on PATH (the macOS /usr/bin/java stub is not enough) and the test deps in a
// scratch dir, then:
//
//   npm i @firebase/rules-unit-testing firebase   # in a scratch dir
//   npx firebase-tools emulators:exec --only firestore,storage \
//     --project crystocraft-rbac-test "node qa/rbac-rules.test.mjs"
//
// (run from a dir whose firebase.json points firestore.rules / storage.rules
// at this repo's files). Deliberately not a project dependency — same posture
// as qa/eslint.no-undef.mjs.
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc,
} from 'firebase/firestore'
import { ref as storageRef, uploadString } from 'firebase/storage'

const PROJECT = 'crystocraft-rbac-test'
let pass = 0, fail = 0
const ok = (label, p) => p.then(() => { pass++; console.log('ok   ' + label) })
  .catch(e => { fail++; console.log('FAIL ' + label + '  — ' + (e?.message || e)) })

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
})

// The two live staff shapes we actually migrated (2026-09-02):
//   supply  = pack5@uart.com.hk    (ex-production, minus erp/pricing)
//   broad   = 2647939198@qq.com    (ex-sales + full catalogue + pricing + supply)
const SUPPLY_MODS = ['dashboard', 'supply', 'products', 'figurine', 'swatch', 'catalogues']
const BROAD_MODS = ['dashboard', 'products', 'figurine', 'swatch', 'catalogues', 'pricing',
  'customers', 'quotes', 'marketing', 'portal', 'shipping', 'invoices', 'credit_notes', 'supply']

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore()
  await setDoc(doc(d, 'users/admin1'),   { role: 'admin' })
  await setDoc(doc(d, 'users/supply1'),  { role: 'staff', status: 'approved', modules: SUPPLY_MODS })
  await setDoc(doc(d, 'users/broad1'),   { role: 'staff', status: 'approved', modules: BROAD_MODS })
  await setDoc(doc(d, 'users/none1'),    { role: 'staff', status: 'approved', modules: [] })
  await setDoc(doc(d, 'users/cust1'),    { role: 'customer', status: 'approved', customer_id: 'c1' })

  await setDoc(doc(d, 'customers/c1'),   { company_name: 'ACME', sensitive: false })
  await setDoc(doc(d, 'products/p1'),    { name: 'Widget' })
  await setDoc(doc(d, 'products/p1/images/i1'), { branded_for_customer_id: '' })
  await setDoc(doc(d, 'products/p1/pricing_tiers/t0'), { price: 1 })
  await setDoc(doc(d, 'products/p1/customer_prices/cust1'), { price: 1 })
  await setDoc(doc(d, 'range_products/rp1'), { name: 'Crystal Bear' })
  await setDoc(doc(d, 'suppliers/s1'),   { name: 'Foundry' })
  await setDoc(doc(d, 'purchase_orders/po1'), { supplier_id: 's1' })
  await setDoc(doc(d, 'range_components/rc1'), { code: 'RC1' })
  await setDoc(doc(d, 'crystals/x1'),    { colour: 'red' })
  await setDoc(doc(d, 'b2c_stock/b1'),   { category: 'gift' })
  await setDoc(doc(d, 'catalogues/cat1'), { title: 'C' })
  await setDoc(doc(d, 'client_quotes/q1'), { customer_name: 'ACME' })
  await setDoc(doc(d, 'orders/o1'),      { customer_id: 'c1' })
  await setDoc(doc(d, 'credit_notes/cn1'), { amount: 1 })
  await setDoc(doc(d, 'uc_invoices/ui1'), { uc_no: 'UC1' })
  await setDoc(doc(d, 'marketing_contacts/m1'), { email: 'x@y.z' })
  await setDoc(doc(d, 'woo_cache/orders'), { rows: [] })
  await setDoc(doc(d, 'seo_batches/b1'), { status: 'draft' })
  await setDoc(doc(d, 'portal_invitations/inv1'), { email: 'x@y.z' })
  await setDoc(doc(d, 'counters/pu_26'), { seq: 1 })
  await setDoc(doc(d, 'counters/so_26'), { seq: 1 })
  await setDoc(doc(d, 'settings/pricing_groups'), { groups: [] })
  await setDoc(doc(d, 'settings/quote_branding'), { stamp: '' })
  await setDoc(doc(d, 'crystal_swatch_notes/n1'), { note: 'x' })
})

await env.withSecurityRulesDisabled(async ctx => {
  const s = ctx.storage()
  await uploadString(storageRef(s, 'products/p1/a.png'), 'x')
  await uploadString(storageRef(s, 'suppliers/s1/a.png'), 'x')
  await uploadString(storageRef(s, 'range_products/rp1/a.png'), 'x')
  await uploadString(storageRef(s, 'customers/c1/a.png'), 'x')
  await uploadString(storageRef(s, 'client_quotes/a.png'), 'x')
  await uploadString(storageRef(s, 'daily_draft_images/a.png'), 'x')
})

const admin  = env.authenticatedContext('admin1').firestore()
const supply = env.authenticatedContext('supply1').firestore()
const broad  = env.authenticatedContext('broad1').firestore()
const none   = env.authenticatedContext('none1').firestore()
const cust   = env.authenticatedContext('cust1').firestore()
const supplyS = env.authenticatedContext('supply1').storage()
const broadS  = env.authenticatedContext('broad1').storage()

// ---- admin: unchanged, sees everything ------------------------------------
await ok('admin read customers',       assertSucceeds(getDoc(doc(admin, 'customers/c1'))))
await ok('admin write settings/pricing_groups', assertSucceeds(setDoc(doc(admin, 'settings/pricing_groups'), { groups: [1] })))

// ---- staff(supply) ALLOWED — supply + catalogue keys --------------------
await ok('supply read products',        assertSucceeds(getDoc(doc(supply, 'products/p1'))))
await ok('supply write products',       assertSucceeds(setDoc(doc(supply, 'products/p2'), { name: 'N' })))
await ok('supply read product image',   assertSucceeds(getDoc(doc(supply, 'products/p1/images/i1'))))
await ok('supply rw suppliers',         assertSucceeds(setDoc(doc(supply, 'suppliers/s2'), { name: 'F2' })))
await ok('supply rw purchase_orders',   assertSucceeds(setDoc(doc(supply, 'purchase_orders/po2'), { supplier_id: 's1' })))
await ok('supply rw range_components',  assertSucceeds(setDoc(doc(supply, 'range_components/rc2'), { code: 'RC2' })))
await ok('supply rw crystals',          assertSucceeds(setDoc(doc(supply, 'crystals/x2'), { colour: 'blue' })))
await ok('supply rw b2c_stock',         assertSucceeds(setDoc(doc(supply, 'b2c_stock/b2'), { category: 'g' })))
await ok('supply write range_products', assertSucceeds(setDoc(doc(supply, 'range_products/rp2'), { name: 'B2' })))
await ok('supply rw catalogues',        assertSucceeds(setDoc(doc(supply, 'catalogues/cat2'), { title: 'D' })))
await ok('supply write counters/pu_',   assertSucceeds(setDoc(doc(supply, 'counters/pu_26'), { seq: 2 })))
await ok('supply write crystal_swatch_notes', assertSucceeds(setDoc(doc(supply, 'crystal_swatch_notes/n2'), { note: 'y' })))

// ---- staff(supply) DENIED — no customers/quotes/pricing/finance/uc ------
await ok('supply DENIED customers',     assertFails(getDoc(doc(supply, 'customers/c1'))))
await ok('supply DENIED client_quotes', assertFails(getDoc(doc(supply, 'client_quotes/q1'))))
await ok('supply DENIED credit_notes',  assertFails(getDoc(doc(supply, 'credit_notes/cn1'))))
await ok('supply DENIED uc_invoices',   assertFails(getDoc(doc(supply, 'uc_invoices/ui1'))))
await ok('supply DENIED write pricing_tiers', assertFails(setDoc(doc(supply, 'products/p1/pricing_tiers/t9'), { price: 9 })))
await ok('supply DENIED write customer_prices', assertFails(setDoc(doc(supply, 'products/p1/customer_prices/z9'), { price: 9 })))
await ok('supply DENIED read settings/pricing_groups', assertFails(getDoc(doc(supply, 'settings/pricing_groups'))))
await ok('supply DENIED woo_cache',     assertFails(getDoc(doc(supply, 'woo_cache/orders'))))
await ok('supply DENIED counters/so_',  assertFails(setDoc(doc(supply, 'counters/so_26'), { seq: 2 })))
await ok('supply DENIED self-escalate', assertFails(setDoc(doc(supply, 'users/supply1'), { role: 'admin', modules: SUPPLY_MODS })))
await ok('supply DENIED grant self module', assertFails(setDoc(doc(supply, 'users/supply1'), { role: 'staff', status: 'approved', modules: [...SUPPLY_MODS, 'customers'] })))

// ---- staff(broad) ALLOWED — front office + finance + pricing + supply ---
await ok('broad rw customers',          assertSucceeds(setDoc(doc(broad, 'customers/c2'), { company_name: 'B' })))
await ok('broad write customer thread', assertSucceeds(setDoc(doc(broad, 'customers/c1/email_threads/e1'), { subject: 'hi' })))
await ok('broad rw client_quotes',      assertSucceeds(setDoc(doc(broad, 'client_quotes/q2'), { customer_name: 'B' })))
await ok('broad rw marketing_contacts', assertSucceeds(setDoc(doc(broad, 'marketing_contacts/m2'), { email: 'a@b.c' })))
await ok('broad write pricing_tiers',   assertSucceeds(setDoc(doc(broad, 'products/p1/pricing_tiers/t1'), { price: 2 })))
await ok('broad write customer_prices', assertSucceeds(setDoc(doc(broad, 'products/p1/customer_prices/z1'), { price: 2 })))
await ok('broad read settings/pricing_groups', assertSucceeds(getDoc(doc(broad, 'settings/pricing_groups'))))
await ok('broad rw orders (shipping)',  assertSucceeds(setDoc(doc(broad, 'orders/o2'), { customer_id: 'c1' })))
await ok('broad rw credit_notes',       assertSucceeds(setDoc(doc(broad, 'credit_notes/cn2'), { amount: 2 })))
await ok('broad write counters/so_',    assertSucceeds(setDoc(doc(broad, 'counters/so_26'), { seq: 3 })))
await ok('broad read users roster',     assertSucceeds(getDoc(doc(broad, 'users/supply1'))))
await ok('broad read portal_invitations', assertSucceeds(getDoc(doc(broad, 'portal_invitations/inv1'))))
await ok('broad rw suppliers (has supply)', assertSucceeds(setDoc(doc(broad, 'suppliers/s3'), { name: 'F3' })))

// ---- staff(broad) DENIED — no uc / woo / settings / escalation ---------
await ok('broad DENIED uc_invoices',    assertFails(getDoc(doc(broad, 'uc_invoices/ui1'))))
await ok('broad DENIED write uc_invoices', assertFails(setDoc(doc(broad, 'uc_invoices/ui2'), { uc_no: 'UC2' })))
await ok('broad DENIED woo_cache',      assertFails(getDoc(doc(broad, 'woo_cache/orders'))))
await ok('broad DENIED seo_batches',    assertFails(getDoc(doc(broad, 'seo_batches/b1'))))
await ok('broad DENIED write settings/quote_branding', assertFails(setDoc(doc(broad, 'settings/quote_branding'), { stamp: 'z' })))
await ok('broad DENIED self-escalate',  assertFails(setDoc(doc(broad, 'users/broad1'), { role: 'admin', modules: BROAD_MODS })))

// ---- staff(no modules) — denied all internal collections --------------
await ok('none DENIED products',        assertFails(getDoc(doc(none, 'products/p1'))))
await ok('none DENIED customers',       assertFails(getDoc(doc(none, 'customers/c1'))))
await ok('none DENIED catalogues',      assertFails(getDoc(doc(none, 'catalogues/cat1'))))
await ok('none DENIED suppliers',       assertFails(getDoc(doc(none, 'suppliers/s1'))))

// ---- customer — unchanged (storefront only) -----------------------------
await ok('customer read storefront product', assertSucceeds(getDoc(doc(cust, 'products/p1'))))
await ok('customer DENIED customers',   assertFails(getDoc(doc(cust, 'customers/c1'))))
await ok('customer DENIED suppliers',   assertFails(getDoc(doc(cust, 'suppliers/s1'))))
await ok('customer DENIED products write', assertFails(setDoc(doc(cust, 'products/p9'), { name: 'x' })))

// ---- Storage — must track Firestore path-for-path ----------------------
await ok('supply upload products/**',   assertSucceeds(uploadString(storageRef(supplyS, 'products/p1/b.png'), 'x')))
await ok('supply upload suppliers/**',  assertSucceeds(uploadString(storageRef(supplyS, 'suppliers/s1/b.png'), 'x')))
await ok('supply upload range_products/**', assertSucceeds(uploadString(storageRef(supplyS, 'range_products/rp1/b.png'), 'x')))
await ok('supply DENIED customers/**',  assertFails(uploadString(storageRef(supplyS, 'customers/c1/b.png'), 'x')))
await ok('supply DENIED client_quotes/**', assertFails(uploadString(storageRef(supplyS, 'client_quotes/b.png'), 'x')))
await ok('supply DENIED daily_draft_images/**', assertFails(uploadString(storageRef(supplyS, 'daily_draft_images/b.png'), 'x')))
await ok('broad upload customers/**',   assertSucceeds(uploadString(storageRef(broadS, 'customers/c1/b.png'), 'x')))
await ok('broad upload client_quotes/**', assertSucceeds(uploadString(storageRef(broadS, 'client_quotes/b.png'), 'x')))
await ok('broad upload daily_draft_images/**', assertSucceeds(uploadString(storageRef(broadS, 'daily_draft_images/b.png'), 'x')))
await ok('broad DENIED settings/**',    assertFails(uploadString(storageRef(broadS, 'settings/b.png'), 'x')))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
