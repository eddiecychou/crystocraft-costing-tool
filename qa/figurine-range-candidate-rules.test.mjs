// Exercises the NOT DEPLOYABLE write-candidate rule paths in an emulator only.
// The checked-in rules keep b0016WritesApproved() == false. This test flips
// that one function in memory to expose referential-integrity mistakes before
// an owner ever considers a separate phase-two rules review.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore'

const source = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const needle = 'function b0016WritesApproved() {\n      return false;\n    }'
if (!source.includes(needle)) throw new Error('Write gate shape changed; do not silently run this candidate test')
const env = await initializeTestEnvironment({
  projectId: 'crystocraft-b0016-candidate-test',
  firestore: { rules: source.replace(needle, needle.replace('return false;', 'return true;')) },
})
const uid = 'mcp-figurine-range-service'
const rangeId = 'mcp_range_0123456789abcdef0123456789abcdef'
const requestId = 'df17f76f-f84d-4f42-bd23-1134464531b8'
const hash = 'a'.repeat(64)
const codes = ['B0016-000-GBK', 'B0016-000-GBL', 'B0016-000-GC1', 'B0016-000-GMT', 'B0016-000-GPE', 'B0016-000-GVL']
let pass = 0, fail = 0
const check = async (label, result) => {
  try { await result; pass++; console.log(`ok   ${label}`) }
  catch (error) { fail++; console.error(`FAIL ${label}: ${error.message}`) }
}
await env.withSecurityRulesDisabled(async context => {
  await setDoc(doc(context.firestore(), `users/${uid}`), { role: 'staff', modules: [], service_scope: 'figurine-range-b0016' })
})
const db = env.authenticatedContext(uid, { figurine_range_writer: true }).firestore()
const variant = sku => ({
  brand_code: 'B', plating_code: 'G', crystal_code: sku.slice(-2), sku,
  ws_price_usd: null,
})
const design = {
  design_no: '0016', body_code: '', body_name: '', design_code: '0016',
  design_name: 'CRYSTAL FABRIC MEZUZAH CASE', description: '', marketing_description: '',
  category: '', design_type: 'Crystal Fabric', product_type: '', format_code: '000',
  size: '', crystal_type: '', active: false, status: 'concept', is_new: false,
  moq: null, lead_time_weeks: null, delivery_note: '', critical_components: [],
  packing: {}, plating_stock: {}, crystal_components: {}, gallery: [], videos: [],
  video_url: '', blog_links: [], variants: codes.map(variant),
  mcp_creator_uid: uid, mcp_request_id: requestId, mcp_request_hash: hash,
  createdAt: serverTimestamp(),
}

await check('orphan claim denied with write candidate enabled', assertFails(setDoc(doc(db, `range_sku_claims/${codes[0]}`), {
  item_code: codes[0], range_id: rangeId, service_principal: uid, createdAt: serverTimestamp(),
})))
await check('range without six claims denied', assertFails(setDoc(doc(db, `range_products/${rangeId}`), design)))
const polluted = writeBatch(db)
polluted.set(doc(db, `range_products/${rangeId}`), {
  ...design, variants: [{ ...design.variants[0], supplier_cost: 99 }, ...design.variants.slice(1)],
})
for (const code of codes) polluted.set(doc(db, `range_sku_claims/${code}`), {
  item_code: code, range_id: rangeId, service_principal: uid, createdAt: serverTimestamp(),
})
await check('variant cost-field injection denied even with matching claims', assertFails(polluted.commit()))

const bundle = writeBatch(db)
bundle.set(doc(db, `range_products/${rangeId}`), design)
for (const code of codes) bundle.set(doc(db, `range_sku_claims/${code}`), {
  item_code: code, range_id: rangeId, service_principal: uid, createdAt: serverTimestamp(),
})
bundle.set(doc(db, `range_mcp_audit/mcp_range_${'b'.repeat(64)}`), {
  action: 'create_mezuzah_range_design', service_principal: uid, requested_by: 'unknown',
  request_id: requestId, request_hash: hash, range_id: rangeId,
  source_product_id: 'mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd',
  at: serverTimestamp(),
})
await check('atomic design plus six matching claims accepted', assertSucceeds(bundle.commit()))
await check('mismatched claim to existing design denied', assertFails(setDoc(doc(db, `range_sku_claims/${codes[0]}`), {
  item_code: 'WRONG', range_id: rangeId, service_principal: uid, createdAt: serverTimestamp(),
})))
await check('orphaned BOM link denied with write candidate enabled', assertFails(updateDoc(doc(db, `range_products/${rangeId}`), {
  critical_components: [
    { id: 'mcp_b0016_m_0123456789abcdef0123', code: 'B0016-METAL', qty_per_unit: 1, plating_code: '', all_variants: true },
    { id: 'mcp_b0016_f_0123456789abcdef0123', code: 'B0016-FABRIC', qty_per_unit: 1, plating_code: '', all_variants: true },
  ],
})))

const metalId = 'mcp_b0016_m_0123456789abcdef0123'
const fabricId = 'mcp_b0016_f_0123456789abcdef0123'
const metalQuoteId = 'mcp_b0016_mq_0123456789abcdef0123'
const fabricQuoteId = 'mcp_b0016_fq_0123456789abcdef0123'
const refs = [
  { id: metalId, code: 'B0016-METAL', qty_per_unit: 1, plating_code: '', all_variants: true },
  { id: fabricId, code: 'B0016-FABRIC', qty_per_unit: 1, plating_code: '', all_variants: true },
]
const component = (code, name, category, supplierId, supplierName, cost, tooling, quoteId) => ({
  code, name, category, plating_code: '', supplierId, supplierName, notes: '', images: [],
  unit_cost: cost, unit_cost_currency: 'RMB', tooling_sample_cost: tooling,
  tooling_sample_cost_currency: 'RMB', volume_tiers: [], preferred_quote_id: quoteId,
  preferred_supplier_name: supplierName, mcp_creator_uid: uid, mcp_range_id: rangeId,
  mcp_request_id: requestId, mcp_request_hash: hash, createdAt: serverTimestamp(),
})
const quote = (supplier_id, supplier_name, unit_cost, moq, tooling_sample_cost, component_id, quote_id, extra = {}) => ({
  supplier_id, supplier_name, unit_cost, unit_cost_currency: 'RMB', moq,
  tooling_sample_cost, tooling_sample_cost_currency: 'RMB', is_preferred: true,
  volume_tiers: [], attachments: [], notes: '',
  source_provenance: { product_id: 'mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd', component_id, quote_id },
  mcp_creator_uid: uid, mcp_range_id: rangeId, mcp_request_id: requestId,
  mcp_request_hash: hash, createdAt: serverTimestamp(), ...extra,
})
const componentBundle = (linkedRefs = refs) => {
  const batch = writeBatch(db)
  batch.update(doc(db, `range_products/${rangeId}`), { critical_components: linkedRefs })
  batch.set(doc(db, `range_components/${metalId}`), component('B0016-METAL', 'Mezuzah Metal Case', 'Metal Part', '33VhLPOuBM46wcCmsb7B', 'Feihong', 11.30, 2912, metalQuoteId))
  batch.set(doc(db, `range_components/${fabricId}`), component('B0016-FABRIC', 'Crystal Fabric Mezuzah Panel', '', 'D1SDoLIAc2aw6PdP76Xo', 'Dongguan Yin Li', 9.00, null, fabricQuoteId))
  batch.set(doc(db, `range_components/${metalId}/supplier_quotes/${metalQuoteId}`), quote('33VhLPOuBM46wcCmsb7B', 'Feihong', 11.30, 500, 2912, 'mcp_a844ebe21ba90961027c', 'mcp_05752f5a8554c7a7d4bd'))
  batch.set(doc(db, `range_components/${fabricId}/supplier_quotes/${fabricQuoteId}`), quote('D1SDoLIAc2aw6PdP76Xo', 'Dongguan Yin Li', 9.00, 100, null, 'mcp_4e4b6112f372269e30dcfb21ea53ca5f', 'mcp_49239ae8ae9de42b0d7f9986d60da702', { source_unit_cost: 8.10, source_unit_cost_currency: 'RMB', cost_basis: 'owner_conservative' }))
  batch.set(doc(db, `range_mcp_audit/mcp_range_${'c'.repeat(64)}`), {
    action: 'create_mezuzah_range_components', service_principal: uid, requested_by: 'unknown',
    request_id: requestId, request_hash: hash, range_id: rangeId,
    source_product_id: 'mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd',
    component_ids: [metalId, fabricId], quote_ids: [metalQuoteId, fabricQuoteId],
    at: serverTimestamp(),
  })
  return batch
}
await check('mismatched BOM code blocks the whole component bundle', assertFails(componentBundle([{ ...refs[0], code: 'WRONG' }, refs[1]]).commit()))
await check('atomic linked components, quotes and audit accepted', assertSucceeds(componentBundle().commit()))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
