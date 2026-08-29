// Integration smoke test for src/domain/supplierMerge.js — mergeSuppliers()
// against the Firestore emulator. Seeds a duplicate + survivor supplier with
// POs, BOM supplier-quotes (both parent trees), a range-component pointer and
// the media subcollections, runs the merge, and asserts every reference moved
// and the duplicate is gone.
//
// supplierMerge.js can't be imported directly in Node (it does
// `import { db } from '../firebase'` — extensionless, and firebase.js pulls in
// persistentLocalCache which needs a browser). So this test copies the real
// module + its one dependency to a temp dir with ONLY the `db` import rewired
// to the emulator, then imports that. The logic body is untouched.
//
// Needs a real JRE on PATH (macOS /usr/bin/java stub is not enough) and the
// test deps in a scratch dir, then:
//   npm i firebase firebase-tools   # in a scratch dir, or use npx
//   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
//   npx firebase-tools emulators:exec --only firestore \
//     --project supplier-merge-test "node qa/supplier-merge.test.mjs"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore'
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const SRC = new URL('../src/domain/', import.meta.url)
// Temp dir NEXT TO this file (not os.tmpdir) so Node's node_modules lookup for
// 'firebase' resolves from the rewired copy. Cleaned up at the end.
const tmp = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.smerge-'))

writeFileSync(join(tmp, 'contacts.mjs'), readFileSync(new URL('supplierContacts.js', SRC), 'utf8'))
writeFileSync(join(tmp, 'db.mjs'),
  `import { initializeApp } from 'firebase/app'\n` +
  `import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'\n` +
  `const app = initializeApp({ projectId: 'supplier-merge-test' })\n` +
  `export const db = getFirestore(app)\n` +
  `connectFirestoreEmulator(db, '127.0.0.1', 8080)\n`)
let mergeSrc = readFileSync(new URL('supplierMerge.js', SRC), 'utf8')
  .replace("import { db } from '../firebase'", "import { db } from './db.mjs'")
  .replace(/from '\.\/supplierContacts'/, "from './contacts.mjs'")
writeFileSync(join(tmp, 'merge.mjs'), mergeSrc)

const { previewSupplierMerge, mergeSuppliers } = await import(join(tmp, 'merge.mjs'))

// This test's own emulator handle (same project id as db.mjs, so same data).
const db = getFirestore(initializeApp({ projectId: 'supplier-merge-test' }, 'runner'))
connectFirestoreEmulator(db, '127.0.0.1', 8080)

let pass = 0, fail = 0
const ok = (label, cond) => { if (cond) { pass++; console.log('ok   ' + label) } else { fail++; console.log('FAIL ' + label) } }
const eq = (label, a, b) => ok(`${label}  (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b))
const S = (path, data) => setDoc(doc(db, path), data)
const g = async p => (await getDoc(doc(db, p)))

// ---- seed ---------------------------------------------------------------
await Promise.all([
  S('suppliers/SURV', {
    name: 'Fei Hong', erp_code: 'S-100', address: '123 Main St', country: 'China',
    phones: ['+86 222'], emails: ['surv@fh.com'], contact_person: 'New Rep',
    wechat_id: '', whatsapp: '', extra_links: [{ id: 'x1', label: 'Site', url: 'http://fh.com' }],
  }),
  S('suppliers/DUP', {
    name: 'Fei Hong Metals', erp_code: '', address: '',
    phones: ['+86 111', '+86 222'], emails: ['dup@fh.com'], contact_person: 'Old Rep',
    wechat_id: 'feihong-wx', whatsapp: '+86 999',
    extra_links: [{ id: 'd1', label: '1688', url: 'http://1688.com/fh' }],
  }),
  S('purchase_orders/PO1', { supplier_id: 'DUP', supplier_name: 'Fei Hong Metals', supplier_erp_code: '', pu_number: 'PU1' }),
  S('purchase_orders/PO2', { supplier_id: 'DUP', supplier_name: 'Fei Hong Metals', pu_number: 'PU2' }),
  S('purchase_orders/PO3', { supplier_id: 'SURV', supplier_name: 'Fei Hong', pu_number: 'PU3' }),           // control
  S('products/P1/components/C1/supplier_quotes/Q1', { supplier_id: 'DUP', supplier_name: 'Fei Hong Metals', unit_cost: 5 }),
  S('range_components/RC1/supplier_quotes/Q2', { supplier_id: 'DUP', supplier_name: 'Fei Hong Metals', unit_cost: 7 }),
  S('range_components/RC1', { code: 'RC1', supplierId: 'DUP', supplierName: 'Fei Hong Metals', preferred_supplier_name: 'Fei Hong Metals', preferred_quote_id: 'Q2' }),
  S('range_components/RC2', { code: 'RC2', supplierId: 'DUP', supplierName: 'Fei Hong Metals' }),           // pointer only
  S('range_components/RC3', { code: 'RC3', supplierId: 'OTHER', preferred_supplier_name: 'Someone Else' }), // control
  S('suppliers/DUP/catalogs/CAT1', { file_name: 'cat.pdf', file_url: 'http://x/cat.pdf' }),
  S('suppliers/DUP/images/IMG1', { file_url: 'http://x/i.jpg', sort_order: 0 }),
  S('suppliers/DUP/videos/VID1', { file_url: 'http://x/v.mp4', sort_order: 0 }),
])

// ---- preview ----------------------------------------------------------------
const preview = await previewSupplierMerge('DUP', 'SURV')
eq('preview.poCount', preview.poCount, 2)
eq('preview.corpQuoteCount', preview.corpQuoteCount, 1)
eq('preview.rangeQuoteCount', preview.rangeQuoteCount, 1)
eq('preview.componentPointerCount', preview.componentPointerCount, 2)
eq('preview.catalogsCount / imagesCount / videosCount', [preview.catalogsCount, preview.imagesCount, preview.videosCount], [1, 1, 1])
ok('fieldsToFill gains wechat_id', preview.fieldsToFill.wechat_id === 'feihong-wx')
ok('fieldsToFill does NOT overwrite the survivor\'s erp_code', !('erp_code' in preview.fieldsToFill))
ok('fieldsToFill.phones unions', JSON.stringify(preview.fieldsToFill.phones) === JSON.stringify(['+86 222', '+86 111']))
ok('fieldsToFill.extra_links unions to 2', (preview.fieldsToFill.extra_links || []).length === 2)
ok('fieldsToFill.contacts merges both reps', (preview.fieldsToFill.contacts || []).length === 2)
ok('merged contacts: unique ids', new Set((preview.fieldsToFill.contacts || []).map(c => c.id)).size === (preview.fieldsToFill.contacts || []).length)
ok('merged contacts: no literal "legacy" id', !(preview.fieldsToFill.contacts || []).some(c => c.id === 'legacy'))
ok('merged contacts: exactly one primary', (preview.fieldsToFill.contacts || []).filter(c => c.is_primary).length === 1)

// ---- run merge --------------------------------------------------------------
await mergeSuppliers('DUP', 'SURV')

ok('DUP supplier deleted', !(await g('suppliers/DUP')).exists())
const surv = (await g('suppliers/SURV')).data()
eq('SURV keeps its own erp_code', surv.erp_code, 'S-100')
eq('SURV gained wechat_id', surv.wechat_id, 'feihong-wx')
eq('SURV phones unioned', surv.phones, ['+86 222', '+86 111'])
eq('SURV extra_links count', (surv.extra_links || []).length, 2)
eq('SURV contacts count', (surv.contacts || []).length, 2)
ok('SURV contacts: unique ids, none "legacy"', new Set(surv.contacts.map(c => c.id)).size === surv.contacts.length && !surv.contacts.some(c => c.id === 'legacy'))

const po1 = (await g('purchase_orders/PO1')).data()
eq('PO1 supplier_id repointed', po1.supplier_id, 'SURV')
eq('PO1 supplier_name refreshed', po1.supplier_name, 'Fei Hong')
eq('PO1 supplier_erp_code refreshed from survivor', po1.supplier_erp_code, 'S-100')
eq('PO2 supplier_id repointed', (await g('purchase_orders/PO2')).data().supplier_id, 'SURV')
eq('PO3 (control) supplier_id untouched', (await g('purchase_orders/PO3')).data().supplier_id, 'SURV')

eq('corp BOM quote Q1 repointed', (await g('products/P1/components/C1/supplier_quotes/Q1')).data().supplier_id, 'SURV')
eq('corp BOM quote Q1 name refreshed', (await g('products/P1/components/C1/supplier_quotes/Q1')).data().supplier_name, 'Fei Hong')
eq('figurine BOM quote Q2 repointed', (await g('range_components/RC1/supplier_quotes/Q2')).data().supplier_id, 'SURV')
eq('figurine BOM quote Q2 name refreshed', (await g('range_components/RC1/supplier_quotes/Q2')).data().supplier_name, 'Fei Hong')

const rc1 = (await g('range_components/RC1')).data()
eq('RC1 supplierId repointed', rc1.supplierId, 'SURV')
eq('RC1 supplierName refreshed', rc1.supplierName, 'Fei Hong')
eq('RC1 preferred_supplier_name refreshed', rc1.preferred_supplier_name, 'Fei Hong')
eq('RC2 (pointer-only) supplierId repointed', (await g('range_components/RC2')).data().supplierId, 'SURV')
ok('RC2 preferred_supplier_name untouched (had none)', (await g('range_components/RC2')).data().preferred_supplier_name === undefined)
eq('RC3 (control) supplierId untouched', (await g('range_components/RC3')).data().supplierId, 'OTHER')
eq('RC3 (control) preferred_supplier_name untouched', (await g('range_components/RC3')).data().preferred_supplier_name, 'Someone Else')

ok('catalogs/images/videos moved to SURV', (await g('suppliers/SURV/catalogs/CAT1')).exists() && (await g('suppliers/SURV/images/IMG1')).exists() && (await g('suppliers/SURV/videos/VID1')).exists())
ok('DUP subcollections emptied', (await getDocs(collection(db, 'suppliers/DUP/catalogs'))).empty && (await getDocs(collection(db, 'suppliers/DUP/images'))).empty && (await getDocs(collection(db, 'suppliers/DUP/videos'))).empty)

let threw = false
try { await previewSupplierMerge('SURV', 'SURV') } catch { threw = true }
ok('merge-into-self rejected', threw)

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
