// No live data or writes. Test the actual Dashboard with fictional records.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import Dashboard from '../src/pages/Dashboard'
globalThis.__dashboardAiCalls=[];globalThis.__dashboardSuggestionCalls=[]
globalThis.__dashboardRows={customers:[{id:'c1',company_name:'QA Repeat-order Customer',crm_category:'Gift / OEM',sales_pipeline:{revision:1,status:'active',detail:'Sample and pricing requested for a repeat order.'}}],orders:[{id:'qa-order',customer_id:'c1',status:'confirmed',order_date:new Date().toISOString().slice(0,10),uc_no:'QA ONLY'}]}
globalThis.__dashboardDigest='The customer is reviewing the revised samples and packaging for a repeat order. Pricing, delivery dates and the final application need discussion before they confirm the next step. '.repeat(9)+'Final reference detail: buyer will confirm the artwork after reviewing the sample.'
const today=new Date();const past=new Date(today);past.setDate(past.getDate()-1);const local=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
globalThis.__dashboardWork=[{id:'qa-note',customerId:'c1',kind:'note',state:'todo',text:'Keep the approved packaging reference for the next enquiry.'},{id:'qa-overdue',customerId:'c1',kind:'task',state:'todo',text:'Confirm revised sample details',due_on:local(past)},{id:'qa-today',customerId:'c1',kind:'task',state:'waiting',text:'Follow up on repeat-order pricing',due_on:local(today)}]
createRoot(document.getElementById('root')).render(<MemoryRouter><p className="p-4 text-sm">Fictional local preview · no live data or writes</p><Dashboard/></MemoryRouter>)
