import {createRoot} from 'react-dom/client'
import {BrowserRouter,Routes,Route,Link,Navigate} from 'react-router-dom'
import {AccessContext} from '../src/access'
import {CartProvider,FavouritesProvider} from '../src/customer/store'
import CrystalComponents from '../src/pages/CrystalComponents'
import CrystalComponentForm from '../src/pages/CrystalComponentForm'
import CrystalComponentsShop from '../src/customer/CrystalComponentsShop'
import CrystalComponentDetail from '../src/customer/CrystalComponentDetail'
import SwatchLibraryPage from '../src/customer/SwatchLibraryPage'
import EnquiryPage from '../src/customer/EnquiryPage'
import FavouritesPage from '../src/customer/FavouritesPage'
import Enquiries from '../src/pages/Enquiries'
const profile={id:'qa_owner',role:'customer',status:'approved',company_name:'Fictional QA company',email:'qa@example.test',base_currency:'HKD'}
createRoot(document.getElementById('root')).render(<BrowserRouter><AccessContext.Provider value={{role:'admin',modules:['swatch','supply']}}><FavouritesProvider uid="qa_owner"><CartProvider><div className="max-w-6xl mx-auto px-4"><nav className="flex flex-wrap gap-4 py-3"><Link to="/crystal-components">OC catalogue</Link><Link to="/shop/crystal-components">Portal catalogue</Link><Link to="/shop/enquiry">Enquiry</Link><Link to="/shop/favourites">Favourites</Link></nav><Routes>
<Route path="/crystal-components" element={<CrystalComponents/>}/><Route path="/crystal-components/:id" element={<CrystalComponentForm/>}/>
<Route path="/shop/crystal-components" element={<CrystalComponentsShop/>}/><Route path="/shop/crystal-components/fabric" element={<SwatchLibraryPage/>}/><Route path="/shop/swatches" element={<Navigate to="/shop/crystal-components/fabric" replace/>}/><Route path="/shop/crystal-components/:id" element={<CrystalComponentDetail/>}/>
<Route path="/shop/enquiry" element={<EnquiryPage profile={profile}/>}/><Route path="/shop/favourites" element={<FavouritesPage/>}/><Route path="/enquiries" element={<Enquiries/>}/>
</Routes></div></CartProvider></FavouritesProvider></AccessContext.Provider></BrowserRouter>)
