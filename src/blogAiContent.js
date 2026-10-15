const nonempty = value => typeof value === 'string' && Boolean(value.trim())
const section = value => value && typeof value === 'object' && nonempty(value.body)
  && (value.heading === null || typeof value.heading === 'string')
export function validateBlogContent(data, type, products = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !['seo_title','meta_description','slug','focus_keyword'].every(k => nonempty(data[k]))
    || !Array.isArray(data.tags) || !data.tags.length || !data.tags.every(nonempty)) throw new Error('The AI returned an incomplete blog draft. Please try again. Your existing draft has been kept.')
  if (type === 'spotlight') {
    const types = ['intro','product_story','use_cases','customisation','cta']
    if (!nonempty(data.hero_alt_text) || !Array.isArray(data.sections) || data.sections.length !== types.length
      || !data.sections.every(s => section(s) && types.includes(s.type))
      || new Set(data.sections.map(s => s.type)).size !== types.length) throw new Error('The AI returned incomplete blog sections. Please try again. Your existing draft has been kept.')
  } else if (type === 'roundup') {
    const names = products.map(p => p.name.trim().toLowerCase()).sort()
    if (!section(data.intro) || !section(data.conclusion) || !Array.isArray(data.items) || data.items.length !== products.length
      || !data.items.every(i => section(i) && nonempty(i.product_name) && typeof i.image_caption === 'string')
      || JSON.stringify(data.items.map(i => i.product_name.trim().toLowerCase()).sort()) !== JSON.stringify(names)) throw new Error('The AI did not return every selected product correctly. Please try again. Your existing draft has been kept.')
  } else throw new Error('Unsupported blog type.')
  return data
}
