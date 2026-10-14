import { collection, doc, getDoc, getDocs, query, orderBy, runTransaction } from 'firebase/firestore'
import { ref, getMetadata, updateMetadata } from 'firebase/storage'
import { db, storage, authedUser } from './firebase'
import { CATALOGUE_IMAGE_CACHE_CONTROL, catalogueStoragePath, chooseGalleryHero, productHeroPatch } from './catalogueImagePolicy'

const heroState = p => ({ heroImage: p.heroImage || null, heroImage_visibility: p.heroImage_visibility ?? null, heroImage_branded_for_customer_id: p.heroImage_branded_for_customer_id || null })
const fingerprint = rows => JSON.stringify(rows.map(i => ({ id: i.id, ...productHeroPatch(i), is_hero: !!i.is_hero, sort_order: i.sort_order || 0 })).sort((a, b) => a.id.localeCompare(b.id)))

async function requireAdmin() {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const profile = await getDoc(doc(db, 'users', user.uid))
  if (!profile.exists() || profile.data().role !== 'admin') throw new Error('Only an administrator can repair catalogue images.')
}

async function inGroups(items, work, progress) {
  const result = []
  for (let i = 0; i < items.length; i += 4) {
    result.push(...await Promise.all(items.slice(i, i + 4).map(work)))
    progress?.(Math.min(i + 4, items.length), items.length)
  }
  return result
}

export async function previewCatalogueImageRepairs(onProgress) {
  await requireAdmin()
  const [products, ranges] = await Promise.all([getDocs(collection(db, 'products')), getDocs(collection(db, 'range_products'))])
  const bucket = ref(storage).bucket
  const objects = new Map()
  const addSource = (url, ownerCollection, ownerId) => {
    const path = catalogueStoragePath(url, bucket, ownerCollection, ownerId)
    if (path) objects.set(path, { path, ownerCollection, ownerId })
  }
  const galleries = await inGroups(products.docs, async p => {
    const snap = await getDocs(query(collection(db, 'products', p.id, 'images'), orderBy('sort_order')))
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    rows.forEach(i => addSource(i.file_url, 'products', p.id))
    return { id: p.id, product: p.data(), rows }
  }, (done, total) => onProgress?.({ phase: 'Checking main images', done, total }))
  ranges.docs.forEach(d => {
    const p = d.data()
    ;(p.gallery || []).forEach(g => addSource(typeof g === 'string' ? g : g.url || g.file_url, 'range_products', d.id))
    ;(p.variants || p.finishes || []).forEach(v => addSource(v.image, 'range_products', d.id))
  })
  const inspected = await inGroups([...objects.values()], async target => {
    try {
      const metadata = await getMetadata(ref(storage, target.path))
      return { ...target, exists: true, generation: metadata.generation, cacheControl: metadata.cacheControl || '', image: metadata.contentType?.startsWith('image/') }
    } catch (error) {
      return { ...target, exists: false, error: error.code || 'storage/read-failed' }
    }
  }, (done, total) => onProgress?.({ phase: 'Checking image caching', done, total }))
  const metadataByPath = new Map(inspected.map(i => [i.path, i]))
  const heroChanges = galleries.flatMap(({ id, product, rows }) => {
    // Preserve cache-only legacy products. Never invent a photo or URL.
    if (!rows.length) return []
    const available = rows.filter(i => {
      const path = catalogueStoragePath(i.file_url, bucket, 'products', id)
      return !path || metadataByPath.get(path)?.exists
    })
    if (!available.length) return []
    const chosen = chooseGalleryHero(available, product.heroImage)
    const after = productHeroPatch(chosen)
    const before = heroState(product)
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    return [{ id, name: product.name || id, before, after, galleryFingerprint: fingerprint(rows), imageIds: rows.map(i => i.id), chosenId: chosen?.id || null }]
  })
  return {
    products: products.size, ranges: ranges.size, inspected: inspected.length,
    heroChanges,
    cacheChanges: inspected.filter(i => i.exists && i.image && i.cacheControl !== CATALOGUE_IMAGE_CACHE_CONTROL),
    skipped: inspected.filter(i => !i.exists),
  }
}

export async function applyCatalogueImageRepairs(plan, onProgress) {
  await requireAdmin()
  const bucket = ref(storage).bucket
  const result = { heroes: 0, images: 0, skipped: [], failed: [] }
  await inGroups(plan.cacheChanges, async target => {
    try {
      // Revalidate the scope even if someone tampers with a preview in the UI.
      const prefix = target.ownerCollection === 'products' ? `products/${target.ownerId}/images/` : target.ownerCollection === 'range_products' ? `range_products/${target.ownerId}/` : null
      if (!prefix || !target.path.startsWith(prefix)) throw new Error('Invalid catalogue image scope.')
      const object = ref(storage, `gs://${bucket}/${target.path}`)
      const current = await getMetadata(object)
      if (current.generation !== target.generation) { result.skipped.push({ name: target.path, reason: 'Photo changed after preview.' }); return }
      if (current.cacheControl === CATALOGUE_IMAGE_CACHE_CONTROL) return
      const saved = await updateMetadata(object, { cacheControl: CATALOGUE_IMAGE_CACHE_CONTROL })
      if (saved.cacheControl !== CATALOGUE_IMAGE_CACHE_CONTROL) throw new Error('Image caching update could not be verified.')
      result.images++
    } catch (error) { result.failed.push({ name: target.path, reason: error.message }) }
  }, (done, total) => onProgress?.({ phase: 'Updating image caching', done, total }))
  await inGroups(plan.heroChanges, async target => {
    try {
      await runTransaction(db, async transaction => {
        const productRef = doc(db, 'products', target.id)
        const [product, ...images] = await Promise.all([
          transaction.get(productRef),
          ...target.imageIds.map(id => transaction.get(doc(db, 'products', target.id, 'images', id))),
        ])
        if (!product.exists() || images.some(i => !i.exists())) throw new Error('Catalogue changed after preview; scan again.')
        const rows = images.map(i => ({ id: i.id, ...i.data() }))
        if (JSON.stringify(heroState(product.data())) !== JSON.stringify(target.before) || fingerprint(rows) !== target.galleryFingerprint) throw new Error('Catalogue changed after preview; scan again.')
        const chosen = rows.find(i => i.id === target.chosenId) || null
        const after = productHeroPatch(chosen)
        if (JSON.stringify(after) !== JSON.stringify(target.after)) throw new Error('Main image changed after preview; scan again.')
        transaction.update(productRef, after)
      })
      result.heroes++
    } catch (error) { result.failed.push({ name: target.name, reason: error.message }) }
  }, (done, total) => onProgress?.({ phase: 'Updating main images', done, total }))
  return result
}
