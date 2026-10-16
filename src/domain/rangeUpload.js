import { buildRangeSku, enumerateRangeSkus } from '../rangeSku.js'
import { RANGE_CRYSTAL_BRANDS, RANGE_FORMAT_CODES, RANGE_PLATINGS, RANGE_DESIGN_TYPES, RANGE_PRODUCT_TYPES, RANGE_COMPONENT_CATEGORIES } from '../constants.js'

export const RANGE_UPLOAD_UID = 'mcp-range-upload-service'
export const MAX_CATALOGUE = 2000
export const MAX_CODES = 200
export class RangeUploadError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
export const reject = (code, message, status = 400) => { throw new RangeUploadError(code, message, status) }
export function only(value, keys, label = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_INPUT', `${label} must be an object`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) reject('UNSUPPORTED_FIELD', `${label}.${key} is not writable`)
}
export function text(value, label, max = 200) {
  if (typeof value !== 'string' || value.length > max) reject('INVALID_INPUT', `${label} must be a string of at most ${max} characters`)
  return value.trim()
}
export function docId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) reject('INVALID_ID', 'A stable document ID is required, never a path')
  return value
}
export function familyKey(product) {
  const design = String(product.design_no || ''), format = String(product.format_code || '')
  if (!/^[0-9]{3,4}$/.test(design) || !/^[0-9]{3}$/.test(format)) reject('INVALID_FAMILY_CODE', 'Use an exact 3/4 digit design number and 3 digit format, retaining leading zeros')
  return `${design}-${format}`
}
export const punctuationKey = code => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')
export function componentCode(code) {
  if (typeof code !== 'string' || !/^[A-Z0-9][A-Z0-9()._/-]{1,79}$/.test(code)) reject('INVALID_COMPONENT_CODE', 'Use the exact uppercase library code, including punctuation')
  return code
}
export function variantId(row, index) { return typeof row.id === 'string' && row.id ? row.id : `legacy_${index}` }
export function codesOf(product) {
  return [...new Set([...enumerateRangeSkus(product).map(v => v.sku), ...(product.variants || []).map(v => v.sku)].filter(Boolean))]
}
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const select = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]))
export function publicFamily(row) {
  if (!row) return null
  const p = row.data
  return { id: row.id, version: row.version, updated_at: p.updatedAt?.toDate?.().toISOString() || null,
    ...select(p, ['design_no','design_code','body_code','format_code','design_name','description','marketing_description','size','dimensions','category','design_type','product_type','crystal_type','status','active','gallery','videos','video_url','moq','lead_time_weeks','delivery_note','plating_stock']),
    variants: (p.variants || []).map((v, index) => ({ ...select(v, ['brand_code','brand_name','plating_code','plating_name','crystal_code','crystal_name','running_no','sku','crystal_colors','ws_price_usd','image','colour_images','description','stock_finished']), variant_id: variantId(v, index), price_state: v.ws_price_usd == null ? 'unpriced' : 'priced' })),
    critical_components: (p.critical_components || []).map((ref, ref_index) => ({ ...select(ref, ['id','code','qty_per_unit','plating_code','all_variants','crystal_code','crystal_codes']), ref_index })),
    item_codes: enumerateRangeSkus(p).map(v => v.sku),
    price_state: (p.variants || []).some(v => v.ws_price_usd != null) ? 'priced' : 'unpriced',
  }
}
export function publicComponent(row, linked = []) {
  return { id: row.id, version: row.version, ...select(row.data, ['code','name','category','plating_code']), already_linked: linked.includes(row.id) }
}
const all = (list, extra) => [...new Set([...list, ...extra].filter(Boolean))]
const invalid = (out, code, field, message) => out.missing_facts.push({ code, field, message })
const conflict = (out, code, message, ids = []) => out.conflicts.push({ code, message, ids })
const sizeOf = d => [d.length, d.width, d.height].map(n => String(Math.round(n * (d.unit === 'mm' ? 0.1 : 1) * 10000) / 10000)).join(' × ') + ' cm'
const rowKeys = ['variant_id','brand_code','plating_code','crystal_colors','crystal_code','running_no','no_crystal']

// Pure planner. Existing private documents are never returned or embedded in tokens.
// Internal `patch` is rebuilt from fresh storage in the commit transaction.
export function planRangeUpload(input, ctx) {
  only(input, ['mode','range_id','expected_version','family','variants','components','media','category_confirmations','code_confirmations','dry_run'])
  if (!['create','update'].includes(input.mode) || input.dry_run !== true) reject('INVALID_INPUT', 'Specify create/update and dry_run:true')
  const out = { existing: null, proposed: null, conflicts: [], missing_facts: [], warnings: [], diff: [], safe_to_commit: false, new_components: [], dependencies: {} }
  let target = null
  if (input.mode === 'update') {
    docId(input.range_id)
    target = ctx.products.find(r => r.id === input.range_id)
    if (!target) reject('NOT_FOUND', 'Range family not found', 404)
    if (typeof input.expected_version !== 'string' || input.expected_version !== target.version) reject('STALE_VERSION', 'Family changed; get a fresh readback and dry run', 409)
    out.existing = publicFamily(target); out.dependencies[`range_products/${target.id}`] = target.version
  } else if (input.range_id !== undefined || input.expected_version !== undefined) reject('INVALID_INPUT', 'Create does not accept an existing ID/version')
  const old = target?.data || {}
  const patch = {}
  const f = input.family || {}
  only(f, ['design_no','format_code','design_name','description','marketing_description','dimensions','category','design_type','product_type','crystal_type'], 'family')
  for (const key of ['design_no','format_code','design_name','description','marketing_description','category','design_type','product_type','crystal_type']) {
    if (f[key] !== undefined) patch[key] = text(f[key], key, key === 'description' ? 12000 : key === 'marketing_description' ? 300 : 200)
  }
  if (target && ['design_no','format_code'].some(k => patch[k] !== undefined && patch[k] !== old[k])) reject('IDENTITY_CHANGE', 'V1 corrects a family in place; design/format renames need separate review', 409)
  let product = target ? { ...old, ...patch } : { design_no: '', format_code: '', design_name: '', description: '', marketing_description: '', category: '', design_type: '', product_type: '', crystal_type: '', size: '', status: 'concept', active: false, variants: [], critical_components: [], gallery: [], ...patch }
  for (const key of ['design_no','format_code','design_name','description','design_type','product_type']) if (!product[key]) invalid(out, 'REQUIRED_FACT', key, `${key} is required`)
  let key
  try { key = familyKey(product) } catch (e) { invalid(out, e.code, 'family', e.message) }
  if (key) {
    const existing = ctx.products.filter(r => r.id !== target?.id && r.data.design_no === product.design_no && r.data.format_code === product.format_code)
    if (existing.length) conflict(out, 'FAMILY_EXISTS', 'Use a bounded update of the existing family, never a second family', existing.map(r => r.id))
    if (ctx.legacyReleaseActive) conflict(out, 'LEGACY_RELEASE_ACTIVE', 'The independent B0016 release window is active')
  }
  const confirmations = input.category_confirmations || [], codeConfirmations = input.code_confirmations || []
  for (const a of [confirmations, codeConfirmations]) if (!Array.isArray(a) || a.length > 20 || a.some(v => typeof v !== 'string' || v.length > 200)) reject('INVALID_INPUT', 'Confirmations must be bounded string lists')
  for (const [field, defaults] of [['design_type', RANGE_DESIGN_TYPES], ['product_type', RANGE_PRODUCT_TYPES], ['category', []]]) {
    const known = all(defaults, ctx.products.map(r => r.data[field]))
    if (product[field] && !known.includes(product[field]) && !confirmations.includes(`${field}:${product[field]}`)) invalid(out, 'CONFIRM_NEW_CATEGORY', field, 'The form permits a new value; confirm its exact field:name before committing')
  }
  if (product.format_code && !all(RANGE_FORMAT_CODES.map(v => v.code), ctx.products.map(r => r.data.format_code)).includes(product.format_code)
    && !codeConfirmations.includes(`format:${product.format_code}`)) invalid(out, 'CONFIRM_FORMAT', 'format_code', 'Confirm this exact form-supported format code')
  if (f.dimensions !== undefined) {
    only(f.dimensions, ['length','width','height','unit','overall_confirmed'], 'dimensions')
    const d = f.dimensions
    if (!['cm','mm'].includes(d.unit) || d.overall_confirmed !== true || ['length','width','height'].some(k => typeof d[k] !== 'number' || !Number.isFinite(d[k]) || d[k] <= 0 || d[k] > 100000)) invalid(out, 'CONFIRM_OVERALL_DIMENSIONS', 'dimensions', 'Supply positive L/W/H, explicit mm/cm and overall_confirmed:true; partial measurements are not overall size')
    else { patch.size = sizeOf(d); patch.dimensions = { length: Number(sizeOf(d).split(' × ')[0]), width: Math.round(d.width * (d.unit === 'mm' ? 0.1 : 1) * 10000) / 10000, height: Math.round(d.height * (d.unit === 'mm' ? 0.1 : 1) * 10000) / 10000, unit: 'cm', overall_confirmed: true }; product = { ...product, ...patch } }
  } else if (!target) invalid(out, 'MISSING_OVERALL_DIMENSIONS', 'dimensions', 'Overall dimensions and explicit units need owner confirmation')
  let variants = (old.variants || []).map(v => ({ ...v }))
  if (input.variants !== undefined) {
    if (!Array.isArray(input.variants) || input.variants.length > 40) reject('INVALID_VARIANTS', 'At most 40 finish/configuration operations are allowed')
    const edited = new Set()
    for (const v of input.variants) {
      only(v, rowKeys, 'variant')
      const index = v.variant_id === undefined ? -1 : variants.findIndex((r, i) => variantId(r, i) === v.variant_id)
      if (v.variant_id !== undefined && (index < 0 || edited.has(index))) reject('INVALID_VARIANT_ID', 'Use a unique variant_id from this exact version')
      edited.add(index < 0 ? `new${variants.length}` : index)
      const before = index < 0 ? {} : variants[index]
      const next = { ...before }
      for (const field of ['brand_code','plating_code','crystal_code','running_no']) if (v[field] !== undefined) next[field] = text(v[field], field, 8)
      if (!/^[A-Z]{1,2}$/.test(next.brand_code || '') || (product.design_no?.length === 4 && next.brand_code?.length > 1)) invalid(out, 'INVALID_BRAND', 'variants', 'Use the canonical 1/2 letter prefix permitted for this design')
      const knownBrands = all(RANGE_CRYSTAL_BRANDS.map(r => r.code), ctx.products.flatMap(r => (r.data.variants || []).map(v => v.brand_code)))
      if (next.brand_code && !knownBrands.includes(next.brand_code) && !codeConfirmations.includes(`brand:${next.brand_code}`)) invalid(out, 'CONFIRM_BRAND', 'variants', 'Confirm the exact form-supported brand code')
      if (!RANGE_PLATINGS.some(r => r.code === next.plating_code)) invalid(out, 'INVALID_PLATING', 'variants', 'Select an offered finish from OC plating codes')
      if (next.running_no && !/^[A-Z0-9]{1,4}$/.test(next.running_no)) reject('INVALID_RUNNING_NUMBER', 'Running suffix must be 1–4 uppercase letters/digits')
      if (v.no_crystal !== undefined && typeof v.no_crystal !== 'boolean') reject('INVALID_INPUT', 'no_crystal must be boolean')
      if (v.crystal_colors !== undefined) {
        if (!Array.isArray(v.crystal_colors) || v.crystal_colors.length > 32 || v.crystal_colors.some(c => typeof c !== 'string')) reject('INVALID_CHIPS', 'Supply at most 32 exact colour chips')
        next.crystal_colors = [...new Set(v.crystal_colors)]
      }
      const colours = next.crystal_colors || []
      if (colours.some(c => !ctx.colors.some(v => v.code === c)) || (next.crystal_code && !ctx.colors.some(v => v.code === next.crystal_code))) invalid(out, 'INVALID_CHIP', 'variants', 'Every chip must exist in live settings/crystal_colors')
      if (!colours.length && !next.crystal_code && v.no_crystal !== true && index < 0) invalid(out, 'CONFIRM_CRYSTAL_SELECTION', 'variants', 'Select chips or explicitly confirm no_crystal:true')
      if (index < 0) Object.assign(next, { id: `v_${variants.length}`, ws_price_usd: null, crystal_colors: colours, crystal_code: next.crystal_code || '', running_no: next.running_no || '' })
      next.sku = buildRangeSku({ ...next, design_no: product.design_no, format: product.format_code })
      next.plating_name = RANGE_PLATINGS.find(r => r.code === next.plating_code)?.name || next.plating_code
      if (index < 0) variants.push(next); else variants[index] = next
    }
    patch.variants = variants; product = { ...product, variants }
  }
  if (!product.variants.length) invalid(out, 'MISSING_FINISHES', 'variants', 'Supply one row per offered finish/configuration, with selectable colour chips')
  const stableIds = product.variants.map((v, i) => variantId(v, i))
  if (new Set(stableIds).size !== stableIds.length) reject('DUPLICATE_VARIANT_ID', 'Variant identities must be unique within the family')
  const expanded = enumerateRangeSkus(product).map(r => r.sku)
  if (expanded.length > MAX_CODES) reject('TOO_MANY_CODES', 'At most 200 colour-expanded codes may be committed atomically')
  if (new Set(expanded).size !== expanded.length) conflict(out, 'DUPLICATE_ITEM_CODE', 'Two finish/configuration rows resolve to the same full item code')
  const wantedCodes = codesOf(product)
  const collisions = ctx.products.filter(r => r.id !== target?.id && codesOf(r.data).some(c => wantedCodes.includes(c)))
  if (collisions.length) conflict(out, 'ITEM_CODE_EXISTS', 'An intended full code or canonical alias already belongs to another family', collisions.map(r => r.id))
  const refs = (old.critical_components || []).map(v => ({ ...v })), editedRefs = new Set()
  if (input.components !== undefined) {
    if (!Array.isArray(input.components) || input.components.length > 20) reject('INVALID_COMPONENTS', 'At most 20 explicit critical-component operations are allowed')
    const platings = new Set(product.variants.map(v => v.plating_code))
    for (const link of input.components) {
      only(link, ['component_id','code','create','qty_per_unit','applicability','ref_index','critical_reason'], 'component link')
      if (!['long_lead','tooling','high_moq','supply_risk'].includes(link.critical_reason)) invalid(out, 'CRITICAL_REASON_REQUIRED', 'components', 'Select an owner-confirmed supply-critical reason; this is not a full BOM')
      if (!Number.isInteger(link.qty_per_unit) || link.qty_per_unit <= 0 || link.qty_per_unit > 100000) reject('INVALID_QUANTITY', 'Quantity per unit must be a positive integer')
      let comp
      if (link.create !== undefined) {
        if (link.component_id !== undefined || link.code !== undefined) reject('INVALID_COMPONENT', 'Choose an exact existing component OR an explicit definition')
        only(link.create, ['code','name','category','plating_code','notes'], 'new component')
        const c = link.create; componentCode(c.code)
        if (typeof c.name !== 'string' || !c.name.trim() || typeof c.category !== 'string' || !c.category.trim()) { invalid(out, 'MISSING_COMPONENT_DEFINITION', 'components', 'Name and category are required, never inferred from a code'); continue }
        text(c.name, 'component name'); text(c.category, 'component category')
        if (!['',...RANGE_PLATINGS.map(v => v.code)].includes(c.plating_code)) invalid(out, 'INVALID_COMPONENT_PLATING', 'components', 'Explicit component plating (or shared blank) is required')
        const cats = all(ctx.componentCategories?.length ? ctx.componentCategories : RANGE_COMPONENT_CATEGORIES, ctx.components.map(r => r.data.category))
        if (!cats.includes(c.category)) invalid(out, 'INVALID_COMPONENT_CATEGORY', 'components', 'Add an approved category through the component settings UI first')
        const exact = ctx.components.filter(r => r.data.code === c.code)
        const punctuation = ctx.components.filter(r => punctuationKey(r.data.code) === punctuationKey(c.code))
        if (exact.length || punctuation.length) { conflict(out, exact.length ? 'COMPONENT_EXISTS' : 'PUNCTUATION_CONFIRMATION_REQUIRED', 'Select the existing stable ID and exact library code; no automatic identity substitution', (exact.length ? exact : punctuation).map(r => r.id)); continue }
        if (out.new_components.some(r => r.data.code === c.code || punctuationKey(r.data.code) === punctuationKey(c.code))) reject('DUPLICATE_COMPONENT_DEFINITION', 'Define a missing component once, never twice under punctuation variants')
        comp = { id: `new_component_${out.new_components.length}`, data: { code: c.code, name: c.name.trim(), category: c.category.trim(), plating_code: c.plating_code, notes: c.notes === undefined ? '' : text(c.notes, 'notes', 2000), images: [] } }
        out.new_components.push(comp)
      } else {
        docId(link.component_id); componentCode(link.code)
        comp = ctx.components.find(r => r.id === link.component_id)
        if (!comp || comp.data.code !== link.code) { conflict(out, 'COMPONENT_ID_CODE_MISMATCH', 'Select the exact stable component ID and matching library code'); continue }
        out.dependencies[`range_components/${comp.id}`] = comp.version
      }
      const applies = link.applicability
      if (!['auto','always',...platings].includes(applies)) reject('INVALID_APPLICABILITY', 'Specify auto, always or an offered plating code')
      if (comp.data.plating_code && (!platings.has(comp.data.plating_code) || (applies === 'always' && [...platings].some(p => p !== comp.data.plating_code)) || (!['auto','always'].includes(applies) && applies !== comp.data.plating_code))) invalid(out, 'COMPONENT_FINISH_MISMATCH', 'components', 'A finish-specific component cannot silently apply to unrelated finishes')
      const i = link.ref_index
      if (i !== undefined && (!Number.isInteger(i) || i < 0 || i >= refs.length || editedRefs.has(i) || refs[i].id !== comp.id)) reject('INVALID_REFERENCE', 'Use a unique existing ref_index for this same stable component; removal/replacement is out of scope')
      if (i !== undefined) editedRefs.add(i)
      const ref = { ...(i === undefined ? {} : refs[i]), id: comp.id, code: comp.data.code, qty_per_unit: link.qty_per_unit, plating_code: ['auto','always'].includes(applies) ? '' : applies, all_variants: applies === 'always' }
      if (i === undefined) refs.push(ref); else refs[i] = ref
    }
    const identities = refs.map(r => `${r.id}|${r.plating_code}|${!!r.all_variants}|${r.crystal_code || ''}`)
    if (new Set(identities).size !== identities.length) conflict(out, 'DUPLICATE_COMPONENT_LINK', 'A component/applicability link is duplicated')
    patch.critical_components = refs; product = { ...product, critical_components: refs }
  }
  // Validate all final links, including unmentioned legacy refs after a finish
  // correction. Otherwise changing G to C could silently drop a gold part.
  const offered = new Set(product.variants.map(v => v.plating_code))
  for (const ref of product.critical_components || []) {
    const comp = ctx.components.find(c => c.id === ref.id) || out.new_components.find(c => c.id === ref.id)
    if (!comp || comp.data.code !== ref.code) { invalid(out, 'UNRESOLVED_CRITICAL_LINK', 'components', 'Every final critical link needs an existing stable ID and exact matching library code'); continue }
    if (comp.version) out.dependencies[`range_components/${comp.id}`] = comp.version
    if (!Number.isInteger(ref.qty_per_unit) || ref.qty_per_unit <= 0) invalid(out, 'INVALID_LINK_QUANTITY', 'components', 'Every final critical link needs a positive integer quantity')
    const finish = comp.data.plating_code || '', scope = ref.plating_code || finish
    if ((scope && !offered.has(scope)) || (finish && (ref.all_variants ? [...offered].some(p => p !== finish) : scope !== finish))) invalid(out, 'COMPONENT_FINISH_MISMATCH', 'components', 'Final critical links must match offered finishes; correct the link before changing finishes')
  }
  if (input.media !== undefined) {
    if (!Array.isArray(input.media) || input.media.length > 10) reject('INVALID_MEDIA', 'At most 10 existing OC gallery references may be appended')
    const gallery = [...(old.gallery || [])]
    for (const item of input.media) {
      only(item, ['source_range_id','url','caption'], 'media'); docId(item.source_range_id)
      const source = ctx.products.find(r => r.id === item.source_range_id)
      let url
      try { url = new URL(item.url) } catch { reject('INVALID_MEDIA', 'Use an existing OC upload reference') }
      const path = decodeURIComponent(url.pathname)
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.username || url.password
        || !ctx.storageBuckets.some(b => path.startsWith(`/v0/b/${b}/o/`))
        || !/\/o\/(range|range_products)\//.test(path)
        || !source || ![...(source.data.gallery || []).map(g => typeof g === 'string' ? g : g.url), ...(source.data.variants || []).flatMap(v => [v.image, ...Object.values(v.colour_images || {})])].includes(item.url)) reject('UNVERIFIED_MEDIA', 'Only an exact existing OC Range upload read back from its source family is allowed')
      out.dependencies[`range_products/${source.id}`] = source.version
      if (gallery.some(g => (typeof g === 'string' ? g : g.url) === item.url)) reject('MEDIA_REPLACEMENT', 'V1 only appends new references; existing images/captions cannot be replaced')
      gallery.push({ url: item.url, caption: text(item.caption, 'caption', 300) })
    }
    patch.gallery = gallery; product = { ...product, gallery }
  }
  if (!target) { const body = (product.variants[0]?.brand_code || '').slice(1); Object.assign(product, { body_code: body, design_code: body + product.design_no }); }
  if (target && !Object.keys(patch).length) invalid(out, 'EMPTY_UPDATE', 'input', 'A bounded correction is required')
  if (product.active === true) out.warnings.push({ code: 'PUBLIC_UPDATE_APPROVAL_REQUIRED', message: 'This existing family is visible; the private owner approval must explicitly permit its correction. Visibility itself cannot be changed.' })
  if ((product.variants || []).some(v => v.ws_price_usd == null)) out.warnings.push({ code: 'MANUAL_PRICING_PENDING', message: 'Unpriced variants remain null. No stock, MOQ, lead time, cost or supplier quote will be invented.' })
  const proposed = publicFamily({ id: target?.id || 'new_family', data: product, version: null })
  out.proposed = proposed
  const changes = target ? patch : product
  out.diff = Object.keys(changes).filter(k => canonical(old[k]) !== canonical(changes[k])).map(field => ({ field, before: select(publicFamily(target), [field])[field] ?? null, after: proposed[field] ?? null }))
  out.safe_to_commit = !out.conflicts.length && !out.missing_facts.length
  return { ...out, patch: changes, family_key: key, item_codes: wantedCodes, target_id: target?.id || null }
}
