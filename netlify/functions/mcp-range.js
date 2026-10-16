import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createRangeUploadHandler } from './lib/rangeUploadService.js'

export default async function handler(req) {
  if (!req.headers.get('authorization')?.startsWith('Bearer ')) return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  try { initAdminApp() } catch { return new Response('Server not configured', { status: 503 }) }
  return createRangeUploadHandler({ db: getFirestore(), verifyToken: token => getAuth().verifyIdToken(token, true),
    secret: process.env.RANGE_UPLOAD_PREVIEW_SECRET, writesEnabled: process.env.RANGE_UPLOAD_WRITES_ENABLED === 'true' })(req)
}
export const config = { path: '/api/mcp-range', rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ['ip','domain'] } }
