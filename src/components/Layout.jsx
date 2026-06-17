import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import logo from '../assets/logo.png'

const nav = [
  { to: '/dashboard',  label: 'Dashboard',  short: 'Home',     icon: '📊', primary: true },
  { to: '/products',   label: 'Corp Gifts', short: 'Corp',     icon: '📦', primary: true },
  { to: '/range',      label: 'Figurine Gifts', short: 'Figurine', icon: '💎', primary: true },
  { to: '/quotes',     label: 'Quotes',     short: 'Quotes',   icon: '📋', primary: true },
  { to: '/suppliers',  label: 'Suppliers',  short: 'Suppliers',  icon: '🏭' },
  { to: '/customers',  label: 'Customers',  short: 'Customers',  icon: '🏢' },
  { to: '/catalogues', label: 'Catalogues', short: 'Catalogues', icon: '📖' },
  { to: '/blog-generator', label: 'Blog Writer', short: 'Blog Writer', icon: '✍️' },
  { to: '/settings',   label: 'Settings',   short: 'Settings',   icon: '⚙️' },
]

const mainNav  = nav.filter(n => n.primary)
const moreNav  = nav.filter(n => !n.primary)

export default function Layout({ children, user }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreNav.some(n => location.pathname.startsWith(n.to))

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-ivory">

      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-ink flex-col shrink-0">
        <div className="px-5 py-5 border-b border-white/10">
          <img src={logo} alt="Crystocraft" className="h-7 w-auto brightness-0 invert" />
          <p className="text-xs font-medium text-ivory/50 mt-2 tracking-[0.14em] uppercase font-label">Product Manager</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-ivory/60 hover:bg-white/8 hover:text-ivory'
                }`
              }
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-xs text-ivory/40 truncate mb-2">{user?.email}</p>
          <button onClick={handleSignOut} className="text-xs text-ivory/40 hover:text-red-400 transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden bg-ink px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <img src={logo} alt="Crystocraft" className="h-6 w-auto brightness-0 invert" />
            <p className="text-xs font-medium text-ivory/50 mt-0.5 tracking-[0.12em] uppercase font-label">Product Manager</p>
          </div>
          <button onClick={handleSignOut} className="text-xs text-ivory/40 hover:text-red-400 transition-colors px-2 py-1">
            Sign out
          </button>
        </header>

        {/* Page content — add bottom padding on mobile for tab bar */}
        <main id="main-scroll" className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>

        {/* Bottom tab bar — mobile only */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-ink border-t border-white/10 flex z-40 pb-[env(safe-area-inset-bottom)]">
          {mainNav.map(({ to, short, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
                  isActive ? 'text-white' : 'text-ivory/40'
                }`
              }
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">{short}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={`flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
              moreActive || moreOpen ? 'text-white' : 'text-ivory/40'
            }`}
          >
            <span className="text-lg leading-none">⋯</span>
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </nav>

        {/* More drawer — slides up above tab bar */}
        {moreOpen && (
          <>
            <div className="md:hidden fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
            <div className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 bg-white border-t border-ivory-dark shadow-lg rounded-t-sm overflow-hidden">
              {moreNav.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-4 px-6 py-4 text-sm font-medium border-b border-ivory-dark last:border-0 transition-colors ${
                      isActive ? 'text-brand-600 bg-brand-50' : 'text-ink-80'
                    }`
                  }
                >
                  <span className="text-2xl leading-none">{icon}</span>
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
