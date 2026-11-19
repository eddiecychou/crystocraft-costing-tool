import {FieldValue} from 'firebase-admin/firestore'
import {createHash} from 'node:crypto'
import {validId as validCatalogueId} from './customerAccess.js'
import {projectRangeProduct} from './customerRange.js'
import {loadAvailabilityComponents} from './availabilityComponents.js'
import {resolveRangeSelection} from '../../../src/domain/customerRangeSelection.js'
import {quantityIssue, positiveWhole} from '../../../src/domain/enquiryQuantity.js'
import {availableOf, availabilityComponent, buildableFromComponents, refApplies, resolveRef} from '../../../src/availability.js'
import {convertFromUSD, DEFAULT_RATES} from '../../../src/domain/customerCurrency.js'

class EnquiryError extends Error {
  constructor(message, status) { super(message); this.status = status }
}
const invalid = () => { throw new EnquiryError('Please review the enquiry and try again.', 400) }
const conflict = message => { throw new EnquiryError(message, 409) }
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
const lineTypes = new Set(['figurine','corporate','crystal_component','crystal_fabric','swatch_sample','swatch','custom'])
const fields = ('type id name code design_no format_code image qty note finish color color_name customer_price_usd pcs_per_carton cartons moq status unit_price line_total source_collection variant_id product_revision variant_revision description_snapshot origin supply unit image_path application swatch_sample_id swatch_revision order_mode finish_sku variant_index').split(' ')

function cleanLine(item) {
  if (!item || !lineTypes.has(item.type) || !validCatalogueId(item.id) || !Number.isFinite(item.qty) || item.qty <= 0) invalid()
  return Object.fromEntries(fields.filter(key => Object.hasOwn(item, key)).map(key => {
    const value = item[key]
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') invalid()
    return [key, value]
  }))
}

function attachmentsFor(attachments, uid, id) {
  if (!Array.isArray(attachments) || attachments.length > 1) invalid()
  return attachments.map(file => {
    const prefix = 'enquiry-files/' + uid + '/' + id + '/'
    if (!file || typeof file.path !== 'string' || !file.path.startsWith(prefix) ||
        !/^[\w-]+\.(pdf|png|jpg|webp)$/.test(file.path.slice(prefix.length)) ||
        !['application/pdf','image/png','image/jpeg','image/webp'].includes(file.mime) ||
        typeof file.name !== 'string' || !positiveWhole(file.bytes) || file.bytes > 20*1024*1024 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) invalid()
    return {path:file.path, name:file.name, bytes:file.bytes, mime:file.mime, sha256:file.sha256}
  })
}

// Only stock requests draw on these pools. Compare the entire basket against
// each applicable part once, including parts shared across different designs.
function countStockDemand(line, refs, parts, demand) {
  for (const ref of refs) {
    if (!refApplies(ref, parts, line.plating_code, line.color)) continue
    const part = resolveRef(ref, parts)
    if (!part) conflict('Stock could not be confirmed. Please recheck availability.')
    if (part.lead_time_weeks > 0 && part.lead_time_weeks < 4) continue // same quick-reorder policy as availability
    const used = (demand.get(part.id) || 0) + line.qty * (Number(ref.qty_per_unit) > 0 ? Number(ref.qty_per_unit) : 1)
    if (used > availableOf(part)) conflict('Your stock selections together exceed the available pieces. Reduce the stock quantities before sending.')
    demand.set(part.id, used)
  }
}

export async function saveCustomerEnquiry(db, uid, {enquiryId, enquiry} = {}) {
  if (!validId(enquiryId) || !enquiry || enquiry.uid !== uid || !Array.isArray(enquiry.items) ||
      !enquiry.items.length || typeof enquiry.message !== 'string') invalid()
  const items = enquiry.items.map(cleanLine)
  const attachments = attachmentsFor(enquiry.attachments, uid, enquiryId)
  const requestHash = createHash('sha256').update(JSON.stringify({items, attachments, message:enquiry.message, currency:enquiry.currency})).digest('hex')
  const target = db.doc('enquiries/' + enquiryId)
  return db.runTransaction(async tx => {
    const [account, existing] = await tx.getAll(db.doc('users/' + uid), target)
    const profile = account.data()
    if (!profile || ['mcp-range-upload-service','mcp-figurine-range-service'].includes(uid) ||
        !(profile.role === 'admin' || profile.role === 'customer' && profile.status === 'approved')) {
      throw new EnquiryError('Approved portal access is required.', 403)
    }
    if (existing.exists) {
      if (existing.get('uid') !== uid || existing.get('request_hash') !== requestHash) conflict('This enquiry reference has already been used. Reopen My Enquiry before sending.')
      return {enquiryId, created:false}
    }
    const currency = profile.base_currency || 'USD'
    if (enquiry.currency !== currency) conflict('Your account currency changed. Please review the enquiry again.')
    const range = items.filter(i => i.type === 'figurine')
    const ids = [...new Set(range.map(i => i.id))]
    const docs = ids.length ? await tx.getAll(...ids.map(id => db.doc('range_products/' + id))) : []
    const products = new Map(docs.map(d => [d.id, d.data()]))
    const visible = docs.map(d => projectRangeProduct(d.id, d.data(), profile)).filter(Boolean)
    const stockIds = [...new Set(range.filter(i => i.order_mode === 'stock').map(i => i.id))]
    const refs = stockIds.flatMap(id => products.get(id)?.critical_components || [])
    const parts = (await loadAvailabilityComponents(db, tx, refs)).map(c => ({id:c.id, ...availabilityComponent(c)}))
    const rates = range.length ? {...DEFAULT_RATES, ...(await tx.get(db.doc('settings/exchange_rates'))).data(), HKD:1} : {}
    const demand = new Map()
    const availability = new Map()
    for (const id of stockIds) {
      const product = products.get(id)
      if (!product) continue
      const limits = buildableFromComponents(product, parts)
      availability.set(id, {verified:(product.critical_components || []).every(r => resolveRef(r, parts)),
        buildable:limits.qty, byPlating:limits.byPlating, byVariant:limits.byVariant})
    }
    const saved = items.map(item => {
      if (item.type !== 'figurine') return {...item, customer_price_usd:null, unit_price:null, line_total:null}
      const line = resolveRangeSelection(item, visible)
      if (!line || !item.order_mode || item.status !== line.status || item.customer_price_usd !== line.customer_price_usd) {
        conflict('A Range selection or price changed. Please review your enquiry.')
      }
      const issue = quantityIssue(line, availability.get(line.id))
      if (issue) conflict(issue)
      if (line.order_mode === 'stock') countStockDemand(line, products.get(line.id).critical_components || [], parts, demand)
      const unit = convertFromUSD(line.customer_price_usd, profile, rates)
      const total = line.status === 'concept' || unit === null ? null : unit * line.qty
      if (unit !== item.unit_price || total !== item.line_total) conflict('A customer price changed. Refresh My Enquiry before sending.')
      return {...line, cartons:line.order_mode === 'mto' ? line.cartons : 0, unit_price:unit, line_total:total}
    })
    const totals = saved.map(i => i.line_total).filter(Number.isFinite)
    tx.create(target, {uid, company_name:profile.company_name || '', contact_name:profile.contact_name || '',
      email:profile.email || enquiry.email || '', base_currency:currency, currency, status:'new', items:saved, attachments,
      message:enquiry.message, estimated_total:totals.length ? totals.reduce((a,b) => a+b,0) : null,
      request_hash:requestHash, createdAt:FieldValue.serverTimestamp()})
    return {enquiryId, created:true}
  })
}

export function enquiryErrorResponse(error) {
  return {status:error instanceof EnquiryError ? error.status : 503,
    error:error instanceof EnquiryError ? error.message : 'Could not confirm your enquiry. Please try again.'}
}
