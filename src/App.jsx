import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthState } from './hooks/useAuthState'
import { useProfile, isAdmin, isApproved, isPending } from './hooks/useProfile'
import Layout from './components/Layout'
import LoadingBar from './components/LoadingBar'
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
import Quotes from './pages/Quotes'
import QuoteForm from './pages/QuoteForm'
import QuoteDetail from './pages/QuoteDetail'
import Customers from './pages/Customers'
import CustomerForm from './pages/CustomerForm'
import CustomerDetail from './pages/CustomerDetail'
import Settings from './pages/Settings'
import ComponentsLib from './pages/Components'
import RangeComponentForm from './pages/RangeComponentForm'
import Catalogues from './pages/Catalogues'
import CatalogueForm from './pages/CatalogueForm'
import CatalogueDetail from './pages/CatalogueDetail'
import CataloguePreview from './pages/CataloguePreview'
import BlogGenerator from './pages/BlogGenerator'
import Dashboard from './pages/Dashboard'
import ImportData from './pages/ImportData'
import ImportImages from './pages/ImportImages'
import CustomerAccounts from './pages/CustomerAccounts'
import Enquiries from './pages/Enquiries'

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
        : role === 'customer' ? <Navigate to="/shop/figurine" replace />
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
            <Layout user={user}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/range" element={<Range />} />
                <Route path="/range/import-images" element={<ImportImages />} />
                <Route path="/range/:id/costing" element={<RangeCosting />} />
                <Route path="/range/:id" element={<RangeForm />} />
                <Route path="/components" element={<ComponentsLib />} />
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
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/new" element={<QuoteForm />} />
                <Route path="/quotes/:id" element={<QuoteDetail />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/customers/new" element={<CustomerForm />} />
                <Route path="/customers/:id" element={<CustomerDetail />} />
                <Route path="/customers/:id/edit" element={<CustomerForm />} />
                <Route path="/catalogues" element={<Catalogues />} />
                <Route path="/catalogues/new" element={<CatalogueForm />} />
                <Route path="/catalogues/:id" element={<CatalogueDetail />} />
                <Route path="/catalogues/:id/edit" element={<CatalogueForm />} />
                <Route path="/catalogues/:id/preview" element={<CataloguePreview />} />
                <Route path="/blog-generator" element={<BlogGenerator />} />
                <Route path="/blog-generator/:productId" element={<BlogGenerator />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/customer-accounts" element={<CustomerAccounts />} />
                <Route path="/enquiries" element={<Enquiries />} />
                <Route path="/import-data" element={<ImportData />} />
              </Routes>
            </Layout>
  )
}
