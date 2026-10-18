import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {AccessContext} from '../src/access'
import SwatchLibrary from '../src/pages/SwatchLibrary'
import SwatchLibraryPage from '../src/customer/SwatchLibraryPage'
const q=new URLSearchParams(location.search)
createRoot(document.getElementById('root')).render(<MemoryRouter><AccessContext.Provider value={{role:q.has('staff')?'staff':'admin',modules:['swatch']}}>
 {q.get('view')==='portal'?<main className="p-4"><SwatchLibraryPage profile={{id:'qa'}}/></main>:<SwatchLibrary/>}
</AccessContext.Provider></MemoryRouter>)
