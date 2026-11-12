import pg from 'pg'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// Hard refusal of production/remote URLs. Never load any .env credentials here.
export async function createInvoiceTestDatabase() {
  const address = new URL(process.env.QA_INVOICE_DATABASE_URL || '')
  assert.ok(['postgres:', 'postgresql:'].includes(address.protocol))
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname),
    'Loopback PostgreSQL only'
  )
  assert.equal(
    address.pathname,
    '/oc_invoice_recovery_qa',
    'Explicit fictional parent database required'
  )
  const admin = new pg.Pool({
    connectionString: address.href,
    max: 2,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    application_name: 'oc_invoice_recovery_qa'
  })
  const check = (
    await admin.query(
      "select current_database() as name,obj_description(oid,'pg_database') as marker from pg_database where datname=current_database()"
    )
  ).rows[0]
  assert.equal(check.name, 'oc_invoice_recovery_qa')
  if (!check.marker) {
    const existing = (
      await admin.query(
        "select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%' and c.relkind in ('r','v','m')"
      )
    ).rows[0].n
    assert.equal(existing, 0, 'Never initialize a QA marker over existing data')
    await admin.query(
      "comment on database oc_invoice_recovery_qa is 'OC fictional invoice recovery QA only'"
    )
  } else assert.equal(check.marker, 'OC fictional invoice recovery QA only')
  const client = await admin.connect()
  try {
    await client.query('begin')
    await client.query(
      "select pg_advisory_xact_lock(hashtext('oc_invoice_qa_roles'))"
    )
    await client.query(
      "do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;"
    )
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
  const name = 'oc_invoice_recovery_qa_' + randomBytes(8).toString('hex')
  await admin.query('create database ' + name)
  address.pathname = '/' + name
  const pool = new pg.Pool({
    connectionString: address.href,
    max: 12,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    application_name: 'oc_invoice_recovery_qa'
  })
  assert.match(
    (await pool.query('select version() as version')).rows[0].version,
    /PostgreSQL 17\./
  )
  const setup = await readFile('erp-sync/app_sales_invoice.sql', 'utf8'),
    migration = await readFile(
      'erp-sync/migrations/20261108013402_invoice_retry_recovery.sql',
      'utf8'
    ),
    followupMigration = await readFile(
      'erp-sync/migrations/20261112011943_guard_invoice_followup_review.sql',
      'utf8'
    )
  const reset = async () => {
    await pool.query(`drop schema if exists oc_invoice_private cascade;drop schema if exists raw cascade;drop schema public cascade;create schema public;grant usage on schema public to public;
   create schema raw;create table raw.salesinvoice(sino text);insert into raw.salesinvoice values('SI260099');
   create sequence public.fictional_uc_number start 100;
   create table public.uc_registry(id bigserial primary key,uc_no text default ('UC'||nextval('public.fictional_uc_number')),year text,customer text,currency text,status text,created_by text,
   updated_at timestamptz,updated_by text,source text,customer_id text,order_no text,total numeric,deposit numeric,balance numeric,bal_pay_date text,remarks text,confirmed boolean);
   insert into uc_registry(uc_no,year,customer,currency,status)values('UC90','/26','FICTIONAL existing UC','USD','open');`)
    await pool.query(setup)
    await pool.query(
      "insert into app_sales_invoice(si_no,year,customer,total)values('SI260020','26','FICTIONAL historical invoice',12.345)"
    )
  }
  const asRole = async (role, sql, params = []) => {
    assert.ok(
      ['service_role', 'anon', 'authenticated', 'postgres'].includes(role)
    )
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role ' + role)
      const r = await c.query(sql, params)
      await c.query('commit')
      return r.rows
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  }
  const counts = async () =>
    (
      await pool.query(`select (select count(*)::int from app_sales_invoice) as invoices,(select count(*)::int from uc_registry) as ucs,(select count(*)::int from app_sales_invoice_audit) as audits,
 (select count(*)::int from oc_invoice_private.invoice_allocations)as receipts`)
    ).rows[0]
  return {
    pool,
    setup,
    migration,
    followupMigration,
    reset,
    asRole,
    counts,
    close: async () => {
      await pool.end()
      try {
        // pool.end() can resolve before PostgreSQL has observed the socket
        // closures. FORCE raced those clients on Linux and emitted a late
        // uncaught FATAL after all assertions passed. Wait for our own sessions
        // to close normally; never terminate a backend to hide a test leak.
        let remaining = 1
        for (let attempt = 0; attempt < 100; attempt++) {
          remaining = Number((await admin.query(
            'select count(*)::int as n from pg_stat_activity where datname=$1', [name]
          )).rows[0].n)
          if (!remaining) break
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        assert.equal(remaining, 0, 'QA database sessions must close before cleanup')
        await admin.query('drop database ' + name)
      } finally {
        await admin.end()
      }
    }
  }
}
export const fictionalInvoiceRequest = (patch = {}) => ({
  year: '26',
  customer: 'FICTIONAL Invoice QA',
  currency: 'USD',
  order_id: 'fictional-order',
  uc_id: null,
  uc_no: null,
  created_by: 'qa@example.invalid',
  actor_uid: 'fictional-admin',
  purpose: 'first',
  reason: '',
  invoiced_at: '2026-11-08',
  ...patch
})
