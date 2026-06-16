import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthState } from './hooks/useAuthState'
import Layout from './components/Layout'
import LoadingBar from './components/LoadingBar'
import Login from './pages/Login'
import Products from './pages/Products'
import Range from './pages/Range'
import RangeForm from './pages/RangeForm'
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
import Catalogues from './pages/Catalogues'
import CatalogueForm from './pages/CatalogueForm'
import CatalogueDetail from './pages/CatalogueDetail'
import CataloguePreview from './pages/CataloguePreview'
import BlogGenerator from './pages/BlogGenerator'
import Dashboard from './pages/Dashboard'
import ImportData from './pages/ImportData'

function ProtectedRoute({ children, user }) {
  if (user === undefined) return <LoadingBar />
  if (user === null) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const user = useAuthState()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

        <Route path="/*" element={
          <ProtectedRoute user={user}>
            <Layout user={user}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/range" element={<Range />} />
                <Route path="/range/:id" element={<RangeForm />} />
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
                <Route path="/import-data" element={<ImportData />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
