// Owner-authorized read-only usage audit. No create/update/delete/commit calls.
import { readFileSync } from 'node:fs'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export const LEGACY_C1_ID = 'rc_mv7xu3mmayc5g'
export const LEGACY_C1_CODE = 'P-CF003-C1'
export const FM_CODES = ['FM-B0016BY00-G', ...['BK','BL','C1','MT','PE','VL'].map(c => 'FM-CF003-' + c)]
export function referenceHits(value, field = '') {
  if (typeof value === 'string') return [LEGACY_C1_ID, LEGACY_C1_CODE].filter(token => value.toUpperCase().includes(token.toUpperCase())).map(token => ({ field, token }))
  if (Array.isArray(value)) return value.flatMap((v, i) => referenceHits(v, `${field}[${i}]`))
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && value.constructor?.name === 'DocumentReference') return referenceHits(value.path, field)
    return Object.entries(value).flatMap(([k, v]) => referenceHits(v, field ? `${field}.${k}` : k))
  }
  return []
}
const referenceFields = ['critical_components','crystal_components','components','component_id','componentId','component_ids',
  'linked_component_ids','component_lines','issued_lines','lines','items','linked','code','component_code',
  'componentcode_snapshot','material_code','product_code','item_code','sku','variants','finishes',
  'stock_items','materials','bom','refs','range_link','proposed','targets','target_ids','source_provenance',
  'action','reused_component_id','c1_before','quote_parents','audit','request_hash','used_by']

export async function auditFmMigration(db) {
  const legacy = await db.doc(`range_components/${LEGACY_C1_ID}`).get()
  const children = await db.doc(`range_components/${LEGACY_C1_ID}`).listCollections()
  const childCounts = {}
  for (const child of children) childCounts[child.id] = (await child.select().get()).size
  const library = await db.collection('range_components').select('code','name','unit_cost','supplierId','preferred_quote_id','stock_qty','reserved_qty').get()
  const conflicts = library.docs.filter(d => FM_CODES.includes(String(d.data().code || '').trim().toUpperCase())).map(d => ({ path: d.ref.path, code: d.data().code, name: d.data().name || '' }))
  const legacyCodeRecords = library.docs.filter(d => String(d.data().code || '').trim().toUpperCase() === LEGACY_C1_CODE).map(d => ({ path: d.ref.path, code: d.data().code }))
  const roots = (await db.listCollections()).map(c => c.id)
  const scan = [], references = []
  // Operational reference-bearing collections only, never customer chat/mail.
  const selected = ['range_products','products','purchase_orders','orders','client_quotes','packing_lists',
    'shipments','uc_invoices','credit_notes','catalogues','range_sku_claims','range_mcp_audit',
    'range_mcp_approvals','audit_logs','product_templates','customer_designs','procurement_lines']
  const inspect = (snap, label) => {
    scan.push({ scope: label, records: snap.size })
    for (const d of snap.docs) {
      if (d.ref.path === `range_components/${LEGACY_C1_ID}`) continue // owner record itself is not a downstream reference
      const hits = referenceHits(d.data())
      if (hits.length) references.push({ path: d.ref.path, hits })
    }
  }
  const operationalRoots = [...new Set([...selected.filter(name => roots.includes(name)), ...roots.filter(name => /(?:range|component|procure|production|inventory|stock|quote|order|catalog|invoice|shipment|packing|template|^pd_)/i.test(name))])]
  for (const name of operationalRoots) inspect(await db.collection(name).select(...referenceFields).get(), name)
  // Items/lines may be subcollections, and quotations/BOMs may live under products.
  for (const name of ['items','lines','components','supplier_quotes']) inspect(await db.collectionGroup(name).select(...referenceFields).get(), `collectionGroup:${name}`)
  const data = legacy.exists ? legacy.data() : null
  const summary = data && Object.fromEntries(['code','name','supplierId','preferred_quote_id','unit_cost','unit_cost_currency','tooling_sample_cost','stock_qty','reserved_qty','used_by'].map(k => [k, data[k] ?? null]))
  return { checked_at: new Date().toISOString(), read_only: true, production_writes: 0,
    component_library_count: library.size, exact_code_conflicts: conflicts, legacy_code_records: legacyCodeRecords,
    legacy_c1: { path: `range_components/${LEGACY_C1_ID}`, exists: legacy.exists, update_time: legacy.updateTime?.toDate().toISOString(), fields: summary, child_counts: childCounts },
    scans: scan, references, reference_count: references.length,
    limitations: ['Projected operational fields only; no external ERP, exports, offline spreadsheets or free-text customer communications scanned.', 'Snapshot audit, not a lock against later edits; repeat immediately before any approved migration.'] }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  if (!process.env.SA_KEY_PATH) throw Error('Existing owner credential path required')
  const key = JSON.parse(readFileSync(process.env.SA_KEY_PATH, 'utf8'))
  if (key.project_id !== 'crystocraft-costing') throw Error('Unexpected project')
  const app = initializeApp({ credential: cert(key) }, 'b0016-fm-read-only-audit')
  try { console.log(JSON.stringify(await auditFmMigration(getFirestore(app)), null, 2)) } finally { await deleteApp(app) }
}
