// Emulator-only. Refuses any host/project which could reach a live catalogue.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createRangeUploadHandler, hash } from '../netlify/functions/lib/rangeUploadService.js'
import { RANGE_UPLOAD_UID } from '../src/domain/rangeUpload.js'
import { coach, contextFixture, SERVICE, OWNER } from './range-upload-fixtures.mjs'

const PROJECT = 'demo-range-mcp'
const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Emulator-only suite: explicit loopback FIRESTORE_EMULATOR_HOST required')
const app = initializeApp({ projectId: PROJECT }, 'range-mcp-integration')
const db = getFirestore(app)
let now = Date.now(), seq = 0
const secret = 'emulator-fixture-signing-only-not-a-production-secret'
const auth = { service: SERVICE, owner: OWNER, corporate: { uid: 'mcp-product-writer-service' }, customer: { uid: 'customer' }, wrong: { uid: RANGE_UPLOAD_UID, range_upload: false } }
const handler = (options = {}) => createRangeUploadHandler({ db, secret, auditFailure: () => {}, writesEnabled: true, clock: () => now, verifyToken: async token => { if (!auth[token]) throw Error('invalid'); return auth[token] }, ...options })
const invoke = async (op, input, token = 'service', fn = handler()) => {
  const response = await fn(new Request('http://localhost/api/mcp-range', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, input }) }))
  return { status: response.status, body: await response.json() }
}
const key = () => `00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`
async function seed() {
  const clear = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }); assert.equal(clear.ok, true)
  now = Date.now()
  await db.doc(`users/${RANGE_UPLOAD_UID}`).set({ role: 'service', status: 'approved', service_scope: 'range-upload-v1', modules: [] })
  await db.doc(`users/${OWNER.uid}`).set({ role: 'admin', status: 'approved' })
  await db.doc('users/figurine-staff').set({ role: 'staff', status: 'approved', modules: ['figurine'] })
  await db.doc('range_upload_controls/service').set({ enabled: true, principal_uid: RANGE_UPLOAD_UID, writes_enabled: true, write_expires_at: Timestamp.fromMillis(now + 1800000) })
  await db.doc('settings/crystal_colors').set({ colors: contextFixture().colors })
  await db.doc('settings/component_categories').set({ list: ['Metal Part','Base / Stand'] })
  for (const c of contextFixture().components) await db.doc(`range_components/${c.id}`).set(c.data)
}
async function preview(input = coach(), fn) {
  const r = await invoke('prepare_range_upload', input, 'service', fn)
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.safe_to_commit, true, JSON.stringify(r.body)); return r.body
}
async function approve(p, extra = {}) {
  const r = await invoke('approve_range_upload', { preview_token: p.preview_token, expected_preview_hash: p.preview_hash, purpose: 'Emulator fixture owner review', ...extra }, 'owner')
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.approval_id
}
const commitInput = (p, approval, id = key()) => ({ preview_token: p.preview_token, approval_id: approval, idempotency_key: id })
async function total(collection) { return (await db.collection(collection).get()).size }

after(async () => { await db.terminate(); await deleteApp(app) })
test('read/dry-run is write-free, redact suppliers; owner exact approval plus atomic commit, persisted readback, receipt/audit and idempotent retries', async () => {
  await seed(); const p = await preview()
  assert.equal(p.commit_enabled,true)
  for (const col of ['range_products','range_upload_approvals','range_upload_receipts','range_upload_audit','range_family_claims']) assert.equal(await total(col), 0)
  assert.equal(await total('range_components'), 3)
  const search = await invoke('search_range_components', { code: 'FM-GLB-H(G)' })
  assert.equal(search.body.matches[0].id, 'globe'); assert.equal(search.body.matches[0].unit_cost, undefined)
  const missing = await invoke('commit_range_upload', commitInput(p, p.preview_hash)); assert.equal(missing.status, 403)
  const approval = await approve(p), input = commitInput(p, approval)
  const r = await invoke('commit_range_upload', input)
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.readback_verified, true)
  assert.equal(r.body.readback.active, false); assert.equal(r.body.readback.status, 'concept'); assert.equal(r.body.readback.variants[0].ws_price_usd, null)
  assert.equal(r.body.readback.size, '10.68 × 6.15 × 8.56 cm')
  const family = (await db.doc(`range_products/${r.body.range_id}`).get()).data()
  for (const ref of family.critical_components) assert.equal((await db.doc(`range_components/${ref.id}`).get()).exists, true)
  assert.equal(await total('range_components'), 4); assert.equal(await total('range_upload_audit'), 1)
  assert.equal((await db.collectionGroup('supplier_quotes').get()).size, 0)
  for (const c of (await db.collection('range_components').get()).docs.filter(d => d.id.startsWith('rc_mcp_'))) for (const name of ['unit_cost','stock_qty','moq','lead_time_weeks','supplierId']) assert.equal(c.data()[name], undefined)
  const retry = await invoke('commit_range_upload', input)
  assert.equal(retry.body.range_id, r.body.range_id); assert.equal(retry.body.idempotent_replay, true)
  assert.equal(await total('range_products'), 1); assert.equal(await total('range_components'), 4)
  now += 1800000 // expired token still returns its exact committed receipt; no duplicate.
  assert.equal((await invoke('commit_range_upload', input)).body.idempotent_replay, true)
  const found = await invoke('get_range_family', { range_id: r.body.range_id }); assert.equal(found.body.family.version, r.body.post_version)
  const searchResult=await invoke('search_range_families',{design_no:'0606'});assert.equal(searchResult.status,200);assert.equal(searchResult.body.matches[0].id,r.body.range_id)
  writeFileSync('/private/tmp/range-mcp-ui-fixture.json', JSON.stringify({ project: PROJECT, range_id: r.body.range_id }))
})
test('different request under same key conflicts; same-token simultaneous retries commit once', async () => {
  await seed(); const p = await preview(), a = await approve(p), input = commitInput(p,a)
  const [one,two] = await Promise.all([invoke('commit_range_upload', input), invoke('commit_range_upload', input)])
  assert.equal(one.status, 200, JSON.stringify(one.body)); assert.equal(two.status, 200, JSON.stringify(two.body))
  assert.equal(one.body.range_id, two.body.range_id); assert.equal(await total('range_upload_audit'), 1)
  const other = coach(); other.family.design_no = '0888'; other.components = []
  const p2 = await preview(other), a2 = await approve(p2)
  assert.equal((await invoke('commit_range_upload', commitInput(p2,a2,input.idempotency_key))).body.error.code, 'IDEMPOTENCY_CONFLICT')
})
test('simultaneous different creates for one family have one winner and no orphan components', async () => {
  await seed(); const first = coach(), second = coach(); second.family.design_name = 'Other reviewed name'; second.components[0].create.code = 'OTHER-FRAME-G'
  const [p1,p2] = await Promise.all([preview(first),preview(second)])
  const [a1,a2] = await Promise.all([approve(p1),approve(p2)])
  const result = await Promise.all([invoke('commit_range_upload',commitInput(p1,a1)), invoke('commit_range_upload',commitInput(p2,a2))])
  assert.deepEqual(result.map(r=>r.status).sort(), [200,409], JSON.stringify(result))
  assert.equal(await total('range_products'),1); assert.equal(await total('range_components'),4); assert.equal(await total('range_family_claims'),1)
})
test('stale update detects external colour-image and unknown-field changes; fresh bounded correction preserves every unrelated field', async () => {
  await seed(); const p = await preview(), a = await approve(p), created = await invoke('commit_range_upload',commitInput(p,a))
  const ref = db.doc(`range_products/${created.body.range_id}`)
  const initial = (await ref.get()).data(); initial.variants[0].colour_images = { C1: 'https://example.test/old.png' }; initial.variants[0].future = { keep: 7 }; initial.unknown_future = 'keep'; initial.plating_stock = { G: 18 }; initial.variants[0].ws_price_usd = 9
  await ref.set(initial)
  let read = (await invoke('get_range_family',{range_id:ref.id})).body.family
  const change = { mode:'update', range_id:ref.id, expected_version:read.version, family:{design_name:'Corrected coach'}, variants:[{variant_id:read.variants[0].variant_id, crystal_colors:['C1','BL']}], dry_run:true }
  const stale = await preview(change), sa = await approve(stale)
  const freshImage = (await ref.get()).data(); freshImage.variants[0].colour_images.C1 = 'https://example.test/new.png'; await ref.update({variants:freshImage.variants})
  assert.equal((await invoke('commit_range_upload',commitInput(stale,sa))).status,409)
  read = (await invoke('get_range_family',{range_id:ref.id})).body.family; change.expected_version = read.version
  const fresh = await preview(change), fa = await approve(fresh), result = await invoke('commit_range_upload',commitInput(fresh,fa))
  assert.equal(result.status,200,JSON.stringify(result.body)); assert.equal(result.body.readback_verified,true)
  const saved = (await ref.get()).data()
  assert.deepEqual(saved.variants[0].colour_images,{C1:'https://example.test/new.png'}); assert.deepEqual(saved.variants[0].future,{keep:7}); assert.equal(saved.unknown_future,'keep')
  assert.equal(saved.variants[0].ws_price_usd,9); assert.deepEqual(saved.plating_stock,{G:18}); assert.equal(saved.createdAt.isEqual(initial.createdAt),true)
})
test('tampered/expired previews, revoked approvals, disabled controls and overprivileged identities are refused', async () => {
  await seed(); const p=await preview(), a=await approve(p)
  const input=commitInput(p,a)
  assert.equal((await invoke('commit_range_upload',{...input,preview_token:p.preview_token+'x'})).status,400)
  await db.doc(`range_upload_approvals/${a}`).update({revoked:true})
  assert.equal((await invoke('commit_range_upload',input)).status,403)
  await db.doc(`range_upload_approvals/${a}`).update({revoked:false})
  assert.equal((await invoke('commit_range_upload',input,'service',handler({writesEnabled:false}))).body.error.code,'WRITES_DISABLED')
  await db.doc('range_upload_controls/service').update({writes_enabled:false})
  assert.equal((await invoke('commit_range_upload',input)).status,403)
  await db.doc('range_upload_controls/service').update({writes_enabled:true})
  for(const token of ['corporate','customer','wrong']) assert.equal((await invoke('prepare_range_upload',coach(),token)).status,403)
  assert.equal((await invoke('get_range_family',{range_id:'fixture'},'invalid')).status,401)
  await db.doc(`users/${RANGE_UPLOAD_UID}`).update({role:'admin',modules:['figurine']})
  assert.equal((await invoke('commit_range_upload',input)).status,403)
  await db.doc(`users/${RANGE_UPLOAD_UID}`).update({role:'service',modules:[]})
  now+=901000; assert.equal((await invoke('commit_range_upload',input)).body.error.code,'PREVIEW_EXPIRED')
  assert.equal(await total('range_products'),0); assert.equal(await total('range_components'),3)
})
test('preview cannot be self-approved; settings changes and private owner-role revocation abort commits', async () => {
  await seed(); const p=await preview()
  const self=await invoke('approve_range_upload',{preview_token:p.preview_token,expected_preview_hash:p.preview_hash,purpose:'No authority'},'service')
  assert.equal(self.status,403)
  const a=await approve(p)
  await db.doc(`users/${OWNER.uid}`).update({role:'staff'})
  assert.equal((await invoke('commit_range_upload',commitInput(p,a))).body.error.code,'OWNER_APPROVAL_REVOKED')
  await db.doc(`users/${OWNER.uid}`).update({role:'admin'})
  await db.doc('settings/crystal_colors').update({colors:[{code:'C1',name:'Changed library'}]})
  assert.equal((await invoke('commit_range_upload',commitInput(p,a))).status,409)
  assert.equal(await total('range_components'),3)
})
test('visible-family correction needs separate public-update approval, and never changes its visibility or price', async () => {
  await seed(); const p=await preview(), a=await approve(p), created=await invoke('commit_range_upload',commitInput(p,a)), ref=db.doc(`range_products/${created.body.range_id}`)
  await ref.update({active:true,status:'active'})
  const read=(await invoke('get_range_family',{range_id:ref.id})).body.family
  const change=await preview({mode:'update',range_id:ref.id,expected_version:read.version,family:{design_name:'Reviewed public correction'},dry_run:true})
  const no=await invoke('approve_range_upload',{preview_token:change.preview_token,expected_preview_hash:change.preview_hash,purpose:'Not public'},'owner')
  assert.equal(no.status,403)
  const yes=await approve(change,{allow_public_update:true}), r=await invoke('commit_range_upload',commitInput(change,yes))
  assert.equal(r.status,200); assert.equal(r.body.readback.active,true); assert.equal(r.body.readback.status,'active'); assert.equal(r.body.readback.variants[0].ws_price_usd,null)
})
test('HTTP request size/shape checks and narrow lookup refuse generic access or writes', async()=>{
  await seed()
  const bad=await handler()(new Request('http://localhost',{method:'POST',headers:{Authorization:'Bearer service'},body:'x'.repeat(140000)}));assert.equal(bad.status,413)
  assert.equal((await invoke('set_document',{path:'products/x',data:{}})).status,400)
  assert.equal((await invoke('prepare_range_upload',{...coach(),family:{...coach().family,active:true}})).status,400)
  assert.equal((await invoke('search_range_families',{})).status,400)
  const punctuation=await invoke('search_range_components',{code:'FM-GLB-H-G'});assert.equal(punctuation.body.requires_confirmation,true);assert.equal(punctuation.body.matches[0].code,'FM-GLB-H(G)')
})
test('manual UI and MCP share the same family reservation under a simultaneous create',async()=>{
 await seed();const p=await preview(),a=await approve(p)
 const {initializeApp: clientApp,deleteApp: deleteClient}=await import('../node_modules/firebase/app/dist/index.mjs')
 const {getFirestore: clientDb,connectFirestoreEmulator,terminate}=await import('../node_modules/firebase/firestore/dist/index.mjs')
 const {persistRangeFamily}=await import('../src/rangePersistence.js')
 const app=clientApp({projectId:PROJECT,apiKey:'emulator-only'},'range-ui-race'),cdb=clientDb(app),[hostname,port]=host.split(':')
 connectFirestoreEmulator(cdb,hostname,Number(port),{mockUserToken:{sub:OWNER.uid,user_id:OWNER.uid}})
 try {
  const outcomes=await Promise.allSettled([invoke('commit_range_upload',commitInput(p,a)),persistRangeFamily(cdb,'manual_family',{design_no:'0606',format_code:'001',design_name:'Manual fixture',status:'concept',active:false},true)])
  const success=outcomes.filter((r,i)=>r.status==='fulfilled'&&(i===1||r.value.status===200))
  assert.equal(success.length,1);assert.equal(await total('range_products'),1)
  assert.equal(await total('range_components'),outcomes[0].status==='fulfilled'&&outcomes[0].value.status===200?4:3)
 } finally {await terminate(cdb);await deleteClient(app)}
})
test('manual component helper and MCP missing-part commit cannot duplicate a punctuation-equivalent code',async()=>{
 await seed();const p=await preview(),a=await approve(p)
 const {initializeApp:clientApp,deleteApp:deleteClient}=await import('../node_modules/firebase/app/dist/index.mjs')
 const {getFirestore:clientDb,connectFirestoreEmulator,terminate}=await import('../node_modules/firebase/firestore/dist/index.mjs')
 const {persistRangeComponent}=await import('../src/rangePersistence.js')
 const app=clientApp({projectId:PROJECT,apiKey:'emulator-only'},'range-component-ui-race'),cdb=clientDb(app),[hostname,port]=host.split(':')
 connectFirestoreEmulator(cdb,hostname,Number(port),{mockUserToken:{sub:OWNER.uid,user_id:OWNER.uid}})
 try {
  const outcomes=await Promise.allSettled([invoke('commit_range_upload',commitInput(p,a)),persistRangeComponent(cdb,'manual_component',{code:'FM-U0606PT00.01G',name:'Manual frame',category:'Metal Part',plating_code:'G'})])
  assert.equal(outcomes.filter((r,i)=>r.status==='fulfilled'&&(i===1||r.value.status===200)).length,1)
  assert.equal(await total('range_components'),4);assert.equal(await total('range_component_claims'),1)
  const mcpWon=outcomes[0].status==='fulfilled'&&outcomes[0].value.status===200;assert.equal(await total('range_products'),mcpWon?1:0)
 } finally {await terminate(cdb);await deleteClient(app)}
})
test('two different families cannot concurrently create the same critical component or punctuation alias',async()=>{
 await seed();const p=await preview(),other=coach();other.family.design_no='0888';other.components[0].create.code='FM-U0606PT00.01G'
 const q=await preview(other),a=await approve(p),b=await approve(q)
 const results=await Promise.all([invoke('commit_range_upload',commitInput(p,a)),invoke('commit_range_upload',commitInput(q,b))])
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await total('range_products'),1);assert.equal(await total('range_components'),4)
})
test('dry-run reports reserved tombstones, referenced component drift aborts, injected transaction failure leaves no orphans',async()=>{
 await seed();await db.doc('range_family_claims/0606-001').set({range_id:'deleted_family'})
 const blocked=await invoke('prepare_range_upload',coach());assert.equal(blocked.status,200);assert.equal(blocked.body.safe_to_commit,false);assert.equal(blocked.body.preview_token,null)
 await seed();const p=await preview(),a=await approve(p);await db.doc('range_components/crown').update({name:'Changed concurrently'})
 assert.equal((await invoke('commit_range_upload',commitInput(p,a))).status,409);assert.equal(await total('range_products'),0)
 await seed();const q=await preview(),b=await approve(q)
 const faulty=new Proxy(db,{get(target,prop){if(prop==='runTransaction')return cb=>target.runTransaction(tx=>cb(new Proxy(tx,{get(t,k){if(k==='create')return(ref,...args)=>{if(ref.path.startsWith('range_upload_receipts/'))throw Error('Injected commit interruption');return t.create(ref,...args)};const v=t[k];return typeof v==='function'?v.bind(t):v}})));const v=target[prop];return typeof v==='function'?v.bind(target):v}})
 const r=await invoke('commit_range_upload',commitInput(q,b),'service',handler({db:faulty}));assert.equal(r.status,503)
 for(const col of ['range_products','range_family_claims','range_component_claims','range_upload_audit','range_upload_receipts'])assert.equal(await total(col),0)
 assert.equal(await total('range_components'),3);assert.equal((await db.doc(`range_upload_approvals/${b}`).get()).data().used_by,undefined)
})
test('preview commit-enabled signal includes the actual expiry window, while dry-run remains read-only',async()=>{
 await seed();await db.doc('range_upload_controls/service').update({write_expires_at:Timestamp.fromMillis(now-1)})
 const p=await preview();assert.equal(p.commit_enabled,false);assert.equal(await total('range_products'),0)
})
// Keep one emulator-created fixture for the actual local OC form visual check.
test('leave an emulator-only committed family for OC form readback',async()=>{
  await seed();const p=await preview(),a=await approve(p),r=await invoke('commit_range_upload',commitInput(p,a));assert.equal(r.status,200)
  const searchResult=await invoke('search_range_families',{design_no:'0606'});assert.equal(searchResult.status,200);assert.equal(searchResult.body.matches[0].id,r.body.range_id)
  writeFileSync('/private/tmp/range-mcp-ui-fixture.json',JSON.stringify({project:PROJECT,range_id:r.body.range_id}))
})
