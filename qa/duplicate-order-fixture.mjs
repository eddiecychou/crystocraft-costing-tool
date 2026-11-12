// Only creates and drops an isolated PostgreSQL QA database. The HTTP adapter
// passes the actual Node RPC request to the migration as service_role.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createInvoiceTestDatabase } from './invoice-recovery-postgres-fixture.mjs'
import { duplicateOrderUc } from '../netlify/functions/lib/duplicateOrderUc.js'
export async function createDuplicateFixture() {
  const db = await createInvoiceTestDatabase()
  try {
    await db.reset()
    await db.pool.query(db.migration)
    await db.pool.query(db.followupMigration)
    await db.pool.query(
      await readFile(
        new URL(
          '../erp-sync/migrations/20261108122444_duplicate_order_uc_receipts.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
  } catch (error) {
    await db.close()
    throw error
  }
  const rpc = 'select * from public.duplicate_order_uc($1,$2::jsonb,$3)'
  const fetchImpl = async (url, init) => {
    assert.equal(
      url,
      'https://fictional.supabase.co/rest/v1/rpc/duplicate_order_uc'
    )
    assert.equal(init.headers.Authorization, 'Bearer local-fixture')
    const p = JSON.parse(init.body)
    try {
      return Response.json(
        await db.asRole('service_role', rpc, [
          p.p_operation_id,
          p.p_request,
          p.p_issue
        ])
      )
    } catch (e) {
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  return {
    db,
    rpc,
    uc: (id, request, issue) =>
      duplicateOrderUc(id, request, issue, {
        url: 'https://fictional.supabase.co',
        key: 'local-fixture',
        fetchImpl
      })
  }
}
