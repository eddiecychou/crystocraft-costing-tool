import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  invoiceExpected,
  invoiceRequestSnapshot,
  invoiceResult,
  invoiceReferenceSavePatch,
  invoiceRecoveryView,
  sameInvoiceValue
} from '../src/invoiceRecoveryModel.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { createInvoiceRecoverySql } from '../netlify/functions/lib/invoiceRecoverySql.js'
const opid = '12345678-1234-4123-8123-123456789abc',
  order = {
    customer_name: 'Fictional 中文 Company',
    currency: 'USD',
    uc_no: 'UC1/26',
    erp_so_no: 'SO260005'
  },
  identity = { uid: 'fictional-admin', email: 'admin@example.invalid' }
test('saved snapshot fixes initiating identity, HKT year/date and exact UC without constraining later invoices', () => {
  const first = invoiceRequestSnapshot(
    order,
    'fictional',
    identity,
    'first',
    '',
    new Date('2026-12-31T17:00:00Z')
  )
  assert.equal(first.year, '27')
  assert.equal(first.invoiced_at, '2027-01-01')
  assert.equal(first.created_by, identity.email)
  assert.equal(first.uc_no, 'UC1/26')
  for (const purpose of ['split', 'reissue'])
    assert.equal(
      invoiceRequestSnapshot(
        order,
        'fictional',
        identity,
        purpose,
        'Reviewed split',
        new Date()
      ).purpose,
      purpose
    )
  assert.throws(
    () =>
      invoiceRequestSnapshot(
        { ...order, invoiced_at: '2026-02-31' },
        'fictional',
        identity,
        'first',
        ''
      ),
    /valid invoice date/
  )
  assert.throws(
    () => invoiceRequestSnapshot(order, 'fictional', identity, 'split', ''),
    /short reason/
  )
})
test('receipt validation refuses changed order/facts and recovery view excludes request actor and private follow-up plans', () => {
  const request = invoiceRequestSnapshot(
      order,
      'fictional',
      identity,
      'first',
      ''
    ),
    op = {
      id: opid,
      order_id: 'fictional',
      request,
      status: 'pending',
      followups: { financial: { state: 'pending', plan: { secret: true } } }
    }
  const receipt = {
    operation_id: opid,
    order_id: 'fictional',
    request_json: request,
    o_si_no: 'SI260100',
    o_uc_no: 'UC1/26',
    o_invoice_id: 42,
    o_uc_id: 1
  }
  assert.equal(invoiceResult(receipt, op).invoice_id, 42)
  for (const patch of [
    { order_id: 'other' },
    { request_json: { ...request, currency: 'HKD' } },
    { o_si_no: '' },
    { operation_id: 'other' }
  ])
    assert.throws(
      () => invoiceResult({ ...receipt, ...patch }, op),
      /does not match/
    )
  const view = invoiceRecoveryView(order, op, [op])
  assert.equal(view.operation.created_by, undefined)
  assert.equal(view.operation.followups.financial.plan, undefined)
  assert.deepEqual(view.expected, invoiceExpected(order))
})
test('reference revisions preserve null/blank equivalence and reject stale loaded state through next-version contract', () => {
  const base = {
    ...order,
    invoice_allocation_id: opid,
    invoice_reference_revision: 2,
    invoiced_at: null
  }
  assert.deepEqual(
    invoiceReferenceSavePatch({ ...base, invoiced_at: '' }, base),
    { invoice_reference_revision: 2 }
  )
  assert.deepEqual(
    invoiceReferenceSavePatch({ ...base, erp_si_no: 'SI260100' }, base),
    { invoice_reference_revision: 3 }
  )
  assert.deepEqual(invoiceReferenceSavePatch(order, order), {})
  assert.ok(sameInvoiceValue({ a: 1, b: 2 }, { b: 2, a: 1 }))
})
test('fresh backend authentication and module authorization precede every SQL/repository call', async () => {
  let calls = 0
  const handler = createInvoiceRecoveryHandler({
    verifyToken: async (token) => {
      if (token === 'revoked') throw Error()
      return { uid: token }
    },
    getProfile: async (uid) => ({
      role: uid === 'customer' ? 'customer' : 'staff',
      modules: ['uc']
    }),
    repo: new Proxy(
      {},
      {
        get: () => () => {
          calls++
          throw Error()
        }
      }
    ),
    sql: {
      lookup: () => {
        calls++
        throw Error()
      }
    }
  })
  for (const uid of ['customer', 'staff', 'revoked', null]) {
    const r = await handler(
      new Request('https://example.invalid/api/invoice-allocation', {
        method: 'POST',
        headers: uid ? { Authorization: 'Bearer ' + uid } : {},
        body: JSON.stringify({ action: 'ready' })
      })
    )
    assert.equal(r.status, uid === 'revoked' || !uid ? 401 : 403)
  }
  assert.equal(calls, 0)
})

test('read-only receipt status checks one exact operation and distinguishes verification, absence, outage and conflict', async () => {
  const saved = { ...order, customer_id: 'fictional-buyer', invoice_allocation_id: opid }
  const request = invoiceRequestSnapshot(saved, 'fictional', identity, 'split', 'Test split')
  const receipt = { operation_id: opid, order_id: 'fictional', request_json: request,
    o_si_no: 'SI260100', o_uc_no: 'UC1/26', o_invoice_id: 42, o_uc_id: 1 }
  const exact = invoiceResult(receipt, { id: opid, order_id: 'fictional', request })
  for (const { label, received, status, recorded = null, phase = 'pending', expected = status === 'verified' ? exact : recorded } of [
    { label:'lost acknowledgement', received:[receipt], status:'verified' },
    { label:'saved result', received:[receipt], recorded:exact, phase:'allocated', status:'verified' },
    { label:'clean empty response', received:[], status:'not_found' },
    { label:'source down', received:503, status:'unavailable' },
    { label:'incomplete source response', received:{wrong:'shape'}, status:'unavailable' },
    { label:'source down after result recorded', received:503, recorded:exact, phase:'review_required', status:'unavailable' },
    { label:'wrong frozen facts', received:[{...receipt,request_json:{...request,currency:'HKD'}}], status:'conflict' },
    { label:'more than one row', received:[receipt,receipt], status:'conflict' },
    { label:'invalid row', received:[null], status:'conflict' },
    { label:'successful empty read of recorded invoice', received:[], recorded:exact, phase:'allocated', status:'conflict' },
    { label:'result disagrees with SQL', received:[receipt], recorded:{...exact,si_no:'SI260199'}, phase:'allocated', status:'conflict',
      expected:{...exact,si_no:'SI260199'} },
    { label:'linked invoice', received:503, recorded:exact, phase:'linked', status:null },
  ]) {
    const operation = { id: opid, order_id: 'fictional', request, before:{customerId:saved.customer_id}, status: phase, result: recorded }
    const original = structuredClone({ saved, operation })
    const calls = []
    const sql = createInvoiceRecoverySql({ url:'https://fictional.invalid',key:'fixture', fetchImpl:async (url, options) => {
      calls.push(JSON.parse(options.body))
      assert.equal(new URL(url).pathname, '/rest/v1/rpc/lookup_invoice_allocation')
      return typeof received === 'number' ? Response.json({message:'private source error'}, {status:received}) : Response.json(received)
    } })
    const handler = createInvoiceRecoveryHandler({ verifyToken:async()=>identity,
      getProfile:async()=>({role:'staff',modules:['shipping']}), sql,
      repo:{ state:async id=>{assert.equal(id,'fictional');return { order:saved, operation, history:[operation] }},
        followupChecklist:async()=>({entries:[]}) },
    })
    const response = await handler(new Request('https://fictional.invalid/api/invoice-allocation', {method:'POST',
      headers:{Authorization:'Bearer fixture'},body:JSON.stringify({order_id:'fictional',action:'status'})}))
    const body = await response.json()
    assert.equal(response.status,200,label)
    assert.equal(body.operation.id,opid,label)
    assert.equal(body.operation.receiptStatus,status,label)
    assert.deepEqual(body.operation.result,expected,label)
    assert.equal(body.operation.status,phase === 'pending' && status === 'verified' ? 'allocated' : phase,label)
    assert.equal(body.linkReviewTarget,null,label)
    assert.equal(body.canManage,false,label)
    assert.equal(body.history[0].status,phase,label)
    assert.deepEqual(calls, phase === 'linked' ? [] : [{p_operation_id:opid}],label)
    assert.deepEqual({saved,operation},original,label)
    assert.doesNotMatch(JSON.stringify(body),/private source error/)
  }
})
let scratch, client, originalFetch
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-invoice-client-'))
  await build({
    entryPoints: ['src/invoiceRecovery.js'],
    outfile: join(scratch, 'client.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'fictional-auth',
        setup(b) {
          b.onResolve({ filter: /\/firebase$/ }, () => ({
            path: 'auth',
            namespace: 'fixture'
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const authHeader=async()=>({Authorization:"Bearer fictional"})'
          }))
        }
      }
    ]
  })
  client = await import(pathToFileURL(join(scratch, 'client.mjs')))
  originalFetch = globalThis.fetch
})
after(async () => {
  globalThis.fetch = originalFetch
  await rm(scratch, { recursive: true, force: true })
})
test('actual client transmits no chosen operation ID and never allocates a replacement after timeout/error', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    throw Error('FICTIONAL lost response')
  }
  await assert.rejects(
    client.invoiceAction('fictional', 'raise', {
      expected: invoiceExpected(order)
    }),
    /lost response/
  )
  assert.equal(calls.length, 1)
  const sent = JSON.parse(calls[0].options.body)
  assert.equal(sent.operation_id, undefined)
  assert.equal(sent.action, 'raise')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fictional')
  assert.ok(calls[0].options.signal)
  globalThis.fetch = async () =>
    Response.json({ error: 'Access denied' }, { status: 403 })
  await assert.rejects(
    client.invoiceAction('fictional', 'resume', { previous_operation_id: opid }),
    /Access denied/
  )
  globalThis.fetch = async () => Response.json({ operation: { id: opid } })
  assert.equal(
    (await client.invoiceAction('fictional', 'resume', { previous_operation_id: opid })).operation.id,
    opid
  )
})
