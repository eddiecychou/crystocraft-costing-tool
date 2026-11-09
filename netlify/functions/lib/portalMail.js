export async function sendPortalMail(
  payload,
  key,
  { apiKey, fetchImpl = fetch, timeoutMs = 20_000 }
) {
  try {
    const result = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload)
    })
    if (!result.ok)
      return {
        status:
          result.status >= 500 || [408, 409, 429].includes(result.status)
            ? 'unknown'
            : 'failed'
      }
    const data = await result.json()
    return data.id
      ? { status: 'sent', provider_id: String(data.id).slice(0, 200) }
      : { status: 'unknown' }
  } catch {
    return { status: 'unknown' }
  }
}
