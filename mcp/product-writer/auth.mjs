import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('./keychain.swift', import.meta.url))
export const projectId = process.env.OC_FIREBASE_PROJECT_ID || 'crystocraft-costing'

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
export async function getIdToken() {
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
