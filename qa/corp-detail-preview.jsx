import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import CorporateDetail from '../src/customer/CorporateDetail'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { id: 'u1', customer_id: 'c1', company_name: 'Acme Brands Ltd', base_currency: 'USD' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop/corporate/p1']}>
    <FavouritesProvider uid={profile.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <Routes>
            <Route path="/shop/corporate/:id" element={<CorporateDetail profile={profile} />} />
          </Routes>
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
