// Client for /api/portal-invite (SU-07A — netlify/functions/portal-invite.js,
// a Node function, not a Deno edge function — see that file's header for
// why). Same authed-fetch posture as campaignApi.js/outreachApi.js for every
// admin action; claimInvitation is the one PUBLIC action (an unauthenticated
// invitee opening their invitation link has no Firebase session yet).
import { authedUser } from './firebase'

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

export const createInvitation = (customerId, contactEmail, contactName, marketingContactId) =>
  callAdmin('create_invitation', { customerId, contactEmail, contactName, marketingContactId })

export const resendInvitation = invitationId => callAdmin('resend_invitation', { invitationId })
export const revokeInvitation = invitationId => callAdmin('revoke_invitation', { invitationId })
export const rejectInvitation = invitationId => callAdmin('reject_invitation', { invitationId })
// customerId is optional — required only when approving a self-submitted
// application (source:'self') that has no customer link yet, or to correct
// an admin-invitation's link before approving. See portal-invite.js's
// approveInvitation.
export const approveInvitation = (invitationId, customerId) =>
  callAdmin('approve_invitation', { invitationId, customerId })

// AccountEdit.jsx's "Delete account" — deletes BOTH the Firebase Auth user
// and the users/{uid} Firestore doc (the old deleteDoc-only client path left
// the Auth credential behind forever, causing a deleted-then-recreated
// account to keep hitting already_registered). See portal-invite.js's
// deleteAccount.
export const deleteAccount = uid => callAdmin('delete_account', { uid })

// Public — no Firebase session; the raw claim token from the invitation
// link IS the credential here.
export const claimInvitation = (invitationId, token, email, contactName) =>
  call('claim_invitation', { invitationId, token, email, contactName })

export const getInvitationPreview = (invitationId, token) =>
  call('get_invitation', { invitationId, token })

// Public — the "Create account" tab's replacement for immediate
// createUserWithEmailAndPassword. See portal-invite.js's applyForAccount.
// hp: honeypot value from Login.jsx's hidden field — passed through untouched,
// portal-invite.js is the one place that interprets it.
export const applyForAccount = (companyName, contactName, email, currency, hp = '') =>
  call('apply_for_account', { companyName, contactName, email, currency, hp })

// Google-authenticated self-signup — Login.jsx calls this AFTER the visitor
// has already completed Sign in with Google (so this goes through callAdmin,
// not call() — the caller has a real Firebase session even though they
// aren't an admin; requireAuth on the server accepts any signed-in user for
// this one action). See portal-invite.js's applyForAccountGoogle.
export const applyForAccountGoogle = (companyName, contactName, currency) =>
  callAdmin('apply_for_account_google', { companyName, contactName, currency })
