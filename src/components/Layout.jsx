import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'
import logo from '../assets/logo.png'
import { APP_NAME, APP_VERSION, versionLabel } from '../appInfo'
import { canAccess, useAccess } from '../access'
import { useT } from '../i18n'
import {
  LayoutDashboard, Package, Gem, ClipboardList, Puzzle,
  Factory, Building2, Megaphone, Settings, MoreHorizontal, Users, Truck, FileText, Boxes, Database, Hash, Receipt, Sparkles, RotateCcw, ShoppingCart,
  PanelLeftClose, PanelLeftOpen, LogOut,
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
  { to: '/seo-reconcile', label: 'SEO Reconcile', short: 'Recon', Icon: Database, module: 'woo' },
  { to: '/woo-sync',   label: 'WooCommerce Sync', short: 'WooSync', Icon: ShoppingCart, module: 'woo' },
  { to: '/woo-stock',  label: 'Woo Stock Match', short: 'WooStock', Icon: ShoppingCart, module: 'woo' },

  { group: 'Supply' },
  { to: '/components', label: 'Components',    short: 'Comps',    Icon: Puzzle, module: 'supply' },
  { to: '/suppliers',  label: 'Suppliers',     short: 'Suppliers',Icon: Factory, module: 'supply' },
  { to: '/purchase-orders', label: 'Purchase Orders', short: 'POs', Icon: FileText, module: 'supply' },
  { to: '/inventory',  label: 'Inventory',     short: 'Stock',    Icon: Boxes, module: 'supply' },

  { group: 'System' },
  { to: '/erp-lookup', label: 'ERP Lookup',    short: 'ERP',      Icon: Database, module: 'erp' },
  { to: '/settings',   label: 'Settings',      short: 'Settings', Icon: Settings, module: 'settings' },
]

// The role-filtered nav for the signed-in user. A group heading is dropped
// when the role can see none of the destinations that follow it, so a
// production login never gets a bare "Sales" header over an empty section.
function useVisibleNav() {
  const { role, modules } = useAccess()
  const out = []
  for (let i = 0; i < nav.length; i++) {
    const item = nav[i]
    if (item.group) {
      // Look ahead: keep the heading only if at least one following
      // destination (before the next heading) is visible to this user.
      let keep = false
      for (let j = i + 1; j < nav.length && !nav[j].group; j++) {
        if (canAccess(role, nav[j].module, modules)) { keep = true; break }
      }
      if (keep) out.push(item)
    } else if (canAccess(role, item.module, modules)) {
      out.push(item)
    }
  }
  return out
}

export default function Layout({ children, user }) {
  const { role, modules } = useAccess()
  const t = useT()
  const visibleNav = useVisibleNav()
  const navItems = visibleNav.filter(n => n.to)
  const mainNav  = navItems.filter(n => n.primary)
  const moreNav  = navItems.filter(n => !n.primary)
  const navigate  = useNavigate()
  const location  = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('oc_nav_collapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('oc_nav_collapsed', navCollapsed ? '1' : '0') } catch { /* private mode */ }
  }, [navCollapsed])

  // Swipe-down-to-dismiss for the mobile "All sections" sheet. Handlers live
  // on the header only, so a swipe inside the scrollable grid still scrolls.
  const [dragY, setDragY] = useState(0)
  const dragStart = useState({ y: 0, active: false })[0]
  const onSheetTouchStart = (e) => { dragStart.y = e.touches[0].clientY; dragStart.active = true }
  const onSheetTouchMove = (e) => {
    if (!dragStart.active) return
    setDragY(Math.max(0, e.touches[0].clientY - dragStart.y))
  }
  const onSheetTouchEnd = () => {
    dragStart.active = false
    setDragY((dy) => { if (dy > 70) setMoreOpen(false); return 0 })
  }
  useEffect(() => { if (moreOpen) setDragY(0) }, [moreOpen])

  // Live count of SEO batches from DSH awaiting review — surfaced as a badge
  // on the "SEO Review" nav item. Admin-gated (seo_batches read = isAdmin);
  // skip the subscription for anyone else so it doesn't permission-deny.
  const [seoPending, setSeoPending] = useState(0)
  useEffect(() => {
    if (!canAccess(role, 'woo', modules)) { setSeoPending(0); return }
    const q = query(collection(db, 'seo_batches'), where('status', '==', 'pending_review'))
    return onSnapshot(q, snap => setSeoPending(snap.size), () => setSeoPending(0))
  }, [role, modules])
  const badgeFor = (to) => (to === '/seo-review' && seoPending > 0 ? seoPending : 0)
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
      <aside className={`hidden md:flex bg-ink flex-col shrink-0 transition-[width] duration-200 ${navCollapsed ? 'w-16' : 'w-56'}`}>
        <div className={`border-b border-white/10 ${navCollapsed ? 'px-2 py-4 flex justify-center' : 'px-5 py-5'}`}>
          {navCollapsed ? (
            <img src={logo} alt="Crystocraft" className="h-6 w-6 object-contain object-left brightness-0 invert" />
          ) : (
            <>
              <img src={logo} alt="Crystocraft" className="h-7 w-auto brightness-0 invert" />
              <p className="text-xs font-medium text-ivory/50 mt-2 tracking-[0.14em] uppercase font-label">{APP_NAME}</p>
              <p className="text-2xs text-ivory/30 mt-1 font-label tracking-wide">{versionLabel()}</p>
            </>
          )}
        </div>

        <button
          onClick={() => setNavCollapsed(v => !v)}
          title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center gap-2 text-ivory/40 hover:text-ivory hover:bg-white/8 transition-colors ${
            navCollapsed ? 'justify-center py-2' : 'px-4 py-2 text-2xs uppercase tracking-[0.12em]'
          }`}
        >
          {navCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} /> : <><PanelLeftClose size={15} strokeWidth={1.75} /> Collapse</>}
        </button>

        {/* min-h-0 + overflow-y-auto: without both, a flex child refuses to
            shrink below its content, so the tail of the list was clipped off
            the bottom of the viewport and simply unreachable — not scrollable,
            gone. */}
        <nav className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3 space-y-0.5 ${navCollapsed ? 'px-2' : 'px-3'}`}>
          {visibleNav.map((item, i) => (
            item.group ? (
              navCollapsed ? (
                <div key={`g-${item.group}`} className={`mx-2 border-t border-white/10 ${i === 0 ? 'hidden' : 'mt-3 pt-3'}`} />
              ) : (
                <p key={`g-${item.group}`}
                   className={`px-3 text-2xs font-semibold uppercase tracking-[0.12em] text-ivory/25 ${i === 0 ? 'pb-1' : 'pt-4 pb-1'}`}>
                  {t(item.group)}
                </p>
              )
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                title={navCollapsed ? t(item.label) : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 py-2 rounded-sm text-sm font-medium transition-colors relative ${
                    navCollapsed ? 'justify-center px-0' : 'px-3'
                  } ${
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-ivory/60 hover:bg-white/8 hover:text-ivory'
                  }`
                }
              >
                <item.Icon size={18} strokeWidth={1.75} className="shrink-0" />
                {!navCollapsed && <span className="truncate">{t(item.label)}</span>}
                {badgeFor(item.to) > 0 && (
                  navCollapsed ? (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                  ) : (
                    <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-2xs font-semibold flex items-center justify-center leading-none">
                      {badgeFor(item.to)}
                    </span>
                  )
                )}
              </NavLink>
            )
          ))}
        </nav>

        <div className={`border-t border-white/10 ${navCollapsed ? 'px-2 py-3 flex justify-center' : 'px-4 py-4'}`}>
          {navCollapsed ? (
            <button onClick={handleSignOut} title={t('Sign out')}
              className="text-ivory/40 hover:text-red-400 transition-colors p-1">
              <LogOut size={18} strokeWidth={1.75} />
            </button>
          ) : (
            <>
              <p className="text-xs text-ivory/40 truncate mb-2">{user?.email}</p>
              <button onClick={handleSignOut} className="text-xs text-ivory/40 hover:text-red-400 transition-colors">
                {t('Sign out')}
              </button>
            </>
          )}
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
            {t('Sign out')}
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
              <span className="text-2xs font-medium leading-none truncate max-w-full px-0.5">{t(short)}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={`relative flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
 moreActive || moreOpen ? 'text-white' : 'text-ivory/40'
            }`}
          >
            {seoPending > 0 && <span className="absolute top-1.5 right-1/2 translate-x-3 w-2 h-2 rounded-full bg-red-500" />}
            <MoreHorizontal size={20} strokeWidth={1.75} />
            <span className="text-2xs font-medium leading-none">{t('More')}</span>
          </button>
        </nav>

        {/* More sheet — full grid of every section, slides up above tab bar */}
        {moreOpen && (
          <>
            <div className="md:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setMoreOpen(false)} />
            <div
              className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 bg-white border-t border-ivory-dark shadow-2xl rounded-t-xl overflow-hidden flex flex-col max-h-[72vh]"
              style={{ transform: `translateY(${dragY}px)`, transition: dragY ? 'none' : 'transform 0.22s ease' }}
            >
              <div
                className="flex flex-col items-center pt-2 pb-1 shrink-0 touch-none cursor-grab active:cursor-grabbing"
                onTouchStart={onSheetTouchStart}
                onTouchMove={onSheetTouchMove}
                onTouchEnd={onSheetTouchEnd}
              >
                <span className="w-10 h-1.5 rounded-full bg-ivory-dark mb-2" />
                <p className="text-xs font-medium text-ink-60 uppercase tracking-[0.12em] font-label">{t('All sections')}</p>
              </div>
              <div className="grid grid-cols-4 gap-1 p-3 pt-1 overflow-y-auto">
                {visibleNav.map((item) => (
                  item.group ? (
                    <p key={`mg-${item.group}`} className="col-span-4 px-1 pt-3 pb-0.5 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-40">
                      {t(item.group)}
                    </p>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        `relative flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-none text-center transition-colors ${
                          isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-70 hover:bg-ivory active:bg-ivory'
                        }`
                      }
                    >
                      {badgeFor(item.to) > 0 && (
                        <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-2xs font-semibold flex items-center justify-center leading-none">
                          {badgeFor(item.to)}
                        </span>
                      )}
                      <item.Icon size={24} strokeWidth={1.6} className="shrink-0" />
                      <span className="text-2xs font-medium leading-tight line-clamp-2">{t(item.short)}</span>
                    </NavLink>
                  )
                ))}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
