// Shared, deterministic contract. No contact or marketing writes belong here.
export const CUSTOMER_FILE_MAX_BYTES = 20 * 1024 * 1024
export const CUSTOMER_FILE_CHUNK_BYTES = 3 * 1024 * 1024
export const CUSTOMER_FILE_THUMB_MAX_BYTES = 512 * 1024
export const CUSTOMER_FILE_CATEGORIES = {
  business_card: 'Business Card', customer_document: 'Customer Document',
  reference_image: 'Reference Image', other: 'Other',
}
export const CUSTOMER_FILE_TYPES = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
  'image/gif': ['gif'], 'application/pdf': ['pdf'],
}
export const CUSTOMER_FILE_ACCEPT = Object.keys(CUSTOMER_FILE_TYPES).join(',')
export const CUSTOMER_FILE_META_KEYS = ['category','title','notes','source','referrer','card_side','card_set','contact_ids']
export const emptyCustomerFileMetadata = () => ({
  category: 'business_card', title: '', notes: '', source: '', referrer: '',
  card_side: '', card_set: '', contact_ids: [],
})
export const validCustomerFileId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
export const validCustomerFileHash = hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
export function customerFileType(file) {
  if (Object.hasOwn(CUSTOMER_FILE_TYPES, file.type)) return file.type
  const ext = file.name?.split('.').pop()?.toLowerCase()
  return Object.entries(CUSTOMER_FILE_TYPES).find(([, exts]) => exts.includes(ext))?.[0] || ''
}
export function validateCustomerFileOriginal({ filename, content_type, byte_size, sha256 }) {
  if (typeof filename !== 'string' || !filename.trim() || /[/\\\u0000-\u001f\u007f]/.test(filename)
    || new TextEncoder().encode(filename).length > 1024) throw Error('Choose a valid original filename (up to 1,024 UTF-8 bytes).')
  try { encodeURIComponent(filename) } catch { throw Error('The original filename contains invalid Unicode.') }
  if (!Object.hasOwn(CUSTOMER_FILE_TYPES, content_type)) throw Error('Choose a JPEG, PNG, WebP, GIF or PDF file.')
  if (!Number.isInteger(byte_size) || byte_size < 1 || byte_size > CUSTOMER_FILE_MAX_BYTES) throw Error('Files must be between 1 byte and 20 MB. Originals are never resized.')
  if (!validCustomerFileHash(sha256)) throw Error('The original file checksum is invalid.')
}
// Read actual saved IDs only. Normalization may generate transient IDs for old
// contacts; never persist those as file associations or silently change contacts.
export function savedCustomerFileContacts(customer) {
  const contacts = Array.isArray(customer?.contacts) ? customer.contacts : []
  return contacts.filter(c => validCustomerFileId(c?.id) && contacts.filter(other => other?.id === c.id).length === 1)
    .map(c => ({ id: c.id, name: typeof c.name==='string'&&c.name?c.name:'(unnamed contact)', title: typeof c.title==='string'?c.title:'' }))
}
export function validateCustomerFileMetadata(input, customer, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !CUSTOMER_FILE_META_KEYS.includes(k))) throw Error('Invalid file details.')
  const meta = { ...emptyCustomerFileMetadata(), ...input }
  if (!Object.hasOwn(CUSTOMER_FILE_CATEGORIES, meta.category)) throw Error('Choose a valid file category.')
  for (const [key, max] of Object.entries({title:240, notes:8000, source:400, referrer:240, card_set:160})) {
    if (typeof meta[key] !== 'string' || meta[key].length > max) throw Error(`${key} must be text up to ${max} characters.`)
  }
  if (!['','front','back'].includes(meta.card_side) || (meta.category !== 'business_card' && (meta.card_side || meta.card_set))) throw Error('Front/back and card set apply to Business Cards only.')
  if (!Array.isArray(meta.contact_ids) || meta.contact_ids.length > 20 || new Set(meta.contact_ids).size !== meta.contact_ids.length) throw Error('Choose up to 20 existing contacts.')
  const allowed = new Set([...savedCustomerFileContacts(customer).map(c => c.id), ...(previous.contact_ids || [])])
  if (meta.contact_ids.some(id => !validCustomerFileId(id) || !allowed.has(id))) throw Error('A selected contact no longer belongs to this customer. Review the links.')
  return meta
}
export function customerFileMatchesType(bytes, type) {
  const b = new Uint8Array(bytes), ascii = (start, end) => String.fromCharCode(...b.slice(start, end))
  if (type === 'application/pdf') return ascii(0, 5) === '%PDF-'
  if (type === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((v, i) => b[i] === v)
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (type === 'image/gif') return ['GIF87a','GIF89a'].includes(ascii(0, 6))
  return false
}
export function customerFileStorageBase(record) {
  if (!validCustomerFileId(record?.storage_customer_id) || !validCustomerFileHash(record?.sha256)) throw Error('Invalid stored file ownership.')
  return `customer-files/${record.storage_customer_id}/${record.sha256}`
}
export function customerFileAttachmentHeader(filename) {
  // Same RFC 5987 strategy as download-image; retain the exact original name.
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
