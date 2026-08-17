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
// collapse to one; leading/trailing separators are trimmed.
export function normalizeTagValue(raw) {
  let s = String(raw ?? '').trim()
  s = s.replace(/[^\x00-\x7F]/g, '_')
  s = s.replace(/[^A-Za-z0-9_-]/g, '_')
  s = s.replace(/[-_]{2,}/g, '_')
  s = s.replace(/^[-_]+|[-_]+$/g, '')
  return s.slice(0, MAX_TAG_LEN)
}

// Builds one Resend tag `{ name, value }`, or null if there's nothing usable
// and the caller didn't ask for a fallback — per spec, an optional tag with
// no valid value should be OMITTED, not sent as a placeholder.
//
// `prefix` keeps the value's identity readable after normalization (e.g.
// prefix 'customer' + raw 'abc 123' -> 'customer_abc_123') rather than
// shipping a bare, ambiguous normalized string.
export function resendTag(name, rawValue, { prefix = '', fallback = null } = {}) {
  const cleanName = normalizeTagValue(name)
  if (!cleanName) return null // a tag with no usable name can't be sent at all
  const body = normalizeTagValue(rawValue)
  if (!body) {
    if (!fallback) return null
    return { name: cleanName, value: normalizeTagValue(prefix ? `${prefix}_${fallback}` : fallback) }
  }
  const value = normalizeTagValue(prefix ? `${prefix}_${body}` : body)
  return { name: cleanName, value }
}

// specs: [{ name, value, prefix?, fallback? }, ...] -> validated tag array,
// safe to pass straight to Resend's `tags` field (or omit entirely if empty).
export function buildResendTags(specs) {
  const tags = (specs || []).map(s => resendTag(s.name, s.value, { prefix: s.prefix, fallback: s.fallback })).filter(Boolean)
  // Defensive re-check — normalizeTagValue should already guarantee this,
  // but a send-time assertion is cheap and this is the one place that would
  // otherwise surface as an opaque 422 from Resend itself.
  const TAG_RE = /^[A-Za-z0-9_-]+$/
  const invalid = tags.filter(t => !TAG_RE.test(t.name) || !TAG_RE.test(t.value))
  if (invalid.length) {
    console.error('resendTags: normalization failed to produce a valid tag, dropping it', invalid.map(t => t.name))
    return tags.filter(t => TAG_RE.test(t.name) && TAG_RE.test(t.value))
  }
  return tags
}
