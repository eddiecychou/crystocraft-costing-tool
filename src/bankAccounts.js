// Client for Crystocraft's own receiving bank accounts, via the /api/bank edge
// function. The browser never talks to Supabase directly — it sends the
// signed-in user's Firebase token and the edge function does the work.
//
// These replace the bank details that used to be retyped into every quote/PI.
import { auth } from './firebase'

async function call(body) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) {
    // Surface `detail` too. Without it a database error arrives as the bare
    // string "Create failed", which says nothing and is unactionable — that
    // hid a missing grant on the audit table on first use.
    const msg = [data.error, data.detail].filter(Boolean).join(' — ')
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return data
}

export const listBankAccounts = (opts = {}) =>
  call({ op: 'list', ...opts }).then((d) => d.rows || [])

export const createBankAccount = (data) => call({ op: 'create', data }).then((d) => d.row)
export const updateBankAccount = (id, data) => call({ op: 'update', id, data }).then((d) => d.row)
export const bankAccountAudit = (id) => call({ op: 'audit', id }).then((d) => d.rows || [])

// The account a document should use: the active default for that currency,
// falling back to any active account in it. Returns null when none exists —
// callers must handle that rather than silently rendering nothing.
export function accountForCurrency(accounts, currency) {
  if (!currency) return null
  const cur = String(currency).trim().toUpperCase()
  const inCur = accounts.filter((a) => a.active && a.currency === cur)
  return inCur.find((a) => a.is_default) || inCur[0] || null
}

// Rendered block for a quote/PI. Kept here so every document formats identically.
// Field order and wording follow the remittance documents the team already
// uses, so the block reads the way a customer's bank expects.
// `payment_methods` and `reference_note` are included deliberately: an account
// that only accepts SEPA will bounce a SWIFT wire, and a payment with no
// invoice number in the memo can't be matched to an order. Both are as
// necessary as the digits. `notes` is internal and never rendered.
export function formatBankDetails(a) {
  if (!a) return ''
  const lines = [
    ['Beneficiary', a.beneficiary],
    ['Beneficiary Bank', a.bank_name],
    ['Bank Address', [a.bank_address, a.bank_country].filter(Boolean).join(', ')],
    ['Account No', a.account_no],
    // Labelled with the scheme's own name — "Sort Code: 608382" is what a UK
    // payer expects to see, not a generic "Local Code".
    [a.local_code_label || 'Local Code', a.local_code],
    ['IBAN', a.iban],
    ['SWIFT', a.swift],
    ['Intermediary Bank', a.intermediary],
    ['Accepted Payments', a.payment_methods],
    ['Payment Reference', a.reference_note],
  ]
  return lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
}
