import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { validId } from './customerAccess.js'

export const decisionConflict = () => ({
  error: 'This request has changed. Refresh to see the current decision.', status: 409,
})

export function canReviewProfile(user, invitation, invitationId) {
  return user?.role === 'customer' && user.status === 'pending' && user.invitation_id === invitationId &&
    (!user.email || user.email.trim().toLowerCase() === invitation.contact_email?.trim().toLowerCase())
}

const mailLeaseMs = 10 * 60 * 1000
function beginDelivery() {
  return {
    email_send_status: 'sending', email_send_error: null,
    approval_email_attempt: randomUUID(), approval_email_started_at: Timestamp.now(),
  }
}

// All document reads belong to the caller's transaction. A notification is
// returned only to the invocation whose decision actually commits.
export function stageApproval(tx, { ref, inv, userRef, user, customer, customerId, actor, edits = {}, claim }) {
  const pricing = { ...inv.pricing, ...edits.pricing }
  const account = {
    ...claim?.profile, status: 'approved', customer_id: customerId,
    sensitive: !!customer?.sensitive, erp_code: customer?.erp_code || '', erp_code_shared: !!customer?.erp_code_shared,
  }
  if (customer) account.company_name = customer.company_name || user.company_name || ''
  if (edits.accountType) account.account_type = edits.accountType
  for (const key of ['base_currency', 'fx_rate', 'ws_discount_pct']) {
    if (key in pricing) account[key] = pricing[key]
  }
  tx.set(userRef, account, { merge: true })
  if ('corp_markup_override' in pricing)
    tx.set(ref.firestore.collection('account_pricing').doc(userRef.id), { corp_markup_override: pricing.corp_markup_override }, { merge: true })

  const at = Timestamp.now()
  const approval = { at, by: actor, action: claim ? 'auto_approved' : 'approved' }
  const mail = beginDelivery()
  tx.update(ref, {
    ...claim?.invitation, ...mail, status: 'approved', approved_at: at, customer_id: customerId,
    audit_log: FieldValue.arrayUnion(...(claim ? [claim.audit, approval] : [approval])),
  })
  return { status: 'approved', delivery: {
    attempt: mail.approval_email_attempt, google: user.auth_provider === 'google.com',
    email: inv.contact_email, customerId, company: customer?.company_name || inv.applicant_company_name || '',
  } }
}

export function approveClaimed(ref, suppliedCustomerId, actor, edits) {
  return ref.firestore.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (!inv) return { error: 'Invitation not found', status: 404 }
    if (inv.status !== 'claimed' || !validId(inv.claimed_uid) ||
      (edits.expectedUid && edits.expectedUid !== inv.claimed_uid)) return decisionConflict()
    const userRef = ref.firestore.collection('users').doc(inv.claimed_uid)
    const user = (await tx.get(userRef)).data()
    if (!canReviewProfile(user, inv, ref.id)) return decisionConflict()
    const customerId = suppliedCustomerId || inv.customer_id || user.customer_id || null
    if (!customerId && (edits.accountType || user.account_type) !== 'internal')
      return { error: 'Link this request to a customer record before approving.', status: 400 }
    if (customerId && !validId(customerId)) return decisionConflict()
    const customer = customerId ? (await tx.get(ref.firestore.collection('customers').doc(customerId))).data() : null
    if (customerId && !customer) return { error: 'That customer record no longer exists.', status: 404 }
    return stageApproval(tx, { ref, inv, userRef, user, customerId, customer, actor, edits })
  })
}

export function retryApprovalDelivery(ref, expectedMailStatus) {
  return ref.firestore.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (inv?.status !== 'approved' || !validId(inv.claimed_uid) ||
      (expectedMailStatus && inv.email_send_status !== expectedMailStatus)) return decisionConflict()
    if (inv.email_send_status === 'sending' && Date.now() - inv.approval_email_started_at?.toMillis() < mailLeaseMs)
      return { error: 'The approval email is still being sent.', status: 409 }
    const user = (await tx.get(ref.firestore.collection('users').doc(inv.claimed_uid))).data()
    if (user?.status !== 'approved' || user.role !== 'customer' || user.invitation_id !== ref.id ||
      (user.email && user.email.toLowerCase() !== inv.contact_email?.toLowerCase())) return decisionConflict()
    const customer = inv.customer_id ? (await tx.get(ref.firestore.collection('customers').doc(inv.customer_id))).data() : null
    const mail = beginDelivery()
    tx.update(ref, mail)
    return { delivery: { attempt: mail.approval_email_attempt, google: user.auth_provider === 'google.com',
      email: inv.contact_email, customerId: inv.customer_id, company: customer?.company_name || inv.applicant_company_name || '' } }
  })
}

export function recordApprovalDelivery(ref, delivery, actor, result) {
  return ref.firestore.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (inv?.status !== 'approved' || inv.approval_email_attempt !== delivery.attempt) return
    const at = Timestamp.now()
    const action = result.ok ? (delivery.google ? 'google_approved_notification_sent' : 'setup_link_sent') : 'approval_email_failed'
    tx.update(ref, { email_send_status: result.ok ? 'sent' : 'failed', email_send_error: result.ok ? null : result.error,
      last_resent_at: at, resend_count: FieldValue.increment(1), audit_log: FieldValue.arrayUnion({ at, by: actor, action }) })
  })
}
