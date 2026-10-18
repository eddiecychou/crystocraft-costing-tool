// One catalogue range projected from the existing published sample library.
// Photographs remain references, not manufactured variants or stock SKUs.
export const FABRIC_ROUTE = '/shop/crystal-components/fabric'
export const FABRIC_DESCRIPTION = 'Crystal Fabric for custom decorative applications. Explore real photographed colours, materials and backings. Quoted individually from your actual drawing and intended application; dimensions, adhesive and effects are confirmed with your project.'
export const FABRIC_STYLE_LABELS = {fabric:'Crystal Fabric',rock:'Fine Rock / Rock',fine_rock:'Fine Rock'}
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max)

export function fabricCatalogueEntry(samples) {
  const published = samples.filter(s => s.publication === 'published' && s.media?.display && s.media?.thumbnail)
    .sort((a,b) => (a.style === 'fabric' ? 0 : 1) - (b.style === 'fabric' ? 0 : 1) || (a.sort_order || 0) - (b.sort_order || 0) || a.id.localeCompare(b.id))
  if (!published.length) return null
  const cover = published[0]
  return {id:'fabric', catalogue_kind:'fabric', name:'Crystal Fabric', code:'', description:FABRIC_DESCRIPTION,
    family:'fabric', origin:'crystocraft', supply:'made_to_order', shape:'', sort_order:100,
    image_path:cover.media.thumbnail, hero_media:cover.media, cover_sample_id:cover.id,
    colours:[...new Set(published.map(s => s.color_name))].sort(),
    materials:[...new Set(published.map(s => FABRIC_STYLE_LABELS[s.style] || s.style))], variants:[]}
}

export function fabricEnquiryLine(sample = null, {application = '', note = ''} = {}) {
  if (sample && (sample.publication !== 'published' || !sample.id || !Number.isInteger(sample.revision) || sample.revision < 1)) throw Error('Please reselect a published reference sample.')
  return {type:'crystal_fabric', id:'fabric', source_collection:'crystal_swatches', name:'Crystal Fabric', code:'',
    description_snapshot:sample ? ['Project quotation', sample.color_name, FABRIC_STYLE_LABELS[sample.style] || sample.style, 'Backing: '+sample.backing_label].join(' · ') : 'Project quotation · reference sample to be confirmed',
    unit:'project', qty:1, image:'', image_path:sample?.media?.thumbnail || '',
    swatch_sample_id:sample?.id || '', swatch_revision:sample?.revision || null,
    application:text(application), note:text(note), ws_price_usd:null}
}

export function fabricEnquirySnapshot(item) {
  return {source_collection:'crystal_swatches', unit:'project', description_snapshot:text(item.description_snapshot,1000),
    image_path:text(item.image_path,600), swatch_sample_id:text(item.swatch_sample_id,128),
    swatch_revision:Number(item.swatch_revision) || null, application:text(item.application)}
}

export const fabricCartKey = item => JSON.stringify(['crystal_fabric','fabric',item.swatch_sample_id || ''])
