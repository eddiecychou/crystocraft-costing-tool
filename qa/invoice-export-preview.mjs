// Actual invoice print/download components; only external data boundaries are
// replaced. No live Firebase/ERP connection or write is available in this page.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'

const out = resolve('qa/out/invoice-deposit/exports')
await mkdir(out, { recursive: true })
const stubs = {
  firebase: 'export const db={}',
  router: 'export const useParams=()=>({id:"qa-export",key:"app-qa-export"})',
  firestore: `
    const data=()=>window.invoiceExportFixture;
    export const doc=(_, ...parts)=>parts.join('/'),collection=doc,query=p=>p,orderBy=()=>{};
    export const getDoc=async p=>({exists:()=>p==='orders/qa-export',data:()=>data().order});
    export const getDocs=async p=>({docs:p==='orders/qa-export/lines'?data().lines.map(l=>({id:l.id,data:()=>l})):[]});
    const blocked=()=>{throw Error('Live writes forbidden in export QA')};
    export {blocked as addDoc,blocked as updateDoc,blocked as deleteDoc,blocked as onSnapshot,blocked as serverTimestamp,blocked as writeBatch,blocked as runTransaction};`,
  customer: 'export const loadCustomers=async()=>[];export const primaryContact=()=>null;export const contactAddress=()=>""',
  bankAccounts: 'export const listBankAccounts=async()=>[];export const accountForCurrency=()=>null;export const formatBankDetails=()=>""',
  criticalComponents: 'export const buildProductIndex=()=>({});export const matchProductCode=()=>null',
  customerOrderHistoryApi: 'export const myInvoiceDetail=async()=>{throw Error("No live ERP connection")}',
}
await build({
  stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Sales from './src/pages/SalesInvoicePrint.jsx';
    import Customer from './src/customer/CustomerInvoicePrint.jsx';
    const key=new URLSearchParams(location.search).get('case')||'partial';
    const deposits={partial:2000,blank:null,zero:0,full:7613.94,adjusted:2000};
    if(!(key in deposits))throw Error('Unknown QA case');
    window.invoiceExportFixture={
      order:{source:'manual',customer_id:'qa-export',customer_name:'QA Export Check (fictional)',
        erp_si_no:'SI-QA-'+key.toUpperCase(),erp_so_no:'SO-QA-EXPORT',uc_no:'UC-QA-EXPORT',
        currency:'USD',order_date:'2026-10-30',invoice_date:'2026-10-30',status:'confirmed',
        notes:'Fictional export check. No real invoice or payment.',
        deposit_paid:deposits[key],subtotal:7613.94,total_amount:7613.94,
        accounting_total:key==='adjusted'?7600:null,adjustment:key==='adjusted'?-13.94:null,
        adjustment_reason:key==='adjusted'?'QA accounting adjustment':''},
      lines:[{id:'example',line_no:1,item_code:'QA-EXAMPLE',description:'Fictional invoice export sample',
        qty_ordered:1,unit:'pcs',unit_price:7613.94,line_type:'ad_hoc',
        supplier_name:'PRIVATE-SUPPLIER-QA',unit_cost_hkd:999}],
    };
    const customer=new URLSearchParams(location.search).get('view')==='customer';
    createRoot(document.getElementById('root')).render(customer
      ? <Customer profile={{customer_id:'qa-export',company_name:'QA Export Check (fictional)'}}/>
      : <Sales/>);`,
  },
  outfile: out + '/app.js', bundle: true, format: 'iife', jsx: 'automatic',
  loader: { '.png': 'dataurl' },
  plugins: [{ name: 'invoice-export-read-only-boundaries', setup(b) {
    b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path:'router', namespace:'fixture' }))
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path:'firestore', namespace:'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => {
      const name=basename(a.path).replace(/\.jsx?$/, '')
      if (name in stubs) return { path:name, namespace:'fixture' }
    })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents:stubs[a.path], loader:'js' }))
  } }],
})
await writeFile(out+'/index.html', '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>')
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname
  if (path !== '/' && path !== '/app.js') { res.writeHead(404);res.end();return }
  res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html')
  res.end(await readFile(out+(path==='/app.js'?'/app.js':'/index.html')))
})
server.listen(5196, '127.0.0.1', ()=>console.log('Read-only invoice export review: http://127.0.0.1:5196/?case=partial'))
