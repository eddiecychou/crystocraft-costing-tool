// One reviewed sales position per customer. Orders and AI never change it directly.
export const emptyPipeline = () => ({ revision: 0, status: 'inactive', detail: '', suggestion: null, last_reviewed_source: '' })
const bounded = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
export async function summaryKey(digest) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digest || ''))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('')
}
export function validatePipelineSuggestions(result, customers) {
  if (!Array.isArray(result?.suggestions)) throw Error('AI returned an incomplete suggestion list. Try again.')
  const allowed = new Map(customers.map(c => [c.id, c])), seen = new Set()
  return result.suggestions.map(s => {
    const c = allowed.get(s?.id)
    if (!c || seen.has(s.id) || !['active','inactive'].includes(s.status)
      || !bounded(s.detail,2000) || !bounded(s.reason,1000) || !bounded(s.evidence,1500)
      || !c.digest.includes(s.evidence)
      || (s.status === 'active' && !['product','sample','price','quotation'].includes(s.request_kind))
      || (s.status === 'inactive' && (c.pipeline?.status !== 'active' || s.all_requests_resolved !== true))) {
      throw Error('AI returned an unsupported or ungrounded suggestion. Nothing from this batch was saved.')
    }
    seen.add(s.id)
    return { id:s.id, status:s.status, detail:s.detail.trim(), reason:s.reason.trim(), evidence:s.evidence,
      source_key:c.source_key, based_on_revision:c.pipeline?.revision || 0 }
  })
}
export function pipelineTransition(current, action, { suggestion, detail, sourceKey = '', status } = {}) {
  const p = current || emptyPipeline()
  if (action === 'suggest') {
    if (!suggestion || suggestion.based_on_revision !== p.revision) throw Error('Pipeline changed. Refresh suggestions before reviewing.')
    if (p.last_reviewed_source === suggestion.source_key) return null
    return { ...p, suggestion }
  }
  if (action === 'dismiss' || action === 'confirm') {
    if (!p.suggestion || sourceKey !== p.suggestion.source_key) throw Error('This suggestion changed. Reopen the latest one.')
    if (action === 'dismiss') return { ...p, suggestion:null, last_reviewed_source:sourceKey }
    if (!bounded(detail,2000)) throw Error('Describe the customer’s buying request (up to 2,000 characters).')
    return { ...p, status:p.suggestion.status, detail:detail.trim(), suggestion:null, last_reviewed_source:sourceKey }
  }
  if (action === 'manual') {
    if (!['active','inactive'].includes(status) || !bounded(detail,2000)) throw Error('Choose a position and describe the request or closure reason.')
    return { ...p, status, detail:detail.trim(), suggestion:null, last_reviewed_source:p.suggestion?.source_key || p.last_reviewed_source }
  }
  throw Error('Choose a Pipeline action.')
}
