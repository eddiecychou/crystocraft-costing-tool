import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'
import { createBrandGalleryHandler } from './lib/brandGallery.js'

let credential, validUntil = 0
async function storageCredential() {
  if (credential && Date.now() < validUntil) return credential
  const email = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const raw = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''
  const body = raw.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/\\[rn]/g, '').replace(/[^A-Za-z0-9+/=]/g, '')
  const pem = '-----BEGIN PRIVATE KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n'
  const audience = 'https://oauth2.googleapis.com/token'
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/devstorage.read_only' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(email).setAudience(audience)
    .setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(pem, 'RS256'))
  const response = await fetch(audience, { method: 'POST', body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
  }) })
  if (!response.ok) throw Error('Storage unavailable')
  const result = await response.json()
  credential = result.access_token
  validUntil = Date.now() + (result.expires_in - 120) * 1000
  return credential
}
function documentRead(path, token) {
  const project = Deno.env.get('VITE_FIREBASE_PROJECT_ID')
  return fetch('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/' + path, {
    headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error',
  })
}
export default createBrandGalleryHandler({
  async getProfile(token) {
    // This untrusted subject only locates the document. Firestore authenticates
    // the same ID token for both the profile and the asset read.
    let uid
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      uid = JSON.parse(atob(part)).sub
    } catch { return null }
    if (typeof uid !== 'string' || !uid || uid.includes('/') || uid === 'mcp-range-upload-service') return null
    const response = await documentRead('users/' + encodeURIComponent(uid), token)
    if (!response.ok) return null
    const f = (await response.json()).fields || {}
    return {role: f.role?.stringValue, status: f.status?.stringValue, company: f.customer_id?.stringValue,
      modules: f.modules?.arrayValue?.values?.map(v => v.stringValue)}
  },
  readAsset(company, asset, token) {
    return documentRead('customers/' + company + '/assets/' + asset, token)
  },
  async readObject(path, method, range) {
    const bucket = Deno.env.get('VITE_FIREBASE_STORAGE_BUCKET')
    return fetch('https://storage.googleapis.com/storage/v1/b/' + bucket + '/o/' + encodeURIComponent(path) + '?alt=media', {
      method, headers: { Authorization: 'Bearer ' + await storageCredential(), ...(range ? { Range: range } : {}) },
      cache: 'no-store', redirect: 'error',
    })
  },
})
