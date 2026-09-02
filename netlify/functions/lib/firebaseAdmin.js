// Shared Firebase Admin bootstrap for Node Lambda functions (netlify/functions/).
// A subdirectory here is NOT auto-scanned as a function (same rule as
// netlify/edge-functions/lib/), so this is a safe place for a helper.
//
// portal-invite.js still carries its own copy of this idiom (deliberately, per
// its comment — it predates this file). New functions import from here; a
// future cleanup migrates portal-invite.js over. See TECH-DEBT.md.
import { initializeApp, getApps, cert } from 'firebase-admin/app'

// Same PEM-repair idiom as portal-invite.js / resend-webhook.js: the
// FIREBASE_PRIVATE_KEY env var arrives with escaped newlines and sometimes
// surrounding quotes.
export function normalizePkcs8(input) {
  let s = String(input || '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '')
  const inner = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '').replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
  const bodyB64 = inner.replace(/[^A-Za-z0-9+/=]/g, '')
  const wrapped = bodyB64.match(/.{1,64}/g)?.join('\n') || bodyB64
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`
}

export function initAdminApp() {
  if (getApps().length) return
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) throw new Error('Server not configured')
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey: normalizePkcs8(privateKeyRaw) }) })
}
