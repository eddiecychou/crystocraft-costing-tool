import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import logo from '../assets/logo.png'

const nav = [
  { to: '/products',   label: 'Products',   icon: '📦' },
  { to: '/suppliers',  label: 'Suppliers',  icon: '🏭' },
  { to: '/customers',  label: 'Customers',  icon: '🏢' },
  { to: '/quotes',     label: 'Quotes',     icon: '📋' },
  { to: '/catalogues', label: 'Catalogues', icon: '📖' },
  { to: '/settings',   label: 'Settings',   icon: '⚙️' },
]

export default function Layout({ children, user }) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">

      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-100">
          <img src={logo} alt="Crystocraft" className="h-7 w-auto" />
          <p className="text-sm font-bold text-gray-900 mt-1">Product Management App</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 truncate mb-2">{user?.email}</p>
          <button onClick={handleSignOut} className="text-xs text-gray-500 hover:text-red-600 transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <img src={logo} alt="Crystocraft" className="h-6 w-auto" />
            <p className="text-xs font-bold text-gray-700 mt-0.5">Product Management App</p>
          </div>
          <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1">
            Sign out
          </button>
        </header>

        {/* Page content — add bottom padding on mobile for tab bar */}
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>

        {/* Bottom tab bar — mobile only */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40">
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-brand-600' : 'text-gray-400'
                }`
              }
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
