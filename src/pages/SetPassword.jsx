import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { stampLogin } from '../authActivity'
import logo from '../assets/logo.png'

// SU-07A — where an approved invitation's setup email link lands
// (generatePasswordResetLink's actionCodeSettings.url in netlify/functions/
// portal-invite.js points here with handleCodeInApp:true). Uses Firebase's
// OWN action-code mechanism end to end — verifyPasswordResetCode/
// confirmPasswordReset — never a token this app invented itself, so expired/
// used/invalid handling is Firebase's, not ours to get wrong. A code that's
// already been used, or one belonging to a DIFFERENT account, is rejected by
// Firebase itself; this page cannot be tricked into changing another
// customer's password by supplying an arbitrary email — the email comes
// back FROM verifying the code, never typed in by the visitor.
const MIN_PASSWORD_LENGTH = 8

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <img src={logo} alt="Crystocraft" className="h-10 w-auto mx-auto" />
          <p className="text-xs font-medium text-brand-600 uppercase tracking-widest mt-3">Crystocraft</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function SetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const oobCode = params.get('oobCode') || ''

  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState('')
  const [email, setEmail] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!oobCode) { setCheckError('This link is missing information and can\'t be used.'); setChecking(false); return }
    let cancelled = false
    verifyPasswordResetCode(auth, oobCode)
      .then(verifiedEmail => { if (!cancelled) setEmail(verifiedEmail) })
      .catch(() => { if (!cancelled) setCheckError('This link has expired or has already been used. Please ask Crystocraft to resend it.') })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [oobCode])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    if (password.length < MIN_PASSWORD_LENGTH) { setSubmitError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    if (password !== confirm) { setSubmitError('Passwords don\'t match.'); return }
    setSubmitting(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      // Same "sign in right after account creation" posture as Login.jsx's
      // own sign-up path — the customer just proved control of both the
      // email (via the code) and the new password, so this isn't a weaker
      // guarantee than a normal sign-in.
      const cred = await signInWithEmailAndPassword(auth, email, password)
      stampLogin(cred.user.uid)
      setDone(true)
      setTimeout(() => navigate('/'), 1200)
    } catch (err) {
      setSubmitError(err?.code === 'auth/expired-action-code' || err?.code === 'auth/invalid-action-code'
        ? 'This link has expired or has already been used. Please ask Crystocraft to resend it.'
        : 'Could not set your password — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return <Shell><p className="text-sm text-gray-500 text-center">Checking your link…</p></Shell>

  if (checkError) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">This link isn't available</h2>
        <p className="text-sm text-ink-70">{checkError}</p>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">Password set</h2>
        <p className="text-sm text-ink-70">You're signed in — taking you to the portal…</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h2 className="text-lg font-semibold text-ink mb-2">Set your password</h2>
      <p className="text-sm text-ink-70 mb-6">for <strong>{email}</strong></p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        </div>
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <button type="submit" className="btn-primary w-full justify-center" disabled={submitting}>
          {submitting ? 'Setting password…' : 'Set password and sign in'}
        </button>
      </form>
    </Shell>
  )
}
