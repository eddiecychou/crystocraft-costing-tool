// Resend tag normalization — shared by every edge function that attaches
// tracking tags to a Resend send (send-personal-email.js, send-campaign.js).
//
// Resend rejects a send outright (422 "Tags should only contain ASCII
// letters, numbers, underscores, or dashes") if ANY tag name or value
// contains anything else — found live 2026-08-18: marketing_contacts doc ids
// are the contact's own email address (see domain/marketingContact.js's
// idFromEmail — 'jane@example.com', not a Firestore auto-id), and that raw
// id was going straight into the mc_id tag. A customer/campaign name with
// spaces, CJK characters, or punctuation would hit the same wall.
//
// Tags are a CONSTRAINED tracking representation only, not the source of
// truth — the real customer_id/mc_id/draft_id/campaign_id stay exactly as-is
// in Firestore and the interaction log. Normalizing them for Resend never
// touches those.
//
// Must live in this lib/ subdirectory, not a top-level file — Netlify's edge
// function bundler auto-scans every top-level .js under netlify/edge-
// functions/ and requires each to have a default-exported handler regardless
// of netlify.toml routing (see lib/auth.js's own header for the outage this
// caused once already).

const MAX_TAG_LEN = 256 // generous, bounded — Resend doesn't publish a hard cap

// ASCII letters/digits/underscore/dash only. Any non-ASCII character (CJK,
// accented Latin, emoji, ...) and any other ASCII punctuation/whitespace
// (@, ., /, &, (), spaces, ...) becomes an underscore; runs of separators
// collapse to one; leading/trailing separators are trimmed. Lossy — fine for
// a purely decorative tag, but see encodeTagId below for anything that must
// be looked back up (resend-webhook.js correlating a bounce to a real
// Firestore doc by this exact value).
export function normalizeTagValue(raw) {
  let s = String(raw ?? '').trim()
  s = s.replace(/[^\x00-\x7F]/g, '_')
  s = s.replace(/[^A-Za-z0-9_-]/g, '_')
  s = s.replace(/[-_]{2,}/g, '_')
  s = s.replace(/^[-_]+|[-_]+$/g, '')
  return s.slice(0, MAX_TAG_LEN)
}

// Base64url (RFC 4648 §5) — its whole alphabet (A-Za-z0-9-_) is already a
// SUBSET of what Resend allows, so encoding a raw Firestore doc id this way
// is both ASCII-only AND fully reversible, unlike normalizeTagValue above.
// That matters here specifically because a marketing_contacts doc id IS the
// contact's own email address (domain/marketingContact.js's idFromEmail) —
// lossy normalization ('customer@example.com' -> 'customer_example_com')
// would let the send through but silently break resend-webhook.js's later
// doc lookup by that same value (found live 2026-08-18, while fixing the
// original 422: the first fix made sends succeed but broke every bounce/
// delivered/opened correlation, since the webhook was still using the
// tag value directly as a doc id).
export function encodeTagId(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeTagId(encoded) {
  const s = String(encoded ?? '')
  if (!s) return ''
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

// Builds one Resend tag `{ name, value }` for an identifier that must be
// looked back up later (draft_id, mc_id, customer_id — anything
// resend-webhook.js correlates to a real Firestore doc), or null if there's
// nothing to tag — per spec, an optional tag with no valid value is OMITTED,
// never sent as a placeholder. `prefix` keeps the tag human-recognizable at
// a glance (e.g. 'mc_QWNtZQ') without affecting round-trip decoding — strip
// it with decodeResendTag() using the same prefix.
export function resendTag(name, rawId, { prefix = '' } = {}) {
  const cleanName = normalizeTagValue(name)
  if (!cleanName) return null // a tag with no usable name can't be sent at all
  const encoded = encodeTagId(rawId)
  if (!encoded) return null
  const value = (prefix ? `${normalizeTagValue(prefix)}_${encoded}` : encoded).slice(0, MAX_TAG_LEN)
  return { name: cleanName, value }
}

// resend-webhook.js's counterpart to resendTag() above — strips `prefix_`
// (if present) and base64url-decodes the remainder back to the original raw
// Firestore doc id. Returns '' if the tag is missing or wasn't actually
// produced by resendTag (e.g. a differently-prefixed or hand-written tag).
export function decodeResendTag(value, prefix = '') {
  const s = String(value ?? '')
  if (!s) return ''
  const cleanPrefix = prefix ? normalizeTagValue(prefix) : ''
  const body = cleanPrefix && s.startsWith(`${cleanPrefix}_`) ? s.slice(cleanPrefix.length + 1) : s
  return decodeTagId(body)
}

// specs: [{ name, value, prefix? }, ...] -> validated tag array, safe to pass
// straight to Resend's `tags` field (or omit entirely if empty).
export function buildResendTags(specs) {
  const tags = (specs || []).map(s => resendTag(s.name, s.value, { prefix: s.prefix })).filter(Boolean)
  // Defensive re-check — resendTag()'s base64url output should already
  // guarantee this, but a send-time assertion is cheap and this is the one
  // place that would otherwise surface as an opaque 422 from Resend itself.
  const TAG_RE = /^[A-Za-z0-9_-]+$/
  const invalid = tags.filter(t => !TAG_RE.test(t.name) || !TAG_RE.test(t.value))
  if (invalid.length) {
    console.error('resendTags: normalization failed to produce a valid tag, dropping it', invalid.map(t => t.name))
    return tags.filter(t => TAG_RE.test(t.name) && TAG_RE.test(t.value))
  }
  return tags
}
