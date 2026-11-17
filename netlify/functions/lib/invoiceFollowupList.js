import { FieldPath } from 'firebase-admin/firestore'
import { invoiceFollowupsDone, invoiceFollowupStages, invoiceLinkedReferences, invoiceLinkOwnershipIssue,
  invoiceReferenceValues, linkedInvoiceReceipt, sameInvoiceValue, validInvoiceOperationId, validInvoiceOrderId } from '../../../src/invoiceRecoveryModel.js'
import { orderSoDisplay } from '../../../src/shippingModel.js'
import { privateJson, validId } from './customerAccess.js'
import { classifyInvoiceFollowup } from './invoiceFollowupStatus.js'
import { permitted } from './orderRequestAccess.js'
import { readInvoiceReceiptStatus } from './invoiceReceiptStatus.js'

const pageSize = 50
const source = 'invoice_allocations'
const orderFields = ['invoice_allocation_id', 'erp_si_no', 'erp_so_no', 'erp_pi_no', 'uc_no', 'customer_name', 'currency', 'shipping_closed']
const jobFields = ['order_id', 'operation_id', 'stage', 'lease_until']
const unavailable = () => privateJson({ error: 'Invoice follow-ups are temporarily unavailable. Please retry.' }, 503)
const awaitingUnavailable = () => privateJson({ error: 'The invoice receipt source is temporarily unavailable. Retry this page.' }, 503)

// Document names provide a stable cursor even for older receipts with no date.
function cursorPath(cursor) {
  if (!cursor || cursor.length > 8200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return ''
  const path = Buffer.from(cursor, 'base64url').toString('utf8')
  const parts = path.split('/')
  if (Buffer.from(path).toString('base64url') !== cursor || parts.length % 2 || parts.at(-2) !== source ||
      parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 1500)) return ''
  return path
}

async function scanReceipts(db, after, limit, fields) {
  const base = db.collectionGroup(source).orderBy(FieldPath.documentId()).select('id', 'order_id', 'status', ...fields)
  const query = after ? base.startAfter(db.doc(after)) : base
  const { docs } = await query.limit(limit + 1).get()
  return docs
}

function readOrderReceipt(doc) {
  const parent = doc.ref.parent.parent
  if (parent?.parent.path !== 'orders' || !validInvoiceOrderId(parent.id)) return null
  return { doc, parent, op: doc.data() }
}

async function readOrderHeaders(db, candidates, fields = orderFields) {
  const parents = [...new Map(candidates.map(({ parent }) => [parent.id, parent])).values()]
  const headers = parents.length ? await db.getAll(...parents, { fieldMask: fields }) : []
  return new Map(headers.filter(header => header.exists).map(header => [header.id, { ...header.data(), id: header.id }]))
}

function receiptPage(docs, scanned, rows) {
  return { rows, next: docs.length > scanned ? Buffer.from(docs[scanned - 1].ref.path).toString('base64url') : null }
}

function displayOrderReference(order) {
  return (typeof order.erp_so_no === 'string' ? orderSoDisplay(order) : '') || order.id
}

export async function readInvoiceFollowupPage(db, after, limit = pageSize) {
  const docs = await scanReceipts(db, after, limit, ['result.si_no', 'result.uc_no', 'request.customer', 'request.currency',
    ...invoiceFollowupStages.flatMap(stage => [`followups.${stage}.state`, `followups.${stage}.requires_review`])])
  const page = docs.slice(0, limit)
  const candidates = page.map(readOrderReceipt).filter(item => item?.op.status === 'linked' && !invoiceFollowupsDone(item.op))
  const orders = await readOrderHeaders(db, candidates)
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
    return { ...identity, si: result.si_no, uc: result.uc_no, reference: displayOrderReference(order),
      customer: typeof order.customer_name === 'string' ? order.customer_name : '', current, disposition,
      stages: stages.map(({ stage, inProgress }) => ({ stage, inProgress })) }
  })
  return receiptPage(docs, page.length, rows)
}

export async function readAwaitingInvoiceLinkPage(db, lookup, after, limit = pageSize, maxChecks = 8) {
  const docs = await scanReceipts(db, after, limit, ['request', 'result', 'before.customerId', 'before.refs'])
  const page = docs.slice(0, limit)
  const candidates = page.map(readOrderReceipt).flatMap((item, index) =>
    item && ['allocated', 'pending', 'review_required'].includes(item.op.status) ? [{ ...item, index }] : [])
  const checked = candidates.slice(0, maxChecks)
  const orders = await readOrderHeaders(db, checked, [...orderFields, 'invoiced_at', 'customer_id'])
  const rows = await Promise.all(checked.map(async ({ doc, parent, op }) => {
    const identity = { orderId: parent.id, operationId: doc.id }
    if (!validInvoiceOperationId(doc.id) || op.id !== doc.id || op.order_id !== parent.id || op.request?.order_id !== parent.id)
      return { ...identity, issue: 'receipt_conflict' }
    const receipt = await readInvoiceReceiptStatus(op, lookup)
    if (receipt.status === 'unavailable') throw Error('Receipt verification unavailable')
    if (receipt.status === 'conflict') return { ...identity, issue: 'receipt_conflict' }
    if (receipt.status !== 'verified') return null
    const order = orders.get(parent.id)
    if (!order) return { ...identity, issue: 'order_unavailable' }
    if (order.shipping_closed) return { ...identity, issue: 'order_closed' }
    if (order.invoice_allocation_id !== doc.id) return { ...identity, issue: 'request_not_current' }
    const references = invoiceReferenceValues(order)
    const referenceConflict = !sameInvoiceValue(references, op.before?.refs) &&
      !sameInvoiceValue(references, invoiceLinkedReferences(order, op, receipt.result))
    const review = op.status === 'review_required' || invoiceLinkOwnershipIssue(order, op) || referenceConflict
    return { ...identity, si: receipt.result.si_no, uc: receipt.result.uc_no, reference: displayOrderReference(order),
      customer: typeof order.customer_name === 'string' ? order.customer_name : '', purpose: op.request.purpose,
      disposition: review ? 'finance_review' : 'resume' }
  }))
  return receiptPage(docs, candidates[maxChecks]?.index ?? page.length, rows.filter(Boolean))
}

export function createInvoiceFollowupListHandler({ verifyToken, getProfile, readPage, readAwaitingLinkPage }) {
  return async req => {
    if (req.method !== 'GET') return privateJson({ error: 'Method not allowed.' }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return privateJson({ error: 'Please sign in.' }, 401)
    let uid
    try { uid = (await verifyToken(token)).uid } catch { return privateJson({ error: 'Please sign in again.' }, 401) }
    if (!validId(uid)) return privateJson({ error: 'Please sign in again.' }, 401)
    let awaiting = false
    try {
      if (!permitted(await getProfile(uid), 'shipping')) return privateJson({ error: 'Access denied.' }, 403)
      const params = new URL(req.url).searchParams
      awaiting = params.get('view') === 'awaiting_link'
      const after = params.has('cursor') ? cursorPath(params.get('cursor')) : null
      if (after === '' || (params.has('view') && !awaiting) || params.size !== Number(awaiting) + Number(params.has('cursor')))
        return privateJson({ error: 'Invalid invoice page. Refresh and try again.' }, 400)
      return privateJson(await (awaiting ? readAwaitingLinkPage(after) : readPage(after)))
    } catch {
      return awaiting ? awaitingUnavailable() : unavailable()
    }
  }
}
