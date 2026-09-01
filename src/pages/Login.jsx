import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { CUSTOMER_CURRENCIES } from '../currency'
import { applyForAccount, applyForAccountGoogle } from '../portalInviteApi'
import logo from '../assets/logo.png'

const googleProvider = new GoogleAuthProvider()

export default function Login() {
  const [mode, setMode]         = useState('signin') // 'signin' | 'signup' | 'google-details'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany]   = useState('')
  const [contact, setContact]   = useState('')
  const [currency, setCurrency] = useState('USD')
  const [hp, setHp]             = useState('') // honeypot — see applyForAccount
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [signedUp, setSignedUp]   = useState(false)

  async function handleSignIn(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      // Stamping login moved to useAuthState.js's onAuthStateChanged listener
      // (2026-08-27) — it fires for a restored/persisted session too, not
      // just a fresh interactive sign-in like this one, so it's the one
      // place that actually covers "customer is using the portal."
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
      await applyForAccount(company, contact, email, currency, hp)
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

  // "Sign in with Google" — same door for a returning account and a brand-
  // new one, distinguished only by whether users/{uid} already exists.
  // Returning: stamp the login same as email/password sign-in, done — App's
  // own auth-state routing takes it from there. Brand-new: we don't yet
  // have a company name (Google's own profile doesn't carry one), so land
  // on a short "google-details" step to collect just that before creating
  // the pending account via applyForAccountGoogle — same portal_invitations/
  // approval pipeline as the email/password self-signup path, just fronted
  // by Google instead of a typed email.
  async function handleGoogleSignIn() {
    setError(''); setGoogleLoading(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const uid = result.user.uid
      const userSnap = await getDoc(doc(db, 'users', uid))
      if (userSnap.exists()) {
        // Signed in — App's own routing takes over from here. Login stamp
        // happens in useAuthState.js's listener, see handleSignIn's comment.
      } else {
        setEmail(result.user.email || '')
        setContact(result.user.displayName || '')
        setMode('google-details')
      }
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setError('Could not sign in with Google. Please try again.')
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  // Second step of a brand-new Google signup — just the company name Google
  // itself can't supply. auth.currentUser is already the Google-authenticated
  // session from handleGoogleSignIn; applyForAccountGoogle authenticates as
  // that same user server-side (its own ID token), never a value typed here.
  async function handleGoogleDetailsSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await applyForAccountGoogle(company, contact, currency)
      setSignedUp(true)
    } catch (err) {
      if (err?.message === 'already_registered') {
        // This email already has an account under a DIFFERENT sign-in
        // method — Firebase doesn't auto-link Google to an existing
        // password account. Sign out of this stray new Google identity
        // (same reasoning as cancelGoogleDetails) rather than leave it
        // sitting there, and point back to the real way in.
        await signOut(auth)
        switchMode('signin')
        setError('An account already exists for this email. Sign in with your password below, or use "Forgot password?" if you need a new one.')
      } else {
        setError('Could not submit your request. Check your details and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Abandoning the google-details step: the Google popup already created a
  // live signed-in session with no users/{uid} doc behind it yet. Sign back
  // out rather than leave that half-finished session sitting there — App.jsx
  // has no self-heal for a doc-less signed-in user by design (see V8.3's
  // self-heal removal), so a stray session here would otherwise just show a
  // confusing blank/stuck state instead of cleanly returning to the login form.
  function cancelGoogleDetails() {
    signOut(auth)
    switchMode('signup')
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
        <h2 className="text-lg font-semibold text-ink mb-2">Your new account request is under review</h2>
        <p className="text-sm text-ink-70 mb-6">
          {mode === 'google-details'
            ? "We'll notify you by email once it's approved — no password to set, you'll just sign back in with Google. There's nothing else to do here in the meantime."
            : "Please check your email — we'll notify you there once it's approved, along with a secure link to set your password and sign in. There's nothing else to do here in the meantime."}
        </p>
        <button onClick={() => switchMode('signin')} className="text-xs text-gray-500 hover:text-brand-600 w-full text-center">
          Back to sign in
        </button>
      </Shell>
    )
  }

  if (mode === 'google-details') {
    return (
      <Shell>
        <h2 className="text-lg font-semibold text-ink mb-2">One more thing</h2>
        <p className="text-sm text-ink-70 mb-6">
          Signed in as <strong>{email}</strong> via Google. Just need your company name to submit your request.
        </p>
        <form onSubmit={handleGoogleDetailsSubmit} className="space-y-4">
          <Field label="Company name" value={company} onChange={setCompany} autoComplete="organization" required />
          <Field label="Your name" value={contact} onChange={setContact} autoComplete="name" />
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
          <button type="button" onClick={cancelGoogleDetails} className="text-xs text-gray-500 hover:text-brand-600 w-full text-center">
            Cancel
          </button>
        </form>
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

      <button type="button" onClick={handleGoogleSignIn} disabled={googleLoading}
        className="w-full flex items-center justify-center gap-2.5 py-2 mb-4 text-sm font-medium text-ink-70 bg-white border border-ivory-dark rounded-md hover:bg-ivory transition-colors disabled:opacity-60">
        <GoogleIcon />
        {googleLoading ? 'Signing in…' : mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
      </button>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-ivory-dark" />
        <span className="text-[11px] text-ink-60 uppercase tracking-wide">or</span>
        <div className="flex-1 h-px bg-ivory-dark" />
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
          {/* Honeypot — off-screen, never shown to a real visitor; a bot that
              fills every field submits into it, which applyForAccount reads
              and silently no-ops on. */}
          <input type="text" name="website" value={hp} onChange={e => setHp(e.target.value)}
            tabIndex={-1} autoComplete="off" aria-hidden="true"
            className="absolute opacity-0 pointer-events-none -z-10" style={{ left: '-9999px' }} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Submitting…' : 'Request account'}
          </button>
          <p className="text-xs text-ink-60 text-center">
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

// Standard Google "G" mark — the four-colour glyph is the recognizable part
// of a "Sign in with Google" button, not a Crystocraft design-system icon.
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"/>
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
    </svg>
  )
}
