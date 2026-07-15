import { Routes, Route, Navigate } from 'react-router-dom'
import CustomerLayout from './CustomerLayout'
import FigurineShop from './FigurineShop'
import CorporateShop from './CorporateShop'
import FigurineDetail from './FigurineDetail'
import CorporateDetail from './CorporateDetail'
import FavouritesPage from './FavouritesPage'
import EnquiryPage from './EnquiryPage'
import CustomizerPage from './CustomizerPage'
import { CartProvider, FavouritesProvider } from './store'
import ErrorBoundary from '../components/ErrorBoundary'

export default function Storefront({ profile }) {
  return (
    <FavouritesProvider uid={profile?.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <ErrorBoundary home="/shop/figurine">
          <Routes>
            <Route path="/shop/figurine" element={<FigurineShop profile={profile} />} />
            <Route path="/shop/figurine/:id" element={<FigurineDetail profile={profile} />} />
            <Route path="/shop/corporate" element={<CorporateShop profile={profile} />} />
            <Route path="/shop/corporate/:id" element={<CorporateDetail profile={profile} />} />
            <Route path="/shop/favourites" element={<FavouritesPage profile={profile} />} />
            <Route path="/shop/enquiry" element={<EnquiryPage profile={profile} />} />
            <Route path="/customize/:productId" element={<CustomizerPage profile={profile} />} />
            <Route path="*" element={<Navigate to="/shop/figurine" replace />} />
          </Routes>
          </ErrorBoundary>
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  )
}
