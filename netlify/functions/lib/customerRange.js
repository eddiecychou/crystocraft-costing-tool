import { wsPriceFactor } from '../../../src/domain/wholesalePrice.js'

const string = value => typeof value === 'string' ? value : ''
const list = value => Array.isArray(value) ? value : []
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null

// Older published designs predate the Visible checkbox. An explicit false or
// sold-out retirement always withdraws the design, including old bookmarks.
export const visibleRange = p => !!p && (p.active === true || p.active === undefined) && p.status !== 'retired'

export function projectRangeProduct(id, p, profile) {
  if (!visibleRange(p)) return null
  const raw = list(p.variants).length ? p.variants : list(p.finishes)
  const variants = raw.filter(Boolean).map(v => {
    const colours = list(v.crystal_colors).filter(c => typeof c === 'string')
    const price = number(v.ws_price_usd)
    return {
      brand_code: string(v.brand_code), brand_name: string(v.brand_name),
      plating_code: string(v.plating_code), plating_name: string(v.plating_name || v.finish_name),
      sku: string(v.sku), image: string(v.image), crystal_colors: colours,
      colour_images: Object.fromEntries(colours.filter(c => string(v.colour_images?.[c])).map(c => [c, v.colour_images[c]])),
      customer_price_usd: price === null ? null : price * wsPriceFactor(profile),
    }
  })
  const colours = new Set(variants.flatMap(v => v.crystal_colors))
  return {
    id, variants, design_code: string(p.design_code), design_no: string(p.design_no) || number(p.design_no),
    design_name: string(p.design_name), format_code: string(p.format_code) || number(p.format_code),
    description: string(p.description), marketing_description: string(p.marketing_description),
    design_type: string(p.design_type), category: string(p.category), status: string(p.status),
    size: string(p.size), is_new: p.is_new === true, moq: number(p.moq),
    packing: { pcs_per_carton: number(p.packing?.pcs_per_carton) },
    crystal_mixes: Object.fromEntries([...colours].filter(c => Array.isArray(p.crystal_mixes?.[c]))
      .map(c => [c, p.crystal_mixes[c].filter(x => typeof x === 'string')])),
    gallery: list(p.gallery).map(g => ({ url: string(g?.url || g), caption: string(g?.caption) })).filter(g => g.url),
    videos: list(p.videos).map(v => string(v?.url || v)).filter(Boolean), video_url: string(p.video_url),
    blog_links: list(p.blog_links).map(l => ({ url: string(l?.url || l), label: string(l?.label) })).filter(l => l.url),
  }
}

export async function loadCustomerRange(db, id, profile) {
  const ref = db.collection('range_products')
  const docs = id ? [await ref.doc(id).get()] : (await ref.orderBy('design_code').get()).docs
  return docs.map(d => projectRangeProduct(d.id, d.data(), profile)).filter(Boolean)
}

export function rangeFeaturedItem(item, p) {
  const url = item.image_url
  if (!p || !url || !(p.gallery.some(g => g.url === url) || p.variants.some(v => v.image === url || Object.values(v.colour_images).includes(url)))) return null
  return { id: string(item.id), product_type: 'range', product_id: p.id, image_url: url,
    name: p.design_name || p.description || p.design_code || p.id, is_new: p.is_new }
}
