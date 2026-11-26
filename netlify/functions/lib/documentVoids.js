import { createHash } from 'node:crypto'
import { exactSalesInvoiceNo, piDocumentIdentity } from '../../../src/documentVoidModel.js'
import { orderUc } from '../../../src/shippingModel.js'
import { privateJson, validId } from './customerAccess.js'
import { OrderRequestError, permitted, shippingProfile } from './orderRequestAccess.js'
import { readOcInvoiceLedger } from './ocInvoiceSummaries.js'

const bad = message => new OrderRequestError(message, 400)
const conflict = message => new OrderRequestError(message, 409)
const ledgerId = value => Number.isSafeInteger(value) && value > 0
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const piAuditKey = pi => 'pi-void-' + digest([pi.no, pi.revision])

function voidReason(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500)
    throw bad('Enter a void reason of 1 to 500 characters.')
  return reason.trim()
}

export function createPiVoidRepository(db, timestamp) {
  return (uid, input) => db.runTransaction(async tx => {
    await shippingProfile(db, tx, uid)
    const ref = db.doc('orders/' + input.orderId)
    const snap = await tx.get(ref)
    const order = snap.data()
    if (!order) throw new OrderRequestError('Saved order not found.', 404)
    const current = piDocumentIdentity(order)
    const version = digest([snap.updateTime?.seconds, snap.updateTime?.nanoseconds])
    const audits = ref.collection('closure_audit')
    const project = row => ({ no: row.document_no, revision: row.revision, reason: row.reason,
      voidedAt: row.voided_at?.toDate().toISOString() ?? null })
    if (input.action === 'pi_status') {
      const history = (await tx.get(audits.where('kind', '==', 'pi_void'))).docs.map(doc => project(doc.data()))
      history.sort((a, b) => (b.voidedAt || '').localeCompare(a.voidedAt || ''))
      return { current, version, history }
    }

    const expected = input.target
    const audit = audits.doc(piAuditKey(expected))
    const prior = (await tx.get(audit)).data()
    if (prior) return { void: project(prior) }
    if (!current || current.no !== expected.no || current.revision !== expected.revision || version !== input.version)
      throw conflict('The saved PI changed. Reopen the current PI before voiding it.')
    const reason = voidReason(input.reason)
    tx.create(audit, {
      kind: 'pi_void', document_no: current.no, revision: current.revision, uc_no: orderUc(order),
      version, reason, by: uid, voided_at: timestamp(),
    })
    return { void: { ...current, reason } }
  }, { readOnly: input.action === 'pi_status' })
}

export function createDocumentVoidSql({ url, key, fetchImpl = fetch }) {
  const base = url.replace(/\/$/, '')
  async function rest(path, body) {
    const response = await fetchImpl(base + '/rest/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json',
        ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000), redirect: 'error',
    })
    if (!response.ok) {
      const code = (await response.json().catch(() => null))?.code
      if (['23514', 'P0002'].includes(code))
        throw conflict('The invoice or its receipt changed. Review the exact SI before confirming again.')
      throw Error('The ledger did not confirm the request.')
    }
    const rows = await response.json()
    if (!Array.isArray(rows)) throw Error('Invalid ledger response')
    return rows
  }
  return {
    async read(no, review = false) {
      const select = review ? 'id,si_no,status,updated_at,customer,uc_no,total,currency,invoiced_at,invoice_date,void_reason,voided_at'
        : 'id,si_no,status'
      const rows = await rest('app_sales_invoice?' + new URLSearchParams({ si_no: 'eq.' + no, select, limit: '2' }))
      if (rows.length > 1 || (rows.length === 1 && (!ledgerId(rows[0]?.id) || rows[0].si_no !== no ||
          typeof rows[0].status !== 'string' || !rows[0].status))) throw Error('Invalid exact invoice result')
      return rows[0] ?? null
    },
    async void(input, uid) {
      const rows = await rest('rpc/void_app_sales_invoice', {
        p_id: input.id, p_si: input.no, p_expected_updated_at: input.updatedAt, p_by: uid, p_reason: voidReason(input.reason),
      })
      const result = rows[0]?.result
      if (rows.length !== 1 || result?.no !== input.no || result.status !== 'void') throw Error('Incomplete void confirmation')
      return result
    },
    async voidedNumbers() {
      return (await readOcInvoiceLedger(base, key, fetchImpl, 'void')).map(row => row.si_no).filter(exactSalesInvoiceNo)
    },
  }
}

export function createDocumentVoidHandler({ verifyToken, getProfile, pi, ledger }) {
  return async req => {
    if (req.method !== 'POST') return privateJson({ error: 'Method not allowed.' }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return privateJson({ error: 'Please sign in.' }, 401)
    let uid
    try { uid = (await verifyToken(token)).uid } catch { return privateJson({ error: 'Please sign in again.' }, 401) }
    if (!validId(uid) || uid.length > 128) return privateJson({ error: 'Please sign in again.' }, 401)
    try {
      const raw = await req.text()
      if (Buffer.byteLength(raw) > 8192) return privateJson({ error: 'Request is too long.' }, 413)
      let input
      try { input = JSON.parse(raw) } catch { throw bad('Invalid document request.') }
      if (!input || Array.isArray(input)) throw bad('Invalid document request.')
      const profile = await getProfile(uid)
      if (['pi_status', 'void_pi'].includes(input.action)) {
        if (!permitted(profile, 'shipping')) return privateJson({ error: 'Access denied.' }, 403)
        if (!validId(input.orderId)) throw bad('Choose a saved PI.')
        if (input.action === 'void_pi') {
          const target = piDocumentIdentity({ erp_so_no: input.target?.no, pi_revision: input.target?.revision })
          if (!target || !/^[a-f0-9]{64}$/.test(input.version || '')) throw bad('Review the current PI before voiding it.')
          input.target = target
          input.reason = voidReason(input.reason)
        }
        return privateJson(await pi(uid, input))
      }
      const financeAction = ['review_si', 'void_si'].includes(input.action)
      if (!['si_status', 'si_voids', 'review_si', 'void_si'].includes(input.action)) throw bad('Invalid document action.')
      if (!permitted(profile, 'invoices') || (financeAction && !permitted(profile, 'uc')))
        return privateJson({ error: 'Access denied.' }, 403)
      if (input.action === 'si_voids') return privateJson({ numbers: await ledger().voidedNumbers() })
      if (!exactSalesInvoiceNo(input.no)) throw bad('Enter the exact OC sales invoice number.')
      if (input.action === 'void_si') {
        if (!ledgerId(input.id) || !(input.updatedAt === null ||
            (typeof input.updatedAt === 'string' && input.updatedAt.length < 60 && Number.isFinite(Date.parse(input.updatedAt)))))
          throw bad('Review the exact invoice before voiding it.')
        input.reason = voidReason(input.reason)
        return privateJson(await ledger().void(input, uid))
      }
      const row = await ledger().read(input.no, financeAction)
      if (!financeAction) return privateJson({ status: row?.status ?? 'unregistered' })
      if (!row) return privateJson({ error: 'This SI is unavailable in the OC invoice ledger.' }, 404)
      return privateJson({
        id: row.id, no: row.si_no, status: row.status, updatedAt: row.updated_at ?? null, customer: row.customer,
        currency: row.currency, total: row.total, uc: row.uc_no, date: row.invoice_date || row.invoiced_at,
        reason: row.void_reason, voidedAt: row.voided_at,
      })
    } catch (error) {
      return error instanceof OrderRequestError ? privateJson({ error: error.message }, error.status)
        : privateJson({ error: 'The document status could not be confirmed. Retry the same document.' }, 503)
    }
  }
}
