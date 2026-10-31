// Actual AccountEdit with fictional reads and a no-network correspondence API.
// Run manually for desktop/mobile UI verification; no Firebase or email calls.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const out = 'qa/out/portal-followup-preview'
await mkdir(out, { recursive: true })
const account = { id: 'fixture', role: 'customer', status: 'pending', email: 'applicant@example.test', company_name: 'Fictional Gifts', contact_name: 'Test Contact' }
const api = `
let data={revision:0,state:'new',draft:null,active_message_id:null,messages:[],from:'QA <sender@example.test>',reply_to:'reply@example.test',mail_configured:true};
const copy=()=>structuredClone(data);window.fixture={calls:[],data:copy};
export const getAccountFollowup=async()=>copy();
export const saveAccountFollowupDraft=async(uid,draft)=>{window.fixture.calls.push('save draft');data={...data,draft,revision:data.revision+1};return copy()};
export const sendAccountFollowup=async(uid,message)=>{window.fixture.calls.push('simulated send');data={...data,state:'waiting',draft:null,revision:data.revision+1,last_sent_at:Date.now(),messages:[{id:message.messageId,to:'applicant@example.test',subject:message.subject,message:message.message,status:'sent',sent_at:Date.now()},...data.messages]};return copy()};
export const markAccountInformationReceived=async()=>{window.fixture.calls.push('mark received');data={...data,state:'received',received_at:Date.now(),revision:data.revision+1};return copy()};
export const resolveAccountFollowup=async()=>{throw Error('Not part of this preview')};
export const approveInvitation=()=>{throw Error('Approval forbidden in fixture')};export const deleteAccount=approveInvitation;
`
const stubs = {
  firebase: 'export const db={};export const auth={currentUser:{uid:"admin"}};',
  firestore: `export const doc=(_, ...p)=>p.join('/'),collection=doc,query=x=>x,where=()=>null,serverTimestamp=()=>null;export const getDoc=async()=>({exists:()=>true,id:'fixture',data:()=>(${JSON.stringify(account)})});export const getDocs=async()=>({docs:[]});export const updateDoc=()=>{throw Error('Account changes forbidden in preview')};export const addDoc=updateDoc;`,
  customer: "export const useCustomers=()=>({customers:[]});export const CUSTOMER_COUNTRIES=['Hong Kong'];export const CRM_CATEGORIES=['Prospect'];export const CUSTOMER_SOURCES=['Website'];export const getCustomer=()=>null;export const saveCustomer=()=>{throw Error('Customer creation forbidden')};",
  currency: "export const CUSTOMER_CURRENCIES=['USD'];export const useRates=()=>({});export const fromUSD=v=>v;",
  CustomerAccounts: "export const CustomerPicker=()=>null;export const TypeBadge=()=> 'Customer';",
  ContactPicker: 'export default ()=>null;',
  notify: "export const notifyEmail=()=>{throw Error('Live notifications forbidden')};",
  portalInviteApi: api,
}
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import Page from './src/pages/AccountEdit.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/portal/accounts/:id' element={<Page/>}/></Routes></BrowserRouter>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, jsx: 'automatic', format: 'esm', outfile: out + '/app.js',
  plugins: [{ name: 'fictional-account-boundaries', setup(b) {
    b.onResolve({ filter: /firebase\/firestore$|\/(firebase|customer|currency|CustomerAccounts|ContactPicker|notify|portalInviteApi)$/ }, a => ({ path: a.path === 'firebase/firestore' ? 'firestore' : a.path.split('/').at(-1), namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js' }))
  } }] })
execFileSync('node_modules/.bin/tailwindcss', ['-i', 'src/index.css', '-o', out + '/style.css'], { stdio: 'pipe' })
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/app.js' || path === '/style.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(out + path))
  } else if (path.startsWith('/portal/accounts/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><aside class="p-4 text-sm text-brand-600">Isolated QA fixture · fictional applicant · no real email or account changes</aside><div id="root"></div><script type="module" src="/app.js"></script>')
  } else { res.statusCode = 404; res.end() }
})
server.listen(5199, '127.0.0.1', () => console.log('Isolated preview: http://127.0.0.1:5199/portal/accounts/fixture'))
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close(() => process.exit()))
