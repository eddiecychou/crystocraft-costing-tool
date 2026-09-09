import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
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
    <div className="min-h-screen flex items-center justify-center bg-ivory px-4">
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

// Self-serve recovery when the setup/reset link is dead. Firebase hard-caps
// these codes at ~1 hour and there's no admin "resend" once an invitation is
// claimed, so a dead link must not be a dead end — this fires the same public
// request_password_reset action as Login.jsx's "Forgot password?" (branded
// mail via portal-invite.js, never reveals whether the address has an account).
function ResendLink({ initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const [state, setState] = useState('idle') // idle | sending | sent | error

  async function send(e) {
    e.preventDefault()
    if (!email) { setState('error'); return }
    setState('sending')
    try {
      const res = await fetch('/api/portal-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_password_reset', email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error()
      setState('sent')
    } catch { setState('error') }
  }

  if (state === 'sent') {
    return (
      <p className="text-sm text-ink-70 mt-5">
        If <strong>{email}</strong> has an account, a fresh link is on its way.
        Check your inbox and spam folder — it's valid for about an hour.
      </p>
    )
  }

  return (
    <form onSubmit={send} className="mt-5 space-y-3">
      <div>
        <label className="label">Your email address</label>
        <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" required />
      </div>
      <button type="submit" className="btn-primary w-full justify-center" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send me a new link'}
      </button>
      {state === 'error' && <p className="text-sm text-red-600">Couldn't send — check the address and try again.</p>}
    </form>
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
      .catch(() => { if (!cancelled) setCheckError('This link has expired or has already been used.') })
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
      // Login stamp happens in useAuthState.js's onAuthStateChanged
      // listener, not here — see that file's comment.
      await signInWithEmailAndPassword(auth, email, password)
      setDone(true)
      setTimeout(() => navigate('/'), 1200)
    } catch (err) {
      // A code that dies between page-load and submit lands in the same
      // terminal state as one that was dead on arrival — flip to the
      // "link isn't available" screen, which now carries the resend form.
      if (err?.code === 'auth/expired-action-code' || err?.code === 'auth/invalid-action-code') {
        setCheckError('This link has expired or has already been used.')
      } else {
        setSubmitError('Could not set your password — please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return <Shell><p className="text-sm text-ink-60 text-center">Checking your link…</p></Shell>

  if (checkError) {
    return (
      <Shell>
        <h2 className="text-lg text-ink mb-2">This link isn't available</h2>
        <p className="text-sm text-ink-70">{checkError} Enter your email and we'll send a fresh one.</p>
        <ResendLink initialEmail={email} />
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <h2 className="text-lg text-ink mb-2">Password set</h2>
        <p className="text-sm text-ink-70">You're signed in — taking you through…</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h2 className="text-lg text-ink mb-2">Set your password</h2>
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
