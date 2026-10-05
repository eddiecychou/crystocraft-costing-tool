import { CATEGORIES, MARKETING_DESC_MAXLEN } from '../../../src/productCategories.js'

const ALLOWED_FIELDS = new Set([
  'name', 'category', 'description', 'marketing_description', 'assembly_notes',
  'product_code', 'request_id',
])
const MAX_BODY_BYTES = 16 * 1024
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function textField(value, field, maxLength, required = false) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const trimmed = value.trim()
  if (required && !trimmed) throw new Error(`${field} is required`)
  if (trimmed.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`)
  return trimmed
}

export function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object')
  const unknown = Object.keys(input).filter(key => !ALLOWED_FIELDS.has(key))
  if (unknown.length) throw new Error(`Unsupported field: ${unknown[0]}`)

  const name = textField(input.name, 'name', 160, true)
  const category = textField(input.category, 'category', 80, true)
  if (!CATEGORIES.includes(category)) throw new Error('category must match an existing corporate-gift category')
  const request_id = textField(input.request_id, 'request_id', 36, true)
  if (!REQUEST_ID_RE.test(request_id)) throw new Error('request_id must be a UUID')

  return {
    name,
    category,
    description: textField(input.description, 'description', 4000),
    marketing_description: textField(input.marketing_description, 'marketing_description', MARKETING_DESC_MAXLEN),
    assembly_notes: textField(input.assembly_notes, 'assembly_notes', 4000),
    product_code: textField(input.product_code, 'product_code', 80),
    request_id: request_id.toLowerCase(),
  }
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function draftIdentity(uid, draft) {
  const { request_id, ...text } = draft
  return {
    productId: `mcp_${(await sha256(`${uid}\n${request_id}`)).slice(0, 40)}`,
    fingerprint: await sha256(JSON.stringify(text)),
  }
}

function firestoreFields(draft, uid, fingerprint) {
  const string = value => ({ stringValue: value })
  return {
    name: string(draft.name),
    product_code: string(draft.product_code),
    category: string(draft.category),
    status: string('concept'),
    active: { booleanValue: false },
    description: string(draft.description),
    marketing_description: string(draft.marketing_description),
    assembly_notes: string(draft.assembly_notes),
    videos: { arrayValue: { values: [] } },
    video_url: string(''),
    blog_links: { arrayValue: { values: [] } },
    is_new: { booleanValue: false },
    customizer_type: string(''),
    heroImage: { nullValue: null },
    mcp_creator_uid: string(uid),
    mcp_request_hash: string(fingerprint),
  }
}

export function commitBody(documentName, draft, uid, fingerprint) {
  return {
    writes: [{
      update: { name: documentName, fields: firestoreFields(draft, uid, fingerprint) },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    }],
  }
}

async function readLimitedJson(req) {
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('Request body is too large')
  if (!req.body) throw new Error('Expected a JSON object')
  const reader = req.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) throw new Error('Request body is too large')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('Invalid JSON') }
}

export async function handleCreateCorpGiftProduct(req, { authorize, fetchImpl = fetch, projectId }) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const auth = await authorize(req, 'products')
  if (!auth.ok) return auth.response
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415)
  }
  if (!projectId) return json({ error: 'Server not configured' }, 500)

  let draft
  try { draft = validateDraft(await readLimitedJson(req)) }
  catch (error) { return json({ error: error.message }, 400) }

  const { productId, fingerprint } = await draftIdentity(auth.uid, draft)
  const documentName = `projects/${projectId}/databases/(default)/documents/products/${productId}`
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`
  const token = req.headers.get('authorization')
  const headers = { Authorization: token, 'Content-Type': 'application/json' }
  const edit_url = `${new URL(req.url).origin}/products/${productId}/edit`

  let result
  try {
    result = await fetchImpl(`${base}/documents:commit`, {
      method: 'POST', headers,
      body: JSON.stringify(commitBody(documentName, draft, auth.uid, fingerprint)),
    })
  } catch {
    return json({ error: 'Firestore is temporarily unavailable; retry with the same request_id' }, 502)
  }
  const output = { product_id: productId, name: draft.name, status: 'concept', active: false, edit_url }
  if (result.ok) return json({ ...output, created: true }, 201)

  // A timed-out first call may have committed. The create precondition ensures
  // that two concurrent retries cannot create a second product.
  const failure = await result.json().catch(() => ({}))
  if (result.status === 409 || failure.error?.status === 'ALREADY_EXISTS' || failure.error?.status === 'FAILED_PRECONDITION') {
    let existing
    try { existing = await fetchImpl(`https://firestore.googleapis.com/v1/${documentName}`, { headers }) }
    catch { return json({ error: 'Could not verify the existing draft; retry with the same request_id' }, 502) }
    if (!existing.ok) return json({ error: 'Could not verify the existing draft; retry with the same request_id' }, 502)
    const document = await existing.json().catch(() => ({}))
    if (document.fields?.mcp_creator_uid?.stringValue !== auth.uid ||
        document.fields?.mcp_request_hash?.stringValue !== fingerprint) {
      return json({ error: 'request_id was already used for different product content' }, 409)
    }
    return json({
      ...output,
      name: document.fields.name?.stringValue || draft.name,
      status: document.fields.status?.stringValue || 'concept',
      active: document.fields.active?.booleanValue === true,
      created: false,
    }, 200)
  }
  if (result.status === 401 || result.status === 403) return json({ error: 'Product write was denied' }, 403)
  return json({ error: 'Product draft could not be saved; retry with the same request_id' }, 502)
}
