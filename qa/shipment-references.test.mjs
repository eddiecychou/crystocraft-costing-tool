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
let scratch,Page,normOrder,validateOrder,mapWooOrderToOrder,host,root,f,errors,originalError,originalFetch
const fail=()=>{throw Error('Unexpected service/database action in shipment references fixture')}
const order=()=>({customer_id:'qa-customer',customer_name:'Fictional 客戶 & Co',erp_so_no:'',erp_si_no:'',uc_no:'',erp_pi_no:'',customer_po:'PO-Original',currency:'USD',status:'draft',incoterm:'FOB',payment_terms:'30% deposit',notes:'Keep original notes',deposit_paid:155,discount_amount:0,pi_revision:2})
const stubs={
 firebase:'export const db={},storage={};export const authHeader=async()=>{throw Error("No network requests")}',
 firestore:`const f=()=>globalThis.__shipmentReferences;
 export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'new-line'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{};
 export const getDoc=async p=>{if(p.includes('client_quotes')&&f().quote)return{id:p.at(-1),exists:()=>true,data:()=>f().quote};if(!p.includes('orders'))throw Error('Unexpected document read');return{id:p.at(-1),exists:()=>true,data:()=>f().order}};
 export const getDocs=async p=>({docs:p.includes('client_quotes')&&f().quote?(f().quoteItems||[]).map((l,i)=>({id:'quote-item-'+i,data:()=>l})):JSON.stringify(p).includes('"orders"')?f().lines.map(l=>({id:l.id,ref:l.id,data:()=>l})):[]});
 export const onSnapshot=(path,next)=>{if(!path.includes("orders"))throw Error("Unexpected subscription");f().stockSnapshot=next;return()=>{delete f().stockSnapshot}},serverTimestamp=()=> 'FICTIONAL timestamp',where=()=>{},limit=()=>{};
 export const updateDoc=async(p,data)=>{if(!f().allowWrite)throw Error('Unexpected order write');f().orderWrites.push({path:[...p],data:structuredClone(data)});if(f().writeError)throw f().writeError;f().order={...f().order,...data}};
 export const writeBatch=()=>({set(p,data){if(!f().allowWrite)throw Error('Unexpected line write');f().lineWrites.push(structuredClone(data))},delete(){throw Error('No deletes authorized')},commit:async()=>{}});
 export const runTransaction=async()=>{if(f().createError){f().createAttempts++;throw f().createError}throw Error('No creates/transactions authorized')};
 const fail=()=>{throw Error('No creates/deletes authorized')};export{fail as addDoc,fail as deleteDoc};`,
 router:`import React from 'react';const f=()=>globalThis.__shipmentReferences;export const useParams=()=>({id:f().id}),useSearchParams=()=>[new URLSearchParams(f().search)],useNavigate=()=>to=>{f().destination=to};export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children)`,
 customer:'export const loadCustomers=async()=>[];export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error("No customer writes")}',
 criticalComponents:'export const buildProductIndex=()=>({});export const matchProductCode=()=>null',
 ContactPicker:'export default ()=>null',ConfirmDialog:'export default ()=>null',LineImagePicker:'export default ()=>null',PackingListEditor:'export default ()=>null',FreightComparison:'export default ()=>null',OrderStockIssue:'export default ()=>null',OrderInventoryIssue:'export default ()=>null',
 crystals:'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}}',
 packaging:'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}}',
 orderStock:'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}}',
 erpSoImport:'export const fetchErpSoLines=async()=>{throw Error("No ERP extraction")};export const diffLines=()=>null',
 soNumber:'import{ocYear}from"./src/ocTime.js";export const soYear=()=>String(ocYear(new Date())%100).padStart(2,"0");export const allocateSoNo=(...a)=>globalThis.__shipmentReferences.invoke("so",a);export const JES_SEED_BY_YEAR={};export const formatSoNo=()=>{throw Error("No order creation authorized")}',
 ucRegistry:'export const allocateOrderUc=(...a)=>globalThis.__shipmentReferences.invoke("uc",a);export const allocateInvoice=(...a)=>globalThis.__shipmentReferences.invoke("si",a);export const updateUcInvoice=(...a)=>globalThis.__shipmentReferences.invoke("registry",a);export const upsertInvoice=async data=>{const f=globalThis.__shipmentReferences;if(!f.allowAccounting)throw Error("No accounting upsert authorized");f.accountingWrites.push(structuredClone(data))}',
 storage:'export const ref=()=>{throw Error("No storage requests")};export const uploadBytes=async()=>{throw Error("No uploads")};export const getDownloadURL=async()=>{throw Error("No downloads")}',
}
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-shipment-references-'))
 const source=await readFile(process.env.SHIPMENT_REF_SOURCE||'src/pages/ShipmentForm.jsx','utf8')
 await build({stdin:{contents:source+'\nexport {normOrder,validateOrder} from "../shipping";export {mapWooOrderToOrder} from "../wooImport";',resolveDir:resolve('src/pages'),loader:'jsx'},outfile:join(scratch,'page.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'fictional-shipment-io',setup(b){
  b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
  b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'fixture'}))
  b.onResolve({filter:/^firebase\/(firestore|storage)$/},a=>({path:a.path.split('/')[1],namespace:'fixture'}))
  b.onResolve({filter:/^\.\.?\//},a=>{const name=basename(a.path).replace(/\.jsx?$/,'');if(name in stubs)return{path:name,namespace:'fixture'}})
  if(process.env.SHIPMENT_MODEL_SOURCE)b.onLoad({filter:/\/src\/shipping\.js$/},async()=>({contents:await readFile(process.env.SHIPMENT_MODEL_SOURCE,'utf8'),loader:'js',resolveDir:resolve('src')}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}))
 }}]})
 const module=await import(pathToFileURL(join(scratch,'page.mjs')));Page=module.default;normOrder=module.normOrder;validateOrder=module.validateOrder;mapWooOrderToOrder=module.mapWooOrderToOrder
 originalFetch=globalThis.fetch;globalThis.fetch=fail
})
beforeEach(()=>{
 f={id:'qa-order',search:'',order:order(),lines:[{id:'qa-line',line_no:1,item_code:'QA-ITEM',description:'Fictional item',qty_ordered:1000,unit:'pcs',unit_price:1.222,line_type:'ad_hoc'}],calls:[],actions:{so:async()=> 'SO-FICTIONAL',uc:async()=>({full:'UC-FICTIONAL'}),si:async()=>({si_no:'SI-FICTIONAL',uc_no:'UC-FICTIONAL'}),registry:async()=>({})},orderWrites:[],lineWrites:[],accountingWrites:[],createAttempts:0,allowWrite:false,allowAccounting:false}
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
// The separately authorized Woo metadata repair intentionally updates the two
// original bug-characterization expectations; all other reference cases remain.
for(const registryFails of [false,true])test(`WooCommerce allocation preserves its checkout total and recorded payout (${registryFails?'failure':'success'})`,async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel:'woocommerce',woo_order_no:'WOO-QA',total_amount:1222,woo_fee:10,woo_net_payout_hkd:9456,woo_payout_date:'2026-10-02'});f.actions.si=async()=>({si_no:'SI-WOO',uc_no:'UC-WOO',uc_id:'qa-registry'})
 if(registryFails)f.actions.registry=async()=>{throw Error('Fictional registry failure')}
 await render();await click(allocation('Invoice No'))
 assert.deepEqual(f.calls.find(c=>c.kind==='registry').args,['qa-registry',{source:'Online Shop',customer_id:'qa-customer',order_no:'WOO-QA',total:1222,deposit:1222,balance:0,bal_pay_date:'2026-10-02',remarks:'PO-Original — Gateway fee: USD 10.00 · Net payout: HKD 9456.00 · Payout 2026-10-02'}])
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

for(const value of [1140.123456,0,null,undefined,'','invalid'])test(`canonical Woo HKD payout preserves numeric/null semantics (${String(value)})`,()=>{
 const normalized=normOrder({channel:'woocommerce',currency:'EUR',total_amount:146.18123,woo_net_payout:144.96,woo_net_payout_hkd:value})
 assert.equal(normalized.woo_net_payout_hkd,typeof value==='number'?value:null)
 assert.equal(normalized.total_amount,146.18123);assert.equal(normalized.woo_net_payout,144.96);assert.equal(normalized.currency,'EUR')
})
for(const currency of ['HKD','USD','EUR','GBP'])test(`${currency}: actual Woo mapper/normalizer/form/save/reopen retains checkout and settlement data`,async()=>{
 const mapped=mapWooOrderToOrder({id:999991,number:'999991',currency,customer_name:'Fictional Woo buyer',date_created:'2026-10-02T03:00:00',date_paid:'2026-10-02T04:00:00',subtotal:100,discount_total:3.82,shipping_total:50,tax_total:0,total:146.18,gateway_fee:1.22,net_payout:144.96,net_payout_hkd:1140.123456,payout_date:'2026-10-03',line_items:[{sku:'QA-WOO',name:'Fictional Woo item',quantity:1,subtotal:100}]})
 f.order=normOrder({...order(),deposit_paid:null,...mapped.header});f.lines=mapped.lines.map((l,i)=>({...l,id:'woo-line-'+i,line_no:i+1}));f.allowWrite=true;f.allowAccounting=true
 assert.equal(f.order.woo_net_payout_hkd,1140.123456);assert.equal(f.order.total_amount,146.18)
 f.actions.si=async()=>({si_no:'SI-WOO',uc_no:'UC-WOO',uc_id:'qa-registry'});await render();await click(allocation('Invoice No'))
 const patch=f.calls.find(c=>c.kind==='registry').args[1]
 assert.equal(patch.currency,undefined,'Existing registry currency is not overwritten by metadata fill')
 assert.equal(patch.total,146.18);assert.equal(patch.deposit,146.18);assert.equal(patch.balance,0);assert.equal(patch.customer_id,'online-crystocraft-o07');assert.equal(patch.order_no,'999991');assert.equal(patch.bal_pay_date,'2026-10-03')
 assert.equal(f.calls.find(c=>c.kind==='si').args[0].currency,currency)
 assert.equal(patch.remarks,currency==='HKD'?'Fictional Woo buyer':`Fictional Woo buyer — Gateway fee: ${currency} 1.22 · Net payout: HKD 1140.12 · Payout 2026-10-03`)
 const originalNotes=f.order.notes
 await click([...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save Changes'))
 assert.equal(f.order.woo_net_payout_hkd,1140.123456);assert.equal(f.order.woo_net_payout,144.96);assert.equal(f.order.total_amount,146.18);assert.equal(f.order.notes,originalNotes);assert.equal(f.order.currency,currency);assert.equal(f.order.deposit_paid,null)
 assert.equal(f.accountingWrites[0].total,146.18);assert.equal(f.accountingWrites[0].currency,currency);assert.equal(f.accountingWrites[0].remarks,originalNotes)
 await act(async()=>root.unmount());root=createRoot(host);await render();assert.equal(input('Invoice No').value,'SI-WOO')
 assert.equal(f.calls.filter(c=>c.kind==='si').length,1);assert.equal(f.calls.filter(c=>c.kind==='registry').length,1);assert.equal(normOrder(f.order).woo_net_payout_hkd,1140.123456)
})
for(const total of [undefined,null,'','invalid'])test(`missing Woo total never overwrites registry amounts with a guessed zero (${String(total)})`,async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel:'woocommerce',total_amount:total});f.actions.si=async()=>({si_no:'SI-ISSUED',uc_no:'UC-ISSUED',uc_id:'qa-registry'})
 await render();await click(allocation('Invoice No'))
 assert.equal(f.calls.filter(c=>c.kind==='registry').length,0);assert.equal(f.calls.filter(c=>c.kind==='si').length,1);assert.equal(f.orderWrites.length,1);assert.equal(input('Invoice No').value,'SI-ISSUED');assert.equal(allocation('Invoice No'),null)
 assert.ok(panel().textContent.includes('WooCommerce order total is missing; registry amounts were not overwritten.'))
})
test('known zero Woo total/payout stay zero and three-decimal amounts are not rounded or recalculated',async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel:'woocommerce',total_amount:0,woo_fee:0,woo_net_payout:90,woo_net_payout_hkd:0});f.actions.si=async()=>({si_no:'SI-ZERO',uc_no:'UC-ZERO',uc_id:'qa-registry'});await render();await click(allocation('Invoice No'))
 const p=f.calls.find(c=>c.kind==='registry').args[1];assert.equal(p.total,0);assert.equal(p.deposit,0);assert.equal(p.balance,0);assert.ok(p.remarks.includes('Net payout: HKD 0.00'))
 // A fresh saved record verifies the exact stored checkout amount is used,
 // rather than deriving a different paid amount from the editable line table.
 await act(async()=>root.unmount());f.order=order();Object.assign(f.order,{channel:'woocommerce',total_amount:1.222,woo_net_payout_hkd:12.34567});f.calls=[];root=createRoot(host);await render();await click(allocation('Invoice No'))
 assert.equal(f.calls.find(c=>c.kind==='registry').args[1].total,1.222);assert.equal(f.calls.find(c=>c.kind==='registry').args[1].deposit,1.222)
})
test('legacy Woo payout absence keeps the manual fallback without using a transaction-currency net',async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel:'woocommerce',total_amount:146.18,woo_fee:1.22,woo_net_payout:144.96,woo_payout_date:'2026-10-03'});f.actions.si=async()=>({si_no:'SI-LEGACY',uc_no:'UC-LEGACY',uc_id:'qa-registry'})
 await render();await click(allocation('Invoice No'));const p=f.calls.find(c=>c.kind==='registry').args[1]
 assert.equal(p.total,146.18);assert.ok(p.remarks.includes('Net payout: HKD amount — fill in manually'));assert.ok(!p.remarks.includes('HKD 144.96'));assert.equal(f.order.woo_net_payout_hkd,undefined)
})
for(const channel of ['wholesale','amazon',null])test(`${String(channel)} allocation retains its manual UC metadata policy`,async()=>{
 f.allowWrite=true;Object.assign(f.order,{channel,total_amount:146.18,woo_net_payout_hkd:1140.12});f.actions.si=async()=>({si_no:'SI-MANUAL',uc_no:'UC-MANUAL',uc_id:'qa-registry'})
 await render();await click(allocation('Invoice No'));assert.equal(f.calls.filter(c=>c.kind==='registry').length,0);assert.equal(f.calls.filter(c=>c.kind==='si').length,1);assert.equal(f.orderWrites.length,1)
})

const submit=()=>host.querySelector('button[type="submit"]')
const formError=()=>host.querySelector('#shipment-form-error')
const accountingInput=()=>[...host.querySelectorAll('span')].find(s=>s.textContent==='Accounting Total')?.parentElement.querySelector('input')
const savedInvoice=(overrides={})=>{
 Object.assign(f.order,{erp_si_no:'SI-EXISTING',total_amount:100,accounting_total:100,adjustment_reason:'',deposit_paid:null,...overrides})
 f.lines=[{id:'qa-line',line_no:1,item_code:'QA-ITEM',description:'Fictional item',qty_ordered:1,unit:'pcs',unit_price:100,line_type:'ad_hoc'}]
 f.allowWrite=true;f.allowAccounting=true
}
for(const channel of ['wholesale','woocommerce'])test(`${channel}: matching edited line/accounting totals save without a fictitious adjustment`,async()=>{
 savedInvoice({channel});await render();await fill(host.querySelector('input[placeholder="Unit price"]'),'200');await fill(accountingInput(),'200')
 assert.equal(host.querySelector('input[placeholder="Reason for the adjustment (required)"]'),null)
 await click(submit());assert.equal(f.orderWrites.length,1);assert.equal(f.orderWrites[0].data.total_amount,200);assert.equal(f.orderWrites[0].data.accounting_total,200)
 assert.equal(f.orderWrites[0].data.adjustment,null);assert.equal(f.orderWrites[0].data.adjustment_reason,'');assert.equal(f.accountingWrites[0].total,200);assert.equal(f.accountingWrites[0].accounting_total,200)
 assert.equal(f.destination,'/shipments');assert.deepEqual(f.calls,[])
})
test('quantity and discount edits use the current total while retaining stored line precision and deposit',async()=>{
 savedInvoice({currency:'EUR',total_amount:2.44,accounting_total:2.44,deposit_paid:1.22});f.lines[0].qty_ordered=2;f.lines[0].unit_price=1.222
 await render();await fill(host.querySelector('input[placeholder="Qty"]'),'3')
 const discount=[...host.querySelectorAll('input[placeholder="0.00"]')].find(i=>!i.id)
 await fill(discount,'1');await fill(accountingInput(),'2.67');await click(submit())
 assert.equal(f.orderWrites.length,1);const p=f.orderWrites[0].data;assert.equal(p.total_amount,2.67);assert.equal(p.accounting_total,2.67);assert.equal(p.discount_amount,1);assert.equal(p.deposit_paid,1.22);assert.equal(p.currency,'EUR');assert.equal(p.notes,'Keep original notes')
 assert.equal(f.lineWrites[0].qty_ordered,3);assert.equal(f.lineWrites[0].unit_price,1.222);assert.deepEqual(f.calls,[])
})
test('genuine accounting adjustment blocks all writes visibly until its reason is supplied',async()=>{
 savedInvoice();await render();await fill(host.querySelector('input[placeholder="Unit price"]'),'200');await fill(accountingInput(),'210');await click(submit())
 assert.deepEqual(f.orderWrites,[]);assert.deepEqual(f.lineWrites,[]);assert.deepEqual(f.accountingWrites,[]);assert.equal(f.destination,undefined)
 assert.match(formError()?.textContent||'',/Accounting total differs.*reason is required/);assert.equal(formError().getAttribute('role'),'alert');assert.equal(submit().disabled,false)
 assert.equal(accountingInput().value,'210');assert.equal(host.querySelector('input[placeholder="Unit price"]').value,'200')
 await fill(host.querySelector('input[placeholder="Reason for the adjustment (required)"]'),'  Agreed handling adjustment  ');await click(submit())
 assert.equal(f.orderWrites.length,1);assert.equal(f.orderWrites[0].data.total_amount,200);assert.equal(f.orderWrites[0].data.accounting_total,210);assert.equal(f.orderWrites[0].data.adjustment,10);assert.equal(f.orderWrites[0].data.adjustment_reason,'Agreed handling adjustment');assert.equal(f.accountingWrites[0].accounting_total,210);assert.deepEqual(f.calls,[])
})
test('stored-record audit validation still compares the persisted totals and requires a real adjustment reason',()=>{
 const stored={...order(),erp_si_no:'SI-EXISTING',deposit_paid:null,total_amount:100,accounting_total:110,adjustment_reason:''}
 assert.ok(validateOrder(stored).errors.some(e=>e.code==='order.invoice.adjustment_reason_required'))
 assert.equal(validateOrder({...stored,adjustment_reason:'Agreed adjustment'}).ok,true)
})
test('an edited invoice still rejects excessive deposits before any writes',async()=>{
 savedInvoice();await render();await fill(host.querySelector('input[placeholder="Unit price"]'),'200');await fill(accountingInput(),'200');await fill(host.querySelector('#deposit-paid'),'201')
 // Dispatch submit to exercise the shared guard even when native max validation
 // would already prevent an ordinary click from submitting this amount.
 await act(async()=>Simulate.submit(host.querySelector('form')))
 assert.match(formError()?.textContent||'',/Deposit paid cannot exceed the invoice total/);assert.deepEqual(f.orderWrites,[]);assert.deepEqual(f.lineWrites,[]);assert.deepEqual(f.accountingWrites,[]);assert.deepEqual(f.calls,[])
 assert.equal(host.querySelector('#deposit-paid').value,'201');assert.equal(accountingInput().value,'200')
})
test('rejected edit save shows its error beside the actions, retains edits and permits an explicit retry',async()=>{
 savedInvoice();f.writeError=Error('Fictional save failure');await render();await fill(input('Customer PO'),'Edited PO kept');await click(submit())
 assert.match(formError()?.textContent||'',/Fictional save failure/);assert.equal(formError().getAttribute('role'),'alert');assert.equal(formError().nextElementSibling.contains(submit()),true)
 assert.equal(submit().disabled,false);assert.equal(input('Customer PO').value,'Edited PO kept');assert.equal(accountingInput().value,'100');assert.equal(f.destination,undefined);assert.deepEqual(f.accountingWrites,[]);assert.deepEqual(f.calls,[])
 f.writeError=null;await click(submit());assert.equal(f.orderWrites.length,2);assert.equal(f.orderWrites[1].data.customer_po,'Edited PO kept');assert.equal(f.accountingWrites.length,1);assert.equal(f.destination,'/shipments');assert.equal(formError(),null)
})
const prepareNew=async mode=>{
 f.id=undefined;f.search=mode==='direct'?'direct=1':mode==='quote'?'from_quote=qa-quote':''
 if(mode==='quote'){
  f.quote={quote_type:'built',customer_id:'qa-customer',client_name:'Fictional quote buyer',quote_currency:'USD',quote_no:'QA-QUOTE'}
  f.quoteItems=[{is_custom:true,product_name:'Fictional quoted item',tiers:[{quantity:1,price:100}]}]
 }
 await render()
 if(mode!=='quote'){await click([...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Add line'));await fill(host.querySelector('input[placeholder="Qty"]'),'1');await fill(host.querySelector('input[placeholder="Unit price"]'),'100')}
 await fill(input('Customer PO'),'Unsaved PO kept')
}
for(const mode of ['import','direct','quote']){
 test(`${mode}: rejected create shows an adjacent error and preserves unsaved values without allocating`,async()=>{
  f.createError=Error('Fictional create rejection');await prepareNew(mode);await click(submit())
  assert.equal(f.createAttempts,1);assert.match(formError()?.textContent||'',/Could not create the order: Fictional create rejection/);assert.equal(formError().getAttribute('role'),'alert');assert.equal(formError().nextElementSibling.contains(submit()),true)
  assert.equal(submit().disabled,false);assert.equal(input('Customer PO').value,'Unsaved PO kept');assert.equal(host.querySelector('input[placeholder="Qty"]').value,'1');assert.equal(host.querySelector('input[placeholder="Unit price"]').value,'100')
  assert.equal(f.destination,undefined);assert.deepEqual(f.calls,[]);assert.deepEqual(f.orderWrites,[]);assert.deepEqual(f.lineWrites,[]);assert.deepEqual(f.accountingWrites,[])
 })
 test(`${mode}: validation failures show beside submit before any create or number allocation`,async()=>{
  await prepareNew(mode);await fill(host.querySelector('#deposit-paid'),'101');await act(async()=>Simulate.submit(host.querySelector('form')))
  assert.match(formError()?.textContent||'',/Deposit paid cannot exceed the invoice total/);assert.equal(submit().disabled,false);assert.equal(f.createAttempts,0);assert.equal(f.destination,undefined);assert.deepEqual(f.calls,[]);assert.deepEqual(f.orderWrites,[]);assert.deepEqual(f.lineWrites,[])
 })
}

const schedule = () => [...host.querySelectorAll('h2')]
  .find(heading => heading.textContent === 'Schedule & Terms').parentElement
const scheduleField = label => [...schedule().querySelectorAll('label')]
  .find(el => el.textContent === label)?.parentElement.querySelector('input, select')

test('new schedule uses defaults, allows custom terms and reveals invoice date only with an invoice number', async () => {
  f.id = undefined
  await render()
  for (const [label, expected] of [
    ['Order Date', ''], ['Est. Ship Date', ''], ['Currency', 'USD'],
    ['Incoterm', 'FOB'], ['Payment Terms', ''],
  ]) assert.equal(scheduleField(label).value, expected)
  assert.equal(scheduleField('Status'), undefined)
  assert.equal(scheduleField('Invoice Date'), undefined)
  assert.ok([...scheduleField('Payment Terms').list.options].some(option => option.value === 'Net 30 Days'))

  await fill(scheduleField('Payment Terms'), 'Net 45 days · agreed separately')
  await fill(input('Invoice No'), 'SI-MANUAL')
  assert.equal(scheduleField('Invoice Date').value, '')
  assert.equal(scheduleField('Payment Terms').value, 'Net 45 days · agreed separately')
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.orderWrites, [])
})

test('edited schedule fields persist through the actual save and reopen path', async () => {
  Object.assign(f.order, {
    erp_si_no: 'SI-EXISTING', invoiced_at: '2026-10-20',
    order_date: '2026-10-18', est_ship_date: '2026-11-03', deposit_paid: null,
  })
  f.allowWrite = true
  f.allowAccounting = true
  await render()
  assert.equal(scheduleField('Order Date').value, '2026-10-18')
  assert.equal(scheduleField('Est. Ship Date').value, '2026-11-03')
  assert.equal(scheduleField('Invoice Date').value, '')
  assert.equal(scheduleField('Invoice Date').placeholder, '2026-10-20')

  const edits = [
    ['Order Date', 'order_date', '2026-10-19'],
    ['Est. Ship Date', 'est_ship_date', '2026-11-08'],
    ['Invoice Date', 'invoice_date', '2026-10-22'],
    ['Currency', 'currency', 'CAD'],
    ['Incoterm', 'incoterm', 'DAP'],
    ['Payment Terms', 'payment_terms', 'Net 45 days · agreed separately'],
    ['Status', 'status', 'packing'],
  ]
  for (const [label, , value] of edits) await fill(scheduleField(label), value)
  assert.deepEqual(f.orderWrites, [])
  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.equal(f.accountingWrites.length, 1)
  for (const [, field, value] of edits) assert.equal(f.orderWrites[0].data[field], value)
  assert.equal(f.accountingWrites[0].invoice_date, '2026-10-22')
  assert.equal(f.orderWrites[0].data.invoiced_at, '2026-10-20')
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  for (const [label, , value] of edits) assert.equal(scheduleField(label).value, value)
  assert.deepEqual(f.calls, [])
})

test('stock snapshots drive the existing shipping warning and cancel or accept status changes', async () => {
  const originalConfirm = window.confirm
  const prompts = []
  let accepted = false
  window.confirm = message => {
    prompts.push(message)
    return accepted
  }
  try {
    await render()
    await act(async () => f.stockSnapshot({ data: () => ({ metal_reserved: true }) }))
    assert.match(schedule().textContent, /Stock: partly recorded/)
    await fill(scheduleField('Status'), 'shipped')
    assert.equal(scheduleField('Status').value, 'draft')
    assert.equal(prompts.length, 1)
    assert.match(prompts[0], /reserved but never consumed/)
    assert.match(prompts[0], /Mark it shipped anyway/)

    accepted = true
    await fill(scheduleField('Status'), 'delivered')
    assert.equal(scheduleField('Status').value, 'delivered')
    assert.equal(prompts.length, 2)
    await fill(scheduleField('Status'), 'shipped')
    assert.equal(prompts.length, 2)

    await act(async () => f.stockSnapshot({ data: () => ({ metal_committed: true }) }))
    assert.match(schedule().textContent, /Stock: recorded/)
    await fill(scheduleField('Status'), 'ready')
    await fill(scheduleField('Status'), 'shipped')
    assert.equal(scheduleField('Status').value, 'shipped')
    assert.equal(prompts.length, 2)
    assert.deepEqual(f.orderWrites, [])
    assert.deepEqual(f.lineWrites, [])
    assert.deepEqual(f.calls, [])
  } finally {
    window.confirm = originalConfirm
  }
})
