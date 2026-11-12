import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  createInvoiceTestDatabase,
  fictionalInvoiceRequest
} from './invoice-recovery-postgres-fixture.mjs'
let db
before(async () => {
  db = await createInvoiceTestDatabase()
})
beforeEach(async () => {
  await db.reset()
  await db.pool.query(db.migration)
})
after(async () => {
  await db?.close()
})
const once = (id, request = fictionalInvoiceRequest(), role = 'service_role') =>
  db.asRole(
    role,
    'select * from public.allocate_sales_invoice_once($1::uuid,$2::jsonb)',
    [id, request]
  )

test('recovery migration preserves core identity/body/security and historical invoice/UC rows', async () => {
  const core = (
    await db.pool.query(
      "select p.prosrc,p.prosecdef,p.proconfig,pg_get_userbyid(proowner)as owner from pg_proc p where oid='oc_invoice_private.allocate_core(text,text,text,text,bigint,text,text)'::regprocedure"
    )
  ).rows[0]
  assert.equal(core.owner, 'postgres')
  assert.equal(core.prosecdef, true)
  assert.deepEqual(core.proconfig, ['search_path=public, pg_temp'])
  assert.deepEqual(await db.counts(), {
    invoices: 1,
    ucs: 1,
    audits: 1,
    receipts: 0
  })
  assert.equal(
    (
      await db.pool.query(
        "select total::text from app_sales_invoice where si_no='SI260020'"
      )
    ).rows[0].total,
    '12.345'
  )
})
test('same request after lost acknowledgment returns identical SI/UC/row IDs with one receipt', async () => {
  const id = randomUUID(),
    [first] = await once(id),
    [recovered] = await once(id)
  assert.deepEqual(recovered, first)
  assert.equal(first.o_si_no, 'SI260100')
  assert.equal(first.o_uc_no, 'UC100/26')
  assert.deepEqual(await db.counts(), {
    invoices: 2,
    ucs: 2,
    audits: 2,
    receipts: 1
  })
})
test('real concurrent connections for one operation allocate only once while waiting on the year lock', async () => {
  const blocker = await db.pool.connect()
  await blocker.query('begin')
  await blocker.query("select pg_advisory_xact_lock(hashtext('si_alloc_26'))")
  const id = randomUUID(),
    calls = Array.from({ length: 6 }, () => once(id))
  try {
    let waiting = 0
    for (let n = 0; n < 100; n++) {
      waiting = Number(
        (
          await db.pool.query(
            "select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'"
          )
        ).rows[0].n
      )
      if (waiting >= 2) break
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.ok(
      waiting >= 2,
      'Independent backends must actually overlap at locks'
    )
  } finally {
    await blocker.query('commit')
    blocker.release()
  }
  const results = await Promise.all(calls)
  for (const r of results) assert.deepEqual(r, results[0])
  assert.deepEqual(await db.counts(), {
    invoices: 2,
    ucs: 2,
    audits: 2,
    receipts: 1
  })
})
test('concurrent distinct split/reissued operations on the same order remain separate invoices', async () => {
  const results = await Promise.all(
    ['first', 'split', 'reissue', 'split'].map((purpose) =>
      once(
        randomUUID(),
        fictionalInvoiceRequest({
          purpose,
          reason: purpose === 'first' ? '' : 'FICTIONAL deliberate ' + purpose
        })
      )
    )
  )
  assert.equal(new Set(results.map((r) => r[0].o_si_no)).size, 4)
  assert.equal(new Set(results.map((r) => r[0].o_invoice_id)).size, 4)
  assert.deepEqual(await db.counts(), {
    invoices: 5,
    ucs: 5,
    audits: 5,
    receipts: 4
  })
})
test('conflicting request or order reuse cannot allocate or attach a different invoice', async () => {
  const id = randomUUID()
  await once(id)
  const before = await db.counts()
  for (const patch of [
    { order_id: 'other-order' },
    { currency: 'HKD' },
    { customer: 'Different customer' },
    { actor_uid: 'other-admin' }
  ])
    await assert.rejects(
      once(id, fictionalInvoiceRequest(patch)),
      /reused with different/
    )
  assert.deepEqual(await db.counts(), before)
})
test('receipt insert failure rolls back financial facts and a later same operation can finish', async () => {
  await db.pool.query(
    "create function oc_invoice_private.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'FICTIONAL receipt failure';end$$;create trigger fail_receipt before insert on oc_invoice_private.invoice_allocations for each row execute function oc_invoice_private.fail_receipt()"
  )
  const id = randomUUID(),
    before = await db.counts()
  await assert.rejects(once(id), /FICTIONAL receipt failure/)
  assert.deepEqual(await db.counts(), before)
  await db.pool.query(
    'drop trigger fail_receipt on oc_invoice_private.invoice_allocations'
  )
  const [row] = await once(id)
  assert.equal(row.o_si_no, 'SI260100')
  assert.equal((await db.counts()).receipts, 1)
  // PostgreSQL serial UC sequences can have rollback gaps, as before; never reset.
})
for (const [title, patch, uc] of [
  ['UC ID', { uc_id: 1 }, 'UC90/26'],
  ['UC text', { uc_no: 'UC90/26' }, 'UC90/26'],
  ['unresolved historical UC', { uc_no: 'UC-UNKNOWN/26' }, 'UC-UNKNOWN/26']
])
  test('preserves ' + title, async () => {
    const [row] = await once(randomUUID(), fictionalInvoiceRequest(patch))
    assert.equal(row.o_uc_no, uc)
    assert.equal((await db.counts()).ucs, 1)
  })
test('lookup never allocates and confirms an existing receipt without changing row counts', async () => {
  const id = randomUUID(),
    lookup = (id) =>
      db.asRole(
        'service_role',
        'select * from public.lookup_invoice_allocation($1::uuid)',
        [id]
      )
  const before = await db.counts()
  assert.deepEqual(await lookup(id), [])
  assert.deepEqual(await db.counts(), before)
  const allocated = await once(id),
    after = await db.counts()
  assert.deepEqual(await lookup(id), allocated)
  assert.deepEqual(await db.counts(), after)
})
test('public roles cannot allocate, inspect receipts or read private tables; server cannot bypass the core', async () => {
  const id = randomUUID(),
    before = await db.counts()
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      once(id, fictionalInvoiceRequest(), role),
      (e) => e.code === '42501'
    )
    await assert.rejects(
      db.asRole(
        role,
        'select * from public.lookup_invoice_allocation($1::uuid)',
        [id]
      ),
      (e) => e.code === '42501'
    )
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(
      db.asRole(role, 'select * from oc_invoice_private.invoice_allocations'),
      (e) => e.code === '42501'
    )
    await assert.rejects(
      db.asRole(role, "select * from oc_invoice_private.allocate_core('26')"),
      (e) => e.code === '42501'
    )
  }
  assert.deepEqual(await db.counts(), before)
})
test('legacy RPC and historical grant repair cannot issue numbers outside operation identity', async () => {
  const before = await db.counts()
  const old = () =>
    db.asRole(
      'service_role',
      "select * from public.allocate_sales_invoice('26','FICTIONAL')"
    )
  await assert.rejects(old, /Refresh OC/)
  const { readFile } = await import('node:fs/promises')
  await db.pool.query(
    await readFile(
      'erp-sync/migrations/20261107180016_harden_sales_invoice_execute.sql',
      'utf8'
    )
  )
  await assert.rejects(old, /Refresh OC/)
  assert.deepEqual(await db.counts(), before)
})
test('migration reapplication is idempotent; historical bootstrap refuses to replace the recovery layer', async () => {
  const id = randomUUID(),
    first = await once(id)
  await db.pool.query(db.migration)
  assert.deepEqual(await once(id), first)
  await assert.rejects(db.pool.query(db.setup), /do not replay historical/)
  assert.deepEqual(await once(id), first)
})
test('invalid snapshots and unknown fields fail before number allocation', async () => {
  const before = await db.counts()
  for (const request of [
    fictionalInvoiceRequest({ year: '2026' }),
    fictionalInvoiceRequest({ currency: '' }),
    fictionalInvoiceRequest({ purpose: 'split', reason: '' }),
    { ...fictionalInvoiceRequest(), unexpected: true },
    fictionalInvoiceRequest({ order_id: null })
  ])
    await assert.rejects(once(randomUUID(), request), /Invalid saved invoice/)
  assert.deepEqual(await db.counts(), before)
})

const followup = (id, stage, expected, patch, role = 'service_role') =>
  db.asRole(
    role,
    'select * from public.apply_invoice_allocation_followup($1::uuid,$2,$3::jsonb,$4::jsonb)',
    [id, stage, expected, patch]
  )
const row = async (table, id) =>
  (
    await db.pool.query(
      'select to_jsonb(t) as value from ' + table + ' t where id=$1',
      [id]
    )
  ).rows[0].value
const financialPatch = (receipt) => ({
  si_no: receipt.o_si_no,
  year: '26',
  uc_no: receipt.o_uc_no,
  order_id: 'fictional-order',
  customer: 'FICTIONAL Invoice QA',
  currency: 'USD',
  total: 1222.125,
  accounting_total: 0,
  adjustment: -1222.13,
  adjustment_reason: 'Approved fictional zero',
  invoiced_at: '2026-11-08',
  invoice_date: null,
  remarks: 'Original 中文 notes',
  updated_at: '2026-11-08T12:00:00Z',
  updated_by: 'fictional-admin'
})

test('manual review commits ahead of a delayed write and prevents any ledger or audit change', async () => {
  await db.pool.query(db.followupMigration)
  const id = randomUUID()
  const [receipt] = await once(id)
  const before = await row('app_sales_invoice', receipt.o_invoice_id)
  const counts = await db.counts()
  const reviewer = await db.pool.connect()
  const reviewSql = 'select * from public.review_invoice_allocation_followups($1,$2,$3,$4)'
  const args = [id, 'fictional-order', 'finance', 'Reviewed original invoice']
  try {
    await reviewer.query('begin')
    await reviewer.query('set local role service_role')
    const [review] = (await reviewer.query(reviewSql, args)).rows
    const delayedWrite = followup(id, 'financial', before, financialPatch(receipt))
    await reviewer.query('commit')
    assert.deepEqual(await delayedWrite, [review])
    assert.deepEqual(await row('app_sales_invoice', receipt.o_invoice_id), before)
    assert.deepEqual(await db.counts(), counts)
    assert.deepEqual(await db.asRole('service_role', reviewSql,
      [id, 'fictional-order', 'another-finance-user', 'Retry after lost response']), [review])
    await assert.rejects(db.asRole('authenticated', reviewSql, args), e => e.code === '42501')
    await assert.rejects(db.asRole('service_role', reviewSql,
      [id, 'another-order', 'finance', 'Wrong order']), /matching saved invoice receipt/)
    await assert.rejects(db.asRole('service_role',
      'select * from oc_invoice_private.apply_invoice_allocation_followup($1,$2,$3,$4)',
      [id, 'financial', before, financialPatch(receipt)]), e => e.code === '42501')
  } finally {
    await reviewer.query('rollback')
    reviewer.release()
  }
})

test('review sees a financial update that committed first and blocks a later stage', async () => {
  await db.pool.query(db.followupMigration)
  const id = randomUUID()
  const [receipt] = await once(id)
  const before = await row('app_sales_invoice', receipt.o_invoice_id)
  const writer = await db.pool.connect()
  try {
    await writer.query('begin')
    await writer.query('set local role service_role')
    const [written] = (await writer.query(
      'select * from public.apply_invoice_allocation_followup($1,$2,$3,$4)',
      [id, 'financial', before, financialPatch(receipt)]
    )).rows
    const reviewing = db.asRole('service_role',
      'select * from public.review_invoice_allocation_followups($1,$2,$3,$4)',
      [id, 'fictional-order', 'finance', 'Reviewed after write'])
    await writer.query('commit')
    const [review] = await reviewing
    assert.deepEqual(review.result.applied, { financial: true })
    assert.deepEqual(await row('app_sales_invoice', receipt.o_invoice_id), written.result)
    const uc = await row('uc_registry', receipt.o_uc_id)
    assert.deepEqual(await followup(id, 'woo', uc, { total: 55 }), [review])
    assert.deepEqual(await row('uc_registry', receipt.o_uc_id), uc)
  } finally {
    await writer.query('rollback')
    writer.release()
  }
})

test('SQL rejects expired claims without changing the receipt, financial row or audit history', async () => {
  await db.pool.query(db.followupMigration)
  const id = randomUUID()
  const [receipt] = await once(id)
  const before = await row('app_sales_invoice', receipt.o_invoice_id)
  const counts = await db.counts()
  await assert.rejects(db.asRole('service_role',
    'select * from public.apply_claimed_invoice_followup($1,$2,$3,$4,$5)',
    [id, 'financial', before, financialPatch(receipt), '2000-01-01T00:00:00Z']), /claim expired/)
  assert.deepEqual(await row('app_sales_invoice', receipt.o_invoice_id), before)
  assert.deepEqual(await db.counts(), counts)
})
test('receipt-bound financial follow-up preserves exact source/approved zero and lost acknowledgment is idempotent', async () => {
  const id = randomUUID(),
    [receipt] = await once(id),
    before = await row('app_sales_invoice', receipt.o_invoice_id),
    patch = financialPatch(receipt)
  const [first] = await followup(id, 'financial', before, patch),
    [retry] = await followup(id, 'financial', before, patch)
  assert.deepEqual(retry, first)
  assert.equal(first.result.total, 1222.125)
  assert.equal(first.result.accounting_total, 0)
  assert.equal(first.result.invoice_date, null)
  assert.deepEqual(await db.counts(), {
    invoices: 2,
    ucs: 2,
    audits: 3,
    receipts: 1
  })
})
test('financial changes with the same timestamp or changes made before a recovery read are preserved', async () => {
  const id = randomUUID(),
    [receipt] = await once(id),
    before = await row('app_sales_invoice', receipt.o_invoice_id),
    patch = financialPatch(receipt)
  await db.pool.query(
    'update app_sales_invoice set accounting_total=555,adjustment_reason=$1 where id=$2',
    ['Manual approved amount', receipt.o_invoice_id]
  )
  const edited = await row('app_sales_invoice', receipt.o_invoice_id)
  await assert.rejects(
    followup(id, 'financial', before, patch),
    /changed concurrently/
  )
  await assert.rejects(
    followup(id, 'financial', edited, patch),
    /changed after allocation/
  )
  assert.deepEqual(await row('app_sales_invoice', receipt.o_invoice_id), edited)
})
test('follow-ups cannot target a different invoice/order/UC, unknown fields or public callers', async () => {
  const id = randomUUID(),
    [receipt] = await once(id),
    before = await row('app_sales_invoice', receipt.o_invoice_id),
    patch = financialPatch(receipt)
  for (const extra of [
    { order_id: 'other' },
    { si_no: 'SI260020' },
    { uc_no: 'OTHER' },
    { status: 'void' }
  ])
    await assert.rejects(
      followup(id, 'financial', before, { ...patch, ...extra }),
      /does not match/
    )
  for (const role of ['anon', 'authenticated'])
    await assert.rejects(
      followup(id, 'financial', before, patch, role),
      (e) => e.code === '42501'
    )
  assert.deepEqual(await row('app_sales_invoice', receipt.o_invoice_id), before)
})
test('UC follow-up clears null fields correctly, keeps unrelated data and rejects competing edits', async () => {
  const id = randomUUID(),
    [receipt] = await once(id),
    before = await row('uc_registry', receipt.o_uc_id),
    patch = {
      total: 100,
      deposit: 100,
      balance: 0,
      bal_pay_date: null,
      source: 'Online Shop',
      remarks: 'Fictional saved Woo',
      updated_at: '2026-11-08T12:00:00Z'
    }
  const [first] = await followup(id, 'woo', before, patch),
    [retry] = await followup(id, 'woo', before, patch)
  assert.deepEqual(first, retry)
  assert.equal(first.result.uc_no, before.uc_no)
  assert.equal(first.result.balance, 0)
  await db.pool.query('update uc_registry set total=222 where id=$1', [
    receipt.o_uc_id
  ])
  await assert.rejects(
    followup(id, 'woo', before, patch),
    /changed concurrently/
  )
  assert.equal((await row('uc_registry', receipt.o_uc_id)).total, 222)
})
