import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import FigurineDetail from '../src/customer/FigurineDetail'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { id: 'u1', customer_id: 'c1', company_name: 'Acme Brands Ltd', base_currency: 'USD' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop/figurine/d1']}>
    <FavouritesProvider uid={profile.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <Routes>
            <Route path="/shop/figurine/:id" element={<FigurineDetail profile={profile} />} />
          </Routes>
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
