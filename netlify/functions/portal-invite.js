import { approveClaimed, canReviewProfile, decisionConflict, recordApprovalDelivery, retryApprovalDelivery, stageApproval } from './lib/portalApproval.js'
import { validId } from './lib/customerAccess.js'
import { prepareEmailApplication, emailApplicationStatus } from './lib/portalSignupRetry.js'
import { approveLegacyAccount } from './lib/approveLegacyAccount.js'
// SU-07A — customer portal invitation / approval / password-setup flow.
//
// A Node Lambda function, not a Deno edge function — the one exception to
// this app's usual "everything is netlify/edge-functions/" pattern. Reason:
// this is the only feature that needs the Firebase ADMIN SDK (create an Auth
// user with no password set, generate a real Firebase password-reset action
// code with a custom continue URL) — firebase-admin needs Node APIs and
// cannot run on Netlify's Deno edge runtime, and hand-rolling the Identity
// Toolkit REST contract for a security-critical action-code flow was judged
// too risky to get exactly right without live testing against a real
// project. Approved explicitly (owner, 2026-08-19) before this file existed.
//
// Every ordinary Firestore invitation-record write, resend/revoke/reject,
// and the Resend email send stays consistent with the rest of the app's
// conventions (lib/resendTags.js is reused unchanged from netlify/edge-
// functions/lib/ — it's plain JS with no Deno-specific API, so it works
// fine imported from Node too).
//
// Collection: portal_invitations/{id}
//   customer_id, contact_email, contact_name, marketing_contact_id (nullable),
//   status: 'pending' | 'claimed' | 'approved' | 'rejected' | 'revoked' | 'expired',
//   token_hash (sha256 of the raw claim token — the raw token is NEVER stored),
//   created_by, created_at, expires_at,
//   claimed_at, claimed_uid, approved_at, rejected_at, revoked_at,
//   email_send_status, email_send_error, resend_count, last_resent_at,
//   audit_log: [{ at, action, by }]
//
// users/{uid} created at claim time has NO password set at all (Admin SDK
// createUser({email}) with no password field) — structurally cannot sign in
// until confirmPasswordReset() runs client-side against a real Firebase
// action code, which is a stronger guarantee than a Firestore flag alone.
//
// Env (Netlify site vars, server-side only — shared with the existing Deno
// functions, e.g. resend-webhook.js):
//   FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / VITE_FIREBASE_PROJECT_ID
//   RESEND_API_KEY, MAIL_FROM (or MAIL_PERSONAL_FROM), MAIL_REPLY_TO/MAIL_ADMIN
//   PORTAL_URL — this app's own origin, for invitation/setup links
// firebase-admin v14's ESM default export is app-management only
// (initializeApp/cert/getApps/...) — auth() and firestore() are NOT
// attached to it. The modular subpath imports below are the only working
// way to use the Admin SDK from ESM in this version.
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { buildResendTags } from '../edge-functions/lib/resendTags.js'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { queueAccessAlert, deliverAccessAlert, retryReviewedAccessAlert } from './lib/portalAccessAlerts.js'
import { accountFollowupAction } from './lib/portalAccountFollowup.js'

const INVITE_EXPIRY_DAYS = 7
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ── token handling — raw token NEVER stored, only its hash ────────────────
function newToken() {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashToken(raw) }
}
function hashToken(raw) {
  return createHash('sha256').update(String(raw || '')).digest('hex')
}
function tokensMatch(presentedRaw, storedHash) {
  if (!presentedRaw || !storedHash) return false
  const a = Buffer.from(hashToken(presentedRaw), 'hex')
  const b = Buffer.from(String(storedHash), 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const normEmail = e => String(e || '').trim().toLowerCase()

// Same currency list as src/currency.js's CUSTOMER_CURRENCIES — duplicated
// rather than imported (this file can't share a runtime/module graph with
// the client bundle) and the same field semantics as AccountEdit.jsx's own
// "Pricing" card save logic (saveForm), which this exists to pre-seed:
// ws_discount_pct is "% of list price", non-positive/blank defaults to 100
// (full price, no discount); corp_markup_override blank/non-numeric
// defaults to 0 (no override); fx_rate only applies off-USD and is null
// (use the live rate) when not set.
const INVITE_CURRENCIES = ['USD', 'EUR', 'HKD', 'GBP', 'AUD', 'CAD', 'SGD']
function sanitizePricing(p) {
  if (!p || typeof p !== 'object') return null
  const baseCurrency = INVITE_CURRENCIES.includes(p.baseCurrency) ? p.baseCurrency : 'USD'
  const fxRateNum = Number(p.fxRate)
  return {
    base_currency: baseCurrency,
    fx_rate: baseCurrency !== 'USD' && Number.isFinite(fxRateNum) && fxRateNum > 0 ? fxRateNum : null,
    ws_discount_pct: Number(p.wsDiscountPct) > 0 ? Number(p.wsDiscountPct) : 100,
    corp_markup_override: Number(p.corpMarkupOverride) || 0,
  }
}

// Use the provider for this sign-in. A linked Google identity can also have a password.
async function requireAuth(req, { verifiedGoogle = false } = {}) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return { error: json({ error: 'Not signed in' }, 401) }
  try {
    const decoded = await getAuth().verifyIdToken(token)
    if (verifiedGoogle && (decoded.firebase?.sign_in_provider !== 'google.com' ||
      decoded.email_verified !== true || typeof decoded.email !== 'string' || !decoded.email.trim())) {
      return { error: json({ error: 'verified_google_required' }, 403) }
    }
    return { uid: decoded.uid, email: decoded.email || '' }
  } catch {
    return { error: json({ error: 'Invalid or expired session' }, 401) }
  }
}

async function requireAdmin(req) {
  const { uid, email, error } = await requireAuth(req)
  if (error) return { error }
  const userSnap = await getFirestore().collection('users').doc(uid).get()
  if (userSnap.data()?.role !== 'admin') return { error: json({ error: 'Admin access required' }, 403) }
  return { uid, email }
}

function auditEntry(action, by) {
  return { at: Timestamp.now(), action, by: by || 'system' }
}

async function sendResendEmail({ to, subject, html, text, tags }) {
  const API_KEY = process.env.RESEND_API_KEY
  // MAIL_FROM (noreply@crystocraft.com), NOT MAIL_PERSONAL_FROM — this is a
  // system/transactional email (invitation, setup link), same sender as
  // every other automated portal email (send-email.js's account_approved/
  // signup/enquiry). MAIL_PERSONAL_FROM is eddie@crystocraft.com, reserved
  // for Daily Drafts' personal-note sends specifically (see send-personal-
  // email.js) — using it here read as a real, individually-sent email from
  // Eddie rather than an automated system notice, which is what confused
  // the first live test (found live 2026-08-19).
  const FROM = process.env.MAIL_FROM || 'Crystocraft <onboarding@resend.dev>'
  const REPLY_TO = process.env.MAIL_REPLY_TO || process.env.MAIL_ADMIN || ''
  if (!API_KEY || !FROM) return { ok: false, error: 'Email is not configured on the server.' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to, subject, html, text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        ...(tags?.length ? { tags: buildResendTags(tags) } : {}),
      }),
    })
    if (!r.ok) {
      // Never log the recipient's raw invitation/setup link — only Resend's
      // own error body, truncated, same posture as every other edge
      // function's error handling in this app.
      const errText = (await r.text()).slice(0, 300)
      return { ok: false, error: `Resend rejected the email: ${errText}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

// Same branded shell/helpers as netlify/edge-functions/send-email.js
// (account_approved/signup/enquiry templates) — duplicated rather than
// imported since that file is a Deno edge function and this one is a Node
// function with a different bundler; kept byte-identical on purpose so
// every portal email reads as one consistent, trustworthy system,
// whichever runtime sent it. Update both together if the branding changes.
const BRAND = '#6E2433'
const GOLD  = '#C6A664'

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

const emailShell = (heading, bodyHtml) => `
<div style="margin:0;padding:24px;background:#F7EEE3;font-family:Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E9E8E6;">
    <div style="background:#1C1C1A;padding:18px 24px;">
      <span style="color:#fff;font-size:18px;letter-spacing:3px;font-weight:bold;">CRYSTOCRAFT</span>
      <span style="color:${GOLD};font-size:11px;letter-spacing:2px;display:block;margin-top:2px;">PRODUCT PORTAL</span>
    </div>
    <div style="padding:28px 24px;">
      <h1 style="font-size:19px;color:#222;margin:0 0 16px;font-weight:normal;">${heading}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #E9E8E6;color:#888;font-size:11px;">
      Crystocraft — craftsmanship that catches the light, since 1958.
    </div>
  </div>
</div>`

const emailP = t => `<p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 14px;">${t}</p>`
const emailBtn = (href, label) =>
  `<a href="${escHtml(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;font-size:13px;letter-spacing:1px;">${escHtml(label)}</a>`

function invitationEmailHtml({ companyName, portalUrl }) {
  return emailShell('You\'re invited to the Crystocraft portal', [
    emailP(`Crystocraft is inviting you to set up an online account for <strong>${escHtml(companyName)}</strong> on our customer portal — for browsing your catalogue, pricing, and order history in one place.`),
    emailP('You do not need to create a password yet. Click below to confirm your details; our team will review and approve the account, then send you a secure link to set your own password.'),
    `<p style="margin:20px 0;">${emailBtn(portalUrl, 'View your invitation')}</p>`,
    emailP('<span style="color:#888;font-size:12px;">If you weren\'t expecting this, or aren\'t sure why you received it, please reply to this email and let us know — no account will be created unless you confirm it yourself.</span>'),
  ].join(''))
}

function setupEmailHtml({ companyName, setupUrl }) {
  return emailShell('Your account is approved', [
    emailP(`Your Crystocraft customer portal account for <strong>${escHtml(companyName)}</strong> has been approved.`),
    emailP('Click below to set your password and sign in. This link is single-use and expires soon, for your security.'),
    `<p style="margin:20px 0;">${emailBtn(setupUrl, 'Set your password')}</p>`,
  ].join(''))
}

// Google-authenticated accounts (applyForAccountGoogle) never had a
// password to begin with — sending them setupEmailHtml's "set your
// password" link would be actively wrong (found live, 2026-08-19: the
// approved test account got a password-setup email despite having signed
// up entirely via Google). No action needed at all really, since they can
// already sign back in with the same Google account right now — this email
// exists purely to give the same "you're approved" notification every other
// approval path sends.
function googleApprovedEmailHtml({ companyName, portalUrl }) {
  return emailShell('Your account is approved', [
    emailP(`Your Crystocraft customer portal account for <strong>${escHtml(companyName)}</strong> has been approved.`),
    emailP('Sign in with the same Google account you used to sign up — no password needed.'),
    `<p style="margin:20px 0;">${emailBtn(portalUrl, 'Sign in')}</p>`,
  ].join(''))
}

// Deliberately generic ("your Crystocraft account", not "customer portal") —
// /login is shared by portal customers and internal staff, and both use this
// same forgot-password path.
function resetEmailHtml({ resetUrl }) {
  return emailShell('Reset your password', [
    emailP('We received a request to reset the password on your Crystocraft account.'),
    emailP('Click below to choose a new password. This link is single-use and expires soon, for your security.'),
    `<p style="margin:20px 0;">${emailBtn(resetUrl, 'Reset your password')}</p>`,
    emailP('<span style="color:#888;font-size:12px;">If you didn\'t ask to reset your password, you can ignore this email — nothing will change.</span>'),
  ].join(''))
}

// ── actions ─────────────────────────────────────────────────────────────

async function createInvitation(body, adminUid) {
  const customerId = String(body?.customerId || '').trim()
  const contactEmail = normEmail(body?.contactEmail)
  const contactName = String(body?.contactName || '').trim()
  const marketingContactId = body?.marketingContactId ? String(body.marketingContactId).trim() : null
  const pricing = sanitizePricing(body?.pricing)
  if (!customerId) return json({ error: 'customerId is required' }, 400)
  if (!EMAIL_RE.test(contactEmail)) return json({ error: 'A valid contact email is required' }, 400)

  const db = getFirestore()
  const customerSnap = await db.collection('customers').doc(customerId).get()
  if (!customerSnap.exists) return json({ error: 'That customer record no longer exists.' }, 404)
  const companyName = String(customerSnap.data()?.company_name || '')

  // Duplicate-invitation guard — an existing non-terminal invitation for the
  // SAME customer+email pair is reused (resend it) rather than creating a
  // second one, per SU-07A's explicit "duplicate invitation does not create
  // duplicate portal accounts" requirement.
  const existing = await db.collection('portal_invitations')
    .where('customer_id', '==', customerId)
    .where('contact_email', '==', contactEmail)
    .where('status', 'in', ['pending', 'claimed', 'approved'])
    .limit(1)
    .get()
  if (!existing.empty) {
    const d = existing.docs[0]
    const existingInv = d.data()
    // Re-clicking "Invite to portal" with new pricing used to be silently
    // dropped here — the duplicate guard returned the old record without
    // ever looking at the new `pricing` argument, so an admin correcting a
    // customer's WS %/currency before they'd claimed yet had no effect
    // (found 2026-09-24: owner had invited a customer, wanted to set her
    // pricing, and the second invite attempt did nothing). Safe to update
    // ONLY while still 'pending' — nothing has happened yet, so there's no
    // live account or in-flight claim to conflict with. Once 'claimed' or
    // 'approved', pricing changes go through AccountEdit.jsx instead (the
    // account already exists by then).
    let pricingUpdated = false
    if (existingInv.status === 'pending' && pricing) {
      try {
        await d.ref.update({ pricing, audit_log: FieldValue.arrayUnion(auditEntry('pricing_updated', adminUid)) }, { lastUpdateTime: d.updateTime })
      } catch (error) {
        if (error.code === 9 || error.code === 5) return json({ error: decisionConflict().error }, 409)
        throw error
      }
      pricingUpdated = true
    }
    return json({ ok: true, id: d.id, reused: true, status: existingInv.status, pricingUpdated })
  }

  const { raw, hash } = newToken()
  const now = Timestamp.now()
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  const ref = db.collection('portal_invitations').doc()
  await ref.set({
    customer_id: customerId, contact_email: contactEmail, contact_name: contactName,
    marketing_contact_id: marketingContactId,
    // Admin-picked pricing to apply the moment this invitation is approved
    // (which, since auto-approve, is the moment the customer claims it —
    // see stageApproval). null when the admin didn't set any, in which case
    // approval falls back to its pre-existing defaults exactly as before
    // this field existed. See CustomerDetail.jsx's InvitePricingDialog.
    pricing,
    // 'admin' = an admin invited a known customer contact (this function);
    // 'self' = the applicant submitted "Request account" themselves
    // (applyForAccount below) — PortalInvitations.jsx shows a badge so the
    // two are never confused, but both share every other field/lifecycle.
    source: 'admin',
    status: 'pending',
    token_hash: hash,
    created_by: adminUid, created_at: now, expires_at: expiresAt,
    claimed_at: null, claimed_uid: null, approved_at: null, rejected_at: null, revoked_at: null,
    email_send_status: null, email_send_error: null, resend_count: 0, last_resent_at: null,
    audit_log: [auditEntry('created', adminUid)],
  })

  const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
  const claimUrl = `${PORTAL_URL}/invite/${ref.id}?t=${raw}`
  const send = await sendResendEmail({
    to: contactEmail, subject: `You're invited to the Crystocraft customer portal`,
    html: invitationEmailHtml({ companyName, portalUrl: claimUrl }),
    text: `Crystocraft is inviting you to set up a customer portal account for ${companyName}. Open this link to continue: ${claimUrl}`,
    tags: [{ name: 'invitation_id', value: ref.id, prefix: 'invite' }, { name: 'customer_id', value: customerId, prefix: 'customer' }],
  })
  await recordInvitationEmail(ref, hash, send)
  if (!send.ok) {
    // The invitation record exists (so it can be resent) but must NOT be
    // reported to the admin as a successful send.
    return json({ ok: false, id: ref.id, error: `Invitation created, but the email failed to send: ${send.error}` }, 502)
  }
  return json({ ok: true, id: ref.id })
}

// PUBLIC — the "Create account" tab's replacement for immediate
// createUserWithEmailAndPassword. Reuses the SAME portal_invitations
// lifecycle and Auth-user-with-no-password guarantee as an admin-created
// invitation, rather than a second, parallel approval system — the only
// real difference is there's no separate "invited, awaiting claim" step:
// the applicant IS the one submitting live in their own browser, so this
// creates the record already at status:'claimed' (skipping 'pending'/the
// token-claim round trip entirely — there's no email to prove ownership of
// UNTIL the password-setup link, exactly matching the old direct-signup
// flow's own security model, which also never verified email ownership
// before creating an account).
//
// customer_id starts null — a self-submitted applicant has typed a
// free-text company name, not picked a real customers/{id} record. An
// admin must link one (approveInvitation's optional customerId param)
// before approving; see PortalInvitations.jsx.
async function applyForAccount(body) {
  // Honeypot — same convention as edge-functions/subscribe.js's `hp` field:
  // a bot fills every field including the hidden one. Accept silently (a
  // 200 so the bot sees success) but create nothing. This is the one public,
  // unauthenticated action here that actually creates an Auth user + two
  // Firestore writes per request, so it's the one worth this cheap guard.
  if (String(body?.hp || '').trim()) return json({ ok: true, status: 'pending' })

  const email = normEmail(body?.email)
  const companyName = String(body?.companyName || '').trim().slice(0, 200)
  const contactName = String(body?.contactName || '').trim().slice(0, 200)
  const currency = String(body?.currency || 'USD').trim().slice(0, 10)
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400)
  if (!companyName) return json({ error: 'Company name is required.' }, 400)

  const db = getFirestore()

  const retryKey = body?.retryKey
  if (retryKey != null && (typeof retryKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(retryKey)))
    return json({ error: 'invalid_retry_key' }, 400)
  const prepared = await prepareEmailApplication(db, getAuth(), { email, companyName, contactName, currency }, retryKey)
  if (!prepared.registration) return json(prepared, prepared.error ? 409 : 200)
  const { registration, receipt } = prepared
  const invitationRef = registration.invitationId ? db.collection('portal_invitations').doc(registration.invitationId) : null
  return saveAccessApplication({ db, ...registration, receipt, invitationRef })
}

// Google-authenticated counterpart to applyForAccount — the visitor already
// has a live Firebase session (they just completed Sign in with Google on
// Login.jsx), so there is no Auth account left to create and no email left
// to verify: the DECODED ID TOKEN's email/uid (requireAuth, never a
// client-supplied value) already proves both. Otherwise mirrors
// applyForAccount's two branches exactly — same portal_invitations/users
// shape, same admin-review queue, same approve/reject path. This is
// deliberately NOT the place Google's account-linking design (custom token
// + linkWithPopup) lives — that's for attaching Google to an EXISTING
// admin-invited account (see "Where V8.5 starts"); this is a brand-new
// self-serve applicant whose uid IS the Google-created uid from the start.
async function applyForAccountGoogle(body, uid, email) {
  const companyName = String(body?.companyName || '').trim().slice(0, 200)
  const contactName = String(body?.contactName || '').trim().slice(0, 200)
  const currency = String(body?.currency || 'USD').trim().slice(0, 10)
  if (!companyName) return json({ error: 'Company name is required.' }, 400)

  const db = getFirestore()

  // Idempotent — a reload/double-submit after the first call already wrote
  // this uid's doc; don't clobber it (could already be approved by then).
  const existingUserSnap = await db.collection('users').doc(uid).get()
  if (existingUserSnap.exists) {
    const status = existingUserSnap.data()?.status
    return json({ ok: true, status: status === 'approved' ? 'approved' : 'pending' })
  }

  // Firebase Auth does NOT auto-link providers by email — a Google sign-in
  // for an email that already has a password-based (or any other) account
  // creates a SEPARATE uid with no relationship to the existing one. Caught
  // live (2026-08-19): an admin testing this button with an email that
  // already had an account ended up signed in as a brand-new, unrelated
  // pending customer identity — confusing, not a privilege escalation (the
  // original account was never touched), but exactly the kind of surprise
  // this should refuse outright rather than silently create. No account
  // linking exists yet (deferred — see the admin-invitation path's own
  // linkWithPopup plan), so the correct move here is just to say so.
  const existingByEmail = await db.collection('users').where('email', '==', email).limit(1).get()
  if (!existingByEmail.empty) {
    const existing = existingByEmail.docs[0]
    if (existing.id === uid) return json({ok:true,status:existing.get('status') === 'approved' ? 'approved' : 'pending'})
    return json({ error: 'already_registered' }, 409)
  }

  // An admin may have already invited this exact email — funnel into that
  // invitation exactly like applyForAccount does, just with the uid we
  // already have instead of minting a new Auth user for it.
  const existingInv = await db.collection('portal_invitations')
    .where('contact_email', '==', email)
    .where('status', 'in', ['pending', 'claimed', 'approved'])
    .limit(1)
    .get()
  return saveAccessApplication({ db, uid, email, companyName, contactName, currency, invitationRef:existingInv.docs[0]?.ref, google:true })

}

// Both application forms save the review record, profile and mail job together.
async function saveAccessApplication({
  db,
  uid,
  email,
  companyName,
  contactName,
  currency,
  invitationRef,
  receipt,
  attemptHash,
  google = false
}) {
  const ref = invitationRef || db.collection('portal_invitations').doc()
  const user = db.collection('users').doc(uid)
  const result = await db.runTransaction(async (tx) => {
    const profile = await tx.get(user)
    if (profile.exists) {
      const outcome = google
        ? { ok: true, status: profile.get('status') === 'approved' ? 'approved' : 'pending' }
        : emailApplicationStatus(profile, attemptHash)
      return { response: json(outcome, outcome.error ? 409 : 200) }
    }
    if (receipt && (await tx.get(receipt)).get('uid') !== uid)
      return { response: json({ error: 'already_registered' }, 409) }
    const existing = invitationRef ? (await tx.get(ref)).data() : null
    if (invitationRef && (existing?.status !== 'pending' || existing.contact_email !== email))
      return { response: json({ error: receipt ? 'signup_invitation_changed' : 'already_pending' }, 409) }
    if (receipt && !invitationRef) {
      const added = await tx.get(db.collection('portal_invitations').where('contact_email', '==', email)
        .where('status', 'in', ['pending', 'claimed', 'approved']).limit(1))
      if (!added.empty) return { response: json({ error: 'signup_invitation_changed' }, 409) }
    }
    const now = Timestamp.now()
    const name = contactName || existing?.contact_name || ''
    const claimed = {
      status: 'claimed',
      claimed_at: now,
      claimed_uid: uid,
      access_alert_status: 'queued'
    }
    if (existing) {
      tx.update(ref, {
        ...claimed,
        audit_log: FieldValue.arrayUnion(
          auditEntry(google ? 'claimed_via_self_apply_google' : 'claimed_via_self_apply', email)
        )
      })
    } else {
      tx.create(ref, {
        ...claimed,
        customer_id: null,
        contact_email: email,
        contact_name: name,
        applicant_company_name: companyName,
        marketing_contact_id: null,
        source: 'self',
        token_hash: null,
        created_by: 'self',
        created_at: now,
        expires_at: null,
        approved_at: null,
        rejected_at: null,
        revoked_at: null,
        email_send_status: null,
        email_send_error: null,
        resend_count: 0,
        last_resent_at: null,
        audit_log: [auditEntry(google ? 'self_applied_google' : 'self_applied', email)]
      })
    }
    tx.create(user, {
      role: 'customer',
      status: 'pending',
      email,
      company_name: companyName,
      contact_name: name,
      base_currency: currency,
      ws_discount_pct: 0,
      customer_id: existing?.customer_id || null,
      invitation_id: ref.id,
      ...(google ? { auth_provider: 'google.com' } : {}),
      ...(attemptHash ? { signup_attempt_hash: attemptHash } : {}),
      createdAt: now
    })
    if (receipt) tx.delete(receipt)
    queueAccessAlert(tx, ref, { uid, email, company: companyName, contact: name })
    return { created: true }
  })
  if (!result.created) return result.response
  // Failure to confirm delivery cannot undo a committed application. A due
  // job survives both a failed HTTP request and an interrupted function.
  try {
    await deliverAccessAlert(db, ref.id)
  } catch {
    console.error('Portal access alert pending retry', ref.id)
  }
  return json({ ok: true, status: 'pending' })
}

// A slow invitation email can finish after the buyer has already claimed it.
function recordInvitationEmail(ref, tokenHash, send) {
  return ref.firestore.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (inv?.status === 'pending' && inv.token_hash === tokenHash)
      tx.update(ref, { email_send_status: send.ok ? 'sent' : 'failed', email_send_error: send.ok ? null : send.error })
  })
}

async function resendInvitation(body, adminUid) {
  const id = String(body?.invitationId || '').trim()
  if (!id) return json({ error: 'invitationId is required' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'Invitation not found' }, 404)
  const inv = snap.data()

  if (body.expectedStatus && body.expectedStatus !== inv.status) return json({ error: decisionConflict().error }, 409)
  if (inv.status === 'pending') {
    // Fresh token — the old link stops working the moment a new one is
    // issued, so "resend" can't be used to keep reviving a stale/possibly-
    // leaked link indefinitely with the same secret.
    const { raw, hash } = newToken()
    const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    const customerSnap = await db.collection('customers').doc(inv.customer_id).get()
    const companyName = String(customerSnap.data()?.company_name || '')
    const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
    const claimUrl = `${PORTAL_URL}/invite/${id}?t=${raw}`
    try {
      await ref.update({
        token_hash: hash, expires_at: expiresAt,
        resend_count: FieldValue.increment(1), last_resent_at: Timestamp.now(),
        email_send_status: null, email_send_error: null,
        audit_log: FieldValue.arrayUnion(auditEntry('resent', adminUid)),
      }, { lastUpdateTime: snap.updateTime })
    } catch (error) {
      if (error.code === 9 || error.code === 5) return json({ error: decisionConflict().error }, 409)
      throw error
    }
    const send = await sendResendEmail({
      to: inv.contact_email, subject: `You're invited to the Crystocraft customer portal`,
      html: invitationEmailHtml({ companyName, portalUrl: claimUrl }),
      text: `Crystocraft is inviting you to set up a customer portal account for ${companyName}. Open this link to continue: ${claimUrl}`,
      tags: [{ name: 'invitation_id', value: id, prefix: 'invite' }, { name: 'customer_id', value: inv.customer_id, prefix: 'customer' }],
    })
    await recordInvitationEmail(ref, hash, send)
    if (!send.ok) return json({ ok: false, error: `Could not resend: ${send.error}` }, 502)
    return json({ ok: true })
  }

  if (inv.status === 'approved') {
    const result = await retryApprovalDelivery(ref, body.expectedMailStatus)
    if (result.error) return json({ error: result.error }, result.status)
    const sent = await deliverApproval(ref, result.delivery, adminUid)
    return sent.ok ? json({ ok: true }) : json({ error: sent.error }, 502)
  }

  return json({ error: `Cannot resend an invitation with status "${inv.status}".` }, 400)
}

async function declineInvitation(body, actor, status) {
  if (!validId(body?.invitationId)) return json({ error: 'invitationId is required' }, 400)
  const ref = getFirestore().collection('portal_invitations').doc(body.invitationId)
  // Revoke in the invitations list acts on an unclaimed link. A caller
  // intentionally revoking a later state must identify the state it saw.
  const expected = status === 'rejected' ? 'claimed' : (body.expectedStatus || 'pending')
  if (!['pending', 'claimed', 'approved'].includes(expected)) return json({ error: 'Invalid invitation status.' }, 400)
  const result = await ref.firestore.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (!inv) return { error: 'Invitation not found', status: 404 }
    if (inv.status !== expected || (body.expectedUid && body.expectedUid !== inv.claimed_uid)) return decisionConflict()
    if (inv.status === 'claimed' && inv.claimed_uid) {
      const profile = (await tx.get(ref.firestore.collection('users').doc(inv.claimed_uid))).data()
      if (!canReviewProfile(profile, inv, ref.id)) return decisionConflict()
    }
    tx.update(ref, { status, [status + '_at']: Timestamp.now(), ...(status === 'revoked' ? { token_hash: null } : {}),
      audit_log: FieldValue.arrayUnion(auditEntry(status, actor)) })
    return { ok: true }
  })
  return result.ok ? json(result) : json({ error: result.error }, result.status)
}

function claimError(inv, token) {
  if (!inv) return { error: 'invalid', status: 404 }
  if (['revoked', 'rejected'].includes(inv.status)) return { error: 'revoked', status: 410 }
  if (inv.status === 'expired') return { error: 'expired', status: 410 }
  if (inv.status !== 'pending') return { error: 'used', status: 410 }
  if (!tokensMatch(token, inv.token_hash)) return { error: 'invalid', status: 400 }
  if (inv.expires_at?.toMillis?.() < Date.now()) return { error: 'expired', status: 410 }
  return null
}

function validateClaim(tx, ref, inv, token) {
  const blocked = claimError(inv, token)
  if (inv?.status === 'pending' && blocked?.error === 'expired') tx.update(ref, { status: 'expired' })
  return blocked
}

// PUBLIC — lets the claim page show which company/what the portal is
// BEFORE the customer submits anything, and distinguish valid/expired/
// used/revoked up front (spec's required UI states). Requires the same
// token as claim itself, so this reveals nothing an already-correct link
// wouldn't. Never returns internal ids, Firestore paths, or anything
// beyond company name + the invited email (which the token's holder was
// already sent).
async function getInvitationPreview(body) {
  const id = String(body?.invitationId || '').trim()
  const presentedToken = String(body?.token || '')
  if (!validId(id) || !presentedToken) return json({ error: 'invalid' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const result = await db.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    return validateClaim(tx, ref, inv, presentedToken) || { inv }
  })
  if (result.error) return json({ error: result.error }, result.status)
  const { inv } = result
  if (!validId(inv.customer_id)) return json({ error: 'customer_missing' }, 410)
  const customerSnap = await db.collection('customers').doc(inv.customer_id).get()
  if (!customerSnap.exists) return json({ error: 'customer_missing' }, 410)
  return json({
    ok: true, status: 'valid',
    companyName: String(customerSnap.data()?.company_name || ''),
    contactEmail: inv.contact_email,
  })
}

async function claimInvitation(body, googleUid = null, verifiedEmail = null) {
  const id = String(body?.invitationId || '').trim()
  const token = String(body?.token || '')
  const email = normEmail(googleUid ? verifiedEmail : body?.email)
  if (!validId(id) || !token) return json({ error: 'invalid' }, 400)
  const db = getFirestore(), ref = db.collection('portal_invitations').doc(id)
  const preview = (await ref.get()).data()
  const blocked = claimError(preview, token)
  if (blocked) return json({ error: blocked.error }, blocked.status)
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400)
  if (email !== normEmail(preview.contact_email)) return json({ error: 'email_mismatch' }, 400)
  if (!validId(preview.customer_id) || !(await db.collection('customers').doc(preview.customer_id).get()).exists)
    return json({ error: 'customer_missing' }, 410)

  let uid = googleUid
  if (!uid) {
    try { uid = (await getAuth().getUserByEmail(email)).uid }
    catch (error) {
      if (error.code !== 'auth/user-not-found') throw error
      try { uid = (await getAuth().createUser({ email, emailVerified: false, disabled: false })).uid }
      catch (createError) {
        if (createError.code !== 'auth/email-already-exists') throw createError
        uid = (await getAuth().getUserByEmail(email)).uid
      }
    }
  }

  const actor = 'system:auto_approve'
  const result = await db.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    const invalid = validateClaim(tx, ref, inv, token)
    if (invalid) return invalid
    if (normEmail(inv.contact_email) !== email || inv.customer_id !== preview.customer_id) return { error: 'invalid', status: 400 }
    const customer = (await tx.get(db.collection('customers').doc(inv.customer_id))).data()
    if (!customer) return { error: 'customer_missing', status: 410 }
    const userRef = db.collection('users').doc(uid)
    const old = (await tx.get(userRef)).data()
    if (old) {
      const eligible = old.status === 'pending' || (old.status === 'approved' && inv.source === 'admin')
      if (!eligible || old.role !== 'customer' || (old.email && normEmail(old.email) !== email) ||
        (old.customer_id && old.customer_id !== inv.customer_id)) return { error: 'used', status: 410 }
      if (old.invitation_id && old.invitation_id !== id) return { error: 'already_pending', status: 409 }
    }
    const profile = old ? {} : {
      role: 'customer', status: 'pending', email, company_name: customer.company_name || '',
      contact_name: String(body?.contactName || '').trim() || inv.contact_name || '',
      base_currency: 'USD', ws_discount_pct: 0, customer_id: inv.customer_id, createdAt: Timestamp.now(),
    }
    profile.invitation_id = id
    if (googleUid) profile.auth_provider = 'google.com'
    const invitation = { status: 'claimed', claimed_at: Timestamp.now(), claimed_uid: uid }
    const audit = auditEntry(googleUid ? 'claimed_via_google' : 'claimed', email)
    if (inv.source === 'admin')
      return stageApproval(tx, { ref, inv, userRef, user: { ...old, ...profile }, customer, customerId: inv.customer_id,
        actor, claim: { profile, invitation, audit } })
    tx.set(userRef, profile, { merge: true })
    tx.update(ref, { ...invitation, audit_log: FieldValue.arrayUnion(audit) })
    return { status: 'pending' }
  })
  return approvalResponse(ref, result, actor)
}

async function deliverApproval(ref, delivery, actor) {
  const { company: companyName, email, customerId, google } = delivery
  const portalUrl = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
  let result
  try {
    let message
    if (google) {
      message = { subject: 'Your Crystocraft portal account is approved',
        html: googleApprovedEmailHtml({ companyName, portalUrl: portalUrl + '/login' }),
        text: `Your Crystocraft customer portal account for ${companyName} has been approved. Sign in with Google at ${portalUrl}/login` }
    } else {
      const raw = await getAuth().generatePasswordResetLink(email, { url: portalUrl + '/portal/set-password', handleCodeInApp: true })
      const code = new URL(raw).searchParams.get('oobCode')
      if (!code) throw Error('Missing password setup code')
      const setupUrl = portalUrl + '/portal/set-password?oobCode=' + encodeURIComponent(code)
      message = { subject: 'Set your Crystocraft portal password', html: setupEmailHtml({ companyName, setupUrl }),
        text: `Your Crystocraft customer portal account for ${companyName} has been approved. Set your password: ${setupUrl}` }
    }
    result = await sendResendEmail({ to: email, ...message,
      tags: [{ name: 'invitation_id', value: ref.id, prefix: 'invite' }, { name: 'customer_id', value: customerId, prefix: 'customer' }] })
  } catch {
    result = { ok: false, error: 'Could not prepare the approval email.' }
  }
  await recordApprovalDelivery(ref, delivery, actor, result)
  return result
}

async function approvalResponse(ref, result, actor) {
  if (result.error) return json({ error: result.error }, result.status)
  if (!result.delivery) return json({ ok: true, status: result.status })
  // The decision is already committed, even if sending or recording delivery fails.
  let notified = false
  try { notified = (await deliverApproval(ref, result.delivery, actor)).ok }
  catch { console.error('Approval email confirmation pending', ref.id) }
  return json({ ok: true, status: 'approved', emailStatus: notified ? 'sent' : 'unconfirmed' })
}

// Public: the login page's "Forgot password?" — replaces the client's
// firebase/auth sendPasswordResetEmail(), whose mail comes from
// noreply@<project>.firebaseapp.com with Firebase's default template (lands
// in spam, carries the raw firebaseapp.com action URL). This sends the same
// branded email as the approval flow, from noreply@crystocraft.com through
// Resend, with our own clean /portal/set-password?oobCode=… link (same
// generate → extract oobCode → rebuild shape as
// deliverApproval).
//
// Never reveals whether an account exists: an unknown/malformed email
// returns { ok: true } exactly like a real one (same posture as
// claim_invitation).
async function requestPasswordReset(body) {
  const email = normEmail(body?.email)
  if (!EMAIL_RE.test(email)) return json({ ok: true })

  try {
    await getAuth().getUserByEmail(email)
  } catch {
    return json({ ok: true }) // no such account — silent no-op, don't leak
  }

  const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
  try {
    const rawLink = await getAuth().generatePasswordResetLink(email, {
      url: `${PORTAL_URL}/portal/set-password`, handleCodeInApp: true,
    })
    const oobCode = new URL(rawLink).searchParams.get('oobCode')
    if (!oobCode) throw new Error('No oobCode in the generated link')
    const resetUrl = `${PORTAL_URL}/portal/set-password?oobCode=${encodeURIComponent(oobCode)}`
    const send = await sendResendEmail({
      to: email, subject: 'Reset your Crystocraft password',
      html: resetEmailHtml({ resetUrl }),
      text: `Reset your Crystocraft password: ${resetUrl}\n\nIf you didn't ask to reset your password, you can ignore this email.`,
      tags: [{ name: 'type', value: 'password_reset', prefix: 'portal' }],
    })
    if (!send.ok) return json({ ok: false, error: 'Could not send the reset email. Please try again.' }, 502)
  } catch (e) {
    return json({ ok: false, error: `Could not start a password reset: ${String(e?.message || e).slice(0, 200)}` }, 502)
  }
  return json({ ok: true })
}

async function approveInvitation(body, actor) {
  if (!validId(body?.invitationId)) return json({ error: 'invitationId is required' }, 400)
  const ref = getFirestore().collection('portal_invitations').doc(body.invitationId)
  const { accountType, pricingChanges = {}, customerId, expectedUid } = body
  if ((accountType !== undefined && !['customer', 'internal'].includes(accountType)) ||
    (customerId && !validId(customerId)) || !pricingChanges || typeof pricingChanges !== 'object' || Array.isArray(pricingChanges))
    return json({ error: 'Invalid approval details.' }, 400)
  for (const [field, value] of Object.entries(pricingChanges)) {
    const valid = field === 'base_currency' ? INVITE_CURRENCIES.includes(value)
      : ['fx_rate', 'ws_discount_pct', 'corp_markup_override'].includes(field) && Number.isFinite(value) && value >= 0
    if (!valid) return json({ error: 'Invalid approval pricing.' }, 400)
  }
  const result = await approveClaimed(ref, customerId, actor, { accountType, pricing: pricingChanges, expectedUid })
  return approvalResponse(ref, result, actor)
}

// AccountEdit.jsx's "Delete account" — previously only deleted the
// Firestore users/{uid} doc via the client SDK (deleteDoc has no way to
// reach Firebase Auth at all), leaving the sign-in credential behind
// permanently ("only removable from the Firebase console", per the old
// confirm-dialog copy). That gap is exactly what caused live confusion
// 2026-08-19: a deleted-then-recreated test account with the same email
// kept hitting already_registered because the orphaned Auth user was still
// there. Deletes both, in the order that leaves nothing dangling if the
// second step fails — Auth user first (idempotent-ish: a NOT-FOUND here is
// fine, means it's already gone or never had one, e.g. an admin-created
// doc-only record), then the Firestore doc.
async function deleteAccount(body, adminUid) {
  const targetUid = String(body?.uid || '').trim()
  if (!targetUid) return json({ error: 'uid is required' }, 400)
  if (targetUid === adminUid) return json({ error: 'You cannot delete your own account.' }, 400)

  try {
    await getAuth().deleteUser(targetUid)
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') {
      return json({ error: `Could not delete the sign-in credential: ${e?.message || e}` }, 500)
    }
  }
  await getFirestore().collection('users').doc(targetUid).delete()
  return json({ ok: true })
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  initAdminApp()

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const action = String(body?.action || '')

  // claim_invitation, get_invitation, apply_for_account and
  // request_password_reset are the fully PUBLIC actions — an unauthenticated
  // visitor (an invitation link, a new-account form, or the login page's
  // "Forgot password?"). request_password_reset never reveals whether an
  // account exists.
  // apply_for_account_google / claim_invitation_google require a signed-in-
  // but-not-yet-admin session (the visitor just completed Sign in with
  // Google); every remaining action requires an admin session.
  if (action === 'claim_invitation') return claimInvitation(body)
  if (action === 'get_invitation') return getInvitationPreview(body)
  if (action === 'apply_for_account') return applyForAccount(body)
  if (action === 'request_password_reset') return requestPasswordReset(body)
  if (action === 'claim_invitation_google' || action === 'apply_for_account_google') {
    const { uid, email, error } = await requireAuth(req, { verifiedGoogle: true })
    if (error) return error
    const verifiedEmail = normEmail(email)
    return action === 'claim_invitation_google'
      ? claimInvitation(body, uid, verifiedEmail)
      : applyForAccountGoogle(body, uid, verifiedEmail)
  }

  const { uid, error } = await requireAdmin(req)
  if (error) return error

  if (['list_account_followup_states', 'get_account_followup', 'save_account_followup_draft', 'send_account_followup',
    'mark_account_information_received', 'resolve_account_followup'].includes(action)) {
    try {
      const response = json(await accountFollowupAction({ db: getFirestore(), actorUid: uid, action, body,
        mail: { apiKey: process.env.RESEND_API_KEY,
          from: process.env.MAIL_PERSONAL_FROM || process.env.MAIL_FROM || '',
          replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_ADMIN || '' } }))
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    } catch (e) {
      return json({ error: e.status ? e.message : 'Could not confirm the follow-up update. Refresh before trying again.' }, e.status || 500)
    }
  }

  switch (action) {
    case 'retry_access_alert':
      if (body.confirmedNotSent !== true) return json({error:'Check Resend before retrying the admin notice.'},400)
      try { await retryReviewedAccessAlert(getFirestore(),body.invitationId,uid); return json({ok:true}) }
      catch (e) { return json({error:e.status ? e.message : 'Could not confirm the admin notice. Refresh before retrying.'},e.status || 500) }
    case 'approve_legacy_account':
      try { await approveLegacyAccount(getFirestore(), body.uid, body.customerId, { role: body.role, expectedStatus: body.expectedStatus }); return json({ ok: true }) }
      catch (e) { return json({ error: e.status ? e.message : 'Could not approve account.' }, e.status || 503) }
    case 'create_invitation': return createInvitation(body, uid)
    case 'resend_invitation': return resendInvitation(body, uid)
    case 'revoke_invitation': return declineInvitation(body, uid, 'revoked')
    case 'reject_invitation': return declineInvitation(body, uid, 'rejected')
    case 'approve_invitation': return approveInvitation(body, uid)
    case 'delete_account': return deleteAccount(body, uid)
    default: return json({ error: 'Unknown action' }, 400)
  }
}

export const config = { path: '/api/portal-invite' }
