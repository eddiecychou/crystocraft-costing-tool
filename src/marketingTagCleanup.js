export const TAG_REVIEW_ACTIONS = ['skip', 'keep', 'rename', 'remove']

const topValues = (map, limit) => [...map.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, limit)
  .map(([value]) => value)

export function buildMarketingTagContextRows(contacts) {
  const byTag = new Map()
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const tags = [...new Set((Array.isArray(contact?.tags) ? contact.tags : []).map(tag => String(tag).trim()).filter(Boolean))]
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, {
        tag, count: 0, companies: new Map(), countries: new Map(), coTags: new Map(),
        audiences: new Map(), statuses: new Map(), linkedCustomers: 0,
      })
      const row = byTag.get(tag)
      row.count++
      if (contact.company) row.companies.set(contact.company, (row.companies.get(contact.company) || 0) + 1)
      if (contact.country) row.countries.set(contact.country, (row.countries.get(contact.country) || 0) + 1)
      for (const coTag of tags) if (coTag !== tag) row.coTags.set(coTag, (row.coTags.get(coTag) || 0) + 1)
      for (const audience of contact.audiences || []) row.audiences.set(audience, (row.audiences.get(audience) || 0) + 1)
      if (contact.status) row.statuses.set(contact.status, (row.statuses.get(contact.status) || 0) + 1)
      if (contact.is_customer || contact.possible_customer_match) row.linkedCustomers++
    }
  }
  return [...byTag.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map(row => ({
      tag: row.tag,
      count: row.count,
      context: {
        sampleCompanies: topValues(row.companies, 5),
        countries: topValues(row.countries, 6),
        coTags: topValues(row.coTags, 8),
        audiences: topValues(row.audiences, 4),
        statuses: topValues(row.statuses, 4),
        linkedCustomers: row.linkedCustomers,
      },
    }))
}

export function normalizeTagReviewDecision(raw, knownTags = []) {
  const tag = String(raw?.tag || '').trim()
  const action = TAG_REVIEW_ACTIONS.includes(raw?.action) ? raw.action : 'skip'
  const target = String(raw?.target || '').trim().toLowerCase()
  const known = new Set(knownTags.map(value => String(value).trim().toLowerCase()))
  if (!tag) return { valid: false, error: 'The source tag is missing.' }
  if (action === 'rename' && !target) return { valid: false, error: `Choose a replacement for “${tag}”.` }
  if (action === 'rename' && target === tag.toLowerCase()) return { valid: false, error: `“${tag}” is already the selected name.` }
  return {
    valid: true,
    decision: {
      tag,
      action,
      target: action === 'rename' ? target : null,
      mergesExisting: action === 'rename' && known.has(target),
    },
  }
}

export function proposedReviewAction(row) {
  const recommendation = row?.deepseek?.action || row?.action
  const canonical = row?.deepseek?.canonical || row?.canonical
  if (recommendation === 'normalize' && canonical) return { action: 'rename', target: canonical }
  if (recommendation === 'removal_candidate') return { action: 'remove', target: '' }
  if (recommendation === 'keep') return { action: 'keep', target: '' }
  return { action: 'skip', target: '' }
}
