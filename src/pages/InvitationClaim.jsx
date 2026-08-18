import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import logo from '../assets/logo.png'
import { getInvitationPreview, claimInvitation } from '../portalInviteApi'

// SU-07A — the public, unauthenticated landing page for an invitation link
// (/invite/:id?t=<rawToken>). Deliberately does NOT read Firestore directly
// (firestore.rules blocks a non-admin from reading portal_invitations at
// all) — every check goes through the Node function's public actions
// (get_invitation to preview, claim_invitation to confirm), which verify
// the token server-side the same way both times. See netlify/functions/
// portal-invite.js for the full state machine this page's states mirror.
function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
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
      setClaimed(true)
    } catch (err) {
      setSubmitError(err.message || 'invalid')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <Shell><p className="text-sm text-gray-500 text-center">Checking your invitation…</p></Shell>
  }

  if (previewError) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">
          {previewError === 'email_mismatch' ? 'Email doesn\'t match' : 'This invitation isn\'t available'}
        </h2>
        <p className="text-sm text-ink-70 mb-4">{STATE_MESSAGES[previewError] || STATE_MESSAGES.invalid}</p>
        <p className="text-xs text-gray-400">
          If you weren't expecting this invitation, you can safely ignore it — no account will be created.
        </p>
      </Shell>
    )
  }

  if (claimed) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">Thanks — you're all set for now</h2>
        <p className="text-sm text-ink-70 mb-2">
          Your details have been sent to Crystocraft for review. Your status is <strong>Pending approval</strong>.
        </p>
        <p className="text-sm text-ink-70">
          Once approved, we'll email you a secure link to set your own password — you don't need to do
          anything else right now.
        </p>
      </Shell>
    )
  }

  const alreadySignedIn = auth.currentUser

  return (
    <Shell>
      <h2 className="text-lg font-semibold text-ink mb-2">You're invited to the Crystocraft customer portal</h2>
      <p className="text-sm text-ink-70 mb-1">
        Crystocraft is inviting you to set up an account for <strong>{preview?.companyName}</strong> — for
        browsing your catalogue, pricing, and order history in one place.
      </p>
      <p className="text-sm text-ink-70 mb-6">
        You don't need to create a password yet. Confirm your details below; our team will review and approve
        the account, then send you a secure link to set your own password.
      </p>

      {alreadySignedIn && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          You're currently signed in as <strong>{alreadySignedIn.email}</strong>. This invitation is for a
          different account and won't affect your current sign-in.{' '}
          <button type="button" onClick={() => signOut(auth)} className="underline">Sign out</button> if that's confusing.
        </div>
      )}

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
      <p className="text-xs text-gray-400 mt-6">
        If you weren't expecting this invitation, or aren't sure why you received it, please reply to the
        invitation email and let us know — no account will be created unless you confirm it yourself.
      </p>
    </Shell>
  )
}
