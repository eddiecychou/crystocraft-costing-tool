import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const helper = fileURLToPath(new URL('./keychain.swift', import.meta.url))
const serviceAccountPath = fileURLToPath(new URL('../../firebase-service-account.json', import.meta.url))
export const projectId = process.env.OC_FIREBASE_PROJECT_ID || 'crystocraft-costing'
export const serviceUid = 'mcp-product-writer-service'
export const pricingServiceUid = 'mcp-catalogue-pricing-service'

export function apiKey() {
  const key = process.env.OC_FIREBASE_API_KEY
  if (!key) throw new Error('OC_FIREBASE_API_KEY is missing; see mcp/product-writer/README.md')
  return key
}

export function keychain(action, value = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('swift', ['-module-cache-path', '/private/tmp/oc-product-writer-swift-cache', helper, action, projectId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let error = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error.trim() || 'Keychain credential unavailable; run npm run login')))
    child.stdin.end(value)
  })
}

let cached = null
async function getInteractiveIdToken() {
  if (cached && cached.expires > Date.now()) return cached.token
  let refreshToken
  try { refreshToken = await keychain('read') }
  catch { throw new Error('No saved Operation Center sign-in; run npm run login from mcp/product-writer') }
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id_token) throw new Error('Operation Center sign-in expired; run npm run login again')
  if (data.refresh_token && data.refresh_token !== refreshToken) await keychain('write', data.refresh_token)
  cached = { token: data.id_token, expires: Date.now() + Math.max(0, Number(data.expires_in || 3600) - 120) * 1000 }
  return cached.token
}

function serviceApp() {
  if (!fs.existsSync(serviceAccountPath)) throw new Error('Operation Center service account is unavailable; restore firebase-service-account.json on this configured checkout')
  return getApps()[0] || initializeApp({ credential: cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))) })
}

const serviceCached = new Map()
export async function getServiceIdToken(principal = 'catalogue') {
  const cachedService = serviceCached.get(principal)
  if (cachedService && cachedService.expires > Date.now()) return cachedService.token
  const uid = principal === 'pricing' ? pricingServiceUid : serviceUid
  const customToken = await getAuth(serviceApp()).createCustomToken(uid, { product_writer: principal === 'catalogue', catalogue_pricing: principal === 'pricing' })
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.idToken) throw new Error('Operation Center MCP service identity could not sign in; run npm run provision-service once, then retry')
  const issued = { token: data.idToken, expires: Date.now() + Math.max(0, Number(data.expiresIn || 3600) - 120) * 1000 }
  serviceCached.set(principal, issued)
  return issued.token
}

// The default deliberately remains the existing products/supply principal.
export function getIdToken() {
  return process.env.OC_PRODUCT_WRITER_AUTH === 'interactive' ? getInteractiveIdToken() : getServiceIdToken()
}
export function getPricingIdToken() { return getServiceIdToken('pricing') }
