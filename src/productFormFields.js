import { productStatusOf, normVideos, normBlogLinks } from './constants.js'
import { engineTypeOf } from './customizerEngines.js'
export const PRODUCT_FORM_DEFAULTS = {
  name: '', product_code: '', category: '', status: 'concept', description: '', marketing_description: '',
  assembly_notes: '', videos: [], blog_links: [], is_new: false, customizer_type: '', active: true,
}
export function productFormFields(record = {}) {
  const fields = Object.fromEntries(Object.entries(PRODUCT_FORM_DEFAULTS).map(([key, fallback]) => [key, record[key] ?? fallback]))
  return { ...fields, status: productStatusOf(record.status).value, videos: normVideos(record.videos, record.video_url),
    blog_links: normBlogLinks(record.blog_links), customizer_type: engineTypeOf(record) }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export function productFormPatch(baseline, draft, current) {
  if (!current) throw Error('This product no longer exists. Your draft has been kept.')
  const latest = productFormFields(current), clean = productFormFields(draft), patch = {}, conflicts = []
  for (const field of Object.keys(PRODUCT_FORM_DEFAULTS)) {
    if (equal(clean[field], baseline[field])) continue
    if (!equal(latest[field], baseline[field]) && !equal(latest[field], clean[field])) conflicts.push(field)
    else patch[field] = clean[field]
  }
  if (conflicts.length) throw Error(`Not saved: another person changed ${conflicts.join(', ')}. Your draft has been kept. Review the latest product in a new tab before retrying.`)
  if (patch.videos) patch.video_url = patch.videos[0] || ''
  return patch
}
