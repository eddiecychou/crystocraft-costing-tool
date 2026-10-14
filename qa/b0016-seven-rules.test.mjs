// Local emulator only. Never deploys rules or authenticates to production.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore'
import { prepareB0016ColourBom, B0016_REUSE_ID, approvalPlan } from '../netlify/edge-functions/lib/b0016ColourBom.js'
import { identity, designDraft, ITEM_CODES, SOURCE_PARTS, SOURCE_PRODUCT_ID, RANGE_SERVICE_UID, usedSkus } from '../netlify/edge-functions/lib/mcpFigurineRange.js'

// Historical false-gate candidate; exact live release has its own suite.
const source = readFileSync(new URL('./fixtures/b0016-read-only.rules', import.meta.url), 'utf8')
const needle = 'function b0016WritesApproved() {\n      return false;\n    }'
if (!source.includes(needle)) throw Error('Live write gate must remain false')
const range_id = 'mcp_range_' + 'd'.repeat(32), request_id = '70e51438-1e69-4ec1-a122-bd6e0621a023'
const c1 = { code: 'P-CF003-C1', name: 'mezuza水晶布', notes: 'preserve', images: ['owner-photo'], stock_qty: 0, reserved_qty: 0, createdAt: 'old' }
const range = { ...designDraft(), mcp_creator_uid: RANGE_SERVICE_UID }
const plan = await prepareB0016ColourBom({ range_id, request_id }, {}, {
  requestId: x => x, source: async () => ({ metal: { supplier: { name: 'Feihong' } }, fabric: { supplier: { name: 'Ryan' } } }),
  get: async (_ctx, path) => path.startsWith('range_products/') ? range : c1,
  listReuseQuotes: async () => [], designPreview: async () => ({ conflicts: [], warnings: [] }),
  identity, id: x => x, usedSkus, ITEM_CODES, RANGE_SERVICE_UID, SOURCE_PRODUCT_ID, SOURCE_PARTS,
})
let passed = 0, failed = 0
const env = await initializeTestEnvironment({ projectId: 'crystocraft-seven-candidate-test', firestore: { rules: source.replace(needle, needle.replace('false', 'true')) } })
const db = env.authenticatedContext(RANGE_SERVICE_UID, { figurine_range_writer: true }).firestore()
async function seed(extra = {}) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore()
    await setDoc(doc(admin, `users/${RANGE_SERVICE_UID}`), { role: 'staff', modules: [], service_scope: 'figurine-range-b0016' })
    await setDoc(doc(admin, `range_products/${range_id}`), range)
    await setDoc(doc(admin, `range_components/${B0016_REUSE_ID}`), { ...c1, ...extra })
    await setDoc(doc(admin, `range_mcp_approvals/${plan.proposed.records.at(-1).path.split('/')[1]}`), { ...approvalPlan(plan, c1, RANGE_SERVICE_UID), approved: true, expires_at: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000), usage_review: { reference_count: 0, code_conflict_count: 0, child_record_count: 0, c1_update_time: 'fixture', checked_at: Timestamp.now() } })
  })
}
function bundle(mutate = () => {}, selectedDb = db) {
  const records = structuredClone(plan.proposed.records)
  mutate(records)
  const batch = writeBatch(selectedDb)
  for (const r of records) {
    if (r.action === 'create') batch.set(doc(selectedDb, r.path), { ...r.fields, [r.path.startsWith('range_mcp_audit/') ? 'at' : 'createdAt']: serverTimestamp() })
    else batch.update(doc(selectedDb, r.path), r.fields)
  }
  return batch.commit()
}
async function check(label, action, extra) {
  await seed(extra)
  try { await action(); passed++; console.log('ok   ' + label) } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message) }
}
const ref = records => records.find(r => r.path.startsWith('range_products/'))
const audit = records => records.find(r => r.path.startsWith('range_mcp_audit/'))
const reuse = records => records.find(r => r.path === `range_components/${B0016_REUSE_ID}`)
const quote = records => records.find(r => r.path.includes('/supplier_quotes/') && r.fields.crystal_code === 'BK')
await check('seven atomic components + quotes + C1 + range + audit allowed only in candidate', () => assertSucceeds(bundle()))
await env.withSecurityRulesDisabled(async context => {
  const d = (await getDoc(doc(context.firestore(), `range_components/${B0016_REUSE_ID}`))).data()
  for (const key of Object.keys(c1).filter(k => k !== 'code')) if (JSON.stringify(d[key]) !== JSON.stringify(c1[key])) throw Error('C1 field changed: ' + key)
  if (d.code !== 'FM-CF003-C1') throw Error('C1 code not renamed')
})
for (const [label, mutate] of [
  ['missing audit', rs => rs.splice(rs.indexOf(audit(rs)), 1)],
  ['missing metal quote', rs => rs.splice(rs.findIndex(r => r.path.includes('/supplier_quotes/') && !r.fields.crystal_code), 1)],
  ['missing panel component', rs => rs.splice(rs.findIndex(r => r.fields.code === 'FM-CF003-BK'), 1)],
  ['missing C1 update', rs => rs.splice(rs.indexOf(reuse(rs)), 1)],
  ['wrong colour link', rs => { ref(rs).fields.critical_components[1].crystal_code = 'BL' }],
  ['orphan BOM ID', rs => { ref(rs).fields.critical_components[1].id = 'missing' }],
  ['mismatched component code', rs => { rs.find(r => r.fields.code === 'FM-CF003-BK').fields.code = 'FM-CF002-BK' }],
  ['wrong quote source', rs => { quote(rs).fields.source_provenance.quote_id = 'wrong' }],
  ['changed working amount', rs => { quote(rs).fields.unit_cost = 8.1 }],
  ['CNY not canonical RMB', rs => { quote(rs).fields.unit_cost_currency = 'CNY' }],
  ['finished price injection', rs => { ref(rs).fields.price_hkd = 62 }],
  ['active flag injection', rs => { ref(rs).fields.active = true }],
  ['customer supplier cost leakage', rs => { ref(rs).fields.critical_components[1].unit_cost = 9 }],
  ['C1 name overwrite', rs => { reuse(rs).fields.name = 'replace' }],
  ['C1 stock overwrite', rs => { reuse(rs).fields.stock_qty = 7 }],
  ['wrong principal', rs => { audit(rs).fields.service_principal = 'other' }],
  ['mismatched audit hash', rs => { audit(rs).fields.request_hash = 'f'.repeat(64) }],
  ['duplicate BOM component', rs => { ref(rs).fields.critical_components[2] = ref(rs).fields.critical_components[1] }],
]) await check(label + ' denies entire bundle', () => assertFails(bundle(mutate)))
await check('assigned C1 cost blocks reuse', () => assertFails(bundle()), { unit_cost: 12 })
await check('unrelated service cannot commit', () => assertFails(bundle(() => {}, env.authenticatedContext('other', { figurine_range_writer: true }).firestore())))
const approvalPath = `range_mcp_approvals/${plan.proposed.records.at(-1).path.split('/')[1]}`
await check('service cannot create/overwrite its approval', () => assertFails(setDoc(doc(db, approvalPath), { approved: true })))
await check('service cannot list private approvals', () => assertFails(getDocs(collection(db, 'range_mcp_approvals'))))
await check('service can fetch its exact approval', () => assertSucceeds(getDoc(doc(db, approvalPath))))
await check('missing approval denies bundle', async () => { await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), approvalPath))); await assertFails(bundle()) })
await check('expired approval denies bundle', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), approvalPath), { expires_at: Timestamp.fromDate(new Date('2000-01-01')) })); await assertFails(bundle()) })
await check('wrong service approval denies bundle', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), approvalPath), { service_principal: 'other' })); await assertFails(bundle()) })
await check('C1 changed owner note denies stale plan', () => assertFails(bundle()), { notes: 'new owner note' })
await check('repeat write cannot rewrite created components or audit', async () => { await assertSucceeds(bundle()); await assertFails(bundle()) })
await check('C1 rename-only outside the atomic bundle denied', () => assertFails(updateDoc(doc(db, `range_components/${B0016_REUSE_ID}`), { code: 'FM-CF003-C1' })))
await check('wrong target C1 code denied', () => assertFails(bundle(rs => { reuse(rs).fields.code = 'FM-CF003-BK' })))
await check('missing code rename denied', () => assertFails(bundle(rs => { delete reuse(rs).fields.code })))
await check('pre-existing reserved stock blocks rename', () => assertFails(bundle()), { reserved_qty: 1 })
await check('pre-existing stock blocks rename', () => assertFails(bundle()), { stock_qty: 1 })
await check('usage hints block rename', () => assertFails(bundle()), { used_by: ['another'] })
await check('wrong old code cannot be renamed', () => assertFails(bundle()), { code: 'P-CF002-C1' })
await check('wrong migration audit code denied', () => assertFails(bundle(rs => { audit(rs).fields.code_migration.from_code = 'P-CF002-C1' })))
for (const [label, change] of [
  ['missing usage review', { usage_review: {} }],
  ['nonzero references', { 'usage_review.reference_count': 1 }],
  ['code conflict', { 'usage_review.code_conflict_count': 1 }],
  ['child records', { 'usage_review.child_record_count': 1 }],
  ['stale usage review', { 'usage_review.checked_at': Timestamp.fromMillis(Date.now() - 16 * 60 * 1000) }],
]) await check(label + ' denies bundle', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), approvalPath), change)); await assertFails(bundle()) })
await check('renamed exact C1 stays readable for idempotent retry; costs remain private', async () => {
  await assertSucceeds(bundle())
  await assertSucceeds(getDoc(doc(db, `range_components/${B0016_REUSE_ID}`)))
  await assertFails(getDoc(doc(env.authenticatedContext('customer').firestore(), `range_components/${B0016_REUSE_ID}`)))
})
await env.cleanup()
const phase = await initializeTestEnvironment({ projectId: 'crystocraft-seven-phase-one-test', firestore: { rules: source } })
await phase.withSecurityRulesDisabled(async context => {
  await setDoc(doc(context.firestore(), `users/${RANGE_SERVICE_UID}`), { role: 'staff', modules: [], service_scope: 'figurine-range-b0016' })
  await setDoc(doc(context.firestore(), `range_products/${range_id}`), range)
  await setDoc(doc(context.firestore(), `range_components/${B0016_REUSE_ID}`), c1)
})
try { await assertFails(bundle(() => {}, phase.authenticatedContext(RANGE_SERVICE_UID, { figurine_range_writer: true }).firestore())); passed++; console.log('ok   checked-in false gate denies complete seven bundle') } catch (e) { failed++; console.error(e.message) }
await phase.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
