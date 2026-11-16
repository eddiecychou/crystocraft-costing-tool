import { FieldPath } from 'firebase-admin/firestore'
import { invoiceFollowupsDone, invoiceFollowupStages, linkedInvoiceReceipt, validInvoiceOperationId, validInvoiceOrderId } from '../../../src/invoiceRecoveryModel.js'
import { orderSoDisplay } from '../../../src/shippingModel.js'
import { privateJson, validId } from './customerAccess.js'
import { classifyInvoiceFollowup } from './invoiceFollowupStatus.js'
import { permitted } from './orderRequestAccess.js'

const pageSize = 50
const source = 'invoice_allocations'
const orderFields = ['invoice_allocation_id', 'erp_si_no', 'erp_so_no', 'erp_pi_no', 'uc_no', 'customer_name', 'currency', 'shipping_closed']
const jobFields = ['order_id', 'operation_id', 'stage', 'lease_until']
const unavailable = () => privateJson({ error: 'Invoice follow-ups are temporarily unavailable. Please retry.' }, 503)

// Document names provide a stable cursor even for older receipts with no date.
function cursorPath(cursor) {
  if (!cursor || cursor.length > 8200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return ''
  const path = Buffer.from(cursor, 'base64url').toString('utf8')
  const parts = path.split('/')
  if (Buffer.from(path).toString('base64url') !== cursor || parts.length % 2 || parts.at(-2) !== source ||
      parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 1500)) return ''
  return path
}

export async function readInvoiceFollowupPage(db, after, limit = pageSize) {
  const base = db.collectionGroup(source).orderBy(FieldPath.documentId()).select('id', 'order_id', 'status',
    'result.si_no', 'result.uc_no', 'request.customer', 'request.currency',
    ...invoiceFollowupStages.flatMap(stage => [`followups.${stage}.state`, `followups.${stage}.requires_review`]))
  const query = after ? base.startAfter(db.doc(after)) : base
  const { docs } = await query.limit(limit + 1).get()
  const page = docs.slice(0, limit)
  const candidates = page.flatMap(doc => {
    const parent = doc.ref.parent.parent
    if (parent?.parent.path !== 'orders' || !validInvoiceOrderId(parent.id)) return []
    const op = doc.data()
    return op.status === 'linked' && !invoiceFollowupsDone(op) ? [{ doc, parent, op }] : []
  })
  const parents = [...new Map(candidates.map(({ parent }) => [parent.id, parent])).values()]
  const headers = parents.length ? await db.getAll(...parents, { fieldMask: orderFields }) : []
  const orders = new Map(headers.filter(header => header.exists).map(header => [header.id, { ...header.data(), id: header.id }]))
  const jobRefs = candidates.flatMap(({ doc, parent, op }) =>
    orders.get(parent.id)?.invoice_allocation_id === doc.id && linkedInvoiceReceipt(op, doc.id, parent.id)
      ? invoiceFollowupStages.map(stage => db.doc(`invoice_followup_jobs/${doc.id}_${stage}`)) : [])
  const distinctJobs = [...new Map(jobRefs.map(ref => [ref.path, ref])).values()]
  const jobDocs = distinctJobs.length ? await db.getAll(...distinctJobs, { fieldMask: jobFields }) : []
  const jobs = new Map(jobDocs.map(job => [job.id, job.data()]))
  const now = Date.now()
  const rows = candidates.map(({ doc, parent, op }) => {
    const order = orders.get(parent.id)
    const identity = { orderId: parent.id, operationId: doc.id }
    if (!linkedInvoiceReceipt(op, doc.id, parent.id) || !/^SI\d{6,}$/.test(op.result.si_no) ||
        typeof op.result.uc_no !== 'string' || !op.result.uc_no.trim()) {
      return { ...identity, issue: 'receipt_conflict' }
    }
    if (!order) return { ...identity, issue: 'order_unavailable' }
    const { result, disposition, current, stages } = classifyInvoiceFollowup(order, op,
      new Map(invoiceFollowupStages.map(stage => [stage, jobs.get(`${doc.id}_${stage}`)])), now)
    const reference = typeof order.erp_so_no === 'string' ? orderSoDisplay(order) : ''
    return { ...identity, si: result.si_no, uc: result.uc_no, reference: reference || order.id,
      customer: typeof order.customer_name === 'string' ? order.customer_name : '', current, disposition,
      stages: stages.map(({ stage, inProgress }) => ({ stage, inProgress })) }
  })
  return { rows, next: docs.length > limit ? Buffer.from(page.at(-1).ref.path).toString('base64url') : null }
}

export function createInvoiceFollowupListHandler({ verifyToken, getProfile, readPage }) {
  return async req => {
    if (req.method !== 'GET') return privateJson({ error: 'Method not allowed.' }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return privateJson({ error: 'Please sign in.' }, 401)
    let uid
    try { uid = (await verifyToken(token)).uid } catch { return privateJson({ error: 'Please sign in again.' }, 401) }
    if (!validId(uid)) return privateJson({ error: 'Please sign in again.' }, 401)
    try {
      if (!permitted(await getProfile(uid), 'shipping')) return privateJson({ error: 'Access denied.' }, 403)
      const params = new URL(req.url).searchParams
      const after = params.has('cursor') ? cursorPath(params.get('cursor')) : null
      if (after === '' || params.size !== Number(params.has('cursor'))) return privateJson({ error: 'Invalid follow-up page. Refresh and try again.' }, 400)
      return privateJson(await readPage(after))
    } catch {
      return unavailable()
    }
  }
}
