// Client for /api/seo-state — the SEO control-plane state reader (Step 1).
// Same shape as wooSyncApi.js: the browser sends the signed-in admin's
// Firebase token; the edge function holds the WP Application Password.
import { authedUser } from './firebase'

async function call(op, extra) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/seo-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `SEO state failed (${res.status})`)
  return data
}

export const seoLanguages = () => call('languages').then(d => d.langs || [])

// One page of posts or pages in one language. Caller loops langs × pages.
export const seoContentPage = (kind, lang, page) => call('content_page', { kind, lang, page })

// WPML authoritative per-language status (best-effort, raw-ish).
export const seoWpmlStatus = (type) => call('wpml_status', { type })
