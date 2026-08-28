// RBAC rules test — proves the production role can read/write the supply
// side (Firestore) and attach files to it (Storage), is denied everything
// sensitive, and that admin is unchanged. Covers both firestore.rules and
// storage.rules. Needs a real JRE on PATH (the macOS /usr/bin/java stub is
// not enough) and the test deps in a scratch dir, then:
//
//   npm i @firebase/rules-unit-testing firebase   # in a scratch dir
//   export FIRESTORE_EMULATOR_HOST=localhost:8080
//   export FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
//   npx firebase-tools emulators:exec --only firestore,storage \
//     --project crystocraft-rbac-test "node qa/rbac-rules.test.mjs"
//
// (run from a dir whose firebase.json points firestore.rules / storage.rules
// at this repo's files, or copy them alongside). Deliberately not a project
// dependency — same posture as qa/eslint.no-undef.mjs.
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, collection, getDocs, query, where,
} from 'firebase/firestore'
import { ref as storageRef, uploadString, getBytes } from 'firebase/storage'

const PROJECT = 'crystocraft-rbac-test'
let pass = 0, fail = 0
const ok = (label, p) => p.then(() => { pass++; console.log('ok   ' + label) })
  .catch(e => { fail++; console.log('FAIL ' + label + '  — ' + (e?.message || e)) })

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
})

// Seed the three role docs + a customers doc + a product with a generic image,
// bypassing rules.
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore()
  await setDoc(doc(d, 'users/admin1'),      { role: 'admin' })
  await setDoc(doc(d, 'users/prod1'),       { role: 'production' })
  await setDoc(doc(d, 'users/cust1'),       { role: 'customer', status: 'approved', customer_id: 'c1' })
  await setDoc(doc(d, 'customers/c1'),      { company_name: 'ACME', sensitive: false })
  await setDoc(doc(d, 'products/p1'),       { name: 'Widget' })
  await setDoc(doc(d, 'range_products/rp1'), { name: 'Crystal Bear' })
  await setDoc(doc(d, 'settings/exchange_rates'), { USD: 7.78 })
  await setDoc(doc(d, 'products/p1/images/i1'), { branded_for_customer_id: '' })
  await setDoc(doc(d, 'suppliers/s1'),      { name: 'Foundry' })
  await setDoc(doc(d, 'range_components/rc1'), { code: 'RC1' })
  await setDoc(doc(d, 'crystals/x1'),       { colour: 'red' })
  await setDoc(doc(d, 'packaging/pk1'),     { type: 'box' })
  await setDoc(doc(d, 'b2c_stock/b1'),      { category: 'gift' })
  await setDoc(doc(d, 'purchase_orders/po1'), { supplier_id: 's1' })
  await setDoc(doc(d, 'counters/pu_26'), { seq: 1 })
  await setDoc(doc(d, 'counters/so_26'), { seq: 1 })
  await setDoc(doc(d, 'counters/uc_26'), { seq: 1 })
  await setDoc(doc(d, 'client_quotes/q1'),  { customer_name: 'ACME' })
  await setDoc(doc(d, 'orders/o1'),         { customer_id: 'c1' })
  await setDoc(doc(d, 'credit_notes/cn1'),  { amount: 1 })
  await setDoc(doc(d, 'marketing_contacts/m1'), { email: 'x@y.z' })
  await setDoc(doc(d, 'settings/format_moq'),        { formats: [] })
  await setDoc(doc(d, 'settings/crystal_unit_costs'), { items: [] })
  await setDoc(doc(d, 'settings/component_categories'), { list: [] })
  await setDoc(doc(d, 'settings/pricing_groups'),    { groups: [] })
})

const admin = env.authenticatedContext('admin1').firestore()
const prod  = env.authenticatedContext('prod1').firestore()

// ---- production ALLOWED (supply side) ---------------------------------
await ok('prod read products',           assertSucceeds(getDoc(doc(prod, 'products/p1'))))
await ok('prod write products',          assertSucceeds(setDoc(doc(prod, 'products/p2'), { name: 'New' })))
await ok('prod read product image',      assertSucceeds(getDoc(doc(prod, 'products/p1/images/i1'))))
await ok('prod read suppliers',          assertSucceeds(getDoc(doc(prod, 'suppliers/s1'))))
await ok('prod write suppliers',         assertSucceeds(setDoc(doc(prod, 'suppliers/s2'), { name: 'X' })))
await ok('prod read range_components',   assertSucceeds(getDoc(doc(prod, 'range_components/rc1'))))
await ok('prod write supplier photo',    assertSucceeds(setDoc(doc(prod, 'suppliers/s1/images/img1'), { file_url: 'x', sort_order: 0 })))
await ok('prod write range_components',  assertSucceeds(setDoc(doc(prod, 'range_components/rc2'), { code: 'RC2' })))
await ok('prod read crystals',           assertSucceeds(getDoc(doc(prod, 'crystals/x1'))))
await ok('prod read packaging',          assertSucceeds(getDoc(doc(prod, 'packaging/pk1'))))
await ok('prod read b2c_stock',          assertSucceeds(getDoc(doc(prod, 'b2c_stock/b1'))))
await ok('prod read settings/format_moq',           assertSucceeds(getDoc(doc(prod, 'settings/format_moq'))))
await ok('prod write settings/format_moq',          assertSucceeds(setDoc(doc(prod, 'settings/format_moq'), { formats: [1] })))
await ok('prod read settings/crystal_unit_costs',   assertSucceeds(getDoc(doc(prod, 'settings/crystal_unit_costs'))))
await ok('prod read settings/component_categories', assertSucceeds(getDoc(doc(prod, 'settings/component_categories'))))
await ok('prod read range_products (figurine)',  assertSucceeds(getDoc(doc(prod, 'range_products/rp1'))))
await ok('prod write range_products (figurine)', assertSucceeds(setDoc(doc(prod, 'range_products/rp2'), { name: 'New' })))
await ok('prod read settings/exchange_rates',    assertSucceeds(getDoc(doc(prod, 'settings/exchange_rates'))))
await ok('prod read purchase_orders',   assertSucceeds(getDocs(query(collection(prod, 'purchase_orders'), where('supplier_id', '==', 's1')))))
await ok('prod write purchase_orders',  assertSucceeds(setDoc(doc(prod, 'purchase_orders/po2'), { supplier_id: 's1' })))
await ok('prod write counters/pu_ (PO number)', assertSucceeds(setDoc(doc(prod, 'counters/pu_26'), { seq: 2 })))

// ---- production DENIED (sensitive) ------------------------------------
await ok('prod DENIED customers',        assertFails(getDoc(doc(prod, 'customers/c1'))))
await ok('prod DENIED client_quotes',    assertFails(getDoc(doc(prod, 'client_quotes/q1'))))
await ok('prod DENIED orders',           assertFails(getDoc(doc(prod, 'orders/o1'))))
await ok('prod DENIED credit_notes',     assertFails(getDoc(doc(prod, 'credit_notes/cn1'))))
await ok('prod DENIED counters/so_ (sales order)', assertFails(setDoc(doc(prod, 'counters/so_26'), { seq: 2 })))
await ok('prod DENIED counters/uc_ (UC registry)', assertFails(setDoc(doc(prod, 'counters/uc_26'), { seq: 2 })))
await ok('prod DENIED marketing_contacts', assertFails(getDoc(doc(prod, 'marketing_contacts/m1'))))
await ok('prod DENIED settings/pricing_groups (read)',  assertFails(getDoc(doc(prod, 'settings/pricing_groups'))))
await ok('prod DENIED settings/pricing_groups (write)', assertFails(setDoc(doc(prod, 'settings/pricing_groups'), { groups: [1] })))
await ok('prod DENIED settings/exchange_rates (write)', assertFails(setDoc(doc(prod, 'settings/exchange_rates'), { USD: 9 })))
await ok('prod DENIED write pricing_tiers', assertFails(setDoc(doc(prod, 'products/p1/pricing_tiers/t1'), { price: 1 })))
// A production login must never be able to self-escalate its own role.
await ok('prod DENIED self role escalation', assertFails(setDoc(doc(prod, 'users/prod1'), { role: 'admin' })))

// ---- admin UNCHANGED --------------------------------------------------
await ok('admin read customers',         assertSucceeds(getDoc(doc(admin, 'customers/c1'))))
await ok('admin read purchase_orders',   assertSucceeds(getDoc(doc(admin, 'purchase_orders/po1'))))
await ok('admin read settings/pricing_groups', assertSucceeds(getDoc(doc(admin, 'settings/pricing_groups'))))

// ---- Storage rules (V8.12 DeepSeek finding 1) ------------------------
// Production must be able to attach files to the supply-side records it can
// edit; still denied the admin-only object domains.
const prodStore  = env.authenticatedContext('prod1').storage()
const custStore  = env.authenticatedContext('cust1').storage()
await ok('prod upload products/ image',        assertSucceeds(uploadString(storageRef(prodStore, 'products/p1/images/x.txt'), 'x')))
await ok('prod upload range_products/ image',  assertSucceeds(uploadString(storageRef(prodStore, 'range_products/rp1/x.txt'), 'x')))
await ok('prod upload range_components/ image', assertSucceeds(uploadString(storageRef(prodStore, 'range_components/rc1/x.txt'), 'x')))
await ok('prod upload suppliers/ catalog',     assertSucceeds(uploadString(storageRef(prodStore, 'suppliers/s1/catalogs/x.txt'), 'x')))
await ok('prod upload component quote attach',  assertSucceeds(uploadString(storageRef(prodStore, 'products/p1/components/c1/quotes/x.txt'), 'x')))
await ok('prod DENIED customers/ upload',       assertFails(uploadString(storageRef(prodStore, 'customers/c1/x.txt'), 'x')))
await ok('prod DENIED settings/ branding upload', assertFails(uploadString(storageRef(prodStore, 'settings/stamp.txt'), 'x')))
await ok('prod DENIED client_quotes/ upload',   assertFails(uploadString(storageRef(prodStore, 'client_quotes/custom_items/i1/x.txt'), 'x')))
await ok('customer DENIED products/ upload',    assertFails(uploadString(storageRef(custStore, 'products/p1/images/x.txt'), 'x')))

await env.cleanup()
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
