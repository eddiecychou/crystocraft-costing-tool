import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RangeCosting from '../src/pages/RangeCosting'
import '../src/index.css'
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/range/test/costing']}><Routes><Route path="/range/:id/costing" element={<RangeCosting />} /></Routes></MemoryRouter>)
