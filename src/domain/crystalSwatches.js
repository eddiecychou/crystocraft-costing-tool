// Customer-safe sample records. A photograph is not a sellable inventory SKU.
export const SWATCH_COLLECTION = 'crystal_swatches'
export const SWATCH_STYLES = { fabric: 'Crystal Fabric', rock: 'Fine Rock / Rock', fine_rock: 'Fine Rock' }
export const MAX_SWATCH_BYTES = 20 * 1024 * 1024
export const SWATCH_CACHE_CONTROL = 'private, no-cache'

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(x => x.toString(16).padStart(2, '0')).join('')
}

export async function legacySampleId(colour, style, backing) {
  return 'sw_' + await sha256(new TextEncoder().encode(JSON.stringify([colour, style, backing])))
}

export function validatePhoto(bytes, type) {
  const b = new Uint8Array(bytes)
  const valid = type === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)
      : type === 'image/webp' && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP'
  if (!valid || !b.length || b.length > MAX_SWATCH_BYTES) throw Error('Choose a JPEG, PNG or WebP photograph up to 20 MB.')
}

export function swatchPaths(id, hash, type) {
  if (!/^sw_[a-zA-Z0-9_-]{16,80}$/.test(id) || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid sample identity.')
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type]
  if (!ext) throw Error('Unsupported photograph format.')
  const root = `crystal-swatches/${id}/${hash}`
  return { original: `${root}/original.${ext}`, display: `${root}/display.jpg`, thumbnail: `${root}/thumbnail.jpg` }
}

export function cleanSwatch(input) {
  const text = (key, max, required = true) => {
    const value = String(input[key] ?? '').trim()
    if ((required && !value) || value.length > max || value.includes('/')) throw Error(`Please check ${key.replaceAll('_', ' ')}.`)
    return value
  }
  const color_name = text('color_name', 100), notes_key = text('notes_key', 100)
  const backing_label = text('backing_label', 100), description = String(input.description || '').trim()
  if (description.length > 1000) throw Error('Description must be 1,000 characters or fewer.')
  if (!Object.hasOwn(SWATCH_STYLES, input.style)) throw Error('Choose the material type.')
  if (!['draft','published','archived'].includes(input.publication)) throw Error('Choose the sample visibility.')
  const sort_order = Number(input.sort_order || 0)
  if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 100000) throw Error('Display order must be between 0 and 100,000.')
  const rgb = input.rgb ?? [0.75,0.75,0.75]
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(x => !Number.isFinite(x) || x < 0 || x > 1)) throw Error('Invalid colour preview.')
  return { color_name, notes_key, backing_label, description, style:input.style, publication:input.publication, sort_order, rgb }
}

// Keep the legacy colour-grouped shape so both browsers retain their routes.
export function swatchesToRegistry(samples) {
  const registry = Object.create(null)
  for (const sample of samples.slice().sort((a,b) => a.sort_order-b.sort_order || a.id.localeCompare(b.id))) {
    const entry = registry[sample.color_name] ??= { rgb:sample.rgb, notes_key:sample.notes_key, slots:Object.create(null) }
    const slots = entry.slots[sample.style] ??= Object.create(null)
    const label = Object.hasOwn(slots,sample.backing_label) ? `${sample.backing_label} · ${sample.id}` : sample.backing_label
    slots[label] = { file:sample.media.thumbnail, display:sample.media.display, original:sample.media.original,
      sample_id:sample.id, backing_label:sample.backing_label, description:sample.description, revision:sample.revision }
  }
  return registry
}

export function assertSampleRevision(existing, expected) {
  if ((existing?.revision ?? 0) !== expected) throw Error('This sample changed in another window. Reload it before saving.')
}

// The archive includes the complete private backup. Only registered photos are
// candidates for publication; unregistered files/calibration remain in the run.
export async function prepareSwatchImport(zip) {
  const manifestFile = zip.file('migration-manifest.json')
  if (!manifestFile) throw Error('Choose the verified swatch migration ZIP.')
  const manifest = JSON.parse(await manifestFile.async('string'))
  if (manifest.schema_version !== 1 || !manifest.source_inventory || !manifest.registry_sha256) throw Error('Invalid migration manifest.')
  const registryFile = zip.file('data/colors/registry.json')
  if (!registryFile) throw Error('Registry is missing from the backup.')
  const registryBytes = await registryFile.async('uint8array')
  if (await sha256(registryBytes) !== manifest.registry_sha256) throw Error('Registry checksum does not match.')
  const inventoryKeys = Object.keys(manifest.source_inventory)
  if (!inventoryKeys.length || inventoryKeys.length > 2000) throw Error('Invalid backup inventory.')
  for (const path of inventoryKeys) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw Error('Unsafe backup path.')
    const file = zip.file('data/' + path)
    if (!file) throw Error(`Missing backup file: ${path}`)
    const bytes = await file.async('uint8array'), expected = manifest.source_inventory[path]
    if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256) throw Error(`Backup verification failed: ${path}`)
  }
  const registry = JSON.parse(new TextDecoder().decode(registryBytes)).crystal
  if (!registry || typeof registry !== 'object') throw Error('Invalid source registry.')
  const samples = [], ids = new Set(), usedFiles = new Set()
  for (const [colour, entry] of Object.entries(registry)) {
    const styles = entry.slots || Object.fromEntries(['fabric','rock','fine_rock'].filter(s=>entry[s]).map(s=>[s,entry[s]]))
    for (const [style, backings] of Object.entries(styles)) {
      for (const [backing, slot] of Object.entries(backings)) {
        if (!slot.file || !/^[a-zA-Z0-9_.-]+$/.test(slot.file)) throw Error('Invalid registered filename.')
        const path = 'colors/' + slot.file, source = manifest.source_inventory[path]
        if (!source) throw Error(`Missing registered image: ${slot.file}`)
        const bytes = await zip.file('data/'+path).async('uint8array')
        validatePhoto(bytes, 'image/jpeg')
        const id = await legacySampleId(colour,style,backing)
        if (ids.has(id)) throw Error('Duplicate sample identity.')
        ids.add(id); usedFiles.add(path)
        samples.push({ id, ...cleanSwatch({ color_name:colour, notes_key:colour, style, backing_label:backing,
          rgb:entry.rgb, sort_order:samples.length, publication:'published' }),
          bytes, type:'image/jpeg', source, source_file:slot.file, legacy_slot:slot })
      }
    }
  }
  if (!samples.length || samples.length > 1000) throw Error('Invalid sample count.')
  return { manifest, samples, colourCount:Object.keys(registry).length,
    extraFiles:inventoryKeys.filter(p => p.startsWith('colors/') && p !== 'colors/registry.json' && !usedFiles.has(p)),
    manifestHash:await sha256(new TextEncoder().encode(JSON.stringify(manifest))) }
}
