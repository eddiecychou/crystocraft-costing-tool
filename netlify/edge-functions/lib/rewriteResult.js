// Never send unvalidated model text to a client as application/json.
export function rewriteResult(data, { budget, withHeading } = {}) {
  const candidate = data?.candidates?.[0]
  if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete AI response')
  const text = (candidate.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim()
  const parsed = JSON.parse(text)
  if (!parsed || Array.isArray(parsed) || typeof parsed.body !== 'string' || !parsed.body.trim()) throw new Error('Invalid AI body')
  if (withHeading && parsed.heading !== null && typeof parsed.heading !== 'string') throw new Error('Invalid AI heading')
  let body = parsed.body.trim()
  if (budget && body.length > budget) {
    const cut = body.slice(0, Math.max(0, budget - 1))
    body = (cut.replace(/\s+\S*$/, '').trimEnd() || cut.trimEnd()) + '…'
  }
  return { ...(withHeading ? { heading: parsed.heading } : {}), body }
}
