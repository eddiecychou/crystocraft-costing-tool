import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import OrderHistoryPage from '../src/customer/OrderHistoryPage'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { id: 'u1', customer_id: 'c1', company_name: 'Acme Brands Ltd', base_currency: 'USD' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop/orders']}>
    <FavouritesProvider uid={profile.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <Routes>
            <Route path="/shop/orders" element={<OrderHistoryPage profile={profile} />} />
          </Routes>
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
