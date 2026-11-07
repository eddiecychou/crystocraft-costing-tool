// Fictional loopback-only browser fixture. Production app entry is not loaded.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AccessContext} from '../src/access'
import CustomerFiles from '../src/components/crm/CustomerFiles'
import '../src/index.css'
const profiles={admin:{role:'admin',modules:[]},crm:{role:'staff',modules:['customers']},marketing:{role:'staff',modules:['marketing']},customer:{role:'customer',modules:['customers']}}
window.__customerFilesQaRole=new URLSearchParams(location.search).get('role')||'admin'
function App(){
  const[customer,setCustomer]=useState('customer_files_browser'),profile=profiles[window.__customerFilesQaRole]||profiles.customer
  return <AccessContext.Provider value={profile}><main className="max-w-6xl mx-auto p-4 md:p-8 space-y-4"><p className="text-xs text-brand-600">QA ONLY · fictional Cindy/Tony records · local emulators</p><h1 className="text-xl">Business Cards & Customer Files</h1><button className="btn-secondary text-xs" onClick={()=>setCustomer(c=>c==='customer_files_browser'?'customer_files_browser_other':'customer_files_browser')}>Switch fictional company</button><section className="card p-5"><CustomerFiles customerId={customer}/></section></main></AccessContext.Provider>
}
createRoot(document.getElementById('root')).render(<App/> )
