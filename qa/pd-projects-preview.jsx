import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter,Routes,Route,Navigate,Link} from 'react-router-dom'
import Projects,{DesignProjectDetail} from '../src/pages/pd/Projects'
function ExistingTool(){return <main className="p-6"><h1>Existing tool route</h1><p>Gallery and JSON tool implementations are unchanged; this isolated fixture does not connect to them.</p><Link to="/design/projects">Back to projects</Link></main>}
createRoot(document.getElementById('root')).render(<BrowserRouter><div className="p-3 bg-ivory-dark border-b border-warm-grey text-sm">LOCAL QA · Fictional projects only · No production connection</div><Routes><Route path="/design/projects" element={<Projects/>}/><Route path="/design/projects/new" element={<DesignProjectDetail/>}/><Route path="/design/projects/:id" element={<DesignProjectDetail/>}/><Route path="/design/products" element={<ExistingTool/>}/><Route path="/design/templates" element={<ExistingTool/>}/><Route path="/design/generations" element={<ExistingTool/>}/><Route path="/design/tools" element={<ExistingTool/>}/><Route path="*" element={<Navigate to="/design/projects" replace/>}/></Routes></BrowserRouter>)
