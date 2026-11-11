// Fictional gateway fixtures and disposable PostgreSQL. No network or credentials.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const rows = async (sql, args) => (await db.query(sql, args)).rows
const types = ['text', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text', 'numeric', 'numeric',
  'text', 'text', 'text', 'text', 'jsonb', 'date', 'date', 'text', 'text']
const postParams = [
  'firestore_id', 'customer', 'channel', 'currency', 'order_id', 'uc_id', 'uc_no', 'si_no',
  'system_amount', 'accounting_amount', 'adjustment_reason', 'disposition', 'reason',
  'remarks', 'lines', 'record_date', 'accounting_date', 'marketplace_ref', 'created_by',
].map(name => 'p_' + name)
const post = `public.allocate_credit_note(${types.join(',')})`
const voidNote = 'public.void_credit_note(bigint,text)'
const audit = 'public.credit_note_audit_fn()'
const signatures = [post, voidNote, audit]
const acl = async () => Promise.all(signatures.map(async signature => (await rows(`
  select has_function_privilege('anon',$1,'execute') as anon,
         has_function_privilege('authenticated',$1,'execute') as authenticated,
         has_function_privilege('service_role',$1,'execute') as service,
         has_function_privilege('qa_other',$1,'execute') as other`, [signature]))[0]))
const expectedAcl = [true, true, false].map(service => ({ anon:false, authenticated:false, service, other:false }))
const migration = await readFile('erp-sync/migrations/20261111172028_harden_credit_note_execute.sql', 'utf8')
const legacyGrants = `grant execute on function ${post}, ${voidNote}, ${audit} to public;
  grant execute on function ${post} to anon, authenticated;
  grant execute on function ${audit} to service_role;`
const snapshot = async () => ({
  functions: await rows(`select p.oid, pg_get_functiondef(p.oid) as definition, p.proowner, p.proconfig from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('allocate_credit_note','void_credit_note','credit_note_audit_fn') order by proname`),
  trigger: await rows(`select pg_get_triggerdef(oid) from pg_trigger where tgname='trg_credit_note_audit'`),
  grants: await rows(`select relname,relacl from pg_class where relnamespace='public'::regnamespace and relkind in ('r','S') order by relname`),
  notes: await rows('select * from public.app_credit_note order by id'),
  audits: await rows('select * from public.credit_note_audit order by id'),
  ucs: await rows('select * from public.uc_registry order by id'),
  sequences: await Promise.all(['cn_seq', 'app_credit_note_id_seq', 'credit_note_audit_id_seq'].map(
    name => rows(`select last_value,is_called from public.${name}`))),
})

async function loadModule(entry, filter, contents) {
  const result = await build({ entryPoints:[entry], bundle:true, platform:'node', format:'esm', write:false,
    plugins:[{ name:'fictional-auth-boundary', setup(b) {
      b.onResolve({ filter }, () => ({ path:'auth', namespace:'fictional' }))
      b.onLoad({ filter:/.*/, namespace:'fictional' }, () => ({ contents }))
    } }] })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

const { default: handler } = await loadModule('netlify/edge-functions/credit-note.js', /^https:\/\/esm\.sh\/jose/, `
  export const createRemoteJWKSet=()=>({});
  export async function jwtVerify(token) {
    if (!['qa-admin','qa-staff','qa-other-staff','qa-customer'].includes(token)) throw new Error('Invalid fixture token');
    return {payload:{sub:token,email:token+'@example.invalid'}};
  }`)
let identity = 'qa-admin'
globalThis.creditNoteQaIdentity = () => identity
const client = await loadModule('src/creditNotes.js', /^\.\/firebase$/, `
  export const authedUser=async()=>({getIdToken:async()=>globalThis.creditNoteQaIdentity()});`)
globalThis.Deno = { env:{ get:key=>({ SUPABASE_URL:'https://credit-db.invalid', SUPABASE_SECRET_KEY:'fixture-key',
  VITE_FIREBASE_PROJECT_ID:'demo-credit-note' })[key] } }

let dbCalls = 0
const response = body => Response.json(body)
globalThis.fetch = async (input, init = {}) => {
  if (input === '/api/credit-note') return handler(new Request('https://credit-app.invalid/api/credit-note', init))
  const url = new URL(input)
  if (url.origin === 'https://firestore.googleapis.com') {
    assert.ok(url.pathname.includes('/projects/demo-credit-note/'))
    const token = url.pathname.split('/').at(-1)
    assert.equal(init.headers.Authorization, 'Bearer ' + token)
    const role = token === 'qa-admin' ? 'admin' : token === 'qa-customer' ? 'customer' : 'staff'
    const module = token === 'qa-other-staff' ? 'shipping' : 'credit_notes'
    return response({ fields:{ role:{stringValue:role}, modules:{arrayValue:{values:[{stringValue:module}]}} } })
  }
  assert.equal(url.origin, 'https://credit-db.invalid')
  assert.equal(init.headers.apikey, 'fixture-key')
  assert.equal(init.headers.Authorization, 'Bearer fixture-key')
  dbCalls++
  await db.exec('set role service_role')
  try {
    if (url.pathname === '/rest/v1/rpc/allocate_credit_note') {
      const body = JSON.parse(init.body)
      assert.deepEqual(Object.keys(body).sort(), [...postParams].sort())
      const casts = types.map((type, i) => `$${i+1}::${type}`).join(',')
      return response(await rows(`select * from public.allocate_credit_note(${casts})`,
        postParams.map((name,i) => types[i] === 'jsonb' ? JSON.stringify(body[name]) : body[name])))
    }
    if (url.pathname === '/rest/v1/rpc/void_credit_note') {
      const { p_id, p_voided_by } = JSON.parse(init.body)
      await rows('select public.void_credit_note($1::bigint,$2::text)', [p_id,p_voided_by])
      return response(null)
    }
    assert.equal(url.pathname, '/rest/v1/app_credit_note')
    assert.equal(url.searchParams.get('select'), '*')
    assert.equal(url.searchParams.get('order'), 'id.desc')
    const args = []
    const conditions = ['si_no','order_id'].flatMap(field => {
      const value = url.searchParams.get(field)
      if (!value) return []
      assert.ok(value.startsWith('eq.'))
      args.push(value.slice(3))
      return [`${field}=$${args.length}`]
    })
    args.push(Number(url.searchParams.get('limit')))
    const where = conditions.length ? 'where '+conditions.join(' and ') : ''
    return response(await rows(`select * from public.app_credit_note ${where} order by id desc limit $${args.length}`,args))
  } finally { await db.exec('reset role') }
}

const fixture = { firestoreId:'fictional-cn-admin', customer:'Fictional Credit Note Customer',
  order_id:'fictional-order', currency:'HKD', uc_no:'UC900/26', si_no:'SI-FICTIONAL', system_amount:12,
  accounting_amount:11.97, adjustment_reason:'Fictional rounding', disposition:'record_only',
  lines:[{ item_code:'FICTIONAL', qty_returned:2, unit:'pcs', unit_price:6 }], accounting_date:'2026-11-12' }

try {
  const [version] = await rows('select version()')
  assert.match(version.version, /^PostgreSQL 17\./)
  await db.exec(`create role anon; create role authenticated; create role service_role; create role qa_other;
    create table public.uc_registry(id bigint primary key, uc_no text, year text);
    insert into public.uc_registry values (1,'UC900','/26');`)
  await db.exec(await readFile('erp-sync/app_credit_note.sql','utf8'))
  assert.deepEqual(await acl(), expectedAcl)
  console.log('PASS canonical setup commits restricted function grants')
  await db.exec(legacyGrants)
  assert.deepEqual(await acl(), signatures.map(() => ({anon:true,authenticated:true,service:true,other:true})))
  console.log('PASS baseline effective privileges in ' + version.version.split(' on ')[0])

  const existing = await client.postCreditNote(fixture)
  assert.match(existing.cn_no, /^CN600\/\d{2}$/)
  const before = await snapshot()
  await db.exec(migration)
  assert.deepEqual(await acl(), expectedAcl)
  await db.exec(migration)
  assert.deepEqual(await snapshot(), before)
  console.log('PASS proposed grants preserve existing note, audit, sequences, definitions, trigger and relation ACLs')

  const callsBeforeDenial = dbCalls
  for (const [token,status] of [[null,401],['invalid',401],['qa-other-staff',403],['qa-customer',403]]) {
    for (const op of ['post_credit_note','void_credit_note','list_credit_notes']) {
      const req = new Request('https://credit-app.invalid/api/credit-note', { method:'POST',
        headers: token ? { Authorization:'Bearer '+token } : {}, body:JSON.stringify({op}) })
      assert.equal((await handler(req)).status,status)
    }
  }
  await assert.rejects(client.postCreditNote({...fixture, adjustment_reason:''}), /Adjustment reason required/)
  assert.equal(dbCalls,callsBeforeDenial)
  assert.deepEqual(await snapshot(),before)
  console.log('PASS 12 denied gateway requests and adjustment validation stop before database access')

  const second = await client.postCreditNote({...fixture,firestoreId:'fictional-cn-admin-second'})
  identity = 'qa-staff'
  const third = await client.postCreditNote({...fixture,firestoreId:'fictional-cn-staff',uc_no:'UC-LEGACY/24', order_id:'fictional-legacy-order'})
  assert.match(second.cn_no,/^CN601\/\d{2}$/)
  assert.match(third.cn_no,/^CN602\/\d{2}$/)
  const all = await client.listCreditNotes({si_no:'SI-FICTIONAL'})
  assert.deepEqual(all.map(note=>note.cn_no),[third.cn_no,second.cn_no,existing.cn_no])
  assert.deepEqual((await client.listCreditNotes({order_id:'fictional-order',limit:1})).map(note=>note.cn_no),[second.cn_no])
  assert.equal(all[0].uc_id,null)
  assert.equal(all[0].uc_no,'UC-LEGACY/24')
  assert.equal(Number(all[1].uc_id),1)
  assert.equal(Number(all[1].accounting_amount),11.97)
  assert.equal(Number(all[1].adjustment),-0.03)
  assert.equal(all[1].created_by,'qa-admin@example.invalid')
  assert.equal(all[0].created_by,'qa-staff@example.invalid')
  assert.deepEqual((await snapshot()).ucs,before.ucs)
  console.log('PASS admin/staff posts, filtered list, distinct CNs for one SI, exact amounts, actor and UC references')

  assert.deepEqual(await client.voidCreditNote(existing.id),{ok:true})
  const afterVoid = await snapshot()
  assert.equal(afterVoid.notes.length,3)
  assert.equal(afterVoid.notes[0].status,'void')
  assert.equal(afterVoid.notes[0].voided_by,'qa-staff@example.invalid')
  assert.deepEqual(afterVoid.audits.map(row=>row.action),['insert','insert','insert','update'])
  assert.equal(afterVoid.audits[3].before.status,'posted')
  assert.equal(afterVoid.audits[3].after.status,'void')
  await client.voidCreditNote(existing.id)
  assert.deepEqual(await snapshot(),afterVoid)
  console.log('PASS void existing record, trigger audit and repeat void without a second event')

  await db.exec('grant service_role to anon;')
  const inheritedAcl = await acl()
  await assert.rejects(db.exec(migration), /execution grants do not match/)
  await db.exec('rollback; revoke service_role from anon;')
  assert.equal(inheritedAcl[0].anon,true)
  assert.equal(inheritedAcl[1].anon,true)
  assert.deepEqual(await acl(),expectedAcl)
  assert.deepEqual(await snapshot(),afterVoid)
  console.log('PASS effective grant check catches inherited service access and rolls back')

  await db.exec('alter table public.app_credit_note disable trigger trg_credit_note_audit;')
  await assert.rejects(db.exec(migration), /audit trigger changed/)
  await db.exec('rollback; alter table public.app_credit_note enable trigger trg_credit_note_audit;')
  await db.exec('create function public.void_credit_note() returns int language sql as $$select 1$$;')
  await assert.rejects(db.exec(migration), /inspect overloads/)
  await db.exec('rollback; drop function public.void_credit_note();')
  await db.exec('alter function public.void_credit_note(bigint,text) set search_path = public;')
  await assert.rejects(db.exec(migration), /definition or owner changed/)
  await db.exec('rollback; alter function public.void_credit_note(bigint,text) set search_path = public, pg_temp;')
  assert.deepEqual(await acl(),expectedAcl)
  assert.deepEqual(await snapshot(),afterVoid)
  console.log('PASS drift guards reject a disabled trigger, unexpected overload or changed function configuration')
} finally {
  await db.close()
}
