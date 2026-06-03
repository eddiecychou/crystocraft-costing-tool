import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!email) { setError('Enter your email address first.'); return }
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
      setError('')
    } catch {
      setError('Could not send reset email. Check the address and try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-widest">Crystocraft</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Costing Tool</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {resetSent && <p className="text-sm text-green-600">Reset email sent — check your inbox.</p>}

          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button onClick={handleReset} className="mt-4 text-xs text-gray-500 hover:text-brand-600 w-full text-center">
          Forgot password?
        </button>
      </div>
    </div>
  )
}
