import { useState, useEffect, useRef } from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { Home, Gem, Package, Heart, ClipboardList, Images, Receipt, Sparkles } from 'lucide-react'
import { useCart, useFavourites } from './store'
import { hasBrandPortalContent } from '../customerProposal'
import logo from '../assets/logo.png'

export default function CustomerLayout({ children, profile }) {
  const navigate = useNavigate()
  const location = useLocation()
  const cart = useCart()
  const fav = useFavourites()
  // The nav is a horizontal scroll strip on mobile — keep the current
  // section's tab visible instead of letting it sit scrolled off-screen.
  const navRef = useRef(null)
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [location.pathname])
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
    { to: '/shop', label: 'Home', Icon: Home, end: true },
    { to: '/shop/figurine', label: 'Figurine Gifts', Icon: Gem },
    { to: '/shop/corporate', label: 'Corporate Gifts', Icon: Package },
    // Grouped right after Corporate Gifts (owner request) — related content,
    // and only shown once we know the customer actually has something in it.
    ...(customerId && hasBrandContent ? [{ to: '/shop/brand-portal', label: 'Brand Portal', Icon: Images }] : []),
    { to: '/shop/swatches', label: 'Swatch Library', Icon: Sparkles },
    { to: '/shop/favourites', label: 'Favourites', Icon: Heart, badge: fav?.count },
    { to: '/shop/enquiry', label: 'Enquiry', Icon: ClipboardList, badge: cart?.count },
    // Only linked customers have order history to show.
    ...(customerId ? [{ to: '/shop/orders', label: 'My Orders', Icon: Receipt }] : []),
  ]
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
        {/* relative + right-edge fade so a scrolled-off tab row reads as
            "more this way" rather than clipped. */}
        <div className="relative max-w-6xl mx-auto">
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
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ink to-transparent sm:hidden" />
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-ink-40 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        Ex-factory prices shown in {profile?.base_currency} — freight not included. Corporate gift prices are indicative — made to order.
      </footer>
    </div>
  )
}
