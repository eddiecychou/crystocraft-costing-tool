// Fictional service boundary for real-page tests. Canonical source and actual
// server draft normalization stay real; transaction/rules proof is separate.
import { createHash } from 'node:crypto'
import { quoteSourceCanonical } from '../src/quoteConversionModel.js'
import {
  normalizeConversionDraft,
  operationView
} from '../netlify/functions/lib/quoteConversionModel.js'
export const fixtureSourceToken = (quote, items) =>
  createHash('sha256').update(quoteSourceCanonical(quote, items)).digest('hex')
export async function referenceFixtureQuoteAction(
  f,
  quoteId,
  action = 'status',
  details = {}
) {
  f.quoteRequests = (f.quoteRequests || []).concat({
    quoteId,
    action,
    details: structuredClone(details)
  })
  const token = fixtureSourceToken(
    f.quote,
    (f.quoteItems || []).map((item, i) => ({ ...item, id: 'quote-item-' + i }))
  )
  const state = () => ({
    source_token: token,
    revision: f.quoteRevision || 0,
    active: operationView(f.quoteOperation),
    latest: operationView(f.quoteLatest),
    legacy: f.quoteLegacy || null,
    history: f.quoteHistory || (f.quoteLatest ? [operationView(f.quoteLatest)] : []),
    more_history: false,
    next_cursor: null
  })
  if (action === 'status') {
    if (f.statusFailure) throw Error('Fictional status check unavailable')
    return state()
  }
  if (action === 'prepare') {
    if (details.kind === 'initial' && f.quoteLatest) return state()
    if (f.quoteOperation) return state()
    f.createAttempts++
    if (f.createError) throw f.createError
    if (!f.allowCreate) throw Error('No fictional conversion create authorized')
    const n = f.multipleOrders ? ++f.quoteSequence : null
    f.quoteOperation = {
      id: n ? 'fictional-request-' + n : 'fictional-request',
      quote_id: quoteId,
      order_id: n ? 'fictional-order-' + n : 'new-line',
      kind: details.kind,
      reason: details.reason,
      status: 'prepared',
      source_token: token,
      payload: normalizeConversionDraft(details.draft)
    }
    if (f.prepareGate) await f.prepareGate.promise
    if (f.lostPrepare) {
      f.lostPrepare = false
      throw Error('Fictional prepared response lost')
    }
    return state()
  }
  if (action === 'commit') {
    const op = f.quoteOperation
    if (!op) {
      if (f.quoteLatest?.id === details.operation_id)
        return { ...state(), result: f.quoteLatest.result }
      throw Error('No saved fictional request')
    }
    if (f.commitFailure) throw Error('Fictional commit unavailable')
    f.createdRecords.push({
      path: [{}, 'orders'],
      data: { ...op.payload.order, client_quote_id: quoteId, quote_conversion_id: op.id }
    })
    for (const line of op.payload.lines)
      f.createdRecords.push({ path: [{}, 'orders', 'new-line', 'lines'], data: line })
    op.status = 'committed'
    op.result = { order_id: op.order_id, so: op.payload.order.erp_so_no }
    f.atomicQuoteCommits = (f.atomicQuoteCommits || []).concat({
      quote_id: quoteId,
      order_id: op.order_id
    })
    f.quoteLatest = op
    f.quoteHistory = [operationView(op), ...(f.quoteHistory || [])]
    f.quoteOperation = null
    f.quoteRevision = (f.quoteRevision || 0) + 1
    f.persistCreated?.(op)
    if (f.lostCommit) {
      f.lostCommit = false
      throw Error('Fictional committed response lost')
    }
    return { ...state(), result: op.result }
  }
  throw Error('Unexpected fictional quote conversion action: ' + action)
}
