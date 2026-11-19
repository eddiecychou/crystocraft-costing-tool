import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { privateJson } from './lib/customerAccess.js'

export default async req => {
  if (req.method !== 'POST') return privateJson({error:'Method not allowed.'},405)
  try {
    initAdminApp()
    let uid
    try { uid = (await getAuth().verifyIdToken(req.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] || '', true)).uid }
    catch { return privateJson({error:'Please sign in.'},401) }
    const db = getFirestore(), profile = (await db.doc('users/' + uid).get()).data()
    if (uid === 'mcp-range-upload-service' || !(profile?.role === 'admin' || profile?.role === 'staff' && Array.isArray(profile.modules) && profile.modules.includes('customers'))) return privateJson({error:'CRM access required.'},403)
    const { company, asset, filename, contentType } = await req.json()
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
    if (!validId(company) || !validId(asset) || typeof filename !== 'string' || !filename || /[/\\\x00-\x1f]/.test(filename) || ['.','..'].includes(filename) || new TextEncoder().encode(filename).length > 750 || typeof contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) return privateJson({error:'Invalid file details.'},400)
    const [owner, existing] = await db.getAll(db.doc('customers/' + company), db.doc('customers/' + company + '/assets/' + asset))
    if (!owner.exists || existing.exists) return privateJson({error:'Gallery record unavailable.'},409)
    const file = getStorage().bucket(process.env.VITE_FIREBASE_STORAGE_BUCKET).file('customer-assets/' + company + '/' + asset + '/' + filename)
    const [upload] = await file.createResumableUpload({
      origin: new URL(req.url).origin, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {contentType, cacheControl: 'private, no-store'},
    })
    return privateJson({upload})
  } catch { return privateJson({error:'Upload could not be started.'},503) }
}
export const config = {path:'/api/brand-gallery-upload'}
