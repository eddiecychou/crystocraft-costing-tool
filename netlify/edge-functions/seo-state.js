// SEO control plane — Step 1: read the live WordPress SEO/translation state
// for blog posts and pages so the Operation Center holds a structured,
// snapshottable "what's live now" (products are covered separately by
// woo-sync.js `catalogue_page`). Read-only. Admin-gated.
//
// Why this exists: the DeepSeek SEO workflow's failures (see the Workbench
// LESSONS-LEARNED B1–B53) all share the shape "output written live, damage
// found later, no restorable state". This is the state store — a durable
// snapshot the OC owns, on the code-reviewed side.
//
// Env: WP_BASE_URL (or WC_BASE_URL) + WP_USER / WP_PASS (the WP Application
// Password — wp/v2 does NOT accept the WooCommerce Consumer Key).
//
// Ops (all POST, client-paginated where noted):
//   { op: 'languages' }                       -> { langs: [{code,label}] }
//   { op: 'content_page', kind, lang, page }  -> { rows, has_more }   kind: 'post'|'page'
//   { op: 'wpml_status', type }               -> { rows }   best-effort; type: 'post'|'page'
import { requireAdmin } from './lib/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// FNV-1a 32-bit — a cheap layout fingerprint so we can detect an
// _elementor_data change without storing 60 KB of JSON per post.
function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

// Frontend languages per the 2026-09-02 probe (wpml/v1 enum also lists
// zh-hans, but the SEO docs' hreflang set is these five).
const FALLBACK_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh-hant', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'fr', label: 'Français' },
]

const metaVal = (meta, key) => {
  if (!meta) return ''
  const v = Array.isArray(meta) ? (meta.find(m => m.key === key)?.value) : meta[key]
  return v == null ? '' : String(v)
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const BASE = (Deno.env.get('WP_BASE_URL') || Deno.env.get('WC_BASE_URL') || '').replace(/\/$/, '')
  const WP_USER = Deno.env.get('WP_USER')
  const WP_PASS = Deno.env.get('WP_PASS')
  if (!BASE || !WP_USER || !WP_PASS) {
    return json({ error: 'Not configured (WP_BASE_URL / WP_USER / WP_PASS)' }, 500)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const headers = {
    Authorization: `Basic ${btoa(`${WP_USER}:${WP_PASS}`)}`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  }
  const wp = (path) => fetch(`${BASE}/wp-json/${path}`, { headers })

  // ── active languages ──────────────────────────────────────────────────────
  if (body.op === 'languages') {
    try {
      const r = await wp('wpml/v1/languages')
      if (r.ok) {
        const d = await r.json()
        const list = Array.isArray(d) ? d : Object.values(d || {})
        const langs = list
          .map(l => ({ code: l.code || l.language_code || l.slug, label: l.display_name || l.native_name || l.translated_name || l.code }))
          .filter(l => l.code)
        if (langs.length) return json({ langs })
      }
    } catch { /* fall through */ }
    return json({ langs: FALLBACK_LANGS, fallback: true })
  }

  // ── one page of posts/pages in one language ───────────────────────────────
  if (body.op === 'content_page') {
    const kind = body.kind === 'page' ? 'pages' : 'posts'
    const lang = String(body.lang || 'en')
    const page = Math.max(1, parseInt(body.page, 10) || 1)
    const fields = 'id,slug,status,link,modified,title,meta,yoast_head_json'
    const r = await wp(`wp/v2/${kind}?lang=${encodeURIComponent(lang)}&context=edit&per_page=100&page=${page}&_fields=${fields}`)
    if (!r.ok) {
      return json({ error: `WordPress ${kind} fetch failed`, detail: (await r.text()).slice(0, 300) }, 502)
    }
    const items = await r.json()
    if (!Array.isArray(items)) {
      return json({ error: 'Unexpected payload', detail: JSON.stringify(items).slice(0, 300) }, 502)
    }
    const rows = items.map(p => {
      const ed = metaVal(p.meta, '_elementor_data')
      return {
        id: p.id,
        kind: body.kind === 'page' ? 'page' : 'post',
        lang,
        slug: p.slug || '',
        status: p.status || '',
        link: p.link || '',
        modified: p.modified || '',
        title: (p.title && (p.title.rendered || p.title.raw)) || '',
        seo_title: p.yoast_head_json?.title || '',
        seo_desc: p.yoast_head_json?.description || '',
        seo_title_set: !!metaVal(p.meta, '_yoast_wpseo_title'),
        seo_desc_set: !!metaVal(p.meta, '_yoast_wpseo_metadesc'),
        focus_kw: metaVal(p.meta, '_yoast_wpseo_focuskw'),
        elementor_len: ed.length || 0,
        elementor_hash: ed ? hash32(ed) : null,
      }
    })
    return json({ rows, has_more: items.length === 100 })
  }

  // ── WPML authoritative per-language status (best-effort) ──────────────────
  // /wpml/v1/posts?type=post|page — returns per-language translation status
  // (0 none / 3 needs update / 10 complete) + editor, per the Workbench
  // workflow doc. Shape can vary; returned as-is for the page to interpret.
  if (body.op === 'wpml_status') {
    const type = body.type === 'page' ? 'page' : 'post'
    try {
      const r = await wp(`wpml/v1/posts?type=${type}`)
      const text = await r.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch { /* raw */ }
      return json({ ok: r.ok, status: r.status, rows: parsed, raw: parsed ? null : text.slice(0, 1000) })
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 200)
    }
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}

export const config = { path: '/api/seo-state' }
