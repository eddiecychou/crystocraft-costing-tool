import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { doc, setDoc, getDocFromServer, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { useAuthState } from './hooks/useAuthState'
import { useProfile, isAdmin, isApproved, isPending } from './hooks/useProfile'
import Layout from './components/Layout'
import LoadingBar from './components/LoadingBar'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Storefront from './customer/Storefront'
import PendingScreen from './customer/PendingScreen'
import Products from './pages/Products'
import Range from './pages/Range'
import RangeForm from './pages/RangeForm'
import RangeCosting from './pages/RangeCosting'
import RangeQuoteForm from './pages/RangeQuoteForm'
import ProductForm from './pages/ProductForm'
import ProductDetail from './pages/ProductDetail'
import ComponentForm from './pages/ComponentForm'
import ComponentDetail from './pages/ComponentDetail'
import SupplierQuoteForm from './pages/SupplierQuoteForm'
import PricingTiers from './pages/PricingTiers'
import Suppliers from './pages/Suppliers'
import SupplierForm from './pages/SupplierForm'
import SupplierDetail from './pages/SupplierDetail'
import PurchaseOrders from './pages/PurchaseOrders'
import PurchaseOrderForm from './pages/PurchaseOrderForm'
import PurchaseOrderDetail from './pages/PurchaseOrderDetail'
import PurchaseOrderPrint from './pages/PurchaseOrderPrint'
import Quotes from './pages/Quotes'
import QuoteForm from './pages/QuoteForm'
import QuoteDetail from './pages/QuoteDetail'
import Customers from './pages/Customers'
import CustomerForm from './pages/CustomerForm'
import TagManager from './pages/TagManager'
import CustomerDetail from './pages/CustomerDetail'
import Settings from './pages/Settings'
import SchemaAudit from './pages/SchemaAudit'
import BankDetailsAudit from './pages/BankDetailsAudit'
import BankAccounts from './pages/BankAccounts'
import ComponentsLib from './pages/Components'
import InventoryStatus from './pages/InventoryStatus'
import ErpLookup from './pages/ErpLookup'
import UcRegistry from './pages/UcRegistry'
import SwatchLibrary from './pages/SwatchLibrary'
import RangeComponentForm from './pages/RangeComponentForm'
import Catalogues from './pages/Catalogues'
import CatalogueForm from './pages/CatalogueForm'
import CatalogueDetail from './pages/CatalogueDetail'
import CataloguePreview from './pages/CataloguePreview'
import BlogGenerator from './pages/BlogGenerator'
import Dashboard from './pages/Dashboard'
import ImportData from './pages/ImportData'
import CatalogueBand from './pages/CatalogueBand'
import ImportImages from './pages/ImportImages'
import CustomerAccounts from './pages/CustomerAccounts'
import AccountEdit from './pages/AccountEdit'
import Enquiries from './pages/Enquiries'
import Logistics from './pages/Logistics'
import LogisticsVendorForm from './pages/LogisticsVendorForm'
import Shipments from './pages/Shipments'
import ShipmentForm from './pages/ShipmentForm'
import Shipping from './pages/Shipping'
import Portal from './pages/Portal'
import Marketing from './pages/Marketing'
import PackingListPrint from './pages/PackingListPrint'
import ProformaInvoicePrint from './pages/ProformaInvoicePrint'
import SalesInvoicePrint from './pages/SalesInvoicePrint'
import SalesInvoices from './pages/SalesInvoices'

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

  // Self-heal: a signed-in Auth user with no users doc (e.g. created directly
  // in the Firebase console, or a signup that failed after the auth step) would
  // otherwise be stuck on the pending screen AND invisible to admins, since no
  // doc exists to show in the Pending tab. Create a pending-customer doc for
  // them — the Firestore rules allow a user to self-create their own pending
  // doc — so an admin can see and approve them.
  //
  // INCIDENT (2026-08-12): this fired against a real admin account and
  // silently overwrote it to role:'customer', status:'pending' — useProfile's
  // live onSnapshot briefly reported the doc as missing (most likely a
  // permission/auth-token-attachment race right after sign-in, on a freshly
  // authenticated session with no local cache), which was enough to trigger
  // this effect and clobber a doc that genuinely existed the whole time.
  // Fixed by never trusting the live subscription's "missing" signal for
  // something this destructive — re-confirm directly against the server,
  // after a short delay to let any auth-token race settle, and only write if
  // that fresh, authoritative read ALSO says the doc doesn't exist.
  useEffect(() => {
    if (!(user && profile?.missing && !profile.error)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const fresh = await getDocFromServer(doc(db, 'users', user.uid)).catch(() => null)
      if (cancelled || !fresh || fresh.exists()) return // real doc exists after all (or the check itself failed) — never touch it
      await setDoc(doc(db, 'users', user.uid), {
        role: 'customer',
        status: 'pending',
        email: user.email || '',
        company_name: '',
        contact_name: user.displayName || '',
        base_currency: 'USD',
        ws_discount_pct: 0,
        createdAt: serverTimestamp(),
        self_healed: true,
      }, { merge: true }).catch(() => {})
    }, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [user, profile])

  if (user === undefined) return <LoadingBar />
  if (user && profile === undefined) return <LoadingBar />

  const role = !user ? null
    : isAdmin(profile) ? 'admin'
    : isApproved(profile) ? 'customer'
    : 'pending'

  return (
    <Routes>
      <Route path="/login" element={
        !user ? <Login />
        : role === 'admin' ? <Navigate to="/dashboard" replace />
        : role === 'customer' ? <Navigate to="/shop" replace />
        : <PendingScreen profile={profile} />
      } />
      <Route path="/*" element={
        !user ? <Navigate to="/login" replace />
        : role === 'pending' ? <PendingScreen profile={profile} />
        : role === 'customer' ? <Storefront profile={profile} />
        : <AdminApp user={user} />
      } />
    </Routes>
  )
}

function AdminApp({ user }) {
  return (
    <Routes>
      {/* Print routes — no Layout wrapper */}
      <Route path="/packing/:plId/print" element={<PackingListPrint />} />
      <Route path="/purchase-orders/:id/print" element={<PurchaseOrderPrint />} />
      <Route path="/shipments/:id/pi" element={<ProformaInvoicePrint />} />
      <Route path="/shipments/:id/invoice" element={<SalesInvoicePrint />} />
      {/* All other admin routes wrapped in Layout */}
      <Route path="/*" element={
            <Layout user={user}>
              <ErrorBoundary home="/dashboard">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/range" element={<Range />} />
                <Route path="/range/import-images" element={<ImportImages />} />
                <Route path="/range/:id/costing" element={<RangeCosting />} />
                <Route path="/range/:id" element={<RangeForm />} />
                <Route path="/components" element={<ComponentsLib />} />
                <Route path="/inventory" element={<InventoryStatus />} />
                <Route path="/erp-lookup" element={<ErpLookup />} />
                <Route path="/uc-registry" element={<UcRegistry />} />
                <Route path="/swatch-library" element={<SwatchLibrary />} />
                <Route path="/components/critical/new" element={<RangeComponentForm />} />
                <Route path="/components/critical/:id/quotes/new" element={<RangeQuoteForm />} />
                <Route path="/components/critical/:id/quotes/:quoteId" element={<RangeQuoteForm />} />
                <Route path="/components/critical/:id" element={<RangeComponentForm />} />
                <Route path="/products/new" element={<ProductForm />} />
                <Route path="/products/:id" element={<ProductDetail />} />
                <Route path="/products/:id/edit" element={<ProductForm />} />
                <Route path="/products/:id/pricing" element={<PricingTiers />} />
                <Route path="/products/:productId/components/new" element={<ComponentForm />} />
                <Route path="/products/:productId/components/:componentId" element={<ComponentDetail />} />
                <Route path="/products/:productId/components/:componentId/edit" element={<ComponentForm />} />
                <Route path="/products/:productId/components/:componentId/quotes/new" element={<SupplierQuoteForm />} />
                <Route path="/products/:productId/components/:componentId/quotes/:quoteId" element={<SupplierQuoteForm />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/suppliers/new" element={<SupplierForm />} />
                <Route path="/suppliers/:id" element={<SupplierDetail />} />
                <Route path="/suppliers/:id/edit" element={<SupplierForm />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
                <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
                <Route path="/purchase-orders/:id/edit" element={<PurchaseOrderForm />} />
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/new" element={<QuoteForm />} />
                <Route path="/quotes/:id" element={<QuoteDetail />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/customers/new" element={<CustomerForm />} />
                <Route path="/customers/tags" element={<TagManager />} />
                <Route path="/customers/:id" element={<CustomerDetail />} />
                <Route path="/customers/:id/edit" element={<CustomerForm />} />
                <Route path="/catalogue-band" element={<CatalogueBand />} />
                <Route path="/marketing" element={<Marketing />} />
                <Route path="/catalogues" element={<Catalogues />} />
                <Route path="/catalogues/new" element={<CatalogueForm />} />
                <Route path="/catalogues/:id" element={<CatalogueDetail />} />
                <Route path="/catalogues/:id/edit" element={<CatalogueForm />} />
                <Route path="/catalogues/:id/preview" element={<CataloguePreview />} />
                <Route path="/blog-generator" element={<BlogGenerator />} />
                <Route path="/blog-generator/:productId" element={<BlogGenerator />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/schema-audit" element={<SchemaAudit />} />
                {/* One-off: find bank details pasted into free-text fields.
                    Remove once bank_accounts is the single source. */}
                <Route path="/bank-audit" element={<BankDetailsAudit />} />
                <Route path="/bank-accounts" element={<BankAccounts />} />
                <Route path="/shipping" element={<Shipping />} />
                <Route path="/sales-invoices" element={<SalesInvoices />} />
                <Route path="/shipments/new" element={<ShipmentForm />} />
                <Route path="/shipments/:id" element={<ShipmentForm />} />
                <Route path="/logistics/new" element={<LogisticsVendorForm />} />
                <Route path="/logistics/:id" element={<LogisticsVendorForm />} />
                <Route path="/portal" element={<Portal />} />
                <Route path="/portal/accounts/:id" element={<AccountEdit />} />
                {/* Legacy redirects */}
                <Route path="/shipments" element={<Navigate to="/shipping" replace />} />
                <Route path="/logistics" element={<Navigate to="/shipping" replace />} />
                <Route path="/customer-accounts" element={<Navigate to="/portal" replace />} />
                <Route path="/enquiries" element={<Navigate to="/portal" replace />} />
                <Route path="/catalogue-band" element={<Navigate to="/settings" replace />} />
                <Route path="/import-data" element={<ImportData />} />
              </Routes>
              </ErrorBoundary>
            </Layout>
      } />
    </Routes>
  )
}
