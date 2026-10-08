import { authedUser } from './firebase'

const BATCH_SIZE = 30

async function evaluateBatch(tags) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const response = await fetch('/api/jev-marketing-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tags }),
  })
  let data = {}
  try { data = await response.json() } catch { /* non-JSON error */ }
  if (!response.ok) throw new Error(data.error || `JEV request failed (${response.status})`)
  return data
}

export async function evaluateMarketingTagsWithJev(tagRows, onProgress) {
  const rows = Array.isArray(tagRows) ? tagRows : []
  const results = []
  let model = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const data = await evaluateBatch(batch)
    results.push(...(Array.isArray(data.results) ? data.results : []))
    model = data.model || model
    inputTokens += Number(data.usage?.input_tokens || 0)
    outputTokens += Number(data.usage?.output_tokens || 0)
    inputTokens += Number(data.verificationUsage?.input_tokens || 0)
    outputTokens += Number(data.verificationUsage?.output_tokens || 0)
    onProgress?.(Math.min(offset + batch.length, rows.length), rows.length)
  }

  return { results, model, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }
}
