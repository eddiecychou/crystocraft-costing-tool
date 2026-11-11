import { getMetadata, ref, uploadBytes } from 'firebase/storage'
import { authHeader, storage } from './firebase'
import { invoiceAction } from './invoiceRecovery'
import { needsInitialInvoice, piObjectPath } from './orderCreateRequestModel.js'
import { assertPiUploadSize } from './piUploadPolicy.js'

export async function orderRequestAction(action, details = {}) {
  const response = await fetch('/api/shipping-order-request', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...details }),
    signal: AbortSignal.timeout(55000)
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.error)
    throw Error(
      result?.error || 'Could not confirm the order. Check the saved request.'
    )
  return result
}

export async function describePi(file) {
  if (!file) return null
  assertPiUploadSize(file)
  const bytes = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    sha256: Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  }
}

export async function finishOrderRequest(key, file, expected) {
  const commit = () => orderRequestAction('commit', key)
  const result = await commit()
  if (result.direct && needsInitialInvoice(result.invoice?.state)) {
    await invoiceAction(result.order_id, 'initial_direct', {
      request_id: key.id
    })
    return orderRequestAction('status', key)
  }
  if (!result.needs_file || !file) return result
  const actual = await describePi(file)
  if (
    !expected ||
    actual.sha256 !== expected.sha256 ||
    actual.size !== expected.size ||
    actual.name !== expected.name
  )
    throw Error('Select the original PI named ' + expected?.name + '.')
  const object = ref(
    storage,
    piObjectPath(key.operator, key.id, expected.sha256)
  )
  try {
    await uploadBytes(object, file, { contentType: expected.type })
  } catch (err) {
    // Another tab may have uploaded first, or the upload response may be lost.
    // Only the server can accept the file after checking its actual bytes.
    try {
      await getMetadata(object)
    } catch {
      throw err
    }
  }
  return commit()
}

export function beginOrderCopy(operator, sourceId, previousId, expectedHeader) {
  return orderRequestAction('duplicate', {
    operator,
    id: crypto.randomUUID(),
    source_id: sourceId,
    previous_id: previousId,
    expected_header: expectedHeader
  })
}
