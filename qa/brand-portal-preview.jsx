import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import BrandPortalPage from '../src/customer/BrandPortalPage'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { id: 'u1', customer_id: 'c1', company_name: 'Sun Life', base_currency: 'USD' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop/brand-portal']}>
    <FavouritesProvider uid={profile.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <Routes>
            <Route path="/shop/brand-portal" element={<BrandPortalPage profile={profile} />} />
          </Routes>
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
