// In-memory Firestore boundary for catalogue component tests. No credentials,
// live data, writes, image requests or Firebase initialization are involved.
let data = {}, ready = true
const listeners = new Map()
export const reads = []
export function reset(next, options = {}) {
  if (listeners.size) throw Error('Previous catalogue subscription was not cleaned up')
  data = next; ready = options.ready !== false; reads.length = 0
}
const snapshot = path => ({ docs: (data[path] || []).map(({ id, ...value }) => ({ id, data: () => value })) })
export function publish(next = data) {
  data = next; ready = true
  for (const [cb, path] of listeners) cb(snapshot(path))
}
export const collection = (_, ...parts) => parts.join('/')
export const doc = collection
export const query = path => path
export const orderBy = () => null
export function onSnapshot(path, cb) {
  reads.push(path); listeners.set(cb, path)
  if (ready) cb(snapshot(path))
  return () => listeners.delete(cb)
}
export async function getDocs(path) { reads.push(path); return snapshot(path) }
export async function getDoc(path) { reads.push(path); return { exists: () => false, data: () => ({}) } }
const forbidden = () => { throw Error('Catalogue regression tests must never write data') }
export const addDoc = forbidden, deleteDoc = forbidden, setDoc = forbidden, updateDoc = forbidden
export const serverTimestamp = forbidden

export function catalogueData() {
  const range = (id, name, code, extra = {}) => ({
    id, description: name, design_no: code, design_code: `D${code}-001`, format_code: '001',
    design_type: 'Musical', product_type: 'Figurines', status: 'active',
    variants: [{ sku: `D${code}-001-C`, brand_code: 'D', plating_code: 'C', ws_price_usd: 4 }], ...extra,
  })
  const corp = (id, name, extra = {}) => ({ id, name, category: 'Accessories', status: 'active', pricing_summary: [], ...extra })
  return {
    range_products: [
      ...Array.from({ length: 30 }, (_, i) => range(`r-${i}`, `Desk figurine ${i}`, String(1000 + i))),
      range('ball-1', 'Ballerina', '0327'),
      range('ball-2', 'Ballerina', '0327', { design_type: 'Animals', status: 'concept', variants: [
        { sku: 'D0327-001-C', brand_code: 'D', ws_price_usd: 3 },
        { sku: 'D0327-001-C', brand_code: 'D', ws_price_usd: 6 },
      ] }),
      range('ball-late', 'Zebra Balloon', '0272'),
      range('hidden', 'Hidden Balloon', '0998', { active: false }),
      range('retired', 'Retired Balloon', '0999', { status: 'retired' }),
      range('unnamed', undefined, '0997'),
    ],
    products: [
      ...Array.from({ length: 30 }, (_, i) => corp(`p-${i}`, `Desk item ${i}`)),
      corp('bottle-1', 'Travel Bottle'),
      corp('bottle-2', 'Travel Bottle', { category: 'Tech Accessories', status: 'concept' }),
      corp('bottle-late', 'Zebra Bottle'),
      corp('hidden', 'Hidden Bottle', { active: false }),
      corp('retired', 'Retired Bottle', { status: 'retired' }),
      corp('unnamed', undefined),
    ],
  }
}
