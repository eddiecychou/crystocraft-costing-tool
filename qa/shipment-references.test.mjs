// Real ShipmentForm, including its allocation/save handlers and normalization.
// Only I/O and unrelated child integrations are fictional. Never live writes.
import {test,before,after,beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,basename} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {ocDateOnly,ocYear} from '../src/ocTime.js'

const require=createRequire(import.meta.url)
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://fictional.test'})
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[k]=dom.window[k]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client'),{Simulate}=await import('react-dom/test-utils')
let scratch,Page,host,root,f,errors,originalError,originalFetch
const fail=()=>{throw Error('Unexpected service/database action in shipment references fixture')}
const order=()=>({customer_id:'qa-customer',customer_name:'Fictional 客戶 & Co',erp_so_no:'',erp_si_no:'',uc_no:'',erp_pi_no:'',customer_po:'PO-Original',currency:'USD',status:'draft',incoterm:'FOB',payment_terms:'30% deposit',notes:'Keep original notes',deposit_paid:155,discount_amount:0,pi_revision:2})
const stubs={
 firebase:'export const db={},storage={};export const authHeader=async()=>{throw Error("No network requests")}',
 firestore:`const f=()=>globalThis.__shipmentReferences;
 export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'new-line'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{};
 export const getDoc=async p=>{if(!p.includes('orders'))throw Error('Unexpected document read');return{id:p.at(-1),exists:()=>true,data:()=>f().order}};
 export const getDocs=async p=>({docs:JSON.stringify(p).includes('"orders"')?f().lines.map(l=>({id:l.id,ref:l.id,data:()=>l})):[]});
 export const onSnapshot=()=>()=>{},serverTimestamp=()=> 'FICTIONAL timestamp',where=()=>{},limit=()=>{};
 export const updateDoc=async(p,data)=>{if(!f().allowWrite)throw Error('Unexpected order write');f().orderWrites.push({path:[...p],data:structuredClone(data)});if(f().writeError)throw f().writeError;f().order={...f().order,...data}};
 export const writeBatch=()=>({set(p,data){if(!f().allowWrite)throw Error('Unexpected line write');f().lineWrites.push(structuredClone(data))},delete(){throw Error('No deletes authorized')},commit:async()=>{}});
 const fail=()=>{throw Error('No creates/transactions/deletes authorized')};export{fail as addDoc,fail as runTransaction,fail as deleteDoc};`,
 router:`import React from 'react';const f=()=>globalThis.__shipmentReferences;export const useParams=()=>({id:f().id}),useSearchParams=()=>[new URLSearchParams(f().search)],useNavigate=()=>to=>{f().destination=to};export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children)`,
 customer:'export const loadCustomers=async()=>[];export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error("No customer writes")}',
 criticalComponents:'export const buildProductIndex=()=>({});export const matchProductCode=()=>null',
 ContactPicker:'export default ()=>null',ConfirmDialog:'export default ()=>null',LineImagePicker:'export default ()=>null',PackingListEditor:'export default ()=>null',FreightComparison:'export default ()=>null',OrderStockIssue:'export default ()=>null',OrderInventoryIssue:'export default ()=>null',
 crystals:'export const crystalInventory={}',packaging:'export const packagingInventory={}',orderStock:'export const metalOrderConfig={}',
 orderStockStatus:'export const orderStockStatus=()=>null;export const stockStatusDetail=()=>"";export const STOCK_STATUS_LABEL={},STOCK_STATUS_STYLE={}',
 erpSoImport:'export const fetchErpSoLines=async()=>{throw Error("No ERP extraction")};export const diffLines=()=>null',
 soNumber:'import{ocYear}from"./src/ocTime.js";export const soYear=()=>String(ocYear(new Date())%100).padStart(2,"0");export const allocateSoNo=(...a)=>globalThis.__shipmentReferences.invoke("so",a);export const JES_SEED_BY_YEAR={};export const formatSoNo=()=>{throw Error("No order creation authorized")}',
 ucRegistry:'export const allocateOrderUc=(...a)=>globalThis.__shipmentReferences.invoke("uc",a);export const allocateInvoice=(...a)=>globalThis.__shipmentReferences.invoke("si",a);export const updateUcInvoice=(...a)=>globalThis.__shipmentReferences.invoke("registry",a);export const upsertInvoice=async data=>{const f=globalThis.__shipmentReferences;if(!f.allowAccounting)throw Error("No accounting upsert authorized");f.accountingWrites.push(structuredClone(data))}',
 storage:'export const ref=()=>{throw Error("No storage requests")};export const uploadBytes=async()=>{throw Error("No uploads")};export const getDownloadURL=async()=>{throw Error("No downloads")}',
}
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-shipment-references-'))
 await build({stdin:{contents:await readFile(process.env.SHIPMENT_REF_SOURCE||'src/pages/ShipmentForm.jsx','utf8'),resolveDir:resolve('src/pages'),loader:'jsx'},outfile:join(scratch,'page.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'fictional-shipment-io',setup(b){
  b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
  b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'fixture'}))
  b.onResolve({filter:/^firebase\/(firestore|storage)$/},a=>({path:a.path.split('/')[1],namespace:'fixture'}))
  b.onResolve({filter:/^\.\.?\//},a=>{const name=basename(a.path).replace(/\.jsx?$/,'');if(name in stubs)return{path:name,namespace:'fixture'}})
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}))
 }}]})
 Page=(await import(pathToFileURL(join(scratch,'page.mjs')))).default
 originalFetch=globalThis.fetch;globalThis.fetch=fail
})
beforeEach(()=>{
 f={id:'qa-order',search:'',order:order(),lines:[{id:'qa-line',line_no:1,item_code:'QA-ITEM',description:'Fictional item',qty_ordered:1000,unit:'pcs',unit_price:1.222,line_type:'ad_hoc'}],calls:[],actions:{so:async()=> 'SO-FICTIONAL',uc:async()=>({full:'UC-FICTIONAL'}),si:async()=>({si_no:'SI-FICTIONAL',uc_no:'UC-FICTIONAL'}),registry:async()=>({})},orderWrites:[],lineWrites:[],accountingWrites:[],allowWrite:false,allowAccounting:false}
 f.invoke=(kind,args)=>{f.calls.push({kind,args:structuredClone(args)});return f.actions[kind](...args)}
 globalThis.__shipmentReferences=f
 errors=[];originalError=console.error;console.error=(...a)=>errors.push(a.map(String).join(' '))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{try{await act(async()=>root.unmount());assert.deepEqual(errors,[])}finally{console.error=originalError;host.remove();delete globalThis.__shipmentReferences}})
after(async()=>{globalThis.fetch=originalFetch;dom.window.close();if(scratch)await rm(scratch,{recursive:true,force:true})})
const render=async()=>{await act(async()=>root.render(React.createElement(Page)));await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
const panel=()=>[...host.querySelectorAll('h2')].find(h=>h.textContent==='Document References')?.parentElement
const input=label=>[...panel().querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===label||l.textContent.trim()===label)?.parentElement.querySelector('input')
const allocation=label=>input(label).parentElement.querySelector('button')
const click=async b=>{assert.ok(b);await act(async()=>b.click())}
const fill=async(el,value)=>{assert.ok(el);await act(async()=>{el.value=value;Simulate.change(el,{target:{value}})})}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}

test('new order shows original blank controls and never allocates automatically',async()=>{
 f.id=undefined;await render();assert.equal(panel().querySelectorAll('input').length,5)
 for(const label of ['SO / Doc No','UC#','Invoice No']){assert.equal(input(label).value,'');assert.equal(allocation(label).textContent.trim(),'Allocate');assert.equal(allocation(label).type,'button')}
 assert.equal(input('Revision').value,'');assert.equal(panel().querySelector('a'),null);assert.deepEqual(f.calls,[]);assert.deepEqual(f.orderWrites,[])
})
test('saved exact references and Unicode source attachment load without allocation',async()=>{
 Object.assign(f.order,{erp_so_no:'SO260017',uc_no:'UC4950/26',erp_si_no:'SI260094',customer_po:'PO 中文 & <special>',source_file:{url:'https://fictional.invalid/source.pdf?x=1&y=2',name:'報價 & PI.pdf'}})
 await render()
 for(const [label,value]of [['SO / Doc No','SO260017'],['UC#','UC4950/26'],['Invoice No','SI260094'],['Customer PO','PO 中文 & <special>'],['Revision','2']])assert.equal(input(label).value,value)
 assert.equal(panel().querySelectorAll('button').length,1);const a=panel().querySelector('a');assert.equal(a.textContent.trim(),'報價 & PI.pdf');assert.equal(a.target,'_blank');assert.equal(a.rel,'noreferrer');assert.equal(a.href,f.order.source_file.url);assert.deepEqual(f.calls,[])
})
test('legacy UC and source-file fallback retain their existing meaning',async()=>{
 Object.assign(f.order,{erp_pi_no:'UC4950/26',source_file:{url:'https://fictional.invalid/old.pdf'}});await render()
 assert.equal(input('UC#').value,'UC4950/26');assert.equal(allocation('UC#'),null);assert.equal(panel().querySelector('a').textContent.trim(),'View source PI');assert.deepEqual(f.calls,[])
})
test('all manual inputs and successive revision bumps remain controlled and keep unrelated values',async()=>{
 await render()
 for(const [label,value]of [['SO / Doc No','SO-MANUAL'],['UC#','UC-MANUAL'],['Invoice No','SI-MANUAL'],['Customer PO','中文 & customer PO'],['Revision','7']])await fill(input(label),value)
 await click(allocation('Revision'));await click(allocation('Revision'));assert.equal(input('Revision').value,'9')
 await fill(input('Revision'),'');await click(allocation('Revision'));assert.equal(input('Revision').value,'1')
 assert.equal(input('Customer PO').value,'中文 & customer PO');assert.equal(input('Invoice No').value,'SI-MANUAL');assert.deepEqual(f.calls,[]);assert.deepEqual(f.orderWrites,[])
})
for(const [kind,label]of [['so','SO / Doc No'],['uc','UC#'],['si','Invoice No']]){
 test(`${kind}: pending allocation disables repeated clicks and preserves concurrent manual edits`,async()=>{
  f.allowWrite=true;const d=deferred();f.actions[kind]=()=>d.promise;await render();await click(allocation(label))
  const b=allocation(label);assert.equal(b.disabled,true);assert.equal(b.textContent.trim(),'Allocating…');await click(b);assert.equal(f.calls.filter(c=>c.kind===kind).length,1)
  await fill(input('Customer PO'),'Edited while allocating');await fill(input('Revision'),'8')
  await act(async()=>d.resolve(kind==='so'?'SO-FICTIONAL':kind==='uc'?{full:'UC-FICTIONAL'}:{si_no:'SI-FICTIONAL',uc_no:'UC-FICTIONAL'}))
  assert.equal(allocation(label),null);assert.equal(input(label).value,kind.toUpperCase()+'-FICTIONAL');assert.equal(input('Customer PO').value,'Edited while allocating');assert.equal(input('Revision').value,'8')
  assert.equal(f.orderWrites.length,kind==='si'?1:0)
  if(kind==='si')assert.equal(f.orderWrites[0].data.invoiced_at,ocDateOnly(new Date()))
 })
 test(`${kind}: failed allocation keeps fields, displays the error and retries only on a new click`,async()=>{
  f.allowWrite=true;f.actions[kind]=async()=>{throw Error('Fictional '+kind+' failure')};await render();await click(allocation(label))
  assert.ok(panel().textContent.includes('Fictional '+kind+' failure'));assert.equal(input(label).value,'');assert.equal(allocation(label).disabled,false);assert.equal(f.calls.length,1);assert.deepEqual(f.orderWrites,[])
  f.actions[kind]=async()=>kind==='so'?'SO-RETRY':kind==='uc'?{full:'UC-RETRY'}:{si_no:'SI-RETRY',uc_no:'UC-RETRY'}
  await click(allocation(label));assert.equal(input(label).value,kind.toUpperCase()+'-RETRY');assert.equal(f.calls.filter(c=>c.kind===kind).length,2)
 })
}
test('standalone UC allocation receives the current customer/currency without saving the order',async()=>{
 await render();await click(allocation('UC#'));assert.deepEqual(f.calls,[{kind:'uc',args:[{customer_name:'Fictional 客戶 & Co',currency:'USD'}]}]);assert.deepEqual(f.orderWrites,[])
})
test('invoice allocation sends the existing UC and immediately persists only its number/date patch',async()=>{
 f.allowWrite=true;f.order.uc_no='UC-EXISTING';f.order.invoiced_at='2026-10-01';f.actions.si=async()=>({si_no:'SI-NEW'});await render();await click(allocation('Invoice No'))
 assert.deepEqual(f.calls,[{kind:'si',args:[{year:String(ocYear(new Date())%100).padStart(2,'0'),customer:f.order.customer_name,currency:'USD',order_id:'qa-order',uc_no:'UC-EXISTING'}]}])
 assert.deepEqual(f.orderWrites,[{path:[{},'orders','qa-order'],data:{uc_no:'UC-EXISTING',erp_si_no:'SI-NEW',invoiced_at:'2026-10-01',updatedAt:'FICTIONAL timestamp'}}]);assert.equal(input('Invoice No').value,'SI-NEW');assert.equal(f.order.customer_po,'PO-Original')
})
test('unsaved invoice allocation returns the bundled UC without an order write',async()=>{
 f.id=undefined;await render();await click(allocation('Invoice No'));assert.equal(f.calls[0].args[0].order_id,null);assert.equal(f.calls[0].args[0].uc_no,null);assert.equal(input('UC#').value,'UC-FICTIONAL');assert.deepEqual(f.orderWrites,[]);assert.equal(f.calls.filter(c=>c.kind==='uc').length,0)
})
test('an order-write failure after invoice allocation keeps issued numbers and prevents another allocation click',async()=>{
 f.allowWrite=true;f.writeError=Error('Fictional persist failure');await render();await click(allocation('Invoice No'))
 assert.equal(input('Invoice No').value,'SI-FICTIONAL');assert.equal(input('UC#').value,'UC-FICTIONAL');assert.equal(allocation('Invoice No'),null);assert.ok(panel().textContent.includes('Fictional persist failure'));assert.equal(f.calls.filter(c=>c.kind==='si').length,1);assert.equal(f.orderWrites.length,1)
})
// Characterize the existing saved-order payload, including the separately
// documented missing total/HKD-payout fields. This extraction must not silently
// introduce an accounting-data repair; such a repair needs its own tests/scope.
for(const registryFails of [false,true])test(`WooCommerce allocation retains its existing saved-order payload/warning (${registryFails?'failure':'success'})`,async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel:'woocommerce',woo_order_no:'WOO-QA',total_amount:1222,woo_fee:10,woo_net_payout_hkd:9456,woo_payout_date:'2026-10-02'});f.actions.si=async()=>({si_no:'SI-WOO',uc_no:'UC-WOO',uc_id:'qa-registry'})
 if(registryFails)f.actions.registry=async()=>{throw Error('Fictional registry failure')}
 await render();await click(allocation('Invoice No'))
 assert.deepEqual(f.calls.find(c=>c.kind==='registry').args,['qa-registry',{source:'Online Shop',customer_id:'qa-customer',order_no:'WOO-QA',total:null,deposit:null,balance:0,bal_pay_date:'2026-10-02',remarks:'PO-Original — Gateway fee: USD 10.00 · Net payout: HKD amount — fill in manually · Payout 2026-10-02'}])
 assert.equal(input('Invoice No').value,'SI-WOO');assert.equal(allocation('Invoice No'),null);assert.equal(f.orderWrites.length,1)
 if(registryFails)assert.ok(panel().textContent.includes('Invoice allocated, but the UC Registry details could not be auto-filled: Fictional registry failure'))
})
test('Raise invoice arrival still scrolls/focuses the exact invoice input after saved-order loading',async()=>{
 f.search='invoice=1';const calls=[],original=HTMLElement.prototype.scrollIntoView
 HTMLElement.prototype.scrollIntoView=function(options){calls.push({node:this,options})}
 try{await render();assert.equal(document.activeElement,input('Invoice No'));assert.equal(calls.length,1);assert.equal(calls[0].node,input('Invoice No'));assert.deepEqual(calls[0].options,{block:'center',behavior:'smooth'});assert.deepEqual(f.calls,[])}finally{if(original)HTMLElement.prototype.scrollIntoView=original;else delete HTMLElement.prototype.scrollIntoView}
})
test('route reuse clears saved references/source for a new order and keeps allocation callbacks current',async()=>{
 Object.assign(f.order,{erp_so_no:'SO-OLD',erp_si_no:'SI-OLD',uc_no:'UC-OLD',source_file:{url:'https://fictional.invalid/old.pdf',name:'Old PI'}});await render();assert.equal(input('Invoice No').value,'SI-OLD')
 f.id=undefined;await render();for(const label of ['SO / Doc No','UC#','Invoice No','Customer PO','Revision'])assert.equal(input(label).value,'');assert.equal(panel().querySelector('a'),null)
 await click(allocation('Invoice No'));assert.equal(f.calls[0].args[0].order_id,null);assert.equal(f.calls[0].args[0].uc_no,null);assert.deepEqual(f.orderWrites,[])
})
test('manual references survive the actual save/reopen path with precision, notes and deposit retained',async()=>{
 f.allowWrite=true;f.allowAccounting=true;await render();for(const [label,value]of [['SO / Doc No','SO-SAVED'],['UC#','UC-SAVED'],['Invoice No','SI-SAVED'],['Customer PO','PO 保存 & 1'],['Revision','4']])await fill(input(label),value)
 const save=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save Changes');await click(save)
 assert.equal(f.orderWrites.length,1);const data=f.orderWrites[0].data
 assert.equal(data.erp_so_no,'SO-SAVED');assert.equal(data.uc_no,'UC-SAVED');assert.equal(data.erp_si_no,'SI-SAVED');assert.equal(data.customer_po,'PO 保存 & 1');assert.equal(data.pi_revision,4);assert.equal(data.notes,'Keep original notes');assert.equal(data.deposit_paid,155);assert.equal(f.lineWrites[0].unit_price,1.222);assert.equal(f.lineWrites[0].qty_ordered,1000);assert.deepEqual(f.calls,[])
 assert.equal(f.accountingWrites.length,1);assert.equal(f.accountingWrites[0].si_no,'SI-SAVED');assert.equal(f.accountingWrites[0].customer_po,'PO 保存 & 1');assert.equal(f.accountingWrites[0].total,1222)
 await act(async()=>root.unmount());root=createRoot(host);await render()
 assert.equal(input('Invoice No').value,'SI-SAVED');assert.equal(input('Revision').value,'4');assert.equal(input('Customer PO').value,'PO 保存 & 1')
})
