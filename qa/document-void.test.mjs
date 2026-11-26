import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { createDocumentVoidHandler, createDocumentVoidSql } from '../netlify/functions/lib/documentVoids.js'
import { fictionalInvoiceRequest } from './invoice-recovery-postgres-fixture.mjs'

const profiles = {
  shipping: { role: 'staff', modules: ['shipping'] },
  invoiceReader: { role: 'staff', modules: ['invoices'] },
  uc: { role: 'staff', modules: ['uc'] },
  finance: { role: 'staff', modules: ['invoices', 'uc'] },
  admin: { role: 'admin' },
  buyer: { role: 'customer', modules: ['invoices', 'uc', 'shipping'] },
}
const request = (handler, role, body) => handler(new Request('https://fictional.test/api/document-void', {
  method: 'POST', headers: role ? { Authorization: 'Bearer ' + role } : {}, body: JSON.stringify(body),
}))
const identity = {
  verifyToken: async token => ({ uid: token }),
  getProfile: async uid => profiles[uid],
}

test('void authorization and reasons are enforced before a write', async () => {
  const writes = []
  const handler = createDocumentVoidHandler({
    ...identity,
    pi: async (uid, input) => { writes.push([uid, input.reason]); return {} },
    ledger: () => ({
      read: async no => no === 'SI990090' ? null : ({ status: 'void', id: 8, si_no: no, void_reason: 'Private reason' }),
      void: async (input, uid) => { writes.push([uid, input.reason]); return {} },
    }),
  })
  const pi = { action: 'void_pi', orderId: 'fictional-order', target: { no: 'SO990001', revision: 2 }, version: 'a'.repeat(64), reason: '  Correct PI revision  ' }
  const si = { action: 'void_si', no: 'SI990001', id: 8, updatedAt: null, reason: '  Duplicate invoice  ' }
  assert.equal((await request(handler, null, pi)).status, 401)
  for (const user of ['shipping', 'invoiceReader', 'uc', 'buyer']) assert.equal((await request(handler, user, si)).status, 403)
  for (const user of ['invoiceReader', 'uc', 'buyer', 'finance']) assert.equal((await request(handler, user, pi)).status, 403)
  for (const [user, action] of [['shipping', pi], ['finance', si]]) {
    for (const reason of [undefined, '\n\t', 'a'.repeat(501)]) {
      assert.equal((await request(handler, user, { ...action, reason })).status, 400)
    }
  }
  assert.equal((await request(handler, 'finance', { ...si, no: 'UC101' })).status, 400)
  assert.equal((await request(handler, 'finance', { ...si, updatedAt: 'yesterday' })).status, 400)
  assert.equal((await request(handler, 'finance', { action: 'review_si', no: 'SI990090' })).status, 404)
  assert.deepEqual(await (await request(handler, 'invoiceReader', { action: 'si_status', no: 'SI990001' })).json(), { status: 'void' })
  assert.equal(writes.length, 0)
  for (const [role, action] of [['shipping', pi], ['finance', si], ['admin', si]]) {
    assert.equal((await request(handler, role, action)).status, 200)
  }
  assert.deepEqual(writes, [['shipping', 'Correct PI revision'], ['finance', 'Duplicate invoice'], ['admin', 'Duplicate invoice']])
})

test('voiding exact split or reissued SIs preserves numbers, audit, siblings and shared UC', { timeout: 30000 }, async () => {
  const pg = new PGlite()
  try {
    await pg.exec([
      'create role anon; create role authenticated; create role service_role;',
      'create schema raw; create table raw.salesinvoice(sino text);',
      "create sequence public.fictional_uc_number start 100;",
      "create table public.uc_registry(id bigserial primary key,uc_no text default ('UC'||nextval('public.fictional_uc_number')),year text,customer text,currency text,status text,created_by text,",
      'updated_at timestamptz,updated_by text,source text,customer_id text,order_no text,total numeric,deposit numeric,balance numeric,bal_pay_date text,remarks text,confirmed boolean);',
    ].join('\n'))
    for (const file of ['app_sales_invoice.sql', 'migrations/20261108013402_invoice_retry_recovery.sql',
      'migrations/20261112011943_guard_invoice_followup_review.sql', 'migrations/20261127000000_document_void.sql']) {
      await pg.exec(await readFile(new URL('../erp-sync/' + file, import.meta.url), 'utf8'))
    }

    const operations = ['first', 'split', 'reissue'].map((purpose, i) => ['00000000-0000-4000-8000-00000000000' + (i + 1), purpose])
    const issued = []
    for (const [id, purpose] of operations) {
      const args = fictionalInvoiceRequest(purpose === 'first' ? {} : {
        purpose, reason: 'Fictional ' + purpose, uc_id: issued[0].o_uc_id, uc_no: issued[0].o_uc_no,
      })
      issued.push((await pg.query('select * from public.allocate_sales_invoice_once($1, $2)', [id, args])).rows[0])
    }
    const [first, split, reissued] = issued
    assert.equal(new Set(issued.map(x => x.o_si_no)).size, 3)
    assert.equal(new Set(issued.map(x => x.o_uc_id)).size, 1)
    assert.equal(new Set(issued.map(x => x.order_id)).size, 1)
    const originalUc = (await pg.query('select * from public.uc_registry')).rows
    const row = async no => (await pg.query('select * from public.app_sales_invoice where si_no=$1', [no])).rows[0]
    const selectVoid = 'select result from public.void_app_sales_invoice($1,$2,$3,$4,$5)'
    const invoiceBefore = await row(split.o_si_no)
    const args = [split.o_invoice_id, split.o_si_no, invoiceBefore.updated_at, 'finance', 'Fictional split cancellation']
    for (const role of ['anon', 'authenticated']) {
      await pg.exec('set role ' + role)
      await assert.rejects(pg.query(selectVoid, args), { code: '42501' })
      await pg.exec('reset role')
    }
    await assert.rejects(pg.query(selectVoid, [first.o_invoice_id, ...args.slice(1)]), { code: 'P0002' })
    await assert.rejects(pg.query(selectVoid, [...args.slice(0, 4), '\t\n']), { code: '22023' })
    await pg.query('update public.app_sales_invoice set updated_at=$2 where id=$1', [split.o_invoice_id, '2026-11-27T00:00:00Z'])
    await assert.rejects(pg.query(selectVoid, args), { code: '23514' })

    const fetchImpl = async (url, options) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/app_sales_invoice')) {
        const no = parsed.searchParams.get('si_no')?.slice(3)
        if (no) return Response.json([await row(no)])
        assert.equal(parsed.searchParams.get('status'), 'eq.void')
        const rows = (await pg.query("select * from public.app_sales_invoice where status='void' order by id")).rows
        return Response.json(rows, { headers: { 'Content-Range': '0-0/' + rows.length } })
      }
      assert.equal(parsed.pathname, '/rest/v1/rpc/void_app_sales_invoice')
      const input = JSON.parse(options.body)
      await pg.exec('set role service_role')
      try {
        return Response.json((await pg.query(selectVoid, [input.p_id, input.p_si, input.p_expected_updated_at, input.p_by, input.p_reason])).rows)
      } catch (error) {
        return Response.json({ code: error.code }, { status: 400 })
      } finally { await pg.exec('reset role') }
    }
    const handler = createDocumentVoidHandler({ ...identity, ledger: () => createDocumentVoidSql({
      url: 'https://fictional.test', key: 'fixture', fetchImpl,
    }) })
    const call = async (role, body) => {
      const res = await request(handler, role, body)
      const data = await res.json()
      assert.equal(res.status, 200, JSON.stringify(data))
      return data
    }
    const review = no => call('finance', { action: 'review_si', no })
    const target = await review(split.o_si_no)
    const payload = { action: 'void_si', id: target.id, no: target.no, updatedAt: target.updatedAt, reason: args[4] }
    const saved = await call('finance', payload)
    assert.equal(saved.no, split.o_si_no)
    assert.equal(saved.status, 'void')
    assert.deepEqual(await call('admin', { ...payload, reason: 'Retry after losing response' }), saved)
    assert.equal((await review(first.o_si_no)).status, 'issued')
    assert.equal((await review(reissued.o_si_no)).status, 'issued')
    assert.deepEqual(await call('invoiceReader', { action: 'si_voids' }), { numbers: [split.o_si_no] })

    const lateWrite = (await pg.query('select result from public.apply_claimed_invoice_followup($1,$2,$3,$4,$5)', [
      operations[1][0], 'ledger', {}, {}, '2099-01-01T00:00:00Z',
    ])).rows[0].result
    assert.equal(lateWrite.followup_review.reason, args[4])
    const status = (await pg.query('select invoice_id,followup_review from oc_invoice_private.invoice_allocations order by invoice_id')).rows
    assert.deepEqual(status.map(x => Boolean(x.followup_review)), [false, true, false])
    const history = (await pg.query("select * from public.app_sales_invoice_audit where action='update' and invoice_id=$1", [split.o_invoice_id])).rows
    assert.equal(history.length, 1)
    assert.equal(history[0].changed_by, 'finance')
    assert.equal(history[0].before.status, 'issued')
    assert.equal(history[0].after.status, 'void')
    assert.equal(history[0].after.void_reason, args[4])
    assert.equal(history[0].after.si_no, split.o_si_no)
    assert.equal(history[0].after.uc_no, invoiceBefore.uc_no)
    await assert.rejects(pg.query("update public.app_sales_invoice set status='issued' where id=$1", [split.o_invoice_id]), { code: '23514' })
    await assert.rejects(pg.query('delete from public.app_sales_invoice where id=$1', [split.o_invoice_id]), { code: '23514' })

    const replacement = await review(reissued.o_si_no)
    await call('finance', { action: 'void_si', id: replacement.id, no: replacement.no, updatedAt: replacement.updatedAt, reason: 'Reissued copy withdrawn' })
    assert.deepEqual((await pg.query('select si_no,status from public.app_sales_invoice order by id')).rows,
      [{ si_no: first.o_si_no, status: 'issued' }, { si_no: split.o_si_no, status: 'void' }, { si_no: reissued.o_si_no, status: 'void' }])
    assert.deepEqual((await pg.query('select * from public.uc_registry')).rows, originalUc)
  } finally { await pg.close() }
})
