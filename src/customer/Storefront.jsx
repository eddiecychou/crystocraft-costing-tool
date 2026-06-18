import { Routes, Route, Navigate } from 'react-router-dom'
import CustomerLayout from './CustomerLayout'
import FigurineShop from './FigurineShop'
import CorporateShop from './CorporateShop'

export default function Storefront({ profile }) {
  return (
    <CustomerLayout profile={profile}>
      <Routes>
        <Route path="/shop/figurine" element={<FigurineShop profile={profile} />} />
        <Route path="/shop/corporate" element={<CorporateShop profile={profile} />} />
        <Route path="*" element={<Navigate to="/shop/figurine" replace />} />
      </Routes>
    </CustomerLayout>
  )
}
