import { Routes, Route, Navigate } from 'react-router-dom'
import CustomerLayout from './CustomerLayout'
import HomePage from './HomePage'
import FigurineShop from './FigurineShop'
import CorporateShop from './CorporateShop'
import FigurineDetail from './FigurineDetail'
import CorporateDetail from './CorporateDetail'
import FavouritesPage from './FavouritesPage'
import EnquiryPage from './EnquiryPage'
import CustomizerPage from './CustomizerPage'
import BrandGalleryPage from './BrandGalleryPage'
import ProposalPage from './ProposalPage'
import OrderHistoryPage from './OrderHistoryPage'
import SwatchLibraryPage from './SwatchLibraryPage'
import CustomerInvoicePrint from './CustomerInvoicePrint'
import { CartProvider, FavouritesProvider } from './store'
import ErrorBoundary from '../components/ErrorBoundary'

export default function Storefront({ profile }) {
  return (
    <FavouritesProvider uid={profile?.id}>
      <CartProvider>
        <Routes>
          {/* Print route — no CustomerLayout wrapper, same reason the admin
              print routes (SalesInvoicePrint etc.) sit outside Layout: the
              nav chrome must not print or bleed into the "Save as PDF". */}
          <Route path="/shop/invoice/:key" element={<CustomerInvoicePrint profile={profile} />} />
          <Route path="/*" element={
            <CustomerLayout profile={profile}>
              <ErrorBoundary home="/shop">
              <Routes>
                <Route path="/shop" element={<HomePage profile={profile} />} />
                <Route path="/shop/figurine" element={<FigurineShop profile={profile} />} />
                <Route path="/shop/figurine/:id" element={<FigurineDetail profile={profile} />} />
                <Route path="/shop/corporate" element={<CorporateShop profile={profile} />} />
                <Route path="/shop/corporate/:id" element={<CorporateDetail profile={profile} />} />
                <Route path="/shop/favourites" element={<FavouritesPage profile={profile} />} />
                <Route path="/shop/enquiry" element={<EnquiryPage profile={profile} />} />
                <Route path="/shop/brand-gallery" element={<BrandGalleryPage profile={profile} />} />
                <Route path="/shop/proposal" element={<ProposalPage profile={profile} />} />
                <Route path="/shop/orders" element={<OrderHistoryPage profile={profile} />} />
                <Route path="/shop/swatches" element={<SwatchLibraryPage profile={profile} />} />
                <Route path="/customize/:productId" element={<CustomizerPage profile={profile} />} />
                <Route path="*" element={<Navigate to="/shop" replace />} />
              </Routes>
              </ErrorBoundary>
            </CustomerLayout>
          } />
        </Routes>
      </CartProvider>
    </FavouritesProvider>
  )
}
