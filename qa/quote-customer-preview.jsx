import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import QuoteForm from '../src/pages/QuoteForm'
import '../src/index.css'

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/quotes/new?customer_id=retail']}>
    <QuoteForm />
  </MemoryRouter>,
)
