import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { Clock } from 'lucide-react'
import logo from '../assets/logo.png'

export default function PendingScreen({ profile }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-sm p-8 text-center">
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

        {/* TEMP DIAGNOSTIC — remove after debugging */}
        <pre className="mt-6 text-left text-[10px] leading-snug bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
{`uid: ${auth.currentUser?.uid || '(none)'}
profile: ${JSON.stringify(profile)}`}
        </pre>
      </div>
    </div>
  )
}
