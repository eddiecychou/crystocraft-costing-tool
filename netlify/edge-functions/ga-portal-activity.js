// Portal Login Activity's GA4 traffic panel (V8.11, 2026-08-27) — the
// browser can never call the GA4 Data API directly (it needs a service-
// account credential, not a user's ID token), so this proxies it the same
// way erp.js/uc.js/bank.js proxy their own service-role secrets.
//
// WHAT THIS IS, AND IS NOT (read PortalLogins.jsx's own comment too): GA4
// tracks the whole site from one measurement tag in index.html, covering
// EVERY visitor — staff on the Operation Center side and customers on the
// portal side alike — with no link to a specific users/{uid} account. There
// is no gtag('set', {user_id}) call anywhere in this app (checked before
// building this), so a GA4 session cannot be matched to one row in
// PortalLogins.jsx's roster. This is aggregate traffic for context
// ("does GA's traffic trend roughly track what the roster shows"), not a
// per-account merge — don't build a UI that implies otherwise without
// adding that instrumentation first.
//
// Auth to Google: a JWT-bearer service-account flow (RS256-signed
// assertion → OAuth token), using the SAME service account already granted
// Firebase Admin access (GA_CLIENT_EMAIL/GA_PRIVATE_KEY are that account's
// own credentials — see LOCAL-TOOLS.md's GA4 section for how it was
// granted Viewer access on the property). jose is already an edge-function
// dependency elsewhere (lib/auth.js) — same version, no new import surface.
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'
import { requireAdmin } from './lib/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function getAccessToken(clientEmail, privateKeyPem) {
  const key = await importPKCS8(privateKeyPem, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/analytics.readonly' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  return (await res.json()).access_token
}

export default async function handler(req) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const clientEmail = Deno.env.get('GA_CLIENT_EMAIL')
  const privateKey = (Deno.env.get('GA_PRIVATE_KEY') || '').replace(/\\n/g, '\n')
  const propertyId = Deno.env.get('GA_PROPERTY_ID')
  if (!clientEmail || !privateKey || !propertyId) {
    return json({ error: 'GA4 not configured (GA_CLIENT_EMAIL / GA_PRIVATE_KEY / GA_PROPERTY_ID)' }, 500)
  }

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey)
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
    })
    if (!res.ok) return json({ error: `GA4 request failed: ${await res.text()}` }, 502)
    const data = await res.json()
    const rows = (data.rows || []).map(r => ({
      date: r.dimensionValues[0].value, // YYYYMMDD
      activeUsers: Number(r.metricValues[0].value) || 0,
      sessions: Number(r.metricValues[1].value) || 0,
    }))
    return json({ rows })
  } catch (e) {
    return json({ error: e.message || 'GA4 lookup failed' }, 500)
  }
}

export const config = { path: '/api/ga-portal-activity' }
