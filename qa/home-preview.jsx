// Headless preview of the customer portal HomePage (/shop) — it's behind a
// customer login, so this mounts the REAL component inside the REAL
// CustomerLayout + store providers, with a fake profile and no auth. The
// Firestore-backed hooks (featured products, proposal invite, favourites)
// all degrade to their empty state without auth, which is exactly the
// baseline we want to see rhythm + hover on.
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CustomerLayout from '../src/customer/CustomerLayout'
import HomePage from '../src/customer/HomePage'
import { CartProvider, FavouritesProvider } from '../src/customer/store'

const profile = { company_name: 'Acme Brands Ltd', base_currency: 'USD', email: 'buyer@acme.example' }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/shop']}>
    <FavouritesProvider>
      <CartProvider>
        <CustomerLayout profile={profile}>
          <HomePage profile={profile} />
        </CustomerLayout>
      </CartProvider>
    </FavouritesProvider>
  </MemoryRouter>
)
