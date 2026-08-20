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
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { buildResendTags } from '../edge-functions/lib/resendTags.js'

const INVITE_EXPIRY_DAYS = 7
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Same PEM-repair idiom as resend-webhook.js's normalizePkcs8 — duplicated
// rather than shared, since it's ~10 lines and this file already can't share
// runtime with the Deno functions; not worth a new shared module for this.
function normalizePkcs8(input) {
  let s = String(input || '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '')
  const inner = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '').replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
  const bodyB64 = inner.replace(/[^A-Za-z0-9+/=]/g, '')
  const wrapped = bodyB64.match(/.{1,64}/g)?.join('\n') || bodyB64
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`
}

function initAdminApp() {
  if (getApps().length) return
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) throw new Error('Server not configured')
  const privateKey = normalizePkcs8(privateKeyRaw)
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

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

// Verifies the caller's Firebase ID token, no role check — any signed-in
// user. Returns { uid, email } from the DECODED TOKEN, never trusting a
// client-supplied email for anything that writes data (see
// applyForAccountGoogle below, the one caller so far).
async function requireAuth(req) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return { error: json({ error: 'Not signed in' }, 401) }
  try {
    const decoded = await getAuth().verifyIdToken(token)
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

// ── actions ─────────────────────────────────────────────────────────────

async function createInvitation(body, adminUid) {
  const customerId = String(body?.customerId || '').trim()
  const contactEmail = normEmail(body?.contactEmail)
  const contactName = String(body?.contactName || '').trim()
  const marketingContactId = body?.marketingContactId ? String(body.marketingContactId).trim() : null
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
    return json({ ok: true, id: d.id, reused: true, status: d.data().status })
  }

  const { raw, hash } = newToken()
  const now = Timestamp.now()
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  const ref = db.collection('portal_invitations').doc()
  await ref.set({
    customer_id: customerId, contact_email: contactEmail, contact_name: contactName,
    marketing_contact_id: marketingContactId,
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
  await ref.update({
    email_send_status: send.ok ? 'sent' : 'failed',
    email_send_error: send.ok ? null : send.error,
  })
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

  // Non-enumerating-ish gate: an email that ALREADY has a real Auth account
  // (predates this feature, was invited, or already self-applied) never
  // gets a second account created — same generic response shape whether
  // approved or suspended, so a stranger probing emails learns only "some
  // account state already exists here," never which one specifically.
  // 'pending' gets its OWN distinct message, per spec — the applicant
  // typed their own email, so telling them "you already applied" is useful,
  // not a meaningful enumeration leak.
  let existingAuthUser = null
  try { existingAuthUser = await getAuth().getUserByEmail(email) } catch { /* no existing Auth account — fine */ }
  if (existingAuthUser) {
    const existingUserSnap = await db.collection('users').doc(existingAuthUser.uid).get()
    const existingStatus = existingUserSnap.exists ? existingUserSnap.data().status : null
    if (existingStatus === 'pending') return json({ error: 'already_pending' }, 409)
    return json({ error: 'already_registered' }, 409)
  }

  // An admin may have already invited this exact email (status 'pending',
  // token not yet claimed) — funnel this submission into THAT existing
  // invitation rather than creating a second, parallel one. Ownership of
  // the email still only gets verified later, at the password-setup-link
  // step, same as every other path here.
  const existingInv = await db.collection('portal_invitations')
    .where('contact_email', '==', email)
    .where('status', 'in', ['pending', 'claimed', 'approved'])
    .limit(1)
    .get()
  if (!existingInv.empty) {
    const d = existingInv.docs[0]
    const inv = d.data()
    if (inv.status !== 'pending') return json({ error: 'already_pending' }, 409)
    // Claim the existing admin-created invitation on the applicant's
    // behalf — no raw token to check here (nothing was emailed to click),
    // which is fine: this is exactly as strong as the rest of this
    // function's security model, not weaker than it.
    // getUserByEmail (above) → createUser here is not atomic — two
    // simultaneous submissions for the same email can both pass the check.
    // The loser's createUser throws auth/email-already-exists; degrade to
    // the same response the pre-check would have given rather than a raw 500.
    let userRecord
    try { userRecord = await getAuth().createUser({ email, emailVerified: false, disabled: false }) }
    catch (e) { if (e?.code === 'auth/email-already-exists') return json({ error: 'already_pending' }, 409); throw e }
    await d.ref.update({
      status: 'claimed', claimed_at: Timestamp.now(), claimed_uid: userRecord.uid,
      audit_log: FieldValue.arrayUnion(auditEntry('claimed_via_self_apply', email)),
    })
    await db.collection('users').doc(userRecord.uid).set({
      role: 'customer', status: 'pending', email,
      company_name: companyName, contact_name: contactName || inv.contact_name || '',
      base_currency: currency, ws_discount_pct: 0,
      customer_id: inv.customer_id || null, invitation_id: d.id,
      createdAt: Timestamp.now(),
    })
    return json({ ok: true, status: 'pending' })
  }

  // Genuinely new applicant — create the invitation record AND the
  // no-password Auth account in one step (see header comment for why
  // there's no separate claim round trip here). Same race guard as the
  // existing-invitation branch above.
  let userRecord
  try { userRecord = await getAuth().createUser({ email, emailVerified: false, disabled: false }) }
  catch (e) { if (e?.code === 'auth/email-already-exists') return json({ error: 'already_registered' }, 409); throw e }
  const ref = db.collection('portal_invitations').doc()
  await ref.set({
    customer_id: null, contact_email: email, contact_name: contactName,
    // The applicant's own free-text company name — shown to the admin so
    // they know what to search for while linking a real customers/{id}
    // record (see PortalInvitations.jsx). Not present on an admin-created
    // invitation, where customer_id is already known from the start.
    applicant_company_name: companyName,
    marketing_contact_id: null,
    source: 'self',
    status: 'claimed',
    token_hash: null, // nothing to verify later — this record was never emailed as a claim link
    created_by: 'self', created_at: Timestamp.now(), expires_at: null,
    claimed_at: Timestamp.now(), claimed_uid: userRecord.uid,
    approved_at: null, rejected_at: null, revoked_at: null,
    email_send_status: null, email_send_error: null, resend_count: 0, last_resent_at: null,
    audit_log: [auditEntry('self_applied', email)],
  })
  await db.collection('users').doc(userRecord.uid).set({
    role: 'customer', status: 'pending', email,
    company_name: companyName, contact_name: contactName,
    base_currency: currency, ws_discount_pct: 0,
    customer_id: null, invitation_id: ref.id,
    createdAt: Timestamp.now(),
  })
  return json({ ok: true, status: 'pending' })
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
  if (!existingByEmail.empty) return json({ error: 'already_registered' }, 409)

  // An admin may have already invited this exact email — funnel into that
  // invitation exactly like applyForAccount does, just with the uid we
  // already have instead of minting a new Auth user for it.
  const existingInv = await db.collection('portal_invitations')
    .where('contact_email', '==', email)
    .where('status', 'in', ['pending', 'claimed', 'approved'])
    .limit(1)
    .get()
  if (!existingInv.empty) {
    const d = existingInv.docs[0]
    const inv = d.data()
    if (inv.status !== 'pending') return json({ error: 'already_pending' }, 409)
    await d.ref.update({
      status: 'claimed', claimed_at: Timestamp.now(), claimed_uid: uid,
      audit_log: FieldValue.arrayUnion(auditEntry('claimed_via_self_apply_google', email)),
    })
    await db.collection('users').doc(uid).set({
      role: 'customer', status: 'pending', email,
      company_name: companyName, contact_name: contactName || inv.contact_name || '',
      base_currency: currency, ws_discount_pct: 0,
      customer_id: inv.customer_id || null, invitation_id: d.id,
      auth_provider: 'google.com', createdAt: Timestamp.now(),
    })
    return json({ ok: true, status: 'pending' })
  }

  const ref = db.collection('portal_invitations').doc()
  await ref.set({
    customer_id: null, contact_email: email, contact_name: contactName,
    applicant_company_name: companyName,
    marketing_contact_id: null,
    source: 'self',
    status: 'claimed',
    token_hash: null,
    created_by: 'self', created_at: Timestamp.now(), expires_at: null,
    claimed_at: Timestamp.now(), claimed_uid: uid,
    approved_at: null, rejected_at: null, revoked_at: null,
    email_send_status: null, email_send_error: null, resend_count: 0, last_resent_at: null,
    audit_log: [auditEntry('self_applied_google', email)],
  })
  await db.collection('users').doc(uid).set({
    role: 'customer', status: 'pending', email,
    company_name: companyName, contact_name: contactName,
    base_currency: currency, ws_discount_pct: 0,
    customer_id: null, invitation_id: ref.id,
    auth_provider: 'google.com', createdAt: Timestamp.now(),
  })
  return json({ ok: true, status: 'pending' })
}

async function resendInvitation(body, adminUid) {
  const id = String(body?.invitationId || '').trim()
  if (!id) return json({ error: 'invitationId is required' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'Invitation not found' }, 404)
  const inv = snap.data()

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
    const send = await sendResendEmail({
      to: inv.contact_email, subject: `You're invited to the Crystocraft customer portal`,
      html: invitationEmailHtml({ companyName, portalUrl: claimUrl }),
      text: `Crystocraft is inviting you to set up a customer portal account for ${companyName}. Open this link to continue: ${claimUrl}`,
      tags: [{ name: 'invitation_id', value: id, prefix: 'invite' }, { name: 'customer_id', value: inv.customer_id, prefix: 'customer' }],
    })
    await ref.update({
      token_hash: hash, expires_at: expiresAt,
      resend_count: FieldValue.increment(1), last_resent_at: Timestamp.now(),
      email_send_status: send.ok ? 'sent' : 'failed', email_send_error: send.ok ? null : send.error,
      audit_log: FieldValue.arrayUnion(auditEntry('resent', adminUid)),
    })
    if (!send.ok) return json({ ok: false, error: `Could not resend: ${send.error}` }, 502)
    return json({ ok: true })
  }

  if (inv.status === 'approved') {
    return setupLinkForApprovedInvitation(ref, inv, adminUid)
  }

  return json({ error: `Cannot resend an invitation with status "${inv.status}".` }, 400)
}

async function revokeInvitation(body, adminUid) {
  const id = String(body?.invitationId || '').trim()
  if (!id) return json({ error: 'invitationId is required' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'Invitation not found' }, 404)
  const inv = snap.data()
  if (!['pending', 'claimed', 'approved'].includes(inv.status)) {
    return json({ error: `Invitation is already ${inv.status}.` }, 400)
  }
  await ref.update({
    status: 'revoked', revoked_at: Timestamp.now(),
    token_hash: null, // defensive — even a bug elsewhere can't revive a revoked token
    audit_log: FieldValue.arrayUnion(auditEntry('revoked', adminUid)),
  })
  return json({ ok: true })
}

async function rejectInvitation(body, adminUid) {
  const id = String(body?.invitationId || '').trim()
  if (!id) return json({ error: 'invitationId is required' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'Invitation not found' }, 404)
  const inv = snap.data()
  if (inv.status !== 'claimed') return json({ error: 'Only a claimed (not yet approved) invitation can be rejected.' }, 400)
  await ref.update({
    status: 'rejected', rejected_at: Timestamp.now(),
    audit_log: FieldValue.arrayUnion(auditEntry('rejected', adminUid)),
  })
  // The linked users/{uid} doc (if the claim created one) is left at
  // status:'pending' — PendingScreen.jsx / firestore.rules' isApprovedCustomer()
  // already block portal access for anything short of 'approved', so no new
  // account-status value is needed for "rejected" — see this file's header.
  return json({ ok: true })
}

// Shared by claimInvitation and the public preview action below — one
// state-machine definition for "is this token still usable," so the
// customer-facing states (valid/expired/used/revoked) can never drift
// between what the preview shows and what claim actually enforces.
// Returns null if usable, else the { error, status } to respond with.
async function checkClaimable(ref, inv) {
  if (inv.status === 'revoked') return { error: 'revoked', status: 410 }
  if (inv.status === 'rejected') return { error: 'revoked', status: 410 } // same generic UI state — not a distinct disclosure
  if (inv.status !== 'pending') return { error: 'used', status: 410 } // already claimed/approved
  if (inv.expires_at?.toMillis?.() < Date.now()) {
    await ref.update({ status: 'expired' })
    return { error: 'expired', status: 410 }
  }
  return null
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
  if (!id || !presentedToken) return json({ error: 'invalid' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'invalid' }, 404)
  const inv = snap.data()
  const blocked = await checkClaimable(ref, inv)
  if (blocked) return json({ error: blocked.error }, blocked.status)
  if (!tokensMatch(presentedToken, inv.token_hash)) return json({ error: 'invalid' }, 400)
  const customerSnap = await db.collection('customers').doc(inv.customer_id).get()
  if (!customerSnap.exists) return json({ error: 'customer_missing' }, 410)
  return json({
    ok: true, status: 'valid',
    companyName: String(customerSnap.data()?.company_name || ''),
    contactEmail: inv.contact_email,
  })
}

async function claimInvitation(body) {
  const id = String(body?.invitationId || '').trim()
  const presentedToken = String(body?.token || '')
  const email = normEmail(body?.email)
  const contactName = String(body?.contactName || '').trim()
  if (!id || !presentedToken) return json({ error: 'invalid' }, 400)

  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'invalid' }, 404)
  const inv = snap.data()

  const blocked = await checkClaimable(ref, inv)
  if (blocked) return json({ error: blocked.error }, blocked.status)
  if (!tokensMatch(presentedToken, inv.token_hash)) return json({ error: 'invalid' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400)
  if (email !== inv.contact_email) return json({ error: 'email_mismatch' }, 400)

  const customerCheck = await db.collection('customers').doc(inv.customer_id).get()
  if (!customerCheck.exists) return json({ error: 'customer_missing' }, 410)

  // Reuse an existing Auth account for this email rather than creating a
  // second one — covers a re-claim attempt, or an email that already
  // self-registered separately.
  let userRecord
  try {
    userRecord = await getAuth().getUserByEmail(email)
  } catch {
    userRecord = await getAuth().createUser({ email, emailVerified: false, disabled: false })
  }
  const uid = userRecord.uid

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  if (!userSnap.exists) {
    await userRef.set({
      role: 'customer', status: 'pending', email,
      company_name: String(customerCheck.data()?.company_name || ''),
      contact_name: contactName || inv.contact_name || '',
      base_currency: 'USD', ws_discount_pct: 0,
      customer_id: inv.customer_id, invitation_id: id,
      createdAt: Timestamp.now(),
    })
  } else if (userSnap.data().role === 'admin') {
    // Defensive — an admin's own account must never be touched by a
    // customer-invitation claim, even though this never modifies role/
    // status either way today. Refusing outright (rather than silently
    // no-op'ing) avoids leaving a confusing invitation_id/claimed state
    // attached to an admin account if this ever gets invoked against one
    // by mistake (e.g. an admin listed as a contact on a customer record).
    return json({ error: 'used' }, 410)
  } else if (!userSnap.data().invitation_id) {
    await userRef.update({ invitation_id: id })
  } else if (userSnap.data().invitation_id !== id) {
    // This uid is already linked to a DIFFERENT invitation. Letting this one
    // proceed would leave two invitations pointing at one user — this
    // invitation's own claimed_uid says one thing, the user's invitation_id
    // says another. Refuse rather than silently create that split reference.
    return json({ error: 'already_pending' }, 409)
  }

  await ref.update({
    status: 'claimed', claimed_at: Timestamp.now(), claimed_uid: uid,
    audit_log: FieldValue.arrayUnion(auditEntry('claimed', email)),
  })
  return json({ ok: true, status: 'pending' })
}

// PUBLIC (requires only a live Google-authenticated session, not admin) —
// V8.6's answer to "Admin-invitation path still doesn't support Google
// sign-in" (see PROJECT-PLAN.md's "Where V8.6 starts"). Offered on the
// invite-claim landing page itself, BEFORE any password-based Auth account
// exists for this invitation — createInvitation (the admin step) never
// creates one, only claimInvitation does, at claim time. Landing here first
// means there is no pre-existing "fixed uid" to reconcile: the customer's
// own Google sign-in IS the account, from the start, so this never needs
// the linkWithPopup/custom-token dance a later-stage retrofit would.
// (A customer who already claimed via email/password and only wants Google
// afterwards is a narrower, separate case this does not cover — deferred.)
async function claimInvitationGoogle(body, uid, googleEmail) {
  const id = String(body?.invitationId || '').trim()
  const presentedToken = String(body?.token || '')
  const contactName = String(body?.contactName || '').trim()
  if (!id || !presentedToken) return json({ error: 'invalid' }, 400)

  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'invalid' }, 404)
  const inv = snap.data()

  const blocked = await checkClaimable(ref, inv)
  if (blocked) return json({ error: blocked.error }, blocked.status)
  if (!tokensMatch(presentedToken, inv.token_hash)) return json({ error: 'invalid' }, 400)
  // The invitation names a specific person's email — trust the DECODED
  // token's email claim, never a client-supplied value, same posture as
  // every other "never trust the caller's claim" spot in this file.
  if (normEmail(googleEmail) !== normEmail(inv.contact_email)) return json({ error: 'email_mismatch' }, 400)

  const customerCheck = await db.collection('customers').doc(inv.customer_id).get()
  if (!customerCheck.exists) return json({ error: 'customer_missing' }, 410)

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  if (userSnap.exists) {
    const existing = userSnap.data()
    // Same defensive checks as claimInvitation's own re-claim/admin-guard
    // branches — this Google uid may already be linked to a DIFFERENT
    // invitation/account (e.g. an admin, or an unrelated prior signup).
    if (existing.role === 'admin') return json({ error: 'used' }, 410)
    if (existing.invitation_id && existing.invitation_id !== id) return json({ error: 'already_pending' }, 409)
    if (!existing.invitation_id) await userRef.update({ invitation_id: id, auth_provider: 'google.com' })
  } else {
    await userRef.set({
      role: 'customer', status: 'pending', email: normEmail(googleEmail),
      company_name: String(customerCheck.data()?.company_name || ''),
      contact_name: contactName || inv.contact_name || '',
      base_currency: 'USD', ws_discount_pct: 0,
      customer_id: inv.customer_id, invitation_id: id,
      auth_provider: 'google.com', createdAt: Timestamp.now(),
    })
  }

  await ref.update({
    status: 'claimed', claimed_at: Timestamp.now(), claimed_uid: uid,
    audit_log: FieldValue.arrayUnion(auditEntry('claimed_via_google', googleEmail)),
  })
  return json({ ok: true, status: 'pending' })
}

async function setupLinkForApprovedInvitation(ref, inv, adminUid) {
  const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
  const db = getFirestore()
  // No customer_id for an approved internal/test account (see approveInvitation's
  // isInternal branch) — db.collection().doc(null) throws, and there's no
  // real company name to show anyway; fall back to the applicant's own
  // free-text name from the invitation itself.
  const companyName = inv.customer_id
    ? String((await db.collection('customers').doc(inv.customer_id).get()).data()?.company_name || '')
    : String(inv.applicant_company_name || '')
  let setupUrl
  try {
    // generatePasswordResetLink() always returns a link through Firebase's
    // OWN hosted action handler (<project>.firebaseapp.com/__/auth/action)
    // — handleCodeInApp does NOT make it skip straight to our continueUrl
    // with the code attached the way the docs imply (confirmed live,
    // 2026-08-19: the owner watched it happen — Firebase's generic blue-
    // button "Reset your password" page ran first, then its OWN "Continue"
    // link went to our continueUrl with NO oobCode at all, since Firebase's
    // page had already consumed it). Never send that raw link — extract
    // just the oobCode and build our OWN clean, always-branded url instead.
    // verifyPasswordResetCode/confirmPasswordReset (src/pages/
    // SetPassword.jsx) only need the auth instance + this raw code; they
    // don't need apiKey/mode from Firebase's URL shape.
    const rawLink = await getAuth().generatePasswordResetLink(inv.contact_email, {
      url: `${PORTAL_URL}/portal/set-password`, handleCodeInApp: true,
    })
    const oobCode = new URL(rawLink).searchParams.get('oobCode')
    if (!oobCode) throw new Error('No oobCode in the generated link')
    setupUrl = `${PORTAL_URL}/portal/set-password?oobCode=${encodeURIComponent(oobCode)}`
  } catch (e) {
    return json({ ok: false, error: `Could not generate a setup link: ${String(e?.message || e).slice(0, 200)}` }, 502)
  }
  const send = await sendResendEmail({
    to: inv.contact_email, subject: `Set your Crystocraft portal password`,
    html: setupEmailHtml({ companyName, setupUrl }),
    text: `Your Crystocraft customer portal account for ${companyName} has been approved. Set your password: ${setupUrl}`,
    tags: [{ name: 'invitation_id', value: ref.id, prefix: 'invite' }, { name: 'customer_id', value: inv.customer_id, prefix: 'customer' }],
  })
  await ref.update({
    email_send_status: send.ok ? 'sent' : 'failed', email_send_error: send.ok ? null : send.error,
    resend_count: FieldValue.increment(1), last_resent_at: Timestamp.now(),
    audit_log: FieldValue.arrayUnion(auditEntry('setup_link_sent', adminUid || 'system')),
  })
  if (!send.ok) return json({ ok: false, error: `Could not send the setup email: ${send.error}` }, 502)
  return json({ ok: true })
}

// Companion to setupLinkForApprovedInvitation for accounts that signed up
// via Google — no password-reset link to generate at all, just a
// notification that approval happened, same posture as every other path.
async function googleApprovedNotification(ref, inv, adminUid) {
  const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.crystocraft.com'
  const db = getFirestore()
  const companyName = inv.customer_id
    ? String((await db.collection('customers').doc(inv.customer_id).get()).data()?.company_name || '')
    : String(inv.applicant_company_name || '')
  const send = await sendResendEmail({
    to: inv.contact_email, subject: `Your Crystocraft portal account is approved`,
    html: googleApprovedEmailHtml({ companyName, portalUrl: `${PORTAL_URL}/login` }),
    text: `Your Crystocraft customer portal account for ${companyName} has been approved. Sign in with Google at ${PORTAL_URL}/login`,
    tags: [{ name: 'invitation_id', value: ref.id, prefix: 'invite' }, { name: 'customer_id', value: inv.customer_id, prefix: 'customer' }],
  })
  await ref.update({
    email_send_status: send.ok ? 'sent' : 'failed', email_send_error: send.ok ? null : send.error,
    resend_count: FieldValue.increment(1), last_resent_at: Timestamp.now(),
    audit_log: FieldValue.arrayUnion(auditEntry('google_approved_notification_sent', adminUid || 'system')),
  })
  if (!send.ok) return json({ ok: false, error: `Could not send the approval email: ${send.error}` }, 502)
  return json({ ok: true })
}

async function approveInvitation(body, adminUid) {
  const id = String(body?.invitationId || '').trim()
  const suppliedCustomerId = body?.customerId ? String(body.customerId).trim() : null
  if (!id) return json({ error: 'invitationId is required' }, 400)
  const db = getFirestore()
  const ref = db.collection('portal_invitations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return json({ error: 'Invitation not found' }, 404)
  const inv = snap.data()
  if (inv.status !== 'claimed') {
    return json({ error: inv.status === 'pending' ? 'This invitation has not been claimed by the customer yet.' : `Invitation is ${inv.status}, not claimed.` }, 400)
  }
  if (!inv.claimed_uid) return json({ error: 'This invitation has no linked account to approve.' }, 400)

  // A self-submitted application (source:'self') starts with no
  // customer_id — the applicant typed a free-text company name, not a real
  // customers/{id}. An admin must link (or correct) it before approval can
  // proceed; this also doubles as the original SU-07A spec's "correct the
  // customer/contact link before approval" for admin-created invitations.
  //
  // Exception: account_type:'internal' (a staff/test login, set via
  // AccountEdit.jsx's Account Category toggle) never needs a real customer
  // record — there's no wholesale pricing/order-history to mirror for a
  // test account, and requiring one was pure friction the toggle itself
  // didn't advertise (found live, 2026-08-19). Read straight off the user
  // doc rather than trusting a client-supplied flag — same "server verifies,
  // never trusts the caller's claim" posture as everything else here.
  const claimedUserRef = db.collection('users').doc(inv.claimed_uid)
  const claimedUserSnap = await claimedUserRef.get()
  const isInternal = claimedUserSnap.data()?.account_type === 'internal'

  const customerId = suppliedCustomerId || inv.customer_id
  if (!customerId && !isInternal) {
    return json({ error: 'Link this request to a customer record before approving.' }, 400)
  }

  let userUpdate
  if (customerId) {
    const customerSnap = await db.collection('customers').doc(customerId).get()
    if (!customerSnap.exists) return json({ error: 'That customer record no longer exists.' }, 404)

    // Mirror sensitive/erp_code/erp_code_shared onto the user doc — same
    // fields domain/customer.js's mirrorToLinkedAccounts keeps in sync on
    // every future customer edit, but THIS approval is the account's first
    // write, so without it the account sits unscreened (sensitiveImages.js's
    // client-side privacy check reads profile.sensitive — unset is a no-op)
    // and order history reads empty (customer-order-history.js keys off
    // users/{uid}.erp_code) until an admin happens to save the customer
    // record again. Read straight off the customer doc rather than
    // recomputing the erp_code_shared share-count query — saveCustomer
    // already keeps that field current.
    const custData = customerSnap.data() || {}
    userUpdate = {
      status: 'approved', customer_id: customerId,
      sensitive: !!custData.sensitive,
      erp_code: custData.erp_code || '',
      erp_code_shared: !!custData.erp_code_shared,
    }
    if (suppliedCustomerId) {
      // Keep the user's displayed company_name in sync with the now-linked
      // canonical record, rather than whatever free text the applicant typed.
      userUpdate.company_name = String(custData.company_name || '')
    }
  } else {
    // Internal, no customer linked — approve as-is, safe defaults.
    userUpdate = { status: 'approved', customer_id: null, sensitive: false, erp_code: '', erp_code_shared: false }
  }
  await claimedUserRef.update(userUpdate)
  await ref.update({
    status: 'approved', approved_at: Timestamp.now(), customer_id: customerId || null,
    audit_log: FieldValue.arrayUnion(auditEntry('approved', adminUid)),
  })

  const freshSnap = await ref.get()
  const isGoogleAccount = claimedUserSnap.data()?.auth_provider === 'google.com'
  return isGoogleAccount
    ? googleApprovedNotification(ref, freshSnap.data(), adminUid)
    : setupLinkForApprovedInvitation(ref, freshSnap.data(), adminUid)
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

  // claim_invitation is the one fully PUBLIC action — an unauthenticated
  // visitor presenting the raw claim token from their invitation email/link.
  // apply_for_account_google / claim_invitation_google require a signed-in-
  // but-not-yet-admin session (the visitor just completed Sign in with
  // Google); every remaining action requires an admin session.
  if (action === 'claim_invitation') return claimInvitation(body)
  if (action === 'get_invitation') return getInvitationPreview(body)
  if (action === 'apply_for_account') return applyForAccount(body)
  if (action === 'claim_invitation_google') {
    const { uid, email, error } = await requireAuth(req)
    if (error) return error
    return claimInvitationGoogle(body, uid, email)
  }
  if (action === 'apply_for_account_google') {
    const { uid, email, error } = await requireAuth(req)
    if (error) return error
    return applyForAccountGoogle(body, uid, email)
  }

  const { uid, error } = await requireAdmin(req)
  if (error) return error

  switch (action) {
    case 'create_invitation': return createInvitation(body, uid)
    case 'resend_invitation': return resendInvitation(body, uid)
    case 'revoke_invitation': return revokeInvitation(body, uid)
    case 'reject_invitation': return rejectInvitation(body, uid)
    case 'approve_invitation': return approveInvitation(body, uid)
    case 'delete_account': return deleteAccount(body, uid)
    default: return json({ error: 'Unknown action' }, 400)
  }
}

export const config = { path: '/api/portal-invite' }
