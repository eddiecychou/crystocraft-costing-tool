// No live data or writes. Test the actual Dashboard with fictional records.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import Dashboard from '../src/pages/Dashboard'
globalThis.__dashboardAiCalls=[];globalThis.__dashboardSuggestionCalls=[]
globalThis.__dashboardRows={customers:[{id:'c1',company_name:'QA Repeat-order Customer',crm_category:'Gift / OEM',sales_pipeline:{revision:1,status:'active',detail:'Sample and pricing requested for a repeat order.'}}],orders:[{id:'qa-order',customer_id:'c1',status:'confirmed',order_date:new Date().toISOString().slice(0,10),uc_no:'QA ONLY'}]}
createRoot(document.getElementById('root')).render(<MemoryRouter><p className="p-4 text-sm">Fictional local preview · no live data or writes</p><Dashboard/></MemoryRouter>)
