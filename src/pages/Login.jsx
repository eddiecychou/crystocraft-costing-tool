import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { doc, updateDoc, serverTimestamp, increment } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { CUSTOMER_CURRENCIES } from '../currency'
import { applyForAccount } from '../portalInviteApi'
import logo from '../assets/logo.png'

export default function Login() {
  const [mode, setMode]         = useState('signin') // 'signin' | 'signup'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany]   = useState('')
  const [contact, setContact]   = useState('')
  const [currency, setCurrency] = useState('USD')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [signedUp, setSignedUp]   = useState(false)

  async function handleSignIn(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      // Best-effort activity stamp for admin follow-up. Self-update (leaves
      // role/status/pricing untouched, so the rules allow it); never blocks login.
      updateDoc(doc(db, 'users', cred.user.uid), {
        last_login_at: serverTimestamp(),
        login_count: increment(1),
      }).catch(() => {})
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  // SU-07A — "Create account" no longer collects a password up front (that
  // felt "too early," per the owner). This now submits a self-application
  // through the SAME portal_invitations lifecycle an admin-created
  // invitation uses (netlify/functions/portal-invite.js's
  // applyForAccount) — no Auth password exists until admin approval sends
  // a secure setup link, exactly like the invitation flow. Deliberately
  // does NOT sign the browser in (there's no password yet to sign in
  // with) — the "Account created" screen below is purely informational.
  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await applyForAccount(company, contact, email, currency)
      setSignedUp(true)
    } catch (err) {
      const code = err?.message
      setError(
        code === 'already_pending' ? 'You already have a request pending approval for this email.'
        : code === 'already_registered' ? 'An account with this email already exists — try Sign in, or use "Forgot password?" if you need a new password.'
        : code === 'invalid_email' ? 'Enter a valid email address.'
        : 'Could not submit your request. Check your details and try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!email) { setError('Enter your email address first.'); return }
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true); setError('')
    } catch {
      setError('Could not send reset email. Check the address and try again.')
    }
  }

  function switchMode(m) {
    setMode(m); setError(''); setResetSent(false); setSignedUp(false)
  }

  if (signedUp) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">Request received</h2>
        <p className="text-sm text-ink-70 mb-6">
          Your request has been received. Crystocraft will review it and email you a secure password setup
          link if approved.
        </p>
        <button onClick={() => switchMode('signin')} className="btn-primary w-full justify-center">
          Back to sign in
        </button>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex rounded-md overflow-hidden border border-ivory-dark mb-6">
        {['signin', 'signup'].map(m => (
          <button key={m} onClick={() => switchMode(m)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === m ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {mode === 'signin' ? (
        <form onSubmit={handleSignIn} className="space-y-4">
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {resetSent && <p className="text-sm text-green-600">Reset email sent — check your inbox.</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" onClick={handleReset} className="text-xs text-gray-500 hover:text-brand-600 w-full text-center">
            Forgot password?
          </button>
        </form>
      ) : (
        <form onSubmit={handleSignUp} className="space-y-4">
          <Field label="Company name" value={company} onChange={setCompany} autoComplete="organization" required />
          <Field label="Your name" value={contact} onChange={setContact} autoComplete="name" required />
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <div>
            <label className="label">Preferred currency</label>
            <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CUSTOMER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Submitting…' : 'Request account'}
          </button>
          <p className="text-xs text-ink-50 text-center">
            No password needed yet — we'll review your request and email you a secure link to set one once it's approved.
          </p>
        </form>
      )}
    </Shell>
  )
}

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

function Field({ label, type = 'text', value, onChange, ...rest }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} onChange={e => onChange(e.target.value)} {...rest} />
    </div>
  )
}
