import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { RANGE_UPLOAD_UID, MAX_CATALOGUE, MAX_CODES, RangeUploadError, reject, only, text, docId, familyKey, codesOf, canonical, publicFamily, publicComponent, planRangeUpload, punctuationKey } from '../../../src/domain/rangeUpload.js'

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
const row = snap => snap.exists ? { id: snap.id, data: snap.data(), version: hash(snap.data()) } : null
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPS = new Set(['search_range_families','get_range_family','search_range_components','prepare_range_upload','commit_range_upload','approve_range_upload'])
const CONTROL = 'range_upload_controls/service'
const profileOk = data => data?.role === 'service' && data.status === 'approved' && data.service_scope === 'range-upload-v1' && Array.isArray(data.modules) && !data.modules.length
const enabled = c => c?.enabled === true && c.principal_uid === RANGE_UPLOAD_UID
const millis = t => typeof t?.toMillis === 'function' ? t.toMillis() : NaN
function writable(control, now, writesEnabled) {
  if (!writesEnabled || control.writes_enabled !== true || !(millis(control.write_expires_at) > now) || millis(control.write_expires_at) > now + 3600000) reject('WRITES_DISABLED', 'Writes need a separately approved server switch and private expiring write window', 403)
}
function secretReady(secret) { if (typeof secret !== 'string' || secret.length < 32) reject('PREVIEW_UNAVAILABLE', 'Server preview signing is not configured', 503) }
function sign(payload, secret) {
  secretReady(secret)
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
function unpack(token, secret, now, checkExpiry = true) {
  secretReady(secret)
  if (typeof token !== 'string' || token.length > 150000) reject('INVALID_PREVIEW', 'Invalid reviewed preview token')
  const parts = token.split('.')
  if (parts.length !== 2) reject('INVALID_PREVIEW', 'Invalid reviewed preview token')
  const actual = Buffer.from(parts[1], 'base64url'), expected = createHmac('sha256', secret).update(parts[0]).digest()
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) reject('INVALID_PREVIEW', 'Preview signature does not match')
  let p
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) } catch { reject('INVALID_PREVIEW', 'Unreadable preview') }
  if (p.v !== 1 || p.uid !== RANGE_UPLOAD_UID || !Number.isFinite(p.expires_at) || p.expires_at > now + 900000) reject('INVALID_PREVIEW', 'Invalid preview scope or lifetime')
  if (checkExpiry && p.expires_at <= now) reject('PREVIEW_EXPIRED', 'Run a fresh dry run; the reviewed preview expired', 409)
  return p
}
async function context(db, reader) {
  const get = ref => reader ? reader.get(ref) : ref.get()
  const products = await get(db.collection('range_products').limit(MAX_CATALOGUE + 1))
  const components = await get(db.collection('range_components').limit(MAX_CATALOGUE + 1))
  if (products.size > MAX_CATALOGUE || components.size > MAX_CATALOGUE) reject('CATALOGUE_LIMIT', 'Catalogue exceeds the bounded legacy collision scan; migrate the index before writes', 409)
  const colors = await get(db.doc('settings/crystal_colors'))
  const categories = await get(db.doc('settings/component_categories'))
  const legacy = await get(db.doc('range_mcp_approvals/b0016_setup_release'))
  if (!colors.exists || !Array.isArray(colors.data().colors)) reject('SETTINGS_UNAVAILABLE', 'Current crystal colour settings are required', 409)
  return { products: products.docs.map(row), components: components.docs.map(row), colors: colors.data().colors,
    componentCategories: categories.data()?.list || [],
    settingsVersion: hash({ colors: colors.data(), categories: categories.data() || null }),
    legacyReleaseActive: legacy.data()?.approved === true && millis(legacy.data().expires_at) > Date.now(),
    storageBuckets: ['crystocraft-costing.firebasestorage.app','crystocraft-costing.appspot.com'] }
}
function buildPlan(input, ctx) {
  const plan = planRangeUpload(input, ctx), seed = hash({ uid: RANGE_UPLOAD_UID, input })
  const targetId = plan.target_id || `range_mcp_${seed.slice(0,32)}`
  const map = new Map(plan.new_components.map(c => [c.id, `rc_mcp_${hash(seed + c.data.code).slice(0,32)}`]))
  const replaceRefs = refs => refs?.map(ref => ({ ...ref, id: map.get(ref.id) || ref.id }))
  if (plan.patch.critical_components) plan.patch.critical_components = replaceRefs(plan.patch.critical_components)
  plan.proposed.id = targetId
  plan.proposed.critical_components = replaceRefs(plan.proposed.critical_components)
  plan.new_components = plan.new_components.map(c => ({ ...c, id: map.get(c.id) }))
  const catalogueIndex = ctx.products.map(r => ({ id: r.id, design: r.data.design_no || '', format: r.data.format_code || '', codes: codesOf(r.data).sort() })).sort((a,b) => a.id.localeCompare(b.id))
  const componentIndex = ctx.components.map(r => [r.id, r.data.code || '']).sort((a,b) => a[0].localeCompare(b[0]))
  plan.diff = Object.keys(plan.patch).filter(field => canonical(plan.existing?.[field]) !== canonical(plan.proposed[field])).map(field => ({ field, before: plan.existing?.[field] ?? null, after: plan.proposed[field] ?? null }))
  const digest = hash({ input, proposed: plan.proposed, diff: plan.diff, new_components: plan.new_components, dependencies: plan.dependencies, settings: ctx.settingsVersion, catalogueIndex, componentIndex })
  return { ...plan, target_id: targetId, digest }
}
const visiblePlan = p => { const { patch, dependencies, digest, ...visible } = p; return visible }
async function servicePermission(db, claims, reader) {
  if (claims.uid !== RANGE_UPLOAD_UID || claims.range_upload !== true) reject('FORBIDDEN', 'Only the separate Range upload capability is accepted', 403)
  const get = ref => reader ? reader.get(ref) : ref.get()
  const profile = (await get(db.doc(`users/${claims.uid}`))).data()
  const control = (await get(db.doc(CONTROL))).data()
  if (!profileOk(profile) || !enabled(control)) reject('CAPABILITY_DISABLED', 'Range service profile/control is disabled or overprivileged', 403)
  return control
}
function lookupInput(input, keys) {
  only(input, [...keys, 'limit'])
  const limit = input.limit === undefined ? 20 : input.limit
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) reject('INVALID_LIMIT', 'Use limit 1–50')
  if (!keys.some(k => typeof input[k] === 'string' && input[k].trim().length >= 2)) reject('FILTER_REQUIRED', 'An exact code/identity or at least two name characters is required')
  for (const key of keys) if (input[key] !== undefined) text(input[key], key, 100)
  return limit
}

export function createRangeUploadHandler({ db, verifyToken, secret, writesEnabled = false, clock = Date.now, auditFailure = event => console.warn(JSON.stringify(event)) }) {
  async function commit(input, claims) {
    only(input, ['preview_token','approval_id','idempotency_key'])
    if (typeof input.idempotency_key !== 'string' || !UUID.test(input.idempotency_key)) reject('INVALID_IDEMPOTENCY_KEY', 'Supply a caller-generated UUID')
    const approvalId = docId(input.approval_id), payload = unpack(input.preview_token, secret, clock(), false)
    if (approvalId !== hash(input.preview_token)) reject('APPROVAL_MISMATCH', 'Approval must match this exact reviewed token', 409)
    const receiptId = hash(`${claims.uid}:${input.idempotency_key.toLowerCase()}`), requestHash = hash({ token: input.preview_token, approval: approvalId })
    const receiptRef = db.doc(`range_upload_receipts/${receiptId}`)
    const result = await db.runTransaction(async tx => {
      const control = await servicePermission(db, claims, tx)
      const receipt = await tx.get(receiptRef)
      if (receipt.exists) {
        if (receipt.data().request_hash !== requestHash) reject('IDEMPOTENCY_CONFLICT', 'That key belongs to a different reviewed request', 409)
        return { ...receipt.data().result, idempotent_replay: true }
      }
      writable(control, clock(), writesEnabled)
      unpack(input.preview_token, secret, clock())
      const approvalRef = db.doc(`range_upload_approvals/${approvalId}`), approval = (await tx.get(approvalRef)).data()
      if (approval?.used_by) reject('APPROVAL_ALREADY_USED', 'That exact approval was already consumed; use its original receipt/key', 409)
      if (!approval || approval.approved !== true || approval.revoked === true || approval.uid !== claims.uid || approval.preview_hash !== approvalId || approval.used_by || !(millis(approval.expires_at) > clock()) || typeof approval.approved_by !== 'string') reject('OWNER_APPROVAL_REQUIRED', 'Obtain a fresh private owner approval for this exact preview', 403)
      const approver = (await tx.get(db.doc(`users/${approval.approved_by}`))).data()
      if (approver?.role !== 'admin') reject('OWNER_APPROVAL_REVOKED', 'The approving operator no longer has admin authority', 403)
      const ctx = await context(db, tx), plan = buildPlan(payload.input, ctx)
      if (!plan.safe_to_commit || plan.digest !== payload.digest) reject('STALE_PREVIEW', 'Data/settings/codes changed; review a fresh dry run', 409)
      if (plan.proposed.active === true && approval.allow_public_update !== true) reject('PUBLIC_UPDATE_NOT_APPROVED', 'Owner must explicitly approve correction of this visible family', 403)
      const claimsToWrite = [
        { ref: db.doc(`range_family_claims/${plan.family_key}`), kind: 'family', code: plan.family_key, owner: plan.target_id },
        ...plan.item_codes.map(code => ({ ref: db.doc(`range_upload_code_claims/${hash(code)}`), kind: 'item', code, owner: plan.target_id })),
        ...plan.new_components.map(c => ({ ref: db.doc(`range_component_claims/${punctuationKey(c.data.code)}`), kind: 'component', code: c.data.code, owner: c.id })),
      ]
      const reservations = []
      for (const claim of claimsToWrite) {
        const current = await tx.get(claim.ref)
        const owner = claim.kind === 'family' ? current.data()?.range_id : claim.kind === 'component' ? current.data()?.component_id : current.data()?.owner_id
        if (current.exists && (owner !== claim.owner || (claim.kind !== 'family' && current.data().code !== claim.code))) reject('CODE_RESERVED', 'A family/code reservation belongs to another record', 409)
        reservations.push({ ...claim, exists: current.exists })
      }
      // All reads precede writes. Failed claims/approval checks cannot leave parts.
      const at = Timestamp.fromMillis(clock()), before = ctx.products.find(r => r.id === plan.target_id)
      const familyData = { ...(before?.data || {}), ...plan.patch, updatedAt: at, mcp_revision: requestHash, ...(!before ? { createdAt: at } : {}) }
      const postVersion = hash(familyData)
      const readback = publicFamily({ id: plan.target_id, version: postVersion, data: familyData })
      const response = { ok: true, range_id: plan.target_id, component_ids: plan.new_components.map(c => c.id), reused_component_ids: [...new Set(readback.critical_components.map(c => c.id).filter(id => !plan.new_components.some(c => c.id === id)))], pre_version: before?.version || null, post_version: postVersion, readback, audit_id: receiptId }
      for (const claim of reservations.filter(c => !c.exists)) tx.create(claim.ref, claim.kind === 'family'
        ? { range_id: claim.owner, design_no: familyData.design_no, format_code: familyData.format_code, createdAt: at }
        : claim.kind === 'component' ? { component_id: claim.owner, code: claim.code, createdAt: at } : { kind: claim.kind, code: claim.code, owner_id: claim.owner, createdAt: at })
      for (const c of plan.new_components) tx.create(db.doc(`range_components/${c.id}`), { ...c.data, createdAt: at, updatedAt: at })
      if (before) tx.update(db.doc(`range_products/${plan.target_id}`), { ...plan.patch, updatedAt: at, mcp_revision: requestHash })
      else tx.create(db.doc(`range_products/${plan.target_id}`), familyData)
      tx.create(receiptRef, { request_hash: requestHash, actor: claims.uid, request_id: input.idempotency_key.toLowerCase(), result: response, createdAt: at })
      tx.create(db.doc(`range_upload_audit/${receiptId}`), { actor: claims.uid, approved_by: approval.approved_by, request_id: input.idempotency_key.toLowerCase(), range_id: plan.target_id, preview_hash: approvalId, pre_version: response.pre_version, post_version: postVersion, diff: plan.diff, created_component_ids: response.component_ids, component_diff: plan.new_components.map(c => ({ id: c.id, fields: Object.entries(c.data).map(([field, after]) => ({ field, before: null, after })) })), component_versions: Object.fromEntries(plan.new_components.map(c => [c.id, { before: null, after: hash({ ...c.data, createdAt: at, updatedAt: at }) }])), outcome: 'committed', at })
      tx.update(approvalRef, { used_by: receiptId, used_at: at })
      return response
    })
    // Report uncertain readback honestly; receipt already prevents duplicate writes.
    try {
      const current = row(await db.doc(`range_products/${result.range_id}`).get())
      return { ...result, readback_verified: current?.version === result.post_version, current_version: current?.version || null }
    } catch { return { ...result, readback_verified: false, warning: 'Commit receipt exists; readback unavailable. Retry the SAME token/key, never a new key.' } }
  }
  return async function handler(req) {
    if (req.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }, 405)
    let actor = null, operation = null, requestId = null
    try {
      const bearer = req.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
      if (!bearer) reject('UNAUTHORIZED', 'Authentication required', 401)
      let claims
      try { claims = await verifyToken(bearer) } catch { reject('UNAUTHORIZED', 'Invalid, expired, disabled or revoked identity', 401) }
      actor = claims.uid
      const chunks = [], reader = req.body?.getReader(); let length = 0
      if (Number(req.headers.get('content-length')) > 131072) reject('REQUEST_TOO_LARGE', 'Maximum request size is 128 KiB', 413)
      if (reader) while (true) {
        const { done, value } = await reader.read(); if (done) break
        length += value.length
        if (length > 131072) { await reader.cancel(); reject('REQUEST_TOO_LARGE', 'Maximum request size is 128 KiB', 413) }
        chunks.push(value)
      }
      const raw = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length }
      let body
      try { body = JSON.parse(new TextDecoder().decode(raw)) } catch { reject('BAD_JSON', 'Invalid JSON') }
      only(body, ['op','input'])
      if (!OPS.has(body.op)) reject('UNKNOWN_OPERATION', 'Unsupported Range operation')
      operation = body.op
      requestId = UUID.test(body.input?.idempotency_key || '') ? body.input.idempotency_key : null
      const input = body.input
      if (body.op === 'approve_range_upload') {
        only(input, ['preview_token','expected_preview_hash','purpose','allow_public_update'])
        if (!text(input.purpose, 'approval purpose', 500)) reject('PURPOSE_REQUIRED', 'A specific owner approval purpose is required')
        if (input.allow_public_update !== undefined && typeof input.allow_public_update !== 'boolean') reject('INVALID_INPUT', 'allow_public_update must be boolean')
        const payload = unpack(input.preview_token, secret, clock()), id = hash(input.preview_token)
        if (input.expected_preview_hash !== id) reject('APPROVAL_MISMATCH', 'Explicit reviewed hash does not match this token', 409)
        await db.runTransaction(async tx => {
          const operator = (await tx.get(db.doc(`users/${claims.uid}`))).data()
          if (operator?.role !== 'admin') reject('FORBIDDEN', 'Only an authenticated OC admin may approve the exact preview', 403)
          await servicePermission(db, { uid: RANGE_UPLOAD_UID, range_upload: true }, tx)
          const ctx = await context(db, tx), plan = buildPlan(payload.input, ctx)
          if (!plan.safe_to_commit || plan.digest !== payload.digest) reject('STALE_PREVIEW', 'Review a fresh dry run', 409)
          if (plan.proposed.active === true && input.allow_public_update !== true) reject('PUBLIC_UPDATE_NOT_APPROVED', 'Explicit visible-product correction approval is required', 403)
          const ref = db.doc(`range_upload_approvals/${id}`), prior = await tx.get(ref)
          if (prior.exists) reject('APPROVAL_EXISTS', 'An approval already exists; inspect its outcome instead of overwriting it', 409)
          tx.create(ref, { approved: true, uid: RANGE_UPLOAD_UID, preview_hash: id, approved_by: claims.uid, purpose: input.purpose.trim(), allow_public_update: input.allow_public_update === true, approved_at: Timestamp.fromMillis(clock()), expires_at: Timestamp.fromMillis(payload.expires_at) })
        })
        return json({ ok: true, approval_id: id, expires_at: new Date(payload.expires_at).toISOString() })
      }
      const control = await servicePermission(db, claims)
      if (body.op === 'commit_range_upload') return json(await commit(input, claims))
      const ctx = await context(db)
      if (body.op === 'get_range_family') {
        only(input, ['range_id']); docId(input.range_id)
        const found = ctx.products.find(r => r.id === input.range_id)
        if (!found) reject('NOT_FOUND', 'Range family not found', 404)
        return json({ ok: true, family: publicFamily(found) })
      }
      if (body.op === 'search_range_families') {
        const limit = lookupInput(input, ['design_no','format_code','item_code','query'])
        const matches = ctx.products.filter(r => (!input.design_no || r.data.design_no === input.design_no) && (!input.format_code || r.data.format_code === input.format_code) && (!input.item_code || codesOf(r.data).includes(input.item_code)) && (!input.query || `${r.data.design_name || ''} ${r.data.design_no || ''}`.toLowerCase().includes(input.query.trim().toLowerCase())))
        return json({ ok: true, matches: matches.slice(0,limit).map(r => ({ id: r.id, version: r.version, design_no: r.data.design_no, format_code: r.data.format_code, name: r.data.design_name || '', status: r.data.status, active: r.data.active, item_codes: codesOf(r.data).slice(0,MAX_CODES) })), truncated: matches.length > limit })
      }
      if (body.op === 'search_range_components') {
        only(input, ['code','query','range_id','limit'])
        if (input.range_id !== undefined) docId(input.range_id)
        const limit = lookupInput({ ...input, range_id: undefined }, ['code','query','range_id'])
        if (!input.code?.trim() && !input.query?.trim()) reject('FILTER_REQUIRED', 'Supply an exact component code or bounded name query')
        const linked = input.range_id ? (ctx.products.find(r => r.id === input.range_id)?.data.critical_components || []).map(r => r.id) : []
        let matches = input.code ? ctx.components.filter(r => r.data.code === input.code) : ctx.components.filter(r => (r.data.name || '').toLowerCase().includes((input.query || '').toLowerCase()))
        let requires_confirmation = false
        if (input.code && !matches.length) { matches = ctx.components.filter(r => punctuationKey(r.data.code) === punctuationKey(input.code)); requires_confirmation = matches.length > 0 }
        return json({ ok: true, matches: matches.slice(0,limit).map(r => publicComponent(r, linked)), requires_confirmation, truncated: matches.length > limit })
      }
      const plan = buildPlan(input, ctx), expires = clock() + 900000
      const reservations = [
        ...(plan.family_key ? [[`range_family_claims/${plan.family_key}`, 'range_id', plan.target_id]] : []),
        ...plan.item_codes.map(code => [`range_upload_code_claims/${hash(code)}`, 'owner_id', plan.target_id]),
        ...plan.new_components.map(c => [`range_component_claims/${punctuationKey(c.data.code)}`, 'component_id', c.id]),
      ]
      for (const [path, field, owner] of reservations) {
        const existing = await db.doc(path).get()
        if (existing.exists && existing.data()[field] !== owner) {
          plan.conflicts.push({ code: 'CODE_RESERVED', message: 'A family/component/item code remains reserved by another identity', path })
          plan.safe_to_commit = false
        }
      }
      const token = plan.safe_to_commit ? sign({ v: 1, uid: claims.uid, expires_at: expires, input, digest: plan.digest }, secret) : null
      if (token && token.length > 100000) reject('PREVIEW_TOO_LARGE', 'Reduce this operation before committing; the signed preview exceeds the bounded request size')
      return json({ ok: true, ...visiblePlan(plan), needs_input: !plan.safe_to_commit, preview_token: token, preview_hash: token ? hash(token) : null, expires_at: token ? new Date(expires).toISOString() : null, commit_enabled: writesEnabled && control.writes_enabled === true && millis(control.write_expires_at) > clock() && millis(control.write_expires_at) <= clock() + 3600000, approval_required: true })
    } catch (e) {
      // Failure metadata only: never input bodies, credentials or private docs.
      auditFailure({ event: 'range_upload_failed', actor, operation, request_id: requestId, outcome: 'rejected_or_uncertain', code: e instanceof RangeUploadError ? e.code : 'REQUEST_FAILED', at: new Date(clock()).toISOString() })
      if (e instanceof RangeUploadError) return json({ ok: false, error: { code: e.code, message: e.message } }, e.status)
      // Never log raw documents, credentials, query bodies or tokens.
      return json({ ok: false, error: { code: 'REQUEST_FAILED', message: 'Range operation failed or outcome is uncertain. For commits retry the same token/key; do not create another request.' } }, 503)
    }
  }
}
