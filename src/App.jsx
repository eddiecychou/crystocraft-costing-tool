import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthState } from './hooks/useAuthState'
import { useProfile, isAdmin, isProduction, isSales, isApproved, isPending } from './hooks/useProfile'
import { AccessContext, useCan } from './access'
import Layout from './components/Layout'
import LoadingBar from './components/LoadingBar'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
const InvitationClaim = lazy(() => import('./pages/InvitationClaim'))
const SetPassword = lazy(() => import('./pages/SetPassword'))
const Storefront = lazy(() => import('./customer/Storefront'))
const PendingScreen = lazy(() => import('./customer/PendingScreen'))
const Products = lazy(() => import('./pages/Products'))
const Range = lazy(() => import('./pages/Range'))
const RangeForm = lazy(() => import('./pages/RangeForm'))
const RangeCosting = lazy(() => import('./pages/RangeCosting'))
const RangeQuoteForm = lazy(() => import('./pages/RangeQuoteForm'))
const ProductForm = lazy(() => import('./pages/ProductForm'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const ComponentForm = lazy(() => import('./pages/ComponentForm'))
const ComponentDetail = lazy(() => import('./pages/ComponentDetail'))
const SupplierQuoteForm = lazy(() => import('./pages/SupplierQuoteForm'))
const PricingTiers = lazy(() => import('./pages/PricingTiers'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const SupplierForm = lazy(() => import('./pages/SupplierForm'))
const SupplierDetail = lazy(() => import('./pages/SupplierDetail'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'))
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail'))
const PurchaseOrderPrint = lazy(() => import('./pages/PurchaseOrderPrint'))
const Quotes = lazy(() => import('./pages/Quotes'))
const QuoteForm = lazy(() => import('./pages/QuoteForm'))
const QuoteDetail = lazy(() => import('./pages/QuoteDetail'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerForm = lazy(() => import('./pages/CustomerForm'))
const TagManager = lazy(() => import('./pages/TagManager'))
const WhatsAppImport = lazy(() => import('./pages/WhatsAppImport'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const MarketingContactDetail = lazy(() => import('./pages/MarketingContactDetail'))
const Settings = lazy(() => import('./pages/Settings'))
const SchemaAudit = lazy(() => import('./pages/SchemaAudit'))
const BankDetailsAudit = lazy(() => import('./pages/BankDetailsAudit'))
const BankAccounts = lazy(() => import('./pages/BankAccounts'))
const ComponentsLib = lazy(() => import('./pages/Components'))
const InventoryStatus = lazy(() => import('./pages/InventoryStatus'))
const ErpLookup = lazy(() => import('./pages/ErpLookup'))
const UcRegistry = lazy(() => import('./pages/UcRegistry'))
const SwatchLibrary = lazy(() => import('./pages/SwatchLibrary'))
const RangeComponentForm = lazy(() => import('./pages/RangeComponentForm'))
const Catalogues = lazy(() => import('./pages/Catalogues'))
const CatalogueForm = lazy(() => import('./pages/CatalogueForm'))
const CatalogueDetail = lazy(() => import('./pages/CatalogueDetail'))
const CataloguePreview = lazy(() => import('./pages/CataloguePreview'))
const BlogGenerator = lazy(() => import('./pages/BlogGenerator'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ImportData = lazy(() => import('./pages/ImportData'))
const CatalogueBand = lazy(() => import('./pages/CatalogueBand'))
const ImportImages = lazy(() => import('./pages/ImportImages'))
const CustomerAccounts = lazy(() => import('./pages/CustomerAccounts'))
const AccountEdit = lazy(() => import('./pages/AccountEdit'))
const Enquiries = lazy(() => import('./pages/Enquiries'))
const CreditNotes = lazy(() => import('./pages/CreditNotes'))
const CreditNoteForm = lazy(() => import('./pages/CreditNoteForm'))
const CreditNotePrint = lazy(() => import('./pages/CreditNotePrint'))
const Logistics = lazy(() => import('./pages/Logistics'))
const LogisticsVendorForm = lazy(() => import('./pages/LogisticsVendorForm'))
const Shipments = lazy(() => import('./pages/Shipments'))
const ShipmentForm = lazy(() => import('./pages/ShipmentForm'))
const Shipping = lazy(() => import('./pages/Shipping'))
const Portal = lazy(() => import('./pages/Portal'))
const Marketing = lazy(() => import('./pages/Marketing'))
const PackingListPrint = lazy(() => import('./pages/PackingListPrint'))
const ProformaInvoicePrint = lazy(() => import('./pages/ProformaInvoicePrint'))
const SalesInvoicePrint = lazy(() => import('./pages/SalesInvoicePrint'))
const SalesInvoices = lazy(() => import('./pages/SalesInvoices'))
const WooCommerceSync = lazy(() => import('./pages/WooCommerceSync'))
const ProductionDashboard = lazy(() => import('./pages/ProductionDashboard'))

export default function App() {
  const user = useAuthState()
  return (
    <BrowserRouter>
      <AppRoutes user={user} />
    </BrowserRouter>
  )
}

function AppRoutes({ user }) {
  const { profile } = useProfile(user)
  const location = useLocation()

  // Mobile SPA zoom-stuck fix (reported live, recurring — 2026-08-21) — a
  // mobile browser (Chrome and Safari both do this) auto-zooms the WHOLE
  // page out once, the first time any page briefly renders wider than the
  // viewport. React Router's client-side navigation (pushState) never
  // triggers the browser's own "fit to viewport" recompute the way a full
  // page load does, so that zoom level then sticks across every later
  // route — including ones that never overflowed themselves. Toggling the
  // viewport meta's max-scale forces a recompute back to 1x on every route
  // change, then restores it immediately after so pinch-zoom still works
  // normally in between navigations.
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]')
    if (!viewport) return
    const original = viewport.getAttribute('content') || ''
    viewport.setAttribute('content', `${original}, maximum-scale=1.0`)
    const id = requestAnimationFrame(() => viewport.setAttribute('content', original))
    return () => cancelAnimationFrame(id)
  }, [location.pathname])

  // REMOVED (2026-08-19, owner's explicit instruction after this fired a
  // SECOND time against the real admin account eddie@uart.com.hk, silently
  // flipping it to role:'customer', status:'pending'): this used to
  // "self-heal" a signed-in Auth user with no users/{uid} doc by writing a
  // fresh pending-customer doc for them, guarded by a re-confirm-against-
  // the-server delay added after the FIRST incident (2026-08-12) — that
  // guard was not sufficient; whatever transient condition made
  // useProfile's live onSnapshot briefly report "missing" for a real,
  // long-lived admin account also survived a fresh server re-read closely
  // enough to trigger a second incident. No automatic write is safe enough
  // here — a genuinely orphaned Auth account (created directly in the
  // Firebase console, or a signup that failed after the auth step but
  // before the Firestore write) is now just left on PendingScreen with no
  // doc, and needs a human to notice and create one by hand — see
  // PROJECT-PLAN.md for the incident record.

  if (user === undefined) return <LoadingBar />
  if (user && profile === undefined) return <LoadingBar />

  const role = !user ? null
    : isAdmin(profile) ? 'admin'
    : isProduction(profile) ? 'production'
    : isSales(profile) ? 'sales'
    : isApproved(profile) ? 'customer'
    : 'pending'

  return (
    // Every page is a lazy() chunk now (code-split, 2026-09-02) — one Suspense
    // boundary here covers the whole route tree; LoadingBar is the same
    // fallback used while auth/profile resolve, so a chunk fetch looks
    // identical to a normal load.
    <Suspense fallback={<LoadingBar />}>
    <Routes>
      {/* SU-07A — public, unauthenticated pages, reachable regardless of
          sign-in state. Deliberately OUTSIDE the role-gated "/*" catch-all
          below, same reasoning as /login itself. */}
      <Route path="/invite/:id" element={<InvitationClaim />} />
      <Route path="/portal/set-password" element={<SetPassword />} />
      <Route path="/login" element={
        !user ? <Login />
        : role === 'admin' || role === 'production' || role === 'sales' ? <Navigate to="/dashboard" replace />
        : role === 'customer' ? <Navigate to="/shop" replace />
        : <PendingScreen profile={profile} />
      } />
      <Route path="/*" element={
        !user ? <Navigate to="/login" replace />
        : role === 'pending' ? <PendingScreen profile={profile} />
        : role === 'customer' ? <Storefront profile={profile} />
        : <AdminApp user={user} role={role} />
      } />
    </Routes>
    </Suspense>
  )
}

// Route-level access guard (V8.12 RBAC). Renders its children only if the
// signed-in role may access `module`; otherwise redirects to /dashboard —
// which resolves to a page every staff role can see (ProductionDashboard for
// production, the full Dashboard for admin). This is what stops a production
// login reaching, say, /customers by typing the URL, even though the menu
// item is hidden. It is a UI convenience, NOT a security boundary — the
// Firestore rules (Phase 2) are what actually protect the data.
function Gate({ module, children }) {
  const can = useCan()
  return can(module) ? children : <Navigate to="/dashboard" replace />
}

function AdminApp({ user, role }) {
  return (
    <AccessContext.Provider value={role}>
    <Routes>
      {/* Print routes — no Layout wrapper */}
      <Route path="/packing/:plId/print" element={<Gate module="shipping"><PackingListPrint /></Gate>} />
      <Route path="/purchase-orders/:id/print" element={<Gate module="purchase_orders"><PurchaseOrderPrint /></Gate>} />
      <Route path="/shipments/:id/pi" element={<Gate module="shipping"><ProformaInvoicePrint /></Gate>} />
      <Route path="/shipments/:id/invoice" element={<Gate module="invoices"><SalesInvoicePrint /></Gate>} />
      <Route path="/credit-notes/:id/print" element={<Gate module="credit_notes"><CreditNotePrint /></Gate>} />
      {/* All other admin routes wrapped in Layout */}
      <Route path="/*" element={
            <Layout user={user}>
              <ErrorBoundary home="/dashboard">
              {/* Inner Suspense so a lazy page chunk loads WITHOUT tearing
                  down the sidebar/header — only the content area shows the
                  bar. The outer App-level Suspense still covers Storefront
                  and the public pages. */}
              <Suspense fallback={<LoadingBar />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                {/* Dashboard resolves per role — production gets a supply-side
                    dashboard that reads no sales data (see ProductionDashboard). */}
                <Route path="/dashboard" element={role === 'production' ? <ProductionDashboard /> : <Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/range" element={<Gate module="figurine"><Range /></Gate>} />
                <Route path="/range/import-images" element={<Gate module="figurine"><ImportImages /></Gate>} />
                {/* Figurine costing is cost-derived (crystal unit costs + BOM)
                    — supply-side. Sales browses/quotes figurines but not their
                    costing; admin + production only. */}
                <Route path="/range/:id/costing" element={role === 'sales' ? <Navigate to="/range" replace /> : <Gate module="figurine"><RangeCosting /></Gate>} />
                <Route path="/range/:id" element={<Gate module="figurine"><RangeForm /></Gate>} />
                <Route path="/components" element={<ComponentsLib />} />
                <Route path="/inventory" element={<InventoryStatus />} />
                <Route path="/erp-lookup" element={<Gate module="erp"><ErpLookup /></Gate>} />
                <Route path="/uc-registry" element={<Gate module="uc"><UcRegistry /></Gate>} />
                <Route path="/swatch-library" element={<Gate module="swatch"><SwatchLibrary /></Gate>} />
                <Route path="/components/critical/new" element={<RangeComponentForm />} />
                <Route path="/components/critical/:id/quotes/new" element={<RangeQuoteForm />} />
                <Route path="/components/critical/:id/quotes/:quoteId" element={<RangeQuoteForm />} />
                <Route path="/components/critical/:id" element={<RangeComponentForm />} />
                <Route path="/products/new" element={<ProductForm />} />
                <Route path="/products/:id" element={<ProductDetail />} />
                <Route path="/products/:id/edit" element={<ProductForm />} />
                <Route path="/products/:id/pricing" element={<Gate module="pricing"><PricingTiers /></Gate>} />
                <Route path="/products/:productId/components/new" element={<ComponentForm />} />
                <Route path="/products/:productId/components/:componentId" element={<ComponentDetail />} />
                <Route path="/products/:productId/components/:componentId/edit" element={<ComponentForm />} />
                <Route path="/products/:productId/components/:componentId/quotes/new" element={<SupplierQuoteForm />} />
                <Route path="/products/:productId/components/:componentId/quotes/:quoteId" element={<SupplierQuoteForm />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/suppliers/new" element={<SupplierForm />} />
                <Route path="/suppliers/:id" element={<SupplierDetail />} />
                <Route path="/suppliers/:id/edit" element={<SupplierForm />} />
                <Route path="/purchase-orders" element={<Gate module="purchase_orders"><PurchaseOrders /></Gate>} />
                <Route path="/purchase-orders/new" element={<Gate module="purchase_orders"><PurchaseOrderForm /></Gate>} />
                <Route path="/purchase-orders/:id" element={<Gate module="purchase_orders"><PurchaseOrderDetail /></Gate>} />
                <Route path="/purchase-orders/:id/edit" element={<Gate module="purchase_orders"><PurchaseOrderForm /></Gate>} />
                <Route path="/quotes" element={<Gate module="quotes"><Quotes /></Gate>} />
                <Route path="/quotes/new" element={<Gate module="quotes"><QuoteForm /></Gate>} />
                <Route path="/quotes/:id" element={<Gate module="quotes"><QuoteDetail /></Gate>} />
                <Route path="/customers" element={<Gate module="customers"><Customers /></Gate>} />
                <Route path="/customers/new" element={<Gate module="customers"><CustomerForm /></Gate>} />
                <Route path="/customers/tags" element={<Gate module="customers"><TagManager /></Gate>} />
                <Route path="/customers/whatsapp-import" element={<Gate module="customers"><WhatsAppImport /></Gate>} />
                <Route path="/customers/:id" element={<Gate module="customers"><CustomerDetail /></Gate>} />
                <Route path="/customers/:id/edit" element={<Gate module="customers"><CustomerForm /></Gate>} />
                <Route path="/catalogue-band" element={<Gate module="settings"><CatalogueBand /></Gate>} />
                <Route path="/marketing" element={<Gate module="marketing"><Marketing /></Gate>} />
                <Route path="/marketing-contacts/:id" element={<Gate module="marketing"><MarketingContactDetail /></Gate>} />
                <Route path="/catalogues" element={<Gate module="catalogues"><Catalogues /></Gate>} />
                <Route path="/catalogues/new" element={<Gate module="catalogues"><CatalogueForm /></Gate>} />
                <Route path="/catalogues/:id" element={<Gate module="catalogues"><CatalogueDetail /></Gate>} />
                <Route path="/catalogues/:id/edit" element={<Gate module="catalogues"><CatalogueForm /></Gate>} />
                <Route path="/catalogues/:id/preview" element={<Gate module="catalogues"><CataloguePreview /></Gate>} />
                <Route path="/blog-generator" element={<Gate module="marketing"><BlogGenerator /></Gate>} />
                <Route path="/blog-generator/:productId" element={<Gate module="marketing"><BlogGenerator /></Gate>} />
                <Route path="/settings" element={<Gate module="settings"><Settings /></Gate>} />
                <Route path="/schema-audit" element={<Gate module="settings"><SchemaAudit /></Gate>} />
                {/* One-off: find bank details pasted into free-text fields.
                    Remove once bank_accounts is the single source. */}
                <Route path="/bank-audit" element={<Gate module="settings"><BankDetailsAudit /></Gate>} />
                <Route path="/bank-accounts" element={<Gate module="settings"><BankAccounts /></Gate>} />
                <Route path="/shipping" element={<Gate module="shipping"><Shipping /></Gate>} />
                <Route path="/sales-invoices" element={<Gate module="invoices"><SalesInvoices /></Gate>} />
                <Route path="/credit-notes" element={<Gate module="credit_notes"><CreditNotes /></Gate>} />
                <Route path="/woo-sync" element={<Gate module="woo"><WooCommerceSync /></Gate>} />
                <Route path="/credit-notes/new" element={<Gate module="credit_notes"><CreditNoteForm /></Gate>} />
                <Route path="/credit-notes/:id" element={<Gate module="credit_notes"><CreditNoteForm /></Gate>} />
                {/* Legacy redirect — Phase B's Sales Return register was folded
                    into Credit Notes for Phase C (Cindy, 2026-08-17: no return
                    ever existed without a credit note or vice versa). */}
                <Route path="/sales-returns" element={<Navigate to="/credit-notes" replace />} />
                <Route path="/shipments/new" element={<Gate module="shipping"><ShipmentForm /></Gate>} />
                <Route path="/shipments/:id" element={<Gate module="shipping"><ShipmentForm /></Gate>} />
                <Route path="/logistics/new" element={<Gate module="shipping"><LogisticsVendorForm /></Gate>} />
                <Route path="/logistics/:id" element={<Gate module="shipping"><LogisticsVendorForm /></Gate>} />
                <Route path="/portal" element={<Gate module="portal"><Portal /></Gate>} />
                {/* Account detail edits users/{uid} (role/status/pricing) — an
                    admin-only tool. Sales has the Portal module for the
                    read-only Login-activity view, but must not reach AccountEdit
                    (its writes are all rules-denied). Gate to admin. */}
                <Route path="/portal/accounts/:id" element={role === 'admin' ? <AccountEdit /> : <Navigate to="/dashboard" replace />} />
                {/* Legacy redirects */}
                <Route path="/shipments" element={<Navigate to="/shipping" replace />} />
                <Route path="/logistics" element={<Navigate to="/shipping" replace />} />
                <Route path="/customer-accounts" element={<Navigate to="/portal" replace />} />
                <Route path="/enquiries" element={<Navigate to="/portal" replace />} />
                <Route path="/catalogue-band" element={<Navigate to="/settings" replace />} />
                <Route path="/import-data" element={<Gate module="settings"><ImportData /></Gate>} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </Layout>
      } />
    </Routes>
    </AccessContext.Provider>
  )
}
