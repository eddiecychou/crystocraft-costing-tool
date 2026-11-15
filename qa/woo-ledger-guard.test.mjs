import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'
import { fictionalInvoiceRequest } from './invoice-recovery-postgres-fixture.mjs'

// Real edge handler, client, authorization and fictional ledger. Only JWT and
// upstream HTTP are stubbed. REST requests are served by read-only PostgreSQL.
const db = new PGlite()
const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno
let scratch, handler, client, requests, failure, responseOverride
const wooOrigin = 'https://fictional-woo.invalid', ledgerOrigin = 'https://fictional-ledger.invalid'
const env = {
  WC_BASE_URL: wooOrigin, WC_CONSUMER_KEY: 'fictional', WC_CONSUMER_SECRET: 'fictional',
  SUPABASE_URL: ledgerOrigin, SUPABASE_SECRET_KEY: 'fictional', VITE_FIREBASE_PROJECT_ID: 'fictional-ledger',
}
const numbers = { '900109': 'WC-"A",B.(1)\\C+中', '900110': '#870104' }
const profiles = {
  admin: ['admin', []], both: ['staff', ['woo', 'shipping']],
  woo: ['staff', ['woo']], shipping: ['staff', ['shipping']],
  customer: ['customer', ['woo', 'shipping']],
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const issue = async (sequence, patch) => {
  const id = '92d19cce-e42b-4ac3-8000-' + String(sequence).padStart(12, '0')
  const request = fictionalInvoiceRequest(patch)
  const query = () => rows('select * from public.allocate_sales_invoice_once($1::uuid, $2::jsonb)', [id, JSON.stringify(request)])
  const [result] = await query()
  assert.deepEqual(await query(), [result])
  return result
}
const shape = async () => (await rows(`
  select (select jsonb_agg(to_jsonb(i) order by id) from app_sales_invoice i) invoices,
         (select jsonb_agg(to_jsonb(u) order by id) from uc_registry u) uc,
         (select jsonb_agg(to_jsonb(a) order by operation_id) from oc_invoice_private.invoice_allocations a) receipts,
         (select jsonb_agg(to_jsonb(l) order by id) from app_sales_invoice_audit l) audit,
         (select jsonb_agg(to_jsonb(s) order by sequencename) from pg_sequences s where schemaname='public') sequences
`))[0]

before(async () => {
  assert.match((await rows('select version()'))[0].version, /^PostgreSQL 17\./)
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema raw;
    create table raw.salesinvoice(sino text);
    insert into raw.salesinvoice values ('SI260099');
    create sequence public.fictional_uc_number start 100;
    create table public.uc_registry(
      id bigserial primary key,
      uc_no text default ('UC'||nextval('public.fictional_uc_number')),
      year text, customer text, currency text, status text, created_by text,
      order_no text, source text, jes_si text
    );
  `)
  for (const path of [
    'erp-sync/app_sales_invoice.sql',
    'erp-sync/migrations/20261108013402_invoice_retry_recovery.sql',
  ]) await db.exec(await readFile(path, 'utf8'))

  const first = await issue(1, { order_id: 'woo-900102' })
  await rows(`update app_sales_invoice set channel='woocommerce',external_order_no='870102' where id=$1`, [first.o_invoice_id])
  await rows(`update uc_registry set source='Online Shop',order_no='#870102',jes_si=$2,status='closed' where id=$1`, [first.o_uc_id, first.o_si_no])

  const original = await issue(2, { order_id: 'woo-900105' })
  await issue(3, { order_id: 'woo-900105', purpose: 'split', reason: 'Fictional second shipment', uc_no: original.o_uc_no })
  await issue(4, { order_id: 'woo-900105', purpose: 'reissue', reason: 'Fictional revised invoice', uc_no: original.o_uc_no })
  await rows('update app_sales_invoice set status = $1 where id = $2', ['void', original.o_invoice_id])

  await rows(`insert into uc_registry (order_no,source,status,jes_si) values
    ('#870103','Online Shop','closed','SI250222'),
    ('870104','Online Shop','open',null),
    ('900101','Wholesale','open',null),
    ('#1900101','Online Shop','open',null),
    ('reference 900101','Online Shop','open',null),
    ('900106','Online Shop','open',null)`)
  await rows(`insert into app_sales_invoice (si_no,year,order_id,channel,external_order_no) values
    ('SI260201','26',null,'woocommerce','870107'),
    ('SI260202','26','woo-900999','woocommerce','870108'),
    ('SI260203','26','fictional-non-woo-order','other','870101'),
    ('SI260204','26','woo-1900101','woocommerce','1870101'),
    ('SI260205','26',null,'woocommerce',$1)`, [numbers['900109']])
  scratch = await mkdtemp(join(tmpdir(), 'oc-woo-ledger-'))
  for (const [name, entryPoint, filter, contents] of [
    ['edge', 'netlify/edge-functions/woo-sync.js', /^https:\/\/esm\.sh\/jose/,
      `export const createRemoteJWKSet = () => ({});
       export const jwtVerify = async token => ({payload:{sub:token,email:'fictional@example.invalid'}})`],
    ['client', 'src/wooSyncApi.js', /^\.\/firebase$/,
      `export const authedUser = async () => ({getIdToken:async () => 'admin'})`],
  ]) {
    await build({
      entryPoints: [entryPoint], outfile: join(scratch, name + '.mjs'),
      bundle: true, platform: 'node', format: 'esm', plugins: [{
        name: 'fictional-auth',
        setup(builder) {
          builder.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents }))
        },
      }],
    })
  }
  handler = (await import(pathToFileURL(join(scratch, 'edge.mjs')))).default
  client = await import(pathToFileURL(join(scratch, 'client.mjs')))
  globalThis.Deno = { env: { get: key => env[key] } }
  globalThis.fetch = async (input, init = {}) => {
    if (input === '/api/woo-sync') {
      return responseOverride || handler(new Request('https://fictional-app.invalid/api/woo-sync', init))
    }
    const url = new URL(input)
    assert.equal(init.method || 'GET', 'GET', 'The guard may only read upstream')
    if (url.origin === 'https://firestore.googleapis.com') {
      const [role, modules] = profiles[url.pathname.split('/').at(-1)]
      return Response.json({ fields: {
        role: { stringValue: role }, modules: { arrayValue: { values: modules.map(stringValue => ({ stringValue })) } },
      } })
    }
    requests.push(url)
    assert.ok(init.signal instanceof AbortSignal)
    assert.equal(init.redirect, 'error')
    if (failure?.matches(url)) return failure.respond()
    if (url.origin === wooOrigin) {
      const id = url.pathname.match(/^\/wp-json\/wc\/v3\/orders\/([0-9]+)$/)?.[1]
      assert.ok(id)
      assert.equal(url.searchParams.get('_fields'), 'id,number')
      return Response.json({ id: Number(id), number: numbers[id] ?? String(Number(id) - 30000) })
    }
    assert.equal(url.origin, ledgerOrigin, 'No other network operation is permitted')
    assert.equal(init.headers.apikey, 'fictional')
    return Response.json(await serveLedgerRead(url))
  }
})

after(async () => {
  globalThis.fetch = originalFetch
  globalThis.Deno = originalDeno
  await db.close()
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

async function serveLedgerRead(url) {
  const filters = url.searchParams
  assert.equal(filters.get('select'), 'id')
  assert.equal(filters.get('limit'), '1')
  assert.equal(filters.size, filters.has('order_id') ? 3 : 4)
  const exactValues = key => {
    const value = filters.get(key)
    assert.match(value, /^in\.\(.*\)$/u)
    return JSON.parse('[' + value.slice(4, -1) + ']')
  }
  const table = url.pathname.split('/').at(-1)
  await db.exec('begin read only')
  try {
    if (table === 'app_sales_invoice' && filters.has('order_id')) {
      assert.match(filters.get('order_id'), /^eq\.woo-\d+$/u)
      return await rows('select id from app_sales_invoice where order_id=$1 limit 1', [filters.get('order_id').slice(3)])
    }
    if (table === 'app_sales_invoice') {
      assert.equal(filters.get('channel'), 'eq.woocommerce')
      const values = exactValues('external_order_no')
      assert.equal(values.length, 1)
      return await rows("select id from app_sales_invoice where channel='woocommerce' and external_order_no=$1 limit 1", values)
    }
    assert.equal(table, 'uc_registry')
    assert.equal(filters.get('source'), 'eq.Online Shop')
    const values = exactValues('order_no')
    assert.equal(values.length, 2)
    return await rows("select id from uc_registry where source='Online Shop' and order_no in ($1,$2) limit 1", values)
  } finally {
    await db.exec('rollback')
  }
}

const call = (id, identity = 'admin') => handler(new Request('https://fictional-app.invalid/api/woo-sync', {
  method: 'POST', headers: identity ? { Authorization: 'Bearer ' + identity } : {},
  body: JSON.stringify({ op: 'verify_order_import', order_id: id, number: '900106' }),
}))
const paths = () => requests.map(url => url.pathname)

test('detects exact invoice and UC evidence and returns only a review reason', async () => {
  const before = await shape()
  for (const [id, reason] of [
    ['900102', 'invoice'], ['900103', 'uc'], ['900104', 'uc'], ['900105', 'invoice'],
    ['900107', 'invoice'], ['900108', 'invoice'], ['900109', 'invoice'], ['900110', 'uc'],
  ]) {
    requests = []
    const response = await call(id, 'both')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), { status: 'review', reason })
    if (id === '900102' || id === '900105') assert.deepEqual(paths(), ['/rest/v1/app_sales_invoice'])
  }
  assert.deepEqual(await shape(), before)
  const allocations = await rows(`select i.si_no, i.status, i.uc_id, a.request->>'purpose' as purpose
    from app_sales_invoice i join oc_invoice_private.invoice_allocations a on a.si_no=i.si_no
    where i.order_id='woo-900105' order by i.si_no`)
  assert.equal(new Set(allocations.map(row => row.si_no)).size, 3)
  assert.equal(new Set(allocations.map(row => row.uc_id)).size, 1)
  assert.deepEqual(allocations.map(row => [row.status, row.purpose]), [
    ['void', 'first'], ['issued', 'split'], ['issued', 'reissue'],
  ])
})

test('new Woo orders ignore partial, other-channel and browser-supplied number matches', async () => {
  for (const id of ['900101', '900106']) {
    requests = []
    const response = await call(id)
    assert.deepEqual(await response.json(), { status: 'clear' })
    assert.deepEqual(paths(), [
      '/rest/v1/app_sales_invoice', '/wp-json/wc/v3/orders/' + id,
      '/rest/v1/app_sales_invoice', '/rest/v1/uc_registry',
    ])
  }
  assert.equal(await client.verifyWooOrderImport(900101), null)
  assert.equal(await client.verifyWooOrderImport(900103), 'uc')
})

test('requires admin or both modules and rejects invalid IDs before upstream reads', async () => {
  requests = []
  for (const [identity, status] of [['woo', 403], ['shipping', 403], ['customer', 403], [null, 401]]) {
    assert.equal((await call('900105', identity)).status, status)
  }
  for (const id of [900101, '0', '0900101', '900101\n', '900101?x=y', '900101/900102', '', null]) {
    assert.equal((await call(id)).status, 400)
  }
  assert.deepEqual(requests, [])
})

test('missing, failed and malformed upstream responses fail closed and allow a new verification', async () => {
  requests = []
  const before = await shape()
  const isWoo = url => url.origin === wooOrigin
  const isCanonical = url => url.searchParams.has('order_id')
  const isExternal = url => url.searchParams.has('external_order_no')
  const isUc = url => url.pathname.endsWith('/uc_registry')
  for (const [match, response] of [
    [isCanonical, () => new Response('hidden backend detail', { status: 500 })],
    [isCanonical, () => Response.json({ rows: [] })],
    [isWoo, () => new Response('', { status: 404 })],
    [isWoo, () => Response.json({ id: 900100, number: '870101' })],
    [isWoo, () => Response.json({ id: 900101 })],
    [isExternal, () => new Response('', { status: 429 })],
    [isUc, () => { throw Error('Fictional connection failure') }],
    [isUc, () => Response.json([{}])],
  ]) {
    failure = { matches: match, respond: response }
    try {
      const denied = await call('900101')
      assert.equal(denied.status, 503)
      assert.deepEqual(await denied.json(), { error: 'Could not verify invoice and UC history. Please try again.' })
      await assert.rejects(client.verifyWooOrderImport(900101), /Could not verify invoice and UC history/)
    } finally {
      failure = null
    }
  }
  for (const body of [{}, { status: 'clear', reason: 'uc' }, { status: 'review', reason: 'unknown' }, null]) {
    responseOverride = Response.json(body)
    try { await assert.rejects(client.verifyWooOrderImport(900101), /Could not verify invoice and UC history/) }
    finally { responseOverride = null }
  }
  assert.equal(await client.verifyWooOrderImport(900101), null)
  assert.deepEqual(await shape(), before)
})
