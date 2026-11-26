import { authHeader } from './firebase'

export async function documentVoidAction(action, fields = {}, signal) {
  const response = await fetch('/api/document-void', {
    method: 'POST',
    headers: { ...await authHeader(), 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ ...fields, action }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || data.error)
    throw Error(data?.error || 'Could not confirm document status. Retry the same document.')
  return data
}
