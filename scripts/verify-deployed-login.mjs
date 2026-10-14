// Read-only release probe. No password, sign-in, profile or account writes.
import { validateFirebaseBuildConfig } from './firebase-build-config.mjs'

const base = new URL(process.argv[2] || 'https://portal.crystocraft.com')
if (base.protocol !== 'https:') throw new Error('HTTPS release URL required')
const htmlResponse = await fetch(new URL('/login', base))
if (!htmlResponse.ok) throw new Error(`Login page HTTP ${htmlResponse.status}`)
const html = await htmlResponse.text()
const script = html.match(/src="([^"]+\.js)"/)?.[1]
if (!script) throw new Error('Login bundle missing')
const asset = new URL(script, base)
if (asset.origin !== base.origin) throw new Error('Unexpected bundle origin')
const response = await fetch(asset)
if (!response.ok) throw new Error(`Login bundle HTTP ${response.status}`)
const source = await response.text()
const config = source.match(/\{apiKey:"([^"]*)",authDomain:"([^"]*)",projectId:"([^"]*)",storageBucket:"([^"]*)",messagingSenderId:"([^"]*)",appId:"([^"]*)"\}/)
if (!config) throw new Error('Could not inspect served Firebase configuration')
const suffixes = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']
const env = Object.fromEntries(suffixes.map((suffix, i) => [`VITE_FIREBASE_${suffix}`, config[i + 1]]))
validateFirebaseBuildConfig(env)
const probe = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'eddie@uart.com.hk', continueUri: new URL('/login', base).href }),
})
if (!probe.ok) {
  const body = await probe.json().catch(() => ({}))
  throw new Error(`Firebase client configuration probe HTTP ${probe.status}: ${body.error?.message || 'failed'}`)
}
console.log(JSON.stringify({ url: base.origin, asset: asset.pathname, project: env.VITE_FIREBASE_PROJECT_ID, firebase_probe_status: probe.status, password_sign_in_tested: false }))
