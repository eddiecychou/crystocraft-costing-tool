// Print pagination is driven by the actual, font-loaded text measurements supplied
// by CatalogueProductPages. Never estimate fit from character counts or cut copy.
export function catalogueImages(item) {
  const selected = Array.isArray(item.selected_images)
    ? item.selected_images : item.hero_image ? [item.hero_image] : []
  return [...new Set(selected.filter(url => typeof url === 'string' && url))]
}

export const CATALOGUE_IMAGE_SIZES = ['standard', 'large', 'full']

export function catalogueImageSize(item, url) {
  const choice = Array.isArray(item.image_layouts) ? item.image_layouts.find(row => row?.url === url)?.size : null
  return CATALOGUE_IMAGE_SIZES.includes(choice) ? choice : 'standard'
}

// URL identity keeps the setting attached during reorder/deselect/reselect.
// Return only the layout field, never a replacement product/item snapshot.
export function withCatalogueImageSize(item, url, size) {
  if (!CATALOGUE_IMAGE_SIZES.includes(size)) throw new Error('Choose Standard, Large or Full page.')
  if (!catalogueImages(item).includes(url)) throw new Error('This image is no longer selected. Reopen the catalogue before changing its size.')
  const rows = Array.isArray(item.image_layouts) ? item.image_layouts : []
  const existing = rows.find(row => row?.url === url)
  return [...rows.filter(row => row?.url !== url), { ...existing, url, size }]
}

export function catalogueImageOrientation(dimensions) {
  if (!(dimensions?.width > 0 && dimensions?.height > 0)) throw new Error('An image could not load. Reopen the preview before printing.')
  return dimensions.height > dimensions.width ? 'portrait' : 'landscape'
}

export function catalogueBlocks(item) {
  return [
    { kind: 'marketing', text: item.marketing_description ?? item.product_marketing_description ?? '' },
    { kind: 'spec', text: item.product_description ?? '' },
  ].filter(block => block.text !== '').map(block => ({ ...block, text: String(block.text) }))
}

// Split on Unicode code points, preferably at a word boundary. The two pieces
// concatenate to the EXACT original, including newlines, spaces and punctuation.
export function splitCatalogueText(text, fits) {
  const points = Array.from(text)
  let low = 0, high = points.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits(points.slice(0, mid).join(''))) low = mid
    else high = mid - 1
  }
  let end = low
  if (end < points.length) {
    for (let i = end; i > end * 0.8; i--) {
      if (/\s/u.test(points[i - 1])) { end = i; break }
    }
  }
  return [points.slice(0, end).join(''), points.slice(end).join('')]
}

function takeBlocks(item, blocks, mode, continued, fits) {
  const taken = []
  const rest = blocks.map(block => ({ ...block }))
  while (rest.length) {
    const next = rest[0]
    if (fits(mode, item, [...taken, next], continued)) {
      taken.push(rest.shift())
      continue
    }
    const [head, tail] = splitCatalogueText(next.text, text =>
      fits(mode, item, [...taken, { ...next, text }], continued))
    if (head) {
      taken.push({ ...next, text: head })
      rest[0] = { ...next, text: tail, continued: true }
    }
    break
  }
  if (blocks.length && !taken.length) {
    throw new Error(`The heading for “${String(item.product_name || 'Untitled product').slice(0, 80)}” leaves no room for its text. Shorten the heading before printing.`)
  }
  return [taken, rest]
}

export function planCataloguePages(items, fits, imageDimensions = {}) {
  const entries = items.map((item, index) => ({ item, number: index + 1, images: catalogueImages(item), blocks: catalogueBlocks(item) }))
  const pages = []
  const canShare = (entry, mode) => entry && entry.item.layout_mode !== 'feature'
    && entry.images.length <= 1
    && entry.images.every(url => catalogueImageSize(entry.item, url) === 'standard')
    && fits(mode, entry.item, entry.blocks, false)
  for (let i = 0; i < entries.length;) {
    const four = entries.slice(i, i + 4)
    if (four.length === 4 && four.every((entry, j) => canShare(entry, 'overview') && (!j || !entry.item.page_break_before))) {
      pages.push({ type: 'overview', entries: four })
      i += 4
      continue
    }
    const pair = entries.slice(i, i + 2)
    if (pair.length === 2 && pair.every(entry => canShare(entry, 'standard')) && !pair[1].item.page_break_before) {
      pages.push({ type: 'standard', entries: pair })
      i += 2
      continue
    }
    const entry = entries[i++]
    let images = [...entry.images], blocks = [...entry.blocks], continued = false
    const addPage = (type, photos, text, orientation = 'landscape') => {
      if (!fits(type, entry.item, [], continued, orientation)) throw new Error(`The heading for “${String(entry.item.product_name || 'Untitled product').slice(0, 80)}” is too long for a page.`)
      pages.push({ type, orientation, entries: [{ ...entry, images: photos, blocks: text, continued }] })
      continued = true
    }
    // A standard first image remains the hero beside the complete product copy.
    // Supporting images now have gallery space, never a thumbnail strip.
    if (images.length && catalogueImageSize(entry.item, images[0]) === 'standard') {
      const [text, rest] = takeBlocks(entry.item, blocks, 'feature', false, fits)
      addPage('feature', images.splice(0, 1), text)
      blocks = rest
    } else if (!images.length && !blocks.length) addPage('details', [], [])

    // Keep text readable and together before the remaining picture pages.
    // When the first image is explicitly enlarged, it leads the product first.
    const addImagePage = () => {
      const size = catalogueImageSize(entry.item, images[0])
      const maximum = size === 'full' ? 1 : size === 'large' ? 2 : 4
      const nextSize = images.findIndex(url => catalogueImageSize(entry.item, url) !== size)
      const runLength = nextSize < 0 ? images.length : nextSize
      const count = Math.ceil(runLength / Math.ceil(runLength / maximum))
      const photos = []
      while (images.length && photos.length < count) photos.push(images.shift())
      const orientation = size === 'full' ? catalogueImageOrientation(imageDimensions[photos[0]]) : 'landscape'
      addPage(size === 'standard' ? 'gallery' : size, photos, [], orientation)
    }
    if (!continued && images.length) addImagePage()
    while (blocks.length) {
      const [text, rest] = takeBlocks(entry.item, blocks, 'details', continued, fits)
      addPage('details', [], text)
      blocks = rest
    }
    while (images.length) addImagePage()
  }
  return pages
}

// These are the same dimensions as cataloguePrintStyles.js, applied to the measured
// A4 body rather than the screen-scaled preview.
export function catalogueCopySpace(mode, width, height, hasImages = true) {
  if (mode === 'overview') return { width: (width - 32) / 2 - (hasImages ? 168 : 0), height: (height - 24) / 2 }
  if (mode === 'standard') return { width: (width - 32) / 2, height: height - (hasImages ? 336 : 0) }
  if (mode === 'feature') return { width: (width - 32) / 2.6, height }
  if (mode === 'gallery' || mode === 'large') return { width, height: 160 }
  if (mode === 'full') return { width, height: 96 }
  return { width: Math.min(720, width), height }
}
