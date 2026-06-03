import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'

const nav = [
  { to: '/products',  label: 'Products',  icon: '📦' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏭' },
  { to: '/quotes',    label: 'Quotes',    icon: '📋' },
  { to: '/settings',  label: 'Settings',  icon: '⚙️' },
]

export default function Layout({ children, user }) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-100">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-widest">Crystocraft</p>
          <p className="text-sm font-bold text-gray-900 mt-0.5">Costing Tool</p>
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
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
