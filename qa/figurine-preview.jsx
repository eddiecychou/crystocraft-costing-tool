import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import FigurineShop from '../src/customer/FigurineShop'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { id: 'u1', customer_id: 'c1', company_name: 'Acme Brands Ltd', base_currency: 'USD', email: 'buyer@acme.example' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop/figurine']}>
    <FavouritesProvider uid={profile.id}>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <FigurineShop profile={profile} />
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
