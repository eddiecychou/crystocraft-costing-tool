import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createOcInvoiceSummariesHandler, projectOcInvoiceSummaries, readOcInvoiceLedger,
} from '../netlify/functions/lib/ocInvoiceSummaries.js'

const row = (id, order_id, patch) => ({
  id, si_no: 'SI260' + String(id).padStart(3, '0'), order_id, invoice_date: '2026-11-05',
  customer: 'Fictional buyer', currency: 'USD', status: 'issued', total: 80,
  notes: 'private ledger notes', uc_no: 'private UC', ...patch,
})
const ledger = [
  row(1, 'modern', { status: 'void', total: 100 }),
  row(2, 'modern', { total: 75 }),
  row(3, 'modern'),
  row(4, 'pending', { total: null }),
  row(5, 'unlinked', { total: null }),
  row(6, null, { total: '0' }),
  row(7, 'modern'),
  row(8, 'other', { total: 999 }),
  row(9, 'legacy-match', { total: null }),
]
const orders = [
  { id: 'modern', erp_si_no: 'SI260003', status: 'confirmed', invoice_allocation_id: 'current', total_amount: 999,
    internal_remarks: 'private order data', lines: ['private order line'] },
  { id: 'legacy', erp_so_no: ' SI250055 ', status: 'delivered', customer_name: 'Fictional legacy buyer',
    invoice_date: '2025-10-01', currency: 'HKD' },
  { id: 'legacy-match', erp_si_no: 'SI260009', status: 'shipped', total_amount: 999 },
  { id: 'draft', erp_si_no: 'SI250056', status: 'draft' },
  { id: 'unissued', erp_so_no: 'SO260020', status: 'confirmed' },
  { id: 'conflict', erp_si_no: 'SI260008', status: 'confirmed' },
]
const allocations = [
  ...[1, 2, 3].map(id => ({ orderId: 'modern', order_id: 'modern', status: 'linked',
    result: { si_no: row(id).si_no, invoice_id: String(id) }, request: { actor_uid: 'private actor' } })),
  { orderId: 'pending', order_id: 'pending', status: 'issued', result: { si_no: 'SI260004', invoice_id: 4 } },
  { orderId: 'modern', order_id: 'modern', status: 'linked', result: { si_no: 'SI260007', invoice_id: 3000 } },
]
const expected = [
  ['SI260009', 'ISSUED', null], ['SI260006', 'ISSUED', 0], ['SI260003', 'ISSUED', 80],
  ['SI260002', 'ISSUED', 75], ['SI260001', 'VOID', 100], ['SI250055', 'ISSUED', null],
]

test('distinct split and reissued summaries resolve by exact SI, with legacy, void and blank amounts preserved', () => {
  const rows = projectOcInvoiceSummaries(ledger, orders, allocations)
  assert.deepEqual(rows.map(r => [r.no, r.status, r.amount]), expected)
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['amount','currency','customer','date','documentStatus','no','source','status'])
    assert.equal(row.source, 'OC')
    assert.equal(row.documentStatus, 'Original unavailable')
  }
  assert.doesNotMatch(JSON.stringify(rows), /private|999/)
})

test('a linked current receipt admits a summary with no settled amount but duplicate evidence is excluded', () => {
  const linked = row(3, 'modern', { total: null })
  assert.equal(projectOcInvoiceSummaries([linked], orders.slice(0, 1), allocations)[0].amount, null)
  assert.deepEqual(projectOcInvoiceSummaries([linked], orders.slice(0, 1), [...allocations, allocations[2]]), [])
})

test('live profile check gates a private GET summary before any data lookup', async () => {
  const profiles = {
    admin: {role:'admin'}, staff: {role:'staff',modules:['invoices']}, shipping:{role:'staff',modules:['shipping']},
    customer:{role:'customer',status:'approved',modules:['invoices']}, missing:null,
  }
  let loads = 0
  const handler = createOcInvoiceSummariesHandler({
    verifyToken: async token => { if (token === 'bad') throw Error(); return {uid:token} },
    getProfile: async uid => profiles[uid],
    load: async () => { loads++; return {ledger, orders, allocations} },
  })
  const url = 'https://fictional.invalid/api/oc-invoice-summaries?fields=lines,notes'
  for (const [token, method, status] of [['staff','POST',405], [null,'GET',401], ['bad','GET',401],
    ['customer','GET',403], ['shipping','GET',403], ['missing','GET',403], ['staff','GET',200], ['admin','GET',200]]) {
    const response = await handler(new Request(url, {method,headers:token?{Authorization:'Bearer '+token}:{}}))
    assert.equal(response.status,status)
    assert.match(response.headers.get('Cache-Control'),/private, no-store/)
    if (status === 200) assert.deepEqual((await response.json()).rows.map(r=>[r.no,r.status,r.amount]), expected)
    else assert.ok(!(await response.json()).rows)
  }
  assert.equal(loads, 2)
  profiles.staff.modules = []
  assert.equal((await handler(new Request(url,{headers:{Authorization:'Bearer staff'}}))).status,403)
  assert.equal(loads, 2)
})

test('source failure is retryable and does not return a partial invoice list', async () => {
  const handler = createOcInvoiceSummariesHandler({verifyToken:async()=>({uid:'a'}),getProfile:async()=>({role:'admin'}),
    load:async()=>{throw Error('private upstream detail')}})
  const response = await handler(new Request('https://fictional.invalid',{headers:{Authorization:'Bearer a'}}))
  assert.equal(response.status,503)
  assert.match((await response.json()).error,/temporarily unavailable/)
})

test('ledger read uses a narrow projection and a forward cursor until the exact count is complete', async () => {
  const offsets = []
  const result = await readOcInvoiceLedger('https://fictional.invalid','key',async (href, options)=>{
    const url = new URL(href)
    assert.equal(url.pathname,'/rest/v1/app_sales_invoice')
    assert.equal(url.searchParams.get('select'),'id,si_no,order_id,invoice_date,invoiced_at,customer,currency,status,total')
    assert.equal(options.headers.Prefer,'count=exact')
    const offset = Number(url.searchParams.get('id').slice(3))
    offsets.push(offset)
    const records = offset === 0 ? [row(1)] : [row(2)]
    return Response.json(records,{headers:{'Content-Range':offset===0?'0-0/2':'0-0/1'}})
  })
  assert.deepEqual(offsets,[0,1])
  assert.deepEqual(result.map(r=>r.id),[1,2])
  for (const response of [
    Response.json([row(1)]),
    Response.json([],{headers:{'Content-Range':'*/2'}}),
    Response.json([row(0)],{headers:{'Content-Range':'0-0/1'}}),
    Response.json({error:'failure'},{status:503}),
  ]) await assert.rejects(readOcInvoiceLedger('https://fictional.invalid','key',async ()=>response))
})
