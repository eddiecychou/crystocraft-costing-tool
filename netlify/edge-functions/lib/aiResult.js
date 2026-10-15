export function completedAiText(data) {
  const candidate = data?.candidates?.[0]
  if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete AI response')
  const text = (candidate.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim()
  if (!text) throw new Error('Empty AI response')
  return text
}
export const completedAiJson = data => JSON.parse(completedAiText(data))
export function limitAiCopy(text, budget) {
  const body = text.trim()
  if (body.length <= budget) return body
  const cut = body.slice(0, Math.max(0, budget - 1))
  return (cut.replace(/\s+\S*$/, '').trimEnd() || cut.trimEnd()) + '…'
}
export function blogResponseSchema(type) {
  const string = { type:'STRING' }
  const section = { type:'OBJECT', properties:{ heading:{type:'STRING',nullable:true}, body:string }, required:['heading','body'] }
  const properties = { seo_title:string, meta_description:string, slug:string, focus_keyword:string, tags:{type:'ARRAY',items:string} }
  if (type === 'spotlight') Object.assign(properties, { hero_alt_text:string, sections:{type:'ARRAY',items:{type:'OBJECT',properties:{type:string,...section.properties},required:['type','heading','body']}} })
  else Object.assign(properties, { intro:section, conclusion:section, items:{type:'ARRAY',items:{type:'OBJECT',properties:{product_name:string,...section.properties,image_caption:string},required:['product_name','heading','body','image_caption']}} })
  return {type:'OBJECT',properties,required:Object.keys(properties)}
}
