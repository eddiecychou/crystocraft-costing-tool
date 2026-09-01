import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { Clock } from 'lucide-react'
import logo from '../assets/logo.png'
import { CUSTOMER_CURRENCIES } from '../currency'
import { applyForAccountGoogle } from '../portalInviteApi'

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ivory px-4">
      <div className="card w-full max-w-sm p-8">{children}</div>
    </div>
  )
}

// A brand-new Google signup (Login.jsx's handleGoogleSignIn) never gets to
// show its own "one more thing" company-name step — the instant
// signInWithPopup resolves, App.jsx's top-level router (watching Firebase
// auth state globally, independent of Login.jsx's own local flow) sees a
// signed-in user with no profile doc and immediately swaps Login out for
// THIS component, before Login.jsx's post-signin getDoc/mode-switch code
// ever runs. Caught live (2026-08-19): the popup completed, Auth user was
// created, but no Firestore doc or portal_invitations record ever got
// written — the account genuinely never applied for anything, it just
// LOOKED like it had because PendingScreen's generic copy doesn't
// distinguish "no doc at all" from "a real pending review." So the company-
// name step has to live HERE instead, where the router actually lands.
function GoogleDetailsStep() {
  const navigate = useNavigate()
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState(auth.currentUser?.displayName || '')
  const [currency, setCurrency] = useState('USD')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    try {
      await applyForAccountGoogle(company, contact, currency)
      // Nothing else to do — useProfile's own onSnapshot picks up the
      // freshly written doc and this component swaps to the normal
      // "awaiting approval" message automatically once Firestore syncs.
    } catch (err) {
      if (err?.message === 'already_registered') {
        // Same email already has an account under a DIFFERENT identity —
        // Login.jsx's own pre-check couldn't catch this (it only checks
        // the CURRENT uid, and the router race above skipped straight
        // past it to here). Sign out of this stray Google identity rather
        // than leave it sitting signed-in with nothing behind it.
        await signOut(auth)
        navigate('/login')
      } else {
        setError('Could not submit your request. Check your details and try again.')
        setSubmitting(false)
      }
    }
  }

  return (
    <>
      <img src={logo} alt="Crystocraft" className="h-9 w-auto mx-auto mb-6" />
      <h2 className="text-lg font-semibold text-ink mb-2 text-center">One more thing</h2>
      <p className="text-sm text-ink-70 mb-6 text-center">
        Signed in as <strong>{auth.currentUser?.email}</strong> via Google. Just need your company name to submit
        your request.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Company name</label>
          <input type="text" className="input" value={company} onChange={e => setCompany(e.target.value)} required />
        </div>
        <div>
          <label className="label">Your name</label>
          <input type="text" className="input" value={contact} onChange={e => setContact(e.target.value)} />
        </div>
        <div>
          <label className="label">Preferred currency</label>
          <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {CUSTOMER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full justify-center" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Request account'}
        </button>
        <button type="button" onClick={() => signOut(auth).then(() => navigate('/login'))}
          className="text-xs text-ink-60 hover:text-brand-600 w-full text-center">Cancel</button>
      </form>
    </>
  )
}

export default function PendingScreen({ profile }) {
  const navigate = useNavigate()
  // useProfile.js never returns null for "no doc" — it's the sentinel
  // { missing: true } (or { missing: true, error: true } on a read error),
  // always a truthy object. Checking !profile here (2026-08-19's first
  // attempt at this fix) was therefore always false once useProfile settled,
  // which is why the diagnostic log showed isGoogleWithNoDoc flip from true
  // to false the moment the real (missing) profile object arrived — the
  // "one more thing" form was never actually reachable. profile?.missing is
  // the correct check.
  const isGoogleWithNoDoc = profile?.missing && auth.currentUser?.providerData?.some(p => p.providerId === 'google.com')

  if (isGoogleWithNoDoc) return <Shell><GoogleDetailsStep /></Shell>

  return (
    <Shell>
      <div className="text-center">
        <img src={logo} alt="Crystocraft" className="h-9 w-auto mx-auto mb-6" />
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-600 mb-4">
          <Clock size={22} />
        </div>
        <h2 className="text-lg font-semibold text-ink mb-2">Awaiting approval</h2>
        <p className="text-sm text-ink-70 mb-6">
          Your account{profile?.company_name ? ` for ${profile.company_name}` : ''} is being reviewed.
          We will enable your wholesale pricing access shortly and notify you by email.
        </p>
        <button onClick={() => signOut(auth).then(() => navigate('/login'))}
          className="btn-secondary w-full justify-center">Sign out</button>
      </div>
    </Shell>
  )
}
