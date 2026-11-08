import { validConversionId } from '../../../src/quoteConversionModel.js'
import { QuoteConversionError } from './quoteConversionModel.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Netlify-CDN-Cache-Control': 'no-store',
      Vary: 'Authorization',
      'X-Content-Type-Options': 'nosniff'
    }
  })
const can = (p, key) =>
  p?.role === 'admin' ||
  (p?.role === 'staff' && Array.isArray(p.modules) && p.modules.includes(key))
export function createQuoteConversionHandler({ verifyToken, getProfile, repo }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return json({ error: 'Not signed in' }, 401)
    let identity
    try {
      identity = await verifyToken(token)
      if (!identity.uid) throw Error()
    } catch {
      return json({ error: 'Invalid or expired session' }, 401)
    }
    try {
      const profile = await getProfile(identity.uid)
      if (
        !can(profile, 'shipping') ||
        !can(profile, 'quotes') ||
        ['disabled', 'suspended', 'rejected', 'pending'].includes(profile?.status)
      )
        return json({ error: 'Access denied' }, 403)
      const raw = await req.text()
      if (Buffer.byteLength(raw) > 512000)
        throw new QuoteConversionError('Conversion request is too large.', 400)
      let input
      try {
        input = JSON.parse(raw)
      } catch {
        throw new QuoteConversionError('Bad JSON', 400)
      }
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (k) =>
            ![
              'action',
              'quote_id',
              'cursor',
              'draft',
              'expected_source',
              'expected_revision',
              'kind',
              'reason',
              'legacy_review',
              'operation_id'
            ].includes(k)
        )
      )
        throw new QuoteConversionError('Invalid conversion request.', 400)
      if (input.action === 'ready') return json({ ready: true, protocol: 1 })
      if (
        !validConversionId(input.quote_id) ||
        !['status', 'prepare', 'commit', 'cancel'].includes(input.action)
      )
        throw new QuoteConversionError(
          'Choose a saved quote and valid conversion action.',
          400
        )
      if (input.cursor != null && !validConversionId(input.cursor))
        throw new QuoteConversionError('Invalid history cursor.', 400)
      if (
        ['commit', 'cancel'].includes(input.action) &&
        !validConversionId(input.operation_id)
      )
        throw new QuoteConversionError('Choose the saved conversion request.', 400)
      if (input.action === 'prepare') {
        if (
          !['initial', 'additional'].includes(input.kind) ||
          typeof input.expected_source !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.expected_source) ||
          !Number.isSafeInteger(input.expected_revision) ||
          input.expected_revision < 0
        )
          throw new QuoteConversionError(
            'Review the current quote and conversion details first.',
            400
          )
        if (
          input.reason != null &&
          (typeof input.reason !== 'string' || input.reason.length > 500)
        )
          throw new QuoteConversionError(
            'Give a short reason of no more than 500 characters.',
            400
          )
        input.reason = (input.reason || '').trim()
        if (input.kind === 'additional' && !input.reason)
          throw new QuoteConversionError(
            'Give a short reason for the additional order.',
            400
          )
        await repo.prepare(input.quote_id, input, identity)
      }
      let result
      if (input.action === 'commit')
        result = await repo.commit(input.quote_id, input.operation_id)
      if (input.action === 'cancel') {
        if (
          typeof input.reason !== 'string' ||
          !input.reason.trim() ||
          input.reason.length > 500
        )
          throw new QuoteConversionError('Give a short cancellation reason.', 400)
        await repo.cancel(
          input.quote_id,
          input.operation_id,
          identity,
          input.reason.trim()
        )
      }
      // A failed read after a successful commit is unknown completion to the
      // caller. Its saved receipt still makes Status/Resume safe.
      return json({
        ...(await repo.state(
          input.quote_id,
          input.action === 'status' ? input.cursor : null
        )),
        ...(result ? { result } : {})
      })
    } catch (error) {
      return json(
        {
          error:
            error instanceof QuoteConversionError
              ? error.message
              : 'Conversion confirmation is temporarily unavailable. Check the saved request and resume it; do not create another order.'
        },
        error instanceof QuoteConversionError ? error.status : 503
      )
    }
  }
}
