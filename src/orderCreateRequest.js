import { getMetadata, ref, uploadBytes } from 'firebase/storage'
import { storage } from './firebase'
import { invoiceAction } from './invoiceRecovery'
import { needsInitialInvoice, piObjectPath } from './orderCreateRequestModel.js'
import { assertPiUploadSize } from './piUploadPolicy.js'

import { orderRequestAction } from './shippingOrderApi'
export { orderRequestAction } from './shippingOrderApi'

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

export function samePiOriginal(actual, expected) {
  return Boolean(actual && expected && actual.sha256 === expected.sha256 &&
    actual.size === expected.size && actual.name === expected.name)
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
  if (!samePiOriginal(actual, expected))
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
