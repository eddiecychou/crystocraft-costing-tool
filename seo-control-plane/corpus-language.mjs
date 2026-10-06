// Read-only script-ratio audit of EXISTING published WordPress translations.
// Shared by the admin SEO state route and local tests. Never infers language
// from a payload that has not yet been written.
const TEXT_SETTINGS = ['editor', 'title', 'text', 'description_text', 'caption']
const HAN = /\p{Script=Han}/u
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const LATIN = /\p{Script=Latin}/u

const plain = value => String(value ?? '')
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(?:nbsp|amp|quot|lt|gt|#\d+|#x[\da-f]+);/gi, ' ')

function* widgets(nodes) {
  if (Array.isArray(nodes)) { for (const node of nodes) yield* widgets(node); return }
  if (!nodes || typeof nodes !== 'object') return
  if (nodes.settings && typeof nodes.settings === 'object') {
    for (const key of TEXT_SETTINGS) {
      if (typeof nodes.settings[key] === 'string' && nodes.settings[key].trim()) {
        yield { field: `elementor.${nodes.id || '?'}.${key}`, value: nodes.settings[key] }
      }
    }
  }
  if (nodes.elements) yield* widgets(nodes.elements)
}

const metaValue = (entity, key) => Array.isArray(entity.meta_data)
  ? entity.meta_data.find(item => item?.key === key)?.value
  : entity.meta?.[key]

export function corpusFields(entity, kind) {
  const fields = kind === 'product'
    ? [
      { field: 'post_content', value: entity.description },
      { field: 'post_excerpt', value: entity.short_description },
    ]
    : [
      { field: 'post_content', value: entity.content?.raw ?? entity.content },
      { field: 'post_excerpt', value: entity.excerpt?.raw ?? entity.excerpt },
    ]
  const raw = metaValue(entity, '_elementor_data')
  if (raw != null && raw !== '') {
    try { fields.push(...widgets(typeof raw === 'string' ? JSON.parse(raw) : raw)) }
    catch { fields.push({ field: '_elementor_data', error: 'invalid Elementor JSON' }) }
  }
  return fields
}

function ratioFromCounts(counts, lang) {
  const script = lang === 'ja' ? counts.han + counts.kana : counts.han
  const letters = counts.han + counts.kana + counts.latin
  const ratio = letters ? script / letters : null
  let flagged = false
  if (letters) {
    if (lang === 'zh-hant' || lang === 'zh-hans') flagged = counts.han / letters < 0.40
    else if (lang === 'ja') flagged = ratio < 0.30
    else if (lang === 'es' || lang === 'fr') flagged = (counts.han + counts.kana) / letters > 0.05
    else if (lang === 'en') flagged = (counts.han + counts.kana) / letters > 0.40
  }
  return { ...counts, letters, ratio, flagged }
}

export function scriptRatio(value, lang) {
  const counts = { han: 0, kana: 0, latin: 0 }
  for (const char of plain(value)) {
    if (HAN.test(char)) counts.han++
    else if (KANA.test(char)) counts.kana++
    else if (LATIN.test(char)) counts.latin++
  }
  return ratioFromCounts(counts, lang)
}

export function auditCorpusRow(entity, kind, lang) {
  const elementorVisible = metaValue(entity, '_elementor_data') !== undefined
  const rawBodyVisible = kind === 'product' || (typeof entity.content?.raw === 'string' && typeof entity.excerpt?.raw === 'string')
  const fields = corpusFields(entity, kind).map(({ field, value, error }) => ({
    field, ...(error ? { error, flagged: true } : scriptRatio(value, lang)),
  }))
  const counts = fields.reduce((sum, f) => ({
    han: sum.han + (f.han || 0), kana: sum.kana + (f.kana || 0), latin: sum.latin + (f.latin || 0),
  }), { han: 0, kana: 0, latin: 0 })
  const aggregate = ratioFromCounts(counts, lang)
  return {
    id: entity.id, kind, lang, status: entity.status, link: entity.permalink || entity.link || '',
    ...aggregate, flagged: aggregate.flagged || fields.some(f => f.flagged),
    coverage: { elementor_meta_visible: elementorVisible, raw_body_visible: rawBodyVisible },
    fields: fields.filter(f => f.flagged || f.error),
  }
}
