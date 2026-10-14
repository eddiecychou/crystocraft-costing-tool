import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../src/firebase'
import Products from '../src/pages/Products'
import Range from '../src/pages/Range'
import CorporateShop from '../src/customer/CorporateShop'
import FigurineShop from '../src/customer/FigurineShop'
import CatalogueImageMaintenance from '../src/pages/CatalogueImageMaintenance'
import ImageGallery from '../src/components/ImageGallery'
import '../src/index.css'

const params = new URLSearchParams(location.search)
const surface = params.get('surface') || 'range'
const paths = { products:'/products', range:'/range', corporate:'/shop/corporate', figurine:'/shop/figurine', maintenance:'/maintenance', gallery:'/gallery' }
function Detail() {
  const navigate = useNavigate()
  return <button className="btn-secondary" onClick={() => navigate(-1)}>Back to catalogue</button>
}
function Gallery() {
  const [images, setImages] = useState(window.__qa.gallery)
  const [hero, setHero] = useState(window.__qa.product.heroImage)
  useEffect(() => onSnapshot(collection(db,'products','gallery','images'), snap => setImages(snap.docs.map(d => ({id:d.id,...d.data()})))), [])
  return <div className="p-4 max-w-lg"><ImageGallery images={images} firestorePath="products/gallery/images" storagePath="products/gallery/images" showVisibility captionable enhanceable heroUrl={hero} onHeroChange={async url => setHero(url)} /><output data-testid="hero">{hero}</output></div>
}
const profile = {id:'viewer',customer_id:'viewer-company',base_currency:'USD',sensitive:params.get('sensitive')==='true'}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[paths[surface]]}><main id="main-scroll" className="p-4">
  <Routes>
    <Route path="/products" element={<Products />} /><Route path="/products/:id" element={<Detail />} />
    <Route path="/range" element={<Range />} /><Route path="/range/:id" element={<Detail />} />
    <Route path="/shop/corporate" element={<CorporateShop profile={profile} />} /><Route path="/shop/corporate/:id" element={<Detail />} />
    <Route path="/shop/figurine" element={<FigurineShop profile={profile} />} /><Route path="/shop/figurine/:id" element={<Detail />} />
    <Route path="/maintenance" element={<CatalogueImageMaintenance />} /><Route path="/gallery" element={<Gallery />} />
  </Routes>
</main></MemoryRouter>)
