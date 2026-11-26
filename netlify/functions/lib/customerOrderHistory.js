import { customerContext, privateJson as json, validId } from './customerAccess.js'
import { isConfirmedErpInvoice } from '../../../src/domain/salesInvoiceHistory.js'
import { canonicalSalesInvoiceNo } from '../../../src/documentVoidModel.js'

const headerFields = ['code', 'date', 'status', 'amount', 'currency', 'customer_po', 'ref', 'discount']
const lineFields = ['item_code', 'description', 'qty', 'unit_price', 'amount']
const pick = (record, fields) =>
  Object.fromEntries(
    fields.map((key) => [key, ['number', 'string'].includes(typeof record[key]) ? record[key] : null]),
  )

export async function invoiceTable(deps, table, params) {
  const r = await (deps.fetcher || fetch)(
    deps.SUPABASE_URL + '/rest/v1/' + table + '?' + new URLSearchParams(params),
    {
      headers: {
        apikey: deps.SERVICE_KEY,
        Authorization: 'Bearer ' + deps.SERVICE_KEY,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    },
  )
  if (!r.ok) throw Error('Invoice source unavailable')
  const rows = await r.json()
  if (!Array.isArray(rows)) throw Error('Invalid invoice response')
  return rows
}

export async function customerInvoiceLedger(deps, numbers, voidOnly = false) {
  const rows = []
  for (let i = 0; i < numbers.length; i += 40) {
    const values = numbers.slice(i, i + 40).map((v) => '"' + v.replace(/["\\]/g, '\\$&') + '"')
    rows.push(
      ...(await invoiceTable(deps, 'app_sales_invoice', {
        select: voidOnly ? 'si_no,status' :
          'id,si_no,status,order_id,uc_no,currency,invoice_date,invoiced_at,total,accounting_total,uc_registry(customer_id)',
        si_no: 'in.(' + values.join(',') + ')',
        ...(voidOnly && { status: 'eq.void' }),
      })),
    )
  }
  return rows
}

export function createCustomerOrderHistoryHandler(deps) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    try {
      const { customer, customerId } = await customerContext(req, deps)
      const body = await req.json().catch(() => ({}))
      const action = body?.action || 'history'
      if (action === 'oc-history') return json({ rows: customerId ? await deps.oc.history(customerId) : [] })
      if (action === 'oc-detail') {
        if (
          !customerId ||
          !validId(body.id) ||
          typeof body.code !== 'string' ||
          !body.code.trim() ||
          body.code.length > 200
        )
          return json({ error: 'Original unavailable.' }, 404)
        return json(await deps.oc.detail(customerId, body.id, body.code))
      }
      if (!['history', 'lines'].includes(action)) return json({ error: 'Invalid invoice request.' }, 400)
      const owner = customer?.erp_code
      if (!owner || customer.erp_code_shared)
        return action === 'history'
          ? json({ rows: [], shared: !!customer?.erp_code_shared })
          : json({ error: 'Not available' }, 403)
      const detail = action === 'lines'
      const code = typeof body.code === 'string' ? body.code.trim() : ''
      if (detail && (!code || code.length > 200)) return json({ error: 'Invoice number is required' }, 400)
      const headers = await invoiceTable(deps, 'erp_sales_invoice', {
        select: [...headerFields, 'customer_code'].join(','),
        ...(detail
          ? { code: 'eq.' + code, limit: '2' }
          : {
              customer_code: 'eq.' + owner,
              status: 'imatch.^[[:space:]]*confirmed[[:space:]]*$',
              order: 'date.desc,code.asc',
              limit: '200',
            }),
      })
      const owned = headers.filter(
        (h) =>
          isConfirmedErpInvoice(h) &&
          typeof h.customer_code === 'string' &&
          h.customer_code.toUpperCase() === owner.toUpperCase() &&
          typeof h.code === 'string' &&
          h.code.trim(),
      )
      const voided = deps.voidedOcNumbers
        ? await deps.voidedOcNumbers([...new Set(owned.map(row => canonicalSalesInvoiceNo(row.code)).filter(Boolean))])
        : new Set()
      const available = owned.filter(row => !voided.has(canonicalSalesInvoiceNo(row.code)))
      if (!detail)
        return json({
          rows: available.map((h) => pick(h, ['code', 'date', 'status', 'amount', 'currency', 'ref'])),
        })
      if (headers.length !== 1 || available[0]?.code !== code) return json({ error: 'Invoice not found.' }, 404)
      const lines = []
      for (let offset = 0; ; offset += 200) {
        const page = await invoiceTable(deps, 'erp_sales_invoice_line', {
          select: lineFields.join(','),
          invoice_no: 'eq.' + code,
          order: 'seq.asc',
          offset,
          limit: 200,
        })
        lines.push(...page.map((line) => pick(line, lineFields)))
        if (page.length < 200) break
      }
      return json({ header: pick(available[0], headerFields), lines })
    } catch (e) {
      return json(
        { error: e.status ? e.message : 'Invoice history could not load. Please try again.' },
        e.status || 503,
      )
    }
  }
}
