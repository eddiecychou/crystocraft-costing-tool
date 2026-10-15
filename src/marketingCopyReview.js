export const MAX_COPY_CHARS = 300
export const REVIEW_LABELS = {
  pending: 'Needs copy', awaiting: 'Awaiting approval', approved: 'Approved',
  compliant: 'Already compliant', written: 'Saved', failed: 'Failed',
}
export function hasValidCopy(copy) {
  return typeof copy === 'string' && Boolean(copy.trim()) && copy.length <= MAX_COPY_CHARS
}
export function reviewState(product, entry = {}) {
  const current = product.marketing_description || ''
  if (entry.error || ['preview_failed', 'write_failed'].includes(entry.status)) return 'failed'
  if (entry.status === 'previewed') {
    const instructionsMatch = (entry.guidance || '').trim() === (entry.instructionsApplied || '')
    return entry.approved && current === entry.before && instructionsMatch ? 'approved' : 'awaiting'
  }
  if (entry.status === 'written' && current === entry.after && hasValidCopy(current)) return 'written'
  return hasValidCopy(current) ? 'compliant' : 'pending'
}
export function previewIsStale(product, entry) {
  return entry?.status === 'previewed' && (product.marketing_description || '') !== entry.before
}
