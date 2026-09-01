import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { signOut, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '../firebase'
import logo from '../assets/logo.png'
import { getInvitationPreview, claimInvitation, claimInvitationGoogle } from '../portalInviteApi'

const googleProvider = new GoogleAuthProvider()

// SU-07A — the public, unauthenticated landing page for an invitation link
// (/invite/:id?t=<rawToken>). Deliberately does NOT read Firestore directly
// (firestore.rules blocks a non-admin from reading portal_invitations at
// all) — every check goes through the Node function's public actions
// (get_invitation to preview, claim_invitation to confirm), which verify
// the token server-side the same way both times. See netlify/functions/
// portal-invite.js for the full state machine this page's states mirror.
function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ivory px-4">
      <div className="card w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <img src={logo} alt="Crystocraft" className="h-10 w-auto mx-auto" />
          <p className="text-xs font-medium text-brand-600 uppercase tracking-widest mt-3">Crystocraft</p>
        </div>
        {children}
      </div>
    </div>
  )
}

const STATE_MESSAGES = {
  invalid: 'This invitation link isn\'t valid. If you were expecting one, please contact Crystocraft and we can send a new one.',
  expired: 'This invitation has expired. Please contact Crystocraft and we can send you a new one.',
  used: 'This invitation has already been used.',
  revoked: 'This invitation is no longer active. If you believe this is a mistake, please contact Crystocraft.',
  customer_missing: 'This invitation is no longer valid. Please contact Crystocraft.',
}

export default function InvitationClaim() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') || ''

  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const [preview, setPreview] = useState(null) // { companyName, contactEmail }

  const [email, setEmail] = useState('')
  const [contactName, setContactName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [claimed, setClaimed] = useState(false)
  const [claimedVia, setClaimedVia] = useState('form') // 'form' | 'google'

  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')

  useEffect(() => {
    let cancelled = false
    getInvitationPreview(id, token)
      .then(res => { if (!cancelled) { setPreview(res); setEmail(res.contactEmail || '') } })
      .catch(e => { if (!cancelled) setPreviewError(e.message || 'invalid') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, token])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(''); setSubmitting(true)
    try {
      await claimInvitation(id, token, email.trim(), contactName.trim())
      setClaimedVia('form')
      setClaimed(true)
    } catch (err) {
      setSubmitError(err.message || 'invalid')
    } finally {
      setSubmitting(false)
    }
  }

  // "Continue with Google" — offered here, BEFORE any password-based account
  // exists for this invitation, so there's no pre-existing uid to reconcile
  // (see portal-invite.js's claimInvitationGoogle for why that matters).
  // Verifies the signed-in Google email against the invitation up front and
  // signs back out on any mismatch/rejection, same posture as Login.jsx's
  // own Google-signup error handling — never leave a stray session sitting
  // there attached to nothing.
  async function handleGoogleClaim() {
    setGoogleError(''); setGoogleLoading(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const signedInEmail = (result.user.email || '').trim().toLowerCase()
      const invitedEmail = (preview?.contactEmail || '').trim().toLowerCase()
      if (invitedEmail && signedInEmail !== invitedEmail) {
        await signOut(auth)
        setGoogleError('email_mismatch')
        return
      }
      await claimInvitationGoogle(id, token, result.user.displayName || '')
      setClaimedVia('google')
      setClaimed(true)
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return
      await signOut(auth).catch(() => {})
      setGoogleError(err.message || 'invalid')
    } finally {
      setGoogleLoading(false)
    }
  }

  if (loading) {
    return <Shell><p className="text-sm text-ink-60 text-center">Checking your invitation…</p></Shell>
  }

  if (previewError) {
    return (
      <Shell>
        <h2 className="text-lg text-ink mb-2">
          {previewError === 'email_mismatch' ? 'Email doesn\'t match' : 'This invitation isn\'t available'}
        </h2>
        <p className="text-sm text-ink-70 mb-4">{STATE_MESSAGES[previewError] || STATE_MESSAGES.invalid}</p>
        <p className="text-xs text-ink-60">
          If you weren't expecting this invitation, you can safely ignore it — no account will be created.
        </p>
      </Shell>
    )
  }

  if (claimed) {
    return (
      <Shell>
        <h2 className="text-lg text-ink mb-2">Thanks — you're all set for now</h2>
        <p className="text-sm text-ink-70 mb-2">
          Your details have been sent to Crystocraft for review. Your status is <strong>Pending approval</strong>.
        </p>
        <p className="text-sm text-ink-70">
          {claimedVia === 'google'
            ? "Once approved, you'll be notified by email — just sign back in with Google, no password needed."
            : "Once approved, we'll email you a secure link to set your own password — you don't need to do anything else right now."}
        </p>
      </Shell>
    )
  }

  const alreadySignedIn = auth.currentUser

  return (
    <Shell>
      <h2 className="text-lg text-ink mb-2">You're invited to the Crystocraft customer portal</h2>
      <p className="text-sm text-ink-70 mb-1">
        Crystocraft is inviting you to set up an account for <strong>{preview?.companyName}</strong> — for
        browsing your catalogue, pricing, and order history in one place.
      </p>
      <p className="text-sm text-ink-70 mb-6">
        You don't need to create a password yet. Confirm your details below; our team will review and approve
        the account, then send you a secure link to set your own password.
      </p>

      {alreadySignedIn && (
        <div className="mb-4 rounded-none bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          You're currently signed in as <strong>{alreadySignedIn.email}</strong>. This invitation is for a
          different account and won't affect your current sign-in.{' '}
          <button type="button" onClick={() => signOut(auth)} className="underline">Sign out</button> if that's confusing.
        </div>
      )}

      <button type="button" onClick={handleGoogleClaim} disabled={googleLoading}
        className="btn-secondary w-full justify-center mb-3">
        {googleLoading ? 'Signing in…' : 'Continue with Google'}
      </button>
      {googleError && (
        <p className="text-sm text-red-600 mb-3">
          {googleError === 'email_mismatch'
            ? 'That Google account\'s email doesn\'t match this invitation. Please use the email address the invitation was sent to.'
            : (googleError === 'already_registered' || googleError === 'already_pending')
              ? 'An account already exists for this email. Please use the "Confirm and continue" form below instead.'
              : (STATE_MESSAGES[googleError] || 'Could not sign in with Google — please try again.')}
        </p>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px bg-ivory-dark flex-1" />
        <span className="text-xs text-ink-60">or set a password instead</span>
        <div className="h-px bg-ivory-dark flex-1" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Your name (optional)</label>
          <input type="text" className="input" value={contactName} onChange={e => setContactName(e.target.value)} />
        </div>
        {submitError && (
          <p className="text-sm text-red-600">
            {submitError === 'email_mismatch'
              ? 'That email doesn\'t match this invitation. Please use the email address the invitation was sent to.'
              : (STATE_MESSAGES[submitError] || 'Something went wrong — please try again.')}
          </p>
        )}
        <button type="submit" className="btn-primary w-full justify-center" disabled={submitting}>
          {submitting ? 'Confirming…' : 'Confirm and continue'}
        </button>
      </form>
      <p className="text-xs text-ink-60 mt-6">
        If you weren't expecting this invitation, or aren't sure why you received it, please reply to the
        invitation email and let us know — no account will be created unless you confirm it yourself.
      </p>
    </Shell>
  )
}
