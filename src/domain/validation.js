// Shared domain primitives — the foundation of the Product Manager guardrail
// layer (spec: product-manager-guardrail-spec.md). Two things live here so they
// have exactly one definition across the app:
//
//   1. Coercion helpers (numOrNull, str, trimUpper, oneOf, cleanArray) that were
//      previously copy-pasted into criticalComponents.js / logistics.js /
//      shipping.js. Those modules now import from here.
//   2. A machine-readable validation-result format. Each canonical entity exposes
//      a validateX() that builds one of these, so the write path (saveX) and the
//      read-only Schema Audit page consume the SAME rules — no drift.

// ── Coercion helpers ──────────────────────────────────────────────────────────

// Empty / null / non-finite ⇒ null, else Number. The canonical "numeric or null".
export const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)

// Trimmed string ('' for null/undefined). Never returns null so it's safe to .
export const str = v => (v == null ? '' : String(v)).trim()

// Trimmed + upper-cased — used for codes and enum keys (plating_code, item_code…).
export const trimUpper = v => str(v).toUpperCase()

// Keep `value` only if it's in the allowed set, else fall back. Used for enums.
export const oneOf = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback

// Array with falsy entries removed; non-arrays ⇒ [].
export const cleanArray = arr => (Array.isArray(arr) ? arr.filter(Boolean) : [])

// ── Validation result ─────────────────────────────────────────────────────────
// Shape: { ok, errors[], warnings[], infos[] } where each issue is
// { code, field, message, severity }. `code` is a stable machine-readable key
// (e.g. 'customer.companyname.required'); `field` and `message` are for display.

export function result() {
  return { ok: true, errors: [], warnings: [], infos: [] }
}

export function addError(r, code, field, message) {
  r.errors.push({ code, field, message, severity: 'error' })
  r.ok = false
  return r
}

export function addWarning(r, code, field, message) {
  r.warnings.push({ code, field, message, severity: 'warning' })
  return r
}

export function addInfo(r, code, field, message) {
  r.infos.push({ code, field, message, severity: 'info' })
  return r
}

// Combine several results into one (errors keep ok=false). Skips null/undefined.
export function merge(...results) {
  const m = result()
  for (const r of results) {
    if (!r) continue
    m.errors.push(...r.errors)
    m.warnings.push(...r.warnings)
    m.infos.push(...r.infos)
  }
  m.ok = m.errors.length === 0
  return m
}

// Flat list of every issue, errors first — handy for rendering.
export const allIssues = r => [...(r?.errors || []), ...(r?.warnings || []), ...(r?.infos || [])]
