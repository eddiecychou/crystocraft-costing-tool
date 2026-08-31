// Bank accounts API (read + write) backed by Supabase public.bank_accounts.
// Crystocraft's OWN accounts for receiving customer payments — the single
// source that replaces bank details retyped into every quote/PI. Supplier
// remittance accounts are deliberately not here (BEC-fraud target, needs its
// own design).
//
// Admin-only, same posture as /api/uc and /api/erp: verifies the caller's
// Firebase token and role:'admin', then uses the Supabase secret key
// server-side. The browser never sees the key.
//
//   POST { op: 'list',   currency?, activeOnly? }   -> { rows }
//   POST { op: 'create', data }                     -> { row }
//   POST { op: 'update', id, data }                 -> { row }
//   POST { op: 'audit',  id }                       -> { rows }   change history
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

const WRITABLE = new Set([
  'currency', 'label', 'bank_name', 'bank_address', 'beneficiary',
  'account_no', 'swift', 'iban', 'intermediary', 'bank_country',
  'local_code_label', 'local_code',
  'payment_methods', 'reference_note', 'notes', 'is_default', 'active',
])

// IBAN mod-97 (ISO 13616). Rejecting a bad IBAN at the API boundary is the
// whole point of storing these once: a transposed digit fails arithmetically,
// so it can never reach a document. Iterative remainder — the expanded number
// exceeds Number's safe integer range.
function ibanValid(value) {
  const v = String(value).toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false
  const rearranged = v.slice(4) + v.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const part = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of part) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

// Returns { data } or { error }.
function clean(input) {
  const out = {}
  for (const k of Object.keys(input || {})) if (WRITABLE.has(k)) out[k] = input[k]

  // Required fields are enforced on create only (see the handler), so a partial
  // update — e.g. just toggling `active` — doesn't have to resend everything.
  if ('currency' in out) {
    out.currency = String(out.currency).trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(out.currency)) return { error: 'Currency must be a 3-letter code (e.g. USD).' }
  }
  for (const k of ['label', 'bank_name', 'bank_address', 'beneficiary', 'account_no',
                   'intermediary', 'bank_country', 'local_code_label',
                   'payment_methods', 'reference_note', 'notes']) {
    if (k in out) out[k] = out[k] == null ? null : String(out[k]).trim() || null
  }
  if ('swift' in out) {
    const rawSwift = String(out.swift || '').trim()
    out.swift = rawSwift.replace(/\s/g, '').toUpperCase() || null
    if (out.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(out.swift)) {
      // Banks print the code alongside a note ("BCIRLULL (BCIRLULLXXX * if 11
      // characters are required)"), and the whole line gets pasted in. Echo
      // what arrived so the cause is obvious instead of just restating the rule.
      const looksPasted = /[()*]|required/i.test(rawSwift)
      return {
        error: looksPasted
          ? `That looks like the bank's whole note. Enter only the code itself — e.g. BCIRLULL — not “${rawSwift.slice(0, 60)}”.`
          : `“${rawSwift.slice(0, 40)}” isn't a valid SWIFT/BIC. It must be 8 or 11 characters: 6 letters then alphanumerics.`,
      }
    }
  }
  if ('iban' in out) {
    out.iban = String(out.iban || '').replace(/\s/g, '').toUpperCase() || null
    if (out.iban && !ibanValid(out.iban)) {
      return { error: 'That IBAN fails its checksum — check for a mistyped or transposed character.' }
    }
  }
  // Domestic clearing code (sort code / ABA routing / BSB / …). Kept generic,
  // but where the scheme is identifiable its own rules are applied — same
  // reasoning as the IBAN checksum: catch a wrong digit here, not at the bank.
  if ('local_code' in out) {
    const raw = String(out.local_code || '').trim()
    out.local_code = raw || null
    if (out.local_code) {
      const digits = raw.replace(/\D/g, '')
      const kind = String(out.local_code_label || '').toLowerCase()
      if (/sort/.test(kind) && digits.length !== 6) {
        return { error: `A UK sort code is 6 digits — “${raw.slice(0, 30)}” has ${digits.length}.` }
      }
      if (/aba|routing/.test(kind)) {
        if (digits.length !== 9) {
          return { error: `A US routing number is 9 digits — “${raw.slice(0, 30)}” has ${digits.length}.` }
        }
        // ABA check digit: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10)
        const w = [3, 7, 1, 3, 7, 1, 3, 7, 1]
        const sum = digits.split('').reduce((s, d, i) => s + Number(d) * w[i], 0)
        if (sum % 10 !== 0) {
          return { error: 'That routing number fails its check digit — verify it against the bank document.' }
        }
      }
      if (!digits) return { error: 'The clearing code should contain digits.' }
    }
  }

  // An account needs SOMETHING to pay into.
  if (('account_no' in out || 'iban' in out) && !out.account_no && !out.iban) {
    return { error: 'Enter an account number or an IBAN.' }
  }
  if ('is_default' in out) out.is_default = !!out.is_default
  if ('active' in out) out.active = !!out.active
  return { data: out }
}

async function getRole(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return ''
  const doc = await r.json()
  return doc?.fields?.role?.stringValue || ''
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!SUPABASE_URL || !KEY || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid, email
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub; email = payload.email || null
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  // V8.13: admin has full access; sales (front office) may READ its own
  // receiving-bank details (op 'list'/'audit') to show on a quote/PI/invoice,
  // but never create/update an account (that stays admin — BankAccounts is a
  // settings page sales can't reach).
  const role = await getRole(uid, token, PROJECT_ID)
  if (role !== 'admin' && role !== 'sales') return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  if (role === 'sales' && !['list', 'audit'].includes(body.op)) {
    return json({ error: 'Bank account changes are admin-only.' }, 403)
  }
  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json', ...(init?.headers || {}) },
  })

  if (body.op === 'list') {
    const p = new URLSearchParams()
    p.set('select', '*'); p.set('order', 'currency.asc,is_default.desc,id.asc')
    if (body.activeOnly === true) p.set('active', 'is.true')
    if (body.currency) p.set('currency', `eq.${String(body.currency).replace(/[^A-Za-z]/g, '').toUpperCase()}`)
    const r = await rest(`bank_accounts?${p.toString()}`)
    if (!r.ok) return json({ error: 'List failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ rows: await r.json() })
  }

  if (body.op === 'create') {
    const { data, error } = clean(body.data)
    if (error) return json({ error }, 400)
    for (const k of ['currency', 'bank_name', 'beneficiary']) {
      if (!data[k]) return json({ error: `${k.replace('_', ' ')} is required.` }, 400)
    }
    const r = await rest('bank_accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...data, created_by: email, updated_by: email }),
    })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300)
      // The partial unique index is the DB enforcing one default per currency.
      if (detail.includes('ux_bank_default_per_currency')) {
        return json({ error: `There is already a default account for ${data.currency}. Clear that one first.` }, 409)
      }
      return json({ error: 'Create failed', detail }, 502)
    }
    return json({ row: (await r.json())[0] })
  }

  if (body.op === 'update') {
    const id = parseInt(body.id, 10)
    if (!id) return json({ error: 'Missing id' }, 400)
    const { data, error } = clean(body.data)
    if (error) return json({ error }, 400)
    const r = await rest(`bank_accounts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...data, updated_by: email }),
    })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300)
      if (detail.includes('ux_bank_default_per_currency')) {
        return json({ error: 'There is already a default account for that currency. Clear that one first.' }, 409)
      }
      return json({ error: 'Update failed', detail }, 502)
    }
    return json({ row: (await r.json())[0] })
  }

  // Change history for one account — who changed what, when.
  if (body.op === 'audit') {
    const id = parseInt(body.id, 10)
    if (!id) return json({ error: 'Missing id' }, 400)
    const r = await rest(`bank_accounts_audit?account_id=eq.${id}&select=*&order=id.desc&limit=100`)
    if (!r.ok) return json({ error: 'Audit query failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ rows: await r.json() })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}
