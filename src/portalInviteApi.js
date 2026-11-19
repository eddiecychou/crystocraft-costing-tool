// Client for /api/portal-invite (SU-07A — netlify/functions/portal-invite.js,
// a Node function, not a Deno edge function — see that file's header for
// why). Same authed-fetch posture as campaignApi.js/outreachApi.js for every
// admin action; claimInvitation is the one PUBLIC action (an unauthenticated
// invitee opening their invitation link has no Firebase session yet).
import { authedUser } from './firebase'

export const VERIFIED_GOOGLE_MESSAGE = 'Sign in with Google using a verified email address, then try again.'

async function callAdmin(action, payload) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  return call(action, payload, token)
}

async function call(action, payload, token) {
  const res = await fetch('/api/portal-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// pricing (optional): { baseCurrency, fxRate, wsDiscountPct, corpMarkupOverride }
// — set on the invitation and mirrored onto the account at approval time
// (auto-approval for an admin invitation happens the moment the customer
// claims it, so this is the only chance to set it before they're in). See
// CustomerDetail.jsx's InvitePricingDialog and portal-invite.js's
// stageApproval in lib/portalApproval.js.
export const createInvitation = (customerId, contactEmail, contactName, marketingContactId, pricing) =>
  callAdmin('create_invitation', { customerId, contactEmail, contactName, marketingContactId, pricing })

export const resendInvitation = (invitationId, expectedStatus, expectedMailStatus) => callAdmin('resend_invitation', { invitationId, expectedStatus, expectedMailStatus })
export const revokeInvitation = (invitationId, expectedStatus = 'pending') => callAdmin('revoke_invitation', { invitationId, expectedStatus })
export const rejectInvitation = (invitationId, expectedUid) => callAdmin('reject_invitation', { invitationId, expectedUid })
// customerId is optional — required only when approving a self-submitted
// application (source:'self') that has no customer link yet, or to correct
// an admin-invitation's link before approving. See portal-invite.js's
// approveInvitation.
export const approveInvitation = (invitationId, customerId, { accountType, pricingChanges, expectedUid } = {}) =>
  callAdmin('approve_invitation', { invitationId, customerId, accountType, pricingChanges, expectedUid })

// AccountEdit.jsx's "Delete account" — deletes BOTH the Firebase Auth user
// and the users/{uid} Firestore doc (the old deleteDoc-only client path left
// the Auth credential behind forever, causing a deleted-then-recreated
// account to keep hitting already_registered). See portal-invite.js's
// deleteAccount.
export const deleteAccount = uid => callAdmin('delete_account', { uid })

// Private correspondence can exist before this login is linked to a CRM customer.
export const getAccountFollowup = uid => callAdmin('get_account_followup', { uid })
export const saveAccountFollowupDraft = (uid, draft) => callAdmin('save_account_followup_draft', { uid, ...draft })
export const sendAccountFollowup = (uid, message) => callAdmin('send_account_followup', { uid, ...message })
export const markAccountInformationReceived = (uid, revision) => callAdmin('mark_account_information_received', { uid, revision })
export const resolveAccountFollowup = (uid, messageId, outcome, revision) => callAdmin('resolve_account_followup', { uid, messageId, outcome, revision })

// Public — no Firebase session; the raw claim token from the invitation
// link IS the credential here.
export const claimInvitation = (invitationId, token, email, contactName) =>
  call('claim_invitation', { invitationId, token, email, contactName })

export const getInvitationPreview = (invitationId, token) =>
  call('get_invitation', { invitationId, token })

// Google-authenticated claim — InvitationClaim.jsx calls this AFTER the
// visitor has already completed Sign in with Google on that page, same
// callAdmin (real session, not admin role) posture as applyForAccountGoogle.
// See portal-invite.js's claimInvitationGoogle.
export const claimInvitationGoogle = (invitationId, token, contactName) =>
  callAdmin('claim_invitation_google', { invitationId, token, contactName })

// Public — the "Create account" tab's replacement for immediate
// createUserWithEmailAndPassword. See portal-invite.js's applyForAccount.
// hp: honeypot value from Login.jsx's hidden field — passed through untouched,
// portal-invite.js is the one place that interprets it.
// Keep only a random retry key on this browser. A lost response, reload or
// second tab must reuse it until the server confirms the pending application.
const inMemorySignupKeys = new Map()
export async function applyForAccount(companyName, contactName, email, currency, hp = '') {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  const storageKey = 'oc.portal.signup.' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
  function getKey() {
    let key = inMemorySignupKeys.get(storageKey)
    try { key = localStorage.getItem(storageKey) || key } catch { /* private browsing */ }
    if (!key) key = crypto.randomUUID()
    inMemorySignupKeys.set(storageKey, key)
    try { localStorage.setItem(storageKey, key) } catch { /* same-page retry still works */ }
    return key
  }
  const retryKey = navigator.locks ? await navigator.locks.request(storageKey, getKey) : getKey()
  const result = await call('apply_for_account', { companyName, contactName, email, currency, hp, retryKey })
  if (result.ok !== true || result.status !== 'pending') throw new Error('Application not confirmed')
  inMemorySignupKeys.delete(storageKey)
  try {
    if (localStorage.getItem(storageKey) === retryKey) localStorage.removeItem(storageKey)
  } catch { /* storage unavailable */ }
  return result
}

// Google-authenticated self-signup — Login.jsx calls this AFTER the visitor
// has already completed Sign in with Google (so this goes through callAdmin,
// not call() — the caller has a real Firebase session even though they
// aren't an admin; requireAuth on the server accepts any signed-in user for
// this one action). See portal-invite.js's applyForAccountGoogle.
export const applyForAccountGoogle = (companyName, contactName, currency) =>
  callAdmin('apply_for_account_google', { companyName, contactName, currency })

export function retryAccessAlert(invitationId) {
  return callAdmin('retry_access_alert', {invitationId, confirmedNotSent:true})
}

export const listAccountFollowupStates = uids => callAdmin('list_account_followup_states', { uids })

export const approveLegacyAccount = (uid, customerId, role, expectedStatus) => callAdmin('approve_legacy_account', { uid, customerId, role, expectedStatus })
