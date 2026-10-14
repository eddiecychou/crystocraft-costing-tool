// Phase-one direct-Firestore boundary for the B0016 MCP service token.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'crystocraft-rbac-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
})
let passed = 0
let failed = 0
const check = async (label, promise) => {
  try { await promise; passed++; console.log(`ok   ${label}`) }
  catch (error) { failed++; console.error(`FAIL ${label}: ${error.message}`) }
}
const uid = 'mcp-figurine-range-service'
const rangeId = 'mcp_range_0123456789abcdef0123456789abcdef'
const componentId = 'mcp_b0016_m_0123456789abcdef0123'
const quoteId = 'mcp_b0016_mq_0123456789abcdef0123'
const code = 'B0016-000-GBK'

await env.withSecurityRulesDisabled(async context => {
  const db = context.firestore()
  await setDoc(doc(db, `users/${uid}`), { role: 'staff', modules: [], service_scope: 'figurine-range-b0016' })
  await setDoc(doc(db, `range_products/${rangeId}`), { design_no: '0016', active: false, critical_components: [] })
  await setDoc(doc(db, 'range_products/unrelated'), { design_no: '9999', variants: [{ sku: 'OTHER' }] })
  await setDoc(doc(db, 'range_components/unrelated'), { code: 'OTHER', unit_cost: 900 })
  await setDoc(doc(db, 'range_components/rc_mv7xu3mmayc5g'), { code: 'P-CF003-C1', name: 'mezuza水晶布' })
  await setDoc(doc(db, 'range_components/rc_mv7xu3mmayc5g/supplier_quotes/existing'), { unit_cost: 9 })
  await setDoc(doc(db, `range_components/${componentId}`), { mcp_creator_uid: uid, mcp_range_id: rangeId, code: 'B0016-METAL', unit_cost: 11.30 })
  await setDoc(doc(db, `range_components/${componentId}/supplier_quotes/${quoteId}`), { mcp_creator_uid: uid, mcp_range_id: rangeId, unit_cost: 11.30 })
  await setDoc(doc(db, `range_sku_claims/${code}`), { item_code: code, range_id: rangeId, service_principal: uid })
  await setDoc(doc(db, 'range_sku_claims/OTHER'), { item_code: 'OTHER', range_id: 'unrelated' })
})

const service = env.authenticatedContext(uid, { figurine_range_writer: true }).firestore()
const noClaim = env.authenticatedContext(uid).firestore()
await check('general audit append denied for read-only service', assertFails(setDoc(doc(service, 'audit_logs/b0016-service-probe'), { action: 'probe' })))
await check('service login stamp denied', assertFails(updateDoc(doc(service, `users/${uid}`), { last_login_at: 'probe', login_count: 1 })))
await check('service scope update denied', assertFails(updateDoc(doc(service, `users/${uid}`), { service_scope: 'other' })))
await check('service favourites write denied', assertFails(setDoc(doc(service, `favourites/${uid}`), { items: [] })))
await check('service enquiry create denied', assertFails(setDoc(doc(service, 'enquiries/b0016-service-probe'), { uid })))
await check('service customer design create denied', assertFails(setDoc(doc(service, 'customer_designs/b0016-service-probe'), { uid })))
await check('exact reused C1 get allowed', assertSucceeds(getDoc(doc(service, 'range_components/rc_mv7xu3mmayc5g'))))
await check('exact reused C1 quote list allowed for dedup', assertSucceeds(getDocs(collection(service, 'range_components/rc_mv7xu3mmayc5g/supplier_quotes'))))
await check('no-claim reused C1 get denied', assertFails(getDoc(doc(noClaim, 'range_components/rc_mv7xu3mmayc5g'))))
await check('reused C1 supplier/cost update denied', assertFails(updateDoc(doc(service, 'range_components/rc_mv7xu3mmayc5g'), { unit_cost: 9 })))
await check('reused C1 quote create denied', assertFails(setDoc(doc(service, 'range_components/rc_mv7xu3mmayc5g/supplier_quotes/new'), { unit_cost: 9 })))
await env.withSecurityRulesDisabled(async context => { await updateDoc(doc(context.firestore(), 'range_components/rc_mv7xu3mmayc5g'), { code: 'P-CF002-C1' }) })
await check('changed C1 code get denied', assertFails(getDoc(doc(service, 'range_components/rc_mv7xu3mmayc5g'))))
await check('changed C1 parent quote list denied', assertFails(getDocs(collection(service, 'range_components/rc_mv7xu3mmayc5g/supplier_quotes'))))
await check('B0016 design get', assertSucceeds(getDoc(doc(service, `range_products/${rangeId}`))))
await check('B0016 filtered query', assertSucceeds(getDocs(query(collection(service, 'range_products'), where('design_no', '==', '0016')))))
await check('unfiltered range list denied', assertFails(getDocs(collection(service, 'range_products'))))
await check('unrelated range get denied', assertFails(getDoc(doc(service, 'range_products/unrelated'))))
await check('unrelated component cost denied', assertFails(getDoc(doc(service, 'range_components/unrelated'))))
await check('component collection list denied', assertFails(getDocs(collection(service, 'range_components'))))
await check('own B0016 component get', assertSucceeds(getDoc(doc(service, `range_components/${componentId}`))))
await check('own B0016 quote get', assertSucceeds(getDoc(doc(service, `range_components/${componentId}/supplier_quotes/${quoteId}`))))
await check('own quote list denied', assertFails(getDocs(collection(service, `range_components/${componentId}/supplier_quotes`))))
await check('exact SKU claim get', assertSucceeds(getDoc(doc(service, `range_sku_claims/${code}`))))
await check('unrelated SKU claim get denied', assertFails(getDoc(doc(service, 'range_sku_claims/OTHER'))))
await check('SKU claim collection list denied', assertFails(getDocs(collection(service, 'range_sku_claims'))))
await check('missing token claim denied', assertFails(getDoc(doc(noClaim, `range_components/${componentId}`))))

// Even a correctly authenticated service token must not write in phase one.
// These cover orphaned/mismatched claims and BOM links without mutating live data.
await check('orphan SKU claim create denied', assertFails(setDoc(doc(service, 'range_sku_claims/B0016-000-GBL'), { item_code: 'B0016-000-GBL', range_id: 'mcp_range_ffffffffffffffffffffffffffffffff', service_principal: uid })))
await check('mismatched SKU claim create denied', assertFails(setDoc(doc(service, 'range_sku_claims/B0016-000-GC1'), { item_code: 'B0016-000-GC1', range_id: rangeId, service_principal: 'wrong' })))
await check('orphan BOM component create denied', assertFails(setDoc(doc(service, 'range_components/mcp_b0016_f_0123456789abcdef0123'), { code: 'B0016-FABRIC', mcp_creator_uid: uid, mcp_range_id: 'mcp_range_ffffffffffffffffffffffffffffffff' })))
await check('mismatched BOM link denied', assertFails(updateDoc(doc(service, `range_products/${rangeId}`), { critical_components: [{ id: componentId, code: 'WRONG', qty_per_unit: 1, plating_code: '', all_variants: true }] })))
await check('service audit create denied', assertFails(setDoc(doc(service, 'range_mcp_audit/mcp_range_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), { action: 'create_mezuzah_range_design', service_principal: uid })))

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
