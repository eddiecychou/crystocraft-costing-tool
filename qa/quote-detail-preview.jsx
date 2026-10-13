import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import QuoteDetail from '../src/pages/QuoteDetail.jsx'

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/quotes/q1']}>
    <Routes><Route path="/quotes/:id" element={<QuoteDetail />} /></Routes>
  </MemoryRouter>
)
