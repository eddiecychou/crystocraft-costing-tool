import { conversionCanonical } from '../../../src/quoteConversionModel.js'
import { OrderRequestError } from './orderRequestAccess.js'

// A read-only lookup may return no receipt. Both lookup and issue match the
// original request before trusting the registry number.
export async function duplicateOrderUc(
  id,
  request,
  issue,
  { url, key, fetchImpl = fetch }
) {
  if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url))
    throw new OrderRequestError(
      'UC registry configuration is unavailable. Resume this saved copy later.',
      503
    )
  const res = await fetchImpl(
    url.replace(/\/$/, '') + '/rest/v1/rpc/duplicate_order_uc',
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_operation_id: id,
        p_request: request,
        p_issue: issue
      }),
      signal: AbortSignal.timeout(20000)
    }
  )
  const result = await res.json().catch(() => null)
  if (!res.ok) {
    if (
      [
        'Duplicate UC receipt mismatch',
        'Issued duplicate UC requires review'
      ].includes(result?.message)
    )
      throw new OrderRequestError(
        'The saved UC receipt or its registry row has changed. Review this copy before continuing.'
      )
    throw new OrderRequestError(
      'UC issuance could not be confirmed. Resume this same copy to check the registry.',
      503
    )
  }
  if (!issue && Array.isArray(result) && result.length === 0) return null
  const row = result?.[0]
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    row?.operation_id !== id ||
    conversionCanonical(row.request_json) !== conversionCanonical(request) ||
    typeof row.uc_id !== 'string' ||
    !/^[1-9][0-9]*$/.test(row.uc_id) ||
    typeof row.uc_no !== 'string' ||
    !row.uc_no.endsWith(request.year) ||
    row.uc_no === request.year
  )
    throw new OrderRequestError(
      'The UC registry returned an inconsistent receipt. Review the saved copy.'
    )
  return { id: row.uc_id, number: row.uc_no }
}
