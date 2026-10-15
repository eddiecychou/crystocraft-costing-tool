import { completedAiJson, limitAiCopy } from './aiResult.js'
// Never send unvalidated model text to a client as application/json.
export function rewriteResult(data, { budget, withHeading } = {}) {
  const parsed = completedAiJson(data)
  if (!parsed || Array.isArray(parsed) || typeof parsed.body !== 'string' || !parsed.body.trim()) throw new Error('Invalid AI body')
  if (withHeading && parsed.heading !== null && typeof parsed.heading !== 'string') throw new Error('Invalid AI heading')
  const body = budget ? limitAiCopy(parsed.body, budget) : parsed.body.trim()
  return { ...(withHeading ? { heading: parsed.heading } : {}), body }
}
