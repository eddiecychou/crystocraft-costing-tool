// Fictional local-only mobile audit of the actual pages; writers throw.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import Dashboard from '../src/pages/Dashboard'
import CustomerDetail from '../src/pages/CustomerDetail'
import Layout from '../src/components/Layout'
const customer=location.pathname==='/customer'
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[customer?'/customers/mobile_qa':'/dashboard']}><Layout user={{email:'fictional-mobile@example.invalid'}}><Routes><Route path="/dashboard" element={<Dashboard/>}/><Route path="/customers/:id" element={<CustomerDetail/>}/></Routes></Layout></MemoryRouter>)
