import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { Gem, Package } from 'lucide-react'
import logo from '../assets/logo.png'

const nav = [
  { to: '/shop/figurine', label: 'Figurine Gifts', Icon: Gem },
  { to: '/shop/corporate', label: 'Corporate Gifts', Icon: Package },
]

export default function CustomerLayout({ children, profile }) {
  const navigate = useNavigate()
  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }
  return (
    <div className="min-h-screen flex flex-col bg-ivory">
      <header className="bg-ink text-white shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img src={logo} alt="Crystocraft" className="h-7 w-auto brightness-0 invert shrink-0" />
            <span className="text-xs text-ivory/50 uppercase tracking-widest hidden sm:inline">Wholesale Catalogue</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-ivory/60 hidden sm:inline truncate">
              {profile?.company_name || profile?.email} · {profile?.base_currency}
            </span>
            <button onClick={handleSignOut} className="text-ivory/50 hover:text-red-400 transition-colors">Sign out</button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1">
          {nav.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive ? 'border-brand-500 text-white' : 'border-transparent text-ivory/50 hover:text-ivory'}`}>
              <Icon size={16} strokeWidth={1.75} /> {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-ink-40 py-6">
        Prices shown in {profile?.base_currency}. Corporate gift prices are indicative — made to order.
      </footer>
    </div>
  )
}
