import { createHash } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { duplicateOrderUc } from './lib/duplicateOrderUc.js'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { PI_MAX_FILE_BYTES } from '../../src/piUploadPolicy.js'
import { createOrderRequests } from './lib/orderCreateRequests.js'
import {
  OrderRequestError,
  requirePermission
} from './lib/orderRequestAccess.js'
import {
  piObjectPath,
  validRequestId
} from '../../src/orderCreateRequestModel.js'

export async function verifyPiOriginal(bucket, uid, id, expected) {
  if (expected.size > PI_MAX_FILE_BYTES)
    throw new OrderRequestError('This PI exceeds the 20 MB limit. Select a smaller PDF or image.', 413)
  const file = bucket.file(piObjectPath(uid, id, expected.sha256))
  let metadata
  try {
    const [stored] = await file.getMetadata()
    metadata = stored
  } catch (err) {
    if (Number(err.code) === 404) return null
    throw err
  }
  if (Number(metadata.size) > PI_MAX_FILE_BYTES || Number(metadata.size) !== expected.size)
    throw new OrderRequestError(
      'The uploaded PI size differs from the reviewed original.'
    )
  const hash = createHash('sha256')
  for await (const bytes of file.createReadStream({ validation: 'crc32c' }))
    hash.update(bytes)
  if (hash.digest('hex') !== expected.sha256)
    throw new OrderRequestError(
      'The uploaded PI differs from the reviewed original.'
    )
  const [current] = await file.getMetadata()
  if (current.generation !== metadata.generation)
    throw new OrderRequestError(
      'The uploaded PI changed during verification. Check the original again.'
    )
  const token = metadata.metadata?.firebaseStorageDownloadTokens?.split(',')[0]
  if (!token)
    throw new OrderRequestError(
      'The original PI has no download token. Review the saved file.'
    )
  const origin =
    process.env.STORAGE_EMULATOR_HOST ||
    'https://firebasestorage.googleapis.com'
  const url = new URL(
    '/v0/b/' +
      encodeURIComponent(bucket.name) +
      '/o/' +
      encodeURIComponent(file.name),
    origin
  )
  url.searchParams.set('alt', 'media')
  url.searchParams.set('token', token)
  return { url: url.href, generation: String(metadata.generation) }
}

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Netlify-CDN-Cache-Control': 'no-store',
      Vary: 'Authorization'
    }
  })

export function orderRequestHandler({ verifyToken, getProfile, repo }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const token = req.headers
      .get('authorization')
      ?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token) return json({ error: 'Not signed in' }, 401)
    let identity
    try {
      identity = await verifyToken(token)
    } catch {
      return json({ error: 'Invalid or expired session' }, 401)
    }
    const uid = identity?.uid
    try {
      if (!uid || uid.includes('/') || uid === 'mcp-range-upload-service')
        return json({ error: 'Access denied' }, 403)
      requirePermission(await getProfile(uid), 'shipping')
      const raw = await req.text()
      if (Buffer.byteLength(raw) > 6 * 1024 * 1024)
        return json({ error: 'The order exceeds the request size limit.' }, 413)
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        return json({ error: 'Invalid JSON' }, 400)
      }
      if (!body || typeof body !== 'object')
        return json({ error: 'Invalid order request' }, 400)
      if (body.action === 'list') {
        if (body.cursor && !validRequestId(body.cursor))
          return json({ error: 'Invalid cursor' }, 400)
        return json(await repo.list(uid, body.cursor))
      }
      if (body.operator !== uid)
        return json({ error: 'This request belongs to another operator.' }, 403)
      if (!validRequestId(body.id))
        return json({ error: 'Invalid order request ID' }, 400)
      switch (body.action) {
        case 'status':
          return json(await repo.status(uid, body.id))
        case 'duplicate':
          return json(await repo.duplicate(uid, identity.email, body.id, body))
        case 'prepare':
          return json(await repo.prepare(uid, body.id, body))
        case 'commit':
          return json(await repo.commit(uid, body.id))
        default:
          return json({ error: 'Unknown order action' }, 400)
      }
    } catch (err) {
      return err instanceof OrderRequestError
        ? json({ error: err.message }, err.status)
        : json(
            {
              error:
                'Could not confirm the order request. Check its saved status.'
            },
            503
          )
    }
  }
}

export default async (req) => {
  initAdminApp()
  const db = getFirestore()
  return orderRequestHandler({
    verifyToken: (token) => getAuth().verifyIdToken(token, true),
    getProfile: async (uid) =>
      (await db.collection('users').doc(uid).get()).data(),
    repo: createOrderRequests(
      db,
      (uid, id, file) =>
        verifyPiOriginal(
          getStorage().bucket(
            process.env.VITE_FIREBASE_STORAGE_BUCKET ||
              process.env.FIREBASE_STORAGE_BUCKET
          ),
          uid,
          id,
          file
        ),
      (id, request, issue) =>
        duplicateOrderUc(id, request, issue, {
          url: process.env.SUPABASE_URL,
          key:
            process.env.SUPABASE_SECRET_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY
        })
    )
  })(req)
}
export const config = { path: '/api/shipping-order-request' }
