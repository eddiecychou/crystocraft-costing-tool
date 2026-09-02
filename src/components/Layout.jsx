import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import logo from '../assets/logo.png'
import { APP_NAME, APP_VERSION, versionLabel } from '../appInfo'
import { canAccess, useRole } from '../access'
import {
  LayoutDashboard, Package, Gem, ClipboardList, Puzzle,
  Factory, Building2, Megaphone, Settings, MoreHorizontal, Users, Truck, FileText, Boxes, Database, Hash, Receipt, Sparkles, RotateCcw, ShoppingCart,
} from 'lucide-react'

// Grouped so the list stays readable as it grows — the flat version was hard
// to scan past ~16 destinations. Order within each group follows the real
// workflow rather than the alphabet (e.g. Finance: invoice → credit → UC#).
// Groups: Catalogue, Sales (quote/CRM/marketing), Finance, Ecommerce
// (WooCommerce B2C), Supply, System.
//
// `module` tags each destination with an access.js capability key. The list
// is filtered by the signed-in role (see useVisibleNav below) so a production
// login sees only its five modules; nothing here decides access on its own —
// access.js is the single source of truth, shared with the route guards.
const nav = [
  { to: '/dashboard',  label: 'Dashboard',     short: 'Home',     Icon: LayoutDashboard, primary: true, module: 'dashboard' },

  { group: 'Catalogue' },
  { to: '/range',      label: 'Figurine Gifts',short: 'Figurine', Icon: Gem, primary: true, module: 'figurine' },
  { to: '/products',   label: 'Corp Gifts',    short: 'Corp',     Icon: Package, primary: true, module: 'products' },
  { to: '/swatch-library', label: 'Swatch Library', short: 'Swatches', Icon: Sparkles, module: 'swatch' },

  { group: 'Sales' },
  { to: '/quotes',     label: 'Quotes',        short: 'Quotes',   Icon: ClipboardList, primary: true, module: 'quotes' },
  { to: '/shipping',   label: 'Production',    short: 'Prod',     Icon: Truck, module: 'shipping' },
  { to: '/customers',  label: 'Customers',     short: 'Customers',Icon: Building2, module: 'customers' },
  { to: '/portal',     label: 'Portal',        short: 'Portal',   Icon: Users, module: 'portal' },
  { to: '/marketing',  label: 'Marketing',     short: 'Marketing',Icon: Megaphone, module: 'marketing' },

  { group: 'Finance' },
  { to: '/sales-invoices', label: 'Sales Invoices', short: 'Invoices', Icon: Receipt, module: 'invoices' },
  { to: '/credit-notes', label: 'Credit Notes', short: 'Credits', Icon: RotateCcw, module: 'credit_notes' },
  { to: '/uc-registry',label: 'UC Registry',   short: 'UC#',      Icon: Hash, module: 'uc' },

  { group: 'Ecommerce' },
  { to: '/woo-catalogue', label: 'Woo Catalogue', short: 'WooCat', Icon: ShoppingCart, module: 'woo' },
  { to: '/seo-state',  label: 'SEO State',      short: 'SEO',     Icon: Database, module: 'woo' },
  { to: '/seo-review', label: 'SEO Review',     short: 'Review',  Icon: ClipboardList, module: 'woo' },
  { to: '/woo-sync',   label: 'WooCommerce Sync', short: 'WooSync', Icon: ShoppingCart, module: 'woo' },
  { to: '/woo-stock',  label: 'Woo Stock Match', short: 'WooStock', Icon: ShoppingCart, module: 'woo' },

  { group: 'Supply' },
  { to: '/components', label: 'Components',    short: 'Comps',    Icon: Puzzle, module: 'components' },
  { to: '/suppliers',  label: 'Suppliers',     short: 'Suppliers',Icon: Factory, module: 'suppliers' },
  { to: '/purchase-orders', label: 'Purchase Orders', short: 'POs', Icon: FileText, module: 'purchase_orders' },
  { to: '/inventory',  label: 'Inventory',     short: 'Stock',    Icon: Boxes, module: 'inventory' },

  { group: 'System' },
  { to: '/erp-lookup', label: 'ERP Lookup',    short: 'ERP',      Icon: Database, module: 'erp' },
  { to: '/settings',   label: 'Settings',      short: 'Settings', Icon: Settings, module: 'settings' },
]

// The role-filtered nav for the signed-in user. A group heading is dropped
// when the role can see none of the destinations that follow it, so a
// production login never gets a bare "Sales" header over an empty section.
function useVisibleNav() {
  const role = useRole()
  const out = []
  for (let i = 0; i < nav.length; i++) {
    const item = nav[i]
    if (item.group) {
      // Look ahead: keep the heading only if at least one following
      // destination (before the next heading) is visible to this role.
      let keep = false
      for (let j = i + 1; j < nav.length && !nav[j].group; j++) {
        if (canAccess(role, nav[j].module)) { keep = true; break }
      }
      if (keep) out.push(item)
    } else if (canAccess(role, item.module)) {
      out.push(item)
    }
  }
  return out
}

export default function Layout({ children, user }) {
  const visibleNav = useVisibleNav()
  const navItems = visibleNav.filter(n => n.to)
  const mainNav  = navItems.filter(n => n.primary)
  const moreNav  = navItems.filter(n => !n.primary)
  const navigate  = useNavigate()
  const location  = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreNav.some(n => location.pathname.startsWith(n.to))

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  // Mobile cold-load bottom-nav gap fix (V8.6, reported live on mobile
  // Chrome) — see index.css's .h-screen-dynamic comment for the full
  // `dvh` staleness bug this works around. window.visualViewport.height
  // (falling back to innerHeight) is the actual current visible height and
  // doesn't have dvh's first-paint staleness issue, so it's a more
  // trustworthy source to drive the shell's height from.
  useEffect(() => {
    const setAppVh = () => {
      const h = window.visualViewport?.height || window.innerHeight
      document.documentElement.style.setProperty('--app-vh', `${h * 0.01}px`)
    }
    setAppVh()
    window.visualViewport?.addEventListener('resize', setAppVh)
    window.addEventListener('resize', setAppVh)
    window.addEventListener('orientationchange', setAppVh)
    return () => {
      window.visualViewport?.removeEventListener('resize', setAppVh)
      window.removeEventListener('resize', setAppVh)
      window.removeEventListener('orientationchange', setAppVh)
    }
  }, [])

  return (
    <div className="flex h-screen-dynamic bg-ivory">

      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-ink flex-col shrink-0">
        <div className="px-5 py-5 border-b border-white/10">
          <img src={logo} alt="Crystocraft" className="h-7 w-auto brightness-0 invert" />
          <p className="text-xs font-medium text-ivory/50 mt-2 tracking-[0.14em] uppercase font-label">{APP_NAME}</p>
          <p className="text-2xs text-ivory/30 mt-1 font-label tracking-wide">{versionLabel()}</p>
        </div>

        {/* min-h-0 + overflow-y-auto: without both, a flex child refuses to
            shrink below its content, so the tail of the list was clipped off
            the bottom of the viewport and simply unreachable — not scrollable,
            gone. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-0.5">
          {visibleNav.map((item, i) => (
            item.group ? (
              <p key={`g-${item.group}`}
                 className={`px-3 text-2xs font-semibold uppercase tracking-[0.12em] text-ivory/25 ${i === 0 ? 'pb-1' : 'pt-4 pb-1'}`}>
                {item.group}
              </p>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-ivory/60 hover:bg-white/8 hover:text-ivory'
                  }`
                }
              >
                <item.Icon size={18} strokeWidth={1.75} className="shrink-0" />
                {item.label}
              </NavLink>
            )
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
            <p className="text-xs font-medium text-ivory/50 mt-0.5 tracking-[0.12em] uppercase font-label">
              {APP_NAME} <span className="text-ivory/30 normal-case tracking-normal">{APP_VERSION}</span>
            </p>
          </div>
          <button onClick={handleSignOut} className="text-xs text-ivory/40 hover:text-red-400 transition-colors px-2 py-1">
            Sign out
          </button>
        </header>

        {/* Page content — add bottom padding on mobile for tab bar */}
        <main id="main-scroll" className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-20 md:pb-0">
          {children}
        </main>

        {/* Bottom tab bar — mobile only */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-ink border-t border-white/10 flex z-40 pb-[env(safe-area-inset-bottom)]">
          {mainNav.map(({ to, short, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
                  isActive ? 'text-white' : 'text-ivory/40'
                }`
              }
            >
              <Icon size={20} strokeWidth={1.75} />
              <span className="text-2xs font-medium leading-none truncate max-w-full px-0.5">{short}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={`flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
 moreActive || moreOpen ? 'text-white' : 'text-ivory/40'
            }`}
          >
            <MoreHorizontal size={20} strokeWidth={1.75} />
            <span className="text-2xs font-medium leading-none">More</span>
          </button>
        </nav>

        {/* More sheet — full grid of every section, slides up above tab bar */}
        {moreOpen && (
          <>
            <div className="md:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setMoreOpen(false)} />
            <div className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 bg-white border-t border-ivory-dark shadow-2xl rounded-t-xl overflow-hidden">
              <div className="flex flex-col items-center pt-2 pb-1">
                <span className="w-9 h-1 rounded-full bg-ivory-dark mb-2" />
                <p className="text-xs font-medium text-ink-60 uppercase tracking-[0.12em] font-label">All sections</p>
              </div>
              <div className="grid grid-cols-4 gap-1 p-3 pt-2">
                {navItems.map(({ to, short, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-none text-center transition-colors ${
                        isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-70 hover:bg-ivory active:bg-ivory'
                      }`
                    }
                  >
                    <Icon size={24} strokeWidth={1.6} className="shrink-0" />
                    <span className="text-2xs font-medium leading-tight line-clamp-2">{short}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
