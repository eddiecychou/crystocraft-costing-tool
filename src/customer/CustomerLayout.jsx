import { useState, useEffect, useRef } from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { Home, Gem, Package, Heart, ClipboardList, Images, Receipt, Sparkles, MoreHorizontal } from 'lucide-react'
import { useCart, useFavourites } from './store'
import { hasBrandPortalContent } from '../customerProposal'
import logo from '../assets/logo.png'

export default function CustomerLayout({ children, profile }) {
  const navigate = useNavigate()
  const location = useLocation()
  const cart = useCart()
  const fav = useFavourites()
  // Desktop nav is a horizontal strip — keep the current section's tab
  // visible instead of letting it sit scrolled off-screen.
  const navRef = useRef(null)
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [location.pathname])
  // Mobile "More" sheet — close it on any route change.
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  const customerId = profile?.customer_id || null
  // Hidden until proven otherwise — an empty Brand Portal tab is a dead
  // end (owner request), not just an empty page, so default to NOT showing
  // it rather than flashing it on then off once the check resolves.
  const [hasBrandContent, setHasBrandContent] = useState(false)
  useEffect(() => {
    let alive = true
    if (!customerId) { setHasBrandContent(false); return }
    hasBrandPortalContent(customerId).then(v => { if (alive) setHasBrandContent(v) })
    return () => { alive = false }
  }, [customerId])

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }
  const nav = [
    { to: '/shop', label: 'Home', short: 'Home', Icon: Home, end: true },
    { to: '/shop/figurine', label: 'Figurine Gifts', short: 'Figurines', Icon: Gem },
    { to: '/shop/corporate', label: 'Corporate Gifts', short: 'Corporate', Icon: Package },
    // Grouped right after Corporate Gifts (owner request) — related content,
    // and only shown once we know the customer actually has something in it.
    ...(customerId && hasBrandContent ? [{ to: '/shop/brand-portal', label: 'Brand Portal', short: 'Brand', Icon: Images }] : []),
    { to: '/shop/swatches', label: 'Swatch Library', short: 'Swatches', Icon: Sparkles },
    { to: '/shop/favourites', label: 'Favourites', short: 'Saved', Icon: Heart, badge: fav?.count },
    { to: '/shop/enquiry', label: 'Enquiry', short: 'Enquiry', Icon: ClipboardList, badge: cart?.count },
    // Only linked customers have order history to show.
    ...(customerId ? [{ to: '/shop/orders', label: 'My Orders', short: 'Orders', Icon: Receipt }] : []),
  ]
  // Mobile bottom bar: the 3 shop tabs + Enquiry (the cart) get first-class
  // slots; everything else lives behind "More". Kept to 5 slots so the
  // labels stay legible on a 360px screen.
  const primaryPaths = new Set(['/shop', '/shop/figurine', '/shop/corporate', '/shop/enquiry'])
  const primaryNav = nav.filter(n => primaryPaths.has(n.to))
  const moreNav = nav.filter(n => !primaryPaths.has(n.to))
  const moreHasBadge = moreNav.some(n => n.badge > 0)
  const moreActive = moreNav.some(n => location.pathname === n.to || location.pathname.startsWith(n.to + '/'))
  return (
    <div className="min-h-screen flex flex-col bg-ivory">
      <header className="bg-ink text-white shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/shop" className="flex items-center gap-3 min-w-0">
            <img src={logo} alt="Crystocraft" className="h-7 w-auto brightness-0 invert shrink-0" />
            <span className="text-xs text-ivory/50 uppercase tracking-widest hidden sm:inline">Wholesale Catalogue</span>
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-ivory/60 hidden sm:inline truncate">
              {profile?.company_name || profile?.email} · {profile?.base_currency}
            </span>
            <button onClick={handleSignOut} className="text-ivory/50 hover:text-red-400 transition-colors">Sign out</button>
          </div>
        </div>
        {/* Desktop / tablet: the full horizontal strip. Hidden on mobile,
            which gets the bottom tab bar instead. */}
        <div className="relative max-w-6xl mx-auto hidden md:block">
          <nav ref={navRef} className="no-scrollbar px-4 flex gap-1 overflow-x-auto">
            {nav.map(({ to, label, Icon, badge, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-3 min-h-[44px] text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive ? 'border-brand-500 text-white' : 'border-transparent text-ivory/50 hover:text-ivory'}`}>
                <Icon size={16} strokeWidth={1.75} /> {label}
                {badge > 0 && (
                  <span className="ml-0.5 text-[10px] bg-brand-500 text-white rounded-full px-1.5 py-0.5 leading-none">{badge}</span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>
      <footer className="text-center text-xs text-ink-40 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
        Ex-factory prices shown in {profile?.base_currency} — freight not included. Corporate gift prices are indicative — made to order.
      </footer>

      {/* ── Mobile bottom tab bar — same pattern as the Operation Center's
          Layout.jsx: primary tabs + a "More" sheet, safe-area aware. ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-ink border-t border-white/10 flex pb-[env(safe-area-inset-bottom)]">
        {primaryNav.map(({ to, short, Icon, badge, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) =>
              `flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${
                isActive ? 'text-white' : 'text-ivory/40'}`}>
            <span className="relative">
              <Icon size={20} strokeWidth={1.75} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2 text-[9px] bg-brand-500 text-white rounded-full px-1 min-w-[0.9rem] text-center leading-[0.9rem]">{badge}</span>
              )}
            </span>
            <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">{short}</span>
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(o => !o)}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${
            moreActive || moreOpen ? 'text-white' : 'text-ivory/40'}`}>
          <span className="relative">
            <MoreHorizontal size={20} strokeWidth={1.75} />
            {moreHasBadge && <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-brand-500" />}
          </span>
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setMoreOpen(false)} />
          <div className="md:hidden fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 bg-white border-t border-ivory-dark shadow-2xl rounded-t-xl overflow-hidden">
            <div className="flex flex-col items-center pt-2 pb-1">
              <span className="w-9 h-1 rounded-full bg-ivory-dark mb-2" />
              <p className="text-xs font-label uppercase tracking-[0.14em] text-ink-50">More</p>
            </div>
            <div className="grid grid-cols-3 gap-1 p-3 pt-2">
              {moreNav.map(({ to, label, Icon, badge, end }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) =>
                    `relative flex flex-col items-center justify-center gap-1.5 py-3 px-1 min-h-[44px] rounded-none text-center transition-colors ${
                      isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-70 active:bg-ivory'}`}>
                  <Icon size={22} strokeWidth={1.6} className="shrink-0" />
                  <span className="text-[11px] font-medium leading-tight line-clamp-2">{label}</span>
                  {badge > 0 && (
                    <span className="absolute top-1.5 right-2 text-[9px] bg-brand-500 text-white rounded-full px-1 min-w-[1rem] text-center leading-4">{badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
