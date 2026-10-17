// Actual pages, fictional reads only; see pd-navigation-fixture.mjs.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter,Routes,Route} from 'react-router-dom'
import Projects from '../src/pages/pd/Projects'
import Gallery from '../src/pages/pd/Products'
import Templates from '../src/pages/pd/Templates'
import Generations from '../src/pages/pd/Generations'
import Guide from '../src/pages/pd/DesignHome'
import ProductDetail from '../src/pages/pd/ProductDetail'
import ProductEdit from '../src/pages/pd/ProductEdit'
import TemplateDetail from '../src/pages/pd/TemplateDetail'
import TemplateEdit from '../src/pages/pd/TemplateEdit'
createRoot(document.getElementById('root')).render(<BrowserRouter><p className="p-2 text-xs bg-ivory-dark">Local QA · Fictional data · No production connection</p><Routes>{[['/design/products/:id',ProductDetail],['/design/products/:id/edit',ProductEdit],['/design/templates/:id',TemplateDetail],['/design/templates/:id/edit',TemplateEdit],['/design/projects',Projects],['/design/products',Gallery],['/design/templates',Templates],['/design/generations',Generations],['/design/tools',Guide]].map(([path,Page])=><Route key={path} path={path} element={<Page/>}/>)}</Routes></BrowserRouter>)
