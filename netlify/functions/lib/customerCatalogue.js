import { customerContext, privateJson, validId } from './customerAccess.js'

// Explicit projection, including nested objects. Never spread a Firestore record.
const str = v => typeof v === 'string' ? v : ''
const numeric = v => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null
export function projectCorporateProduct(p, images, price, viewer) {
  if (!p || p.active === false || ['retired', 'discontinued'].includes(p.status)) return null
  const gallery = images.filter(im => im.file_url && (!im.visibility || ['public', 'private'].includes(im.visibility))
    && (!viewer.sensitive || !im.branded_for_customer_id || im.branded_for_customer_id === viewer.customerId))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || str(a.id).localeCompare(str(b.id)))
    .map(im => ({ id: str(im.id), file_url: str(im.file_url), caption: str(im.caption),
      visibility: im.visibility === 'public' ? 'public' : 'private', is_hero: im.is_hero === true,
      branded_for_customer_id: str(im.branded_for_customer_id) }))
  const hero = gallery.find(im => im.file_url === p.heroImage) || gallery.find(im => im.is_hero) || gallery[0]
  return {
    id: str(p.id), name: str(p.name), product_code: str(p.product_code), category: str(p.category),
    description: str(p.description), marketing_description: str(p.marketing_description),
    status: str(p.status), active: true, is_new: p.is_new === true,
    customizer_type: str(p.customizer_type), customizable: p.customizable === true,
    videos: Array.isArray(p.videos) ? p.videos.filter(v => typeof v === 'string') : [], video_url: str(p.video_url),
    blog_links: Array.isArray(p.blog_links) ? p.blog_links.map(l => ({ url: str(l?.url), label: str(l?.label) })) : [],
    heroImage: hero?.file_url || null, images: gallery,
    tiers: (Array.isArray(price?.tiers) ? price.tiers : []).filter(t => numeric(t.price_hkd) > 0)
      .map(t => ({ quantity: numeric(t.quantity), price_hkd: numeric(t.price_hkd), lead_time_days: numeric(t.lead_time_days) }))
      .sort((a, b) => a.quantity - b.quantity),
  }
}
export function createCustomerCatalogueHandler(deps) {
  return async req => {
    if (req.method !== 'GET') return privateJson({ error: 'Method not allowed.' }, 405)
    try {
      const ctx = await customerContext(req, deps)
      const url = new URL(req.url), id = url.searchParams.get('id')
      if (id !== null && !validId(id)) return privateJson({ error: 'Invalid product.' }, 400)
      const records = await deps.load(id, ctx.uid)
      const products = records.map(({ product, images, price }) => projectCorporateProduct(product, images, price,
        { customerId: ctx.customerId, sensitive: ctx.customer ? ctx.customer.sensitive === true : ctx.profile.sensitive === true }))
        .filter(Boolean)
      // Featured corporate image URLs must pass the same live visibility check.
      const featured = await deps.loadFeatured()
      const byId = new Map(products.map(p => [p.id, p]))
      const items = (featured?.items || []).flatMap(it => {
        if (it.product_type !== 'corp_gift') return [{ id: str(it.id), product_type: 'range', product_id: str(it.product_id), image_url: str(it.image_url) }]
        const p = byId.get(it.product_id), im = p?.images.find(im => im.file_url === it.image_url)
        return im ? [{ id: str(it.id), product_type: 'corp_gift', product_id: p.id, image_url: im.file_url }] : []
      })
      return privateJson({ products, featured: { items } })
    } catch (e) { return privateJson({ error: e.status ? e.message : 'Catalogue could not load. Please try again.' }, e.status || 503) }
  }
}
export async function loadCorporateCatalogue(db, id, uid) {
  const docs = id ? [await db.doc('products/' + id).get()] : (await db.collection('products').get()).docs
  const results = []
  // Bound concurrency to avoid one connection per product on large catalogues.
  for (let i = 0; i < docs.length; i += 20) {
    results.push(...await Promise.all(docs.slice(i, i + 20).filter(d => d.exists).map(async d => {
      const product = { ...d.data(), id: d.id }
      if (product.active === false || ['retired', 'discontinued'].includes(product.status)) return { product, images: [] }
      const [images, price] = await Promise.all([d.ref.collection('images').get(), d.ref.collection('customer_prices').doc(uid).get()])
      return { product, images: images.docs.map(im => ({ ...im.data(), id: im.id })), price: price.data() }
    })))
  }
  return results
}
