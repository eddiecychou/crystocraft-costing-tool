// Print pagination is driven by the actual, font-loaded text measurements supplied
// by CatalogueProductPages. Never estimate fit from character counts or cut copy.
export function catalogueImages(item) {
  const selected = Array.isArray(item.selected_images)
    ? item.selected_images : item.hero_image ? [item.hero_image] : []
  return [...new Set(selected.filter(url => typeof url === 'string' && url))]
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

export function planCataloguePages(items, fits) {
  const entries = items.map((item, index) => ({ item, number: index + 1, images: catalogueImages(item), blocks: catalogueBlocks(item) }))
  const pages = []
  const canShare = (entry, mode) => entry && entry.item.layout_mode !== 'feature'
    && entry.images.length <= (mode === 'overview' ? 2 : 4)
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
    do {
      const count = continued ? 6 : images.length > 6 ? 4 : 6
      const photos = images.splice(0, count)
      const type = photos.length ? (continued && !blocks.length ? 'gallery' : 'feature') : 'details'
      if (!fits(type, entry.item, [], continued)) throw new Error(`The heading for “${String(entry.item.product_name || 'Untitled product').slice(0, 80)}” is too long for a page.`)
      const [text, rest] = takeBlocks(entry.item, blocks, type, continued, fits)
      pages.push({ type, entries: [{ ...entry, images: photos, blocks: text, continued }] })
      blocks = rest
      continued = true
    } while (images.length || blocks.length)
  }
  return pages
}

// These are the same dimensions as cataloguePrintStyles.js, applied to the measured
// A4 body rather than the screen-scaled preview.
export function catalogueCopySpace(mode, width, height, hasImages = true) {
  if (mode === 'overview') return { width: (width - 32) / 2 - (hasImages ? 168 : 0), height: (height - 24) / 2 }
  if (mode === 'standard') return { width: (width - 32) / 2, height: height - (hasImages ? 336 : 0) }
  if (mode === 'feature') return { width: (width - 32) / 2.6, height }
  if (mode === 'gallery') return { width, height: 160 }
  return { width: Math.min(720, width), height }
}
