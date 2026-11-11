// Fictional PostgREST transport backed by the isolated local PostgreSQL fixture.
export const invoiceTestRest =
  (db, faults, queries = []) =>
  async (url, options) => {
    const path = new URL(url).pathname.split('/').at(-1),
      body = options.body ? JSON.parse(options.body) : null
    queries.push(path)
    try {
      let rows
      if (path === 'allocate_sales_invoice_once') {
        if (faults.beforeSql) {
          faults.beforeSql = false
          throw Error('FICTIONAL before dispatch')
        }
        rows = await db.asRole(
          'service_role',
          'select * from allocate_sales_invoice_once($1::uuid,$2::jsonb)',
          [body.p_operation_id, body.p_request]
        )
        if (faults.lostSqlAck) {
          faults.lostSqlAck = false
          throw Error('FICTIONAL committed with lost response')
        }
      } else if (path === 'lookup_invoice_allocation')
        rows = await db.asRole(
          'service_role',
          'select * from lookup_invoice_allocation($1::uuid)',
          [body.p_operation_id]
        )
      else if (path === 'apply_invoice_allocation_followup') {
        if (faults.followup) {
          faults.followup = false
          throw Error('FICTIONAL follow-up unavailable')
        }
        rows = await db.asRole(
          'service_role',
          'select * from apply_invoice_allocation_followup($1::uuid,$2,$3::jsonb,$4::jsonb)',
          [body.p_operation_id, body.p_stage, body.p_expected, body.p_patch]
        )
        if (faults.lostFollowupAck) {
          faults.lostFollowupAck = false
          throw Error('FICTIONAL follow-up committed with lost response')
        }
      } else if (['app_sales_invoice', 'uc_registry'].includes(path))
        rows = (
          await db.pool.query(
            'select to_jsonb(t) as row from ' + path + ' t where id=$1',
            [new URL(url).searchParams.get('id').replace('eq.', '')]
          )
        ).rows.map((r) => r.row)
      else throw Error('Unexpected QA database route ' + path)
      return Response.json(rows)
    } catch (error) {
      return Response.json({ message: error.message }, { status: 400 })
    }
  }
