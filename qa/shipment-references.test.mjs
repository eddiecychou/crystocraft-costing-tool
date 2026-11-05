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
for(const k of ['window','document','HTMLElement','Event','MouseEvent','FileReader'])globalThis[k]=dom.window[k]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client'),{Simulate}=await import('react-dom/test-utils')
let scratch,Page,normOrder,validateOrder,mapWooOrderToOrder,host,root,f,errors,originalError,originalFetch
const fail=()=>{throw Error('Unexpected service/database action in shipment references fixture')}
const order=()=>({customer_id:'qa-customer',customer_name:'Fictional 客戶 & Co',erp_so_no:'',erp_si_no:'',uc_no:'',erp_pi_no:'',customer_po:'PO-Original',currency:'USD',status:'draft',incoterm:'FOB',payment_terms:'30% deposit',notes:'Keep original notes',deposit_paid:155,discount_amount:0,pi_revision:2})
const stubs={
 firebase:'export const db={},storage={};export const authHeader=async()=>{if(globalThis.__shipmentReferences?.extractPi)return {Authorization:"Bearer fictional-pi-test"};throw Error("No network requests")}',
 firestore:`const f=()=>globalThis.__shipmentReferences;
 export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'new-line'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{};
 export const getDoc=async p=>{if(p.includes('client_quotes')&&f().quote)return{id:p.at(-1),exists:()=>true,data:()=>f().quote};if(!p.includes('orders'))throw Error('Unexpected document read');return{id:p.at(-1),exists:()=>true,data:()=>f().order}};
 export const getDocs=async path=>{
   const data=f();
   if(path.includes('range_products'))return {docs:(data.rangeProducts||[]).map(({id,...product})=>({id,data:()=>product}))};
   if(path.includes('client_quotes')&&data.quote)return {docs:(data.quoteItems||[]).map((item,i)=>({id:'quote-item-'+i,data:()=>item}))};
   if(JSON.stringify(path).includes('"orders"'))return {docs:data.lines.map(line=>({id:line.id,ref:line.id,data:()=>line}))};
   return {docs:[]};
 };
 export const onSnapshot=(path,next)=>{if(!path.includes("orders"))throw Error("Unexpected subscription");f().stockSnapshot=next;return()=>{delete f().stockSnapshot}},serverTimestamp=()=> 'FICTIONAL timestamp',where=()=>{},limit=()=>{};
 export const updateDoc=async(p,data)=>{
   if(p.includes('client_quotes')&&f().allowCreate){f().quoteLinks.push({path:[...p],data:structuredClone(data)});return}
   if(!f().allowWrite)throw Error('Unexpected order write');f().orderWrites.push({path:[...p],data:structuredClone(data)});if(f().writeError)throw f().writeError;f().order={...f().order,...data}
 };
 export const writeBatch=()=>({set(p,data){if(!f().allowWrite)throw Error('Unexpected line write');f().lineWrites.push(structuredClone(data))},delete(){throw Error('No deletes authorized')},commit:async()=>{}});
 export const runTransaction=async(_db,callback)=>{
   if(f().createError){f().createAttempts++;throw f().createError}
   if(!f().allowCreate)throw Error('No creates/transactions authorized');
   f().createAttempts++;
   return callback({
     get:async()=>{throw Error('Unexpected counter/document read in fictional create')},
     set:(path,data)=>f().createdRecords.push({path:[...path],data:structuredClone(data)})
   });
 };
 const fail=()=>{throw Error('No creates/deletes authorized')};export{fail as addDoc,fail as deleteDoc,fail as setDoc,fail as increment};`,
 router:`import React from 'react';const f=()=>globalThis.__shipmentReferences;export const useParams=()=>({id:f().id}),useSearchParams=()=>[new URLSearchParams(f().search)],useNavigate=()=>to=>{f().destination=to};export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children)`,
 customer:`const customers=()=>globalThis.__shipmentReferences.customers||[];
 export const loadCustomers=async()=>customers();
 export const getCustomer=async id=>customers().find(customer=>customer.id===id)||null;
 export const primaryContact=contacts=>contacts?.find(contact=>contact.is_primary)||contacts?.[0]||null;
 export const saveCustomer=async()=>{throw Error("No customer writes")};`,
 ConfirmDialog:'export default ()=>null',LineImagePicker:`import {createElement as h} from 'react';
 export default function Picker({orderId,itemCode,matchedProductRef,selectedUrl,onSelect,onClear,onClose}) {
   const fixture=globalThis.__shipmentReferences;
   return h('div', {
     'data-test-picker':orderId,'data-item-code':itemCode,
     'data-product-id':matchedProductRef?.id,'data-selected-url':selectedUrl
   },
     h('button',{type:'button',onClick:()=>onSelect(fixture.selectedLineImage)},'Choose fictional image'),
     h('button',{type:'button',onClick:onClear},'Clear fictional image'),
     h('button',{type:'button',onClick:onClose},'Close fictional picker')
   );
 }`,PackingListEditor:'export default ()=>null',FreightComparison:'export default ()=>null',OrderStockIssue:'export default ()=>null',OrderInventoryIssue:'export default ()=>null',
 crystals:'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}}',
 packaging:'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}}',
 orderStock:'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}}',
 erpSoImport:`export const fetchErpSoLines=async soNo=>{
   const lookups=globalThis.__shipmentReferences.erpLookups;
   if(!lookups)throw Error("No ERP extraction");
   lookups.push(soNo);
   return null;
 };export const diffLines=()=>null;`,
 soNumber:'import{ocYear}from"./src/ocTime.js";export const soYear=()=>String(ocYear(new Date())%100).padStart(2,"0");export const allocateSoNo=(...a)=>globalThis.__shipmentReferences.invoke("so",a);export const JES_SEED_BY_YEAR={};export const formatSoNo=()=>{throw Error("No order creation authorized")}',
 ucRegistry:'export const allocateOrderUc=(...a)=>globalThis.__shipmentReferences.invoke("uc",a);export const allocateInvoice=(...a)=>globalThis.__shipmentReferences.invoke("si",a);export const updateUcInvoice=(...a)=>globalThis.__shipmentReferences.invoke("registry",a);export const upsertInvoice=async data=>{const f=globalThis.__shipmentReferences;if(!f.allowAccounting)throw Error("No accounting upsert authorized");f.accountingWrites.push(structuredClone(data))}',
 storage:`const f=()=>globalThis.__shipmentReferences;
 export const ref=(_storage,path)=>{if(!f().allowCreate)throw Error('No storage requests');return{path}};
 export const uploadBytes=async(ref,file,metadata)=>{if(!f().allowCreate)throw Error('No uploads');f().uploads.push({path:ref.path,name:file.name,metadata})};
 export const getDownloadURL=async ref=>{if(!f().allowCreate)throw Error('No downloads');return 'https://fictional.invalid/uploaded-pi.pdf'};
 `,
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
 originalFetch=globalThis.fetch
 globalThis.fetch=(path,options)=>path==='/api/extract-pi'&&globalThis.__shipmentReferences?.extractPi
   ? globalThis.__shipmentReferences.extractPi(options)
   : fail()
})
beforeEach(()=>{
 f={id:'qa-order',search:'',order:order(),lines:[{id:'qa-line',line_no:1,item_code:'QA-ITEM',description:'Fictional item',qty_ordered:1000,unit:'pcs',unit_price:1.222,line_type:'ad_hoc'}],calls:[],actions:{so:async()=> 'SO-FICTIONAL',uc:async()=>({full:'UC-FICTIONAL'}),si:async()=>({si_no:'SI-FICTIONAL',uc_no:'UC-FICTIONAL'}),registry:async()=>({})},orderWrites:[],lineWrites:[],accountingWrites:[],createAttempts:0,allowWrite:false,allowAccounting:false,createdRecords:[],quoteLinks:[],uploads:[]}
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

const destinationPanel = () => [...host.querySelectorAll('h2')]
  .find(heading => heading.textContent === 'Destination').parentElement
const destinationInput = label => [...destinationPanel().querySelectorAll('label')]
  .find(el => el.textContent === label).parentElement.querySelector('input')
const remarksInput = () => host.querySelector('textarea[placeholder^="Prints on the Proforma"]')
const hideQty = () => [...host.querySelectorAll('label')]
  .find(label => label.textContent.includes('Hide "Total Qty"')).querySelector('input')

const customerCard = () => [...host.querySelectorAll('h2')]
  .find(heading => heading.textContent === 'Customer').parentElement
const customerSelect = () => customerCard().querySelector('select')
const addressedTo = () => [...customerCard().querySelectorAll('label')]
  .find(label => label.textContent === 'Addressed to')?.parentElement.querySelector('select')

test('switching customer resets the contact, fills destination and keeps the chosen contact after save and reopen', async () => {
  f.customers = [
    { id: 'qa-customer', company_name: 'Original customer', contacts: [{ id: 'old-contact', name: 'Original contact' }] },
    { id: 'qa-new', company_name: 'New customer', country: 'Canada', address: 'New address' },
    {
      id: 'qa-region', company_name: 'Region-only customer', region: 'Australia', erp_code: 'REGION',
      contacts: [
        { id: 'alternate-contact', name: 'Alternate contact' },
        { id: 'primary-contact', name: 'Primary contact', is_primary: true },
      ],
    },
  ]
  f.order.contact_id = 'old-contact'
  f.order.destination = { country: 'Germany', city: 'Hamburg', port: 'HH', address: 'Original address' }
  f.allowWrite = true
  await render()
  assert.equal(addressedTo().value, 'old-contact')
  await fill(customerSelect(), 'qa-new')
  assert.equal(addressedTo().value, '')
  assert.equal(addressedTo().querySelector('[value="old-contact"]'), null)
  assert.equal(destinationInput('Dest. Country').value, 'Canada')
  assert.equal(destinationInput('Dest. City').value, 'Hamburg')
  assert.equal(destinationInput('Port (optional)').value, 'HH')
  await fill(customerSelect(), 'qa-region')
  assert.equal(addressedTo().value, 'primary-contact')
  assert.equal(destinationInput('Dest. Country').value, 'Australia')
  assert.equal(customerSelect().selectedOptions[0].textContent, '[REGION] Region-only customer')
  await fill(addressedTo(), 'alternate-contact')
  assert.deepEqual(f.orderWrites, [])
  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.equal(f.orderWrites[0].data.customer_id, 'qa-region')
  assert.equal(f.orderWrites[0].data.customer_name, 'Region-only customer')
  assert.equal(f.orderWrites[0].data.contact_id, 'alternate-contact')
  assert.deepEqual(f.orderWrites[0].data.destination, {
    country: 'Australia', city: 'Hamburg', port: 'HH', address: 'New address',
  })

  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(customerSelect().value, 'qa-region')
  assert.equal(addressedTo().value, 'alternate-contact')
  assert.equal(destinationInput('Dest. Country').value, 'Australia')
})

test('unmatched PI customer keeps its displayed name and hides the add prompt after linking', async () => {
  f.order.customer_id = ''
  f.order.customer_name = 'Fictional imported 客戶'
  f.customers = [{ id: 'qa-existing', company_name: 'Existing fictional customer' }]
  await render()
  assert.equal(customerSelect().value, '')
  assert.equal(addressedTo(), undefined)
  assert.match(customerCard().textContent, /From PI: "Fictional imported 客戶" — not linked to any customer/)
  const addCustomerButton = customerCard().querySelector('button')
  assert.equal(addCustomerButton.textContent, '+ Add as new customer')
  assert.equal(addCustomerButton.type, 'button')
  assert.equal(addCustomerButton.disabled, false)

  await fill(customerSelect(), 'qa-existing')
  assert.doesNotMatch(customerCard().textContent, /From PI:|Add as new customer/)
  assert.ok(addressedTo())
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

test('destination edits and multiline remarks save and reopen with the print quantity preference', async () => {
  f.order.destination = { country: 'Germany', city: 'Hamburg', port: 'HH', address: 'Retain this address' }
  f.allowWrite = true
  await render()
  assert.equal(destinationInput('Dest. Country').value, 'Germany')
  assert.equal(destinationInput('Dest. City').value, 'Hamburg')
  assert.equal(destinationInput('Port (optional)').value, 'HH')
  assert.equal(remarksInput().value, 'Keep original notes')
  assert.equal(hideQty().checked, false)

  const notes = 'Fictional delivery instructions\n第二行 & reference'
  await fill(destinationInput('Dest. Country'), '日本')
  await fill(destinationInput('Dest. City'), '東京')
  await fill(destinationInput('Port (optional)'), '')
  await fill(remarksInput(), notes)
  await click(hideQty())
  assert.equal(hideQty().checked, true)
  assert.deepEqual(f.orderWrites, [])
  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.deepEqual(f.orderWrites[0].data.destination, {
    country: '日本', city: '東京', port: '', address: 'Retain this address',
  })
  assert.equal(f.orderWrites[0].data.notes, notes)
  assert.equal(f.orderWrites[0].data.hide_total_qty, true)

  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(destinationInput('Dest. Country').value, '日本')
  assert.equal(destinationInput('Dest. City').value, '東京')
  assert.equal(destinationInput('Port (optional)').value, '')
  assert.equal(remarksInput().value, notes)
  assert.equal(hideQty().checked, true)
  await click(hideQty())
  await click(submit())
  assert.equal(f.orderWrites.length, 2)
  assert.equal(f.orderWrites[1].data.hide_total_qty, false)
  assert.deepEqual(f.calls, [])
})

const reconciliation = () => [...host.querySelectorAll('h2')]
  .find(heading => heading.textContent === 'Line items & reconciliation').parentElement.parentElement
const reconciliationButton = (label, root = reconciliation()) => [...root.querySelectorAll('button')]
  .find(button => button.textContent.trim() === label)
const itemCodeInputs = () => [...reconciliation().querySelectorAll('input[placeholder="Item code"]')]
const lineCard = index => itemCodeInputs()[index].closest('.rounded-none.border')
const classificationWarning = () => reconciliation().querySelector('.border-amber-200.mb-3')?.textContent

test('blank form adds its first line from the header and updates the warning through classification and removal', async () => {
  f.id = undefined
  await render()
  assert.match(reconciliation().textContent, /No lines yet/)
  assert.equal(classificationWarning(), undefined)
  assert.equal(reconciliationButton('+ Add line').type, 'button')
  await click(reconciliationButton('+ Add line'))
  assert.equal(itemCodeInputs().length, 1)
  assert.equal(itemCodeInputs()[0].value, '')
  assert.match(classificationWarning(), /1 line still need a type/)
  await click(reconciliationButton('+ Add line'))
  assert.equal(itemCodeInputs().length, 2)
  assert.match(classificationWarning(), /2 lines still need a type/)
  await click(reconciliationButton('Ad-hoc', lineCard(0)))
  assert.match(classificationWarning(), /1 line still need a type/)
  const trash = lineCard(1).querySelector('svg.lucide-trash-2').closest('button')
  await click(trash)
  assert.equal(itemCodeInputs().length, 1)
  assert.equal(classificationWarning(), undefined)
  assert.equal(f.createAttempts, 0)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

test('Re-match resolves a real product match while preserving a manually classified line', async () => {
  f.rangeProducts = [{ id: 'range-match', design_code: 'D0001', format_code: '001', description: 'Fictional matching design' }]
  f.lines = [
    { ...f.lines[0], item_code: 'D0001-001-C', description: 'Manual line wording', line_type: 'ad_hoc', match_status: 'manual' },
    { ...f.lines[0], id: 'auto-line', line_no: 2, item_code: 'D0001-001-C', description: '', line_type: null, match_status: 'unmatched' },
  ]
  f.allowWrite = true
  await render()
  assert.match(classificationWarning(), /1 line still need a type/)
  const rematch = reconciliationButton('Re-match')
  assert.equal(rematch.type, 'button')
  assert.match(rematch.title, /keeps lines you classified manually/)
  await click(rematch)
  assert.equal(classificationWarning(), undefined)
  assert.equal(lineCard(0).querySelector('textarea[placeholder="Description"]').value, 'Manual line wording')
  assert.doesNotMatch(lineCard(0).textContent, /Fictional matching design/)
  assert.equal(lineCard(1).querySelector('textarea[placeholder="Description"]').value, 'Fictional matching design')
  assert.match(lineCard(1).textContent, /Fictional matching design/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.lineWrites, [])

  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.equal(f.lineWrites.length, 2)
  assert.equal(f.lineWrites[0].line_type, 'ad_hoc')
  assert.equal(f.lineWrites[0].match_status, 'manual')
  assert.equal(f.lineWrites[0].matched_product_ref, null)
  assert.equal(f.lineWrites[1].line_type, 'range')
  assert.equal(f.lineWrites[1].match_status, 'matched')
  assert.equal(f.lineWrites[1].matched_product_ref.id, 'range-match')
  assert.deepEqual(f.calls, [])
})

test('line editor updates only the targeted row, preserving multiline copy and unit cost precision', async () => {
  f.lines.push({ ...f.lines[0], id: 'second-line', line_no: 2, item_code: 'SECOND', qty_ordered: 1 })
  f.allowWrite = true
  await render()
  const original = lineCard(0)
  const edited = lineCard(1)
  const edits = [
    ['Item code', 'SECOND-EDITED'],
    ['Description', 'Fictional custom item\n第二行'],
    ['Tier remarks (customer-facing)', 'Tier A\nTier B'],
    ['Qty', '25'],
    ['pcs', 'set'],
    ['Unit price', '4.567'],
  ]
  for (const [placeholder, value] of edits) {
    await fill(edited.querySelector(`[placeholder="${placeholder}"]`), value)
  }
  assert.equal(original.querySelector('[placeholder="Item code"]').value, 'QA-ITEM')
  assert.equal(original.querySelector('[placeholder="Unit price"]').value, '1.222')
  assert.equal(edited.querySelector('[placeholder="Tier remarks (customer-facing)"]').getAttribute('aria-label'), 'Tier remarks for line 2')
  assert.deepEqual(f.lineWrites, [])
  await click(submit())
  assert.equal(f.lineWrites.length, 2)
  assert.equal(f.lineWrites[0].line_no, 1)
  assert.equal(f.lineWrites[0].unit_price, 1.222)
  assert.equal(f.lineWrites[1].line_no, 2)
  assert.equal(f.lineWrites[1].item_code, 'SECOND-EDITED')
  assert.equal(f.lineWrites[1].description, 'Fictional custom item\n第二行')
  assert.equal(f.lineWrites[1].tier_remarks, 'Tier A\nTier B')
  assert.equal(f.lineWrites[1].qty_ordered, 25)
  assert.equal(f.lineWrites[1].unit, 'set')
  assert.equal(f.lineWrites[1].unit_price, 4.567)
  assert.deepEqual(f.calls, [])

  f.lines = f.lineWrites.map((line, index) => ({ ...line, id: f.lines[index].id }))
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(lineCard(0).querySelector('[placeholder="Item code"]').value, 'QA-ITEM')
  assert.equal(lineCard(0).querySelector('[placeholder="Unit price"]').value, '1.222')
  for (const [placeholder, value] of edits) {
    assert.equal(lineCard(1).querySelector(`[placeholder="${placeholder}"]`).value, value)
  }
})

test('parent image picker targets the selected row and preserves charge packing and image behavior', async () => {
  const firstImage = 'https://fictional.invalid/first.png'
  const secondImage = 'https://fictional.invalid/second.png'
  f.selectedLineImage = 'https://fictional.invalid/selected.png'
  f.lines[0].line_image = firstImage
  f.lines.push(
    {
      ...f.lines[0], id: 'image-line', line_no: 2, item_code: 'FIGURE-2', line_type: 'range',
      line_image: secondImage, matched_product_ref: { collection: 'range_products', id: 'range-2', name: 'Fictional product' },
    },
    { ...f.lines[0], id: 'charge-line', line_no: 3, item_code: 'CHARGE-3', line_type: 'non_product', line_image: null },
  )
  f.allowWrite = true
  await render()
  const rowImageButton = row => lineCard(row).querySelector('button[title*="invoice image"], button[title^="Add an image"]')
  const picker = () => host.querySelector('[data-test-picker]')
  const pickerButton = label => [...picker().querySelectorAll('button')].find(button => button.textContent === label)
  const rowImage = row => lineCard(row).querySelector('img')?.getAttribute('src')

  assert.equal(rowImageButton(2), null)
  assert.match(lineCard(2).textContent, /excluded from packing/)
  await click(rowImageButton(1))
  assert.equal(picker().dataset.testPicker, f.id)
  assert.equal(picker().dataset.itemCode, 'FIGURE-2')
  assert.equal(picker().dataset.productId, 'range-2')
  assert.equal(picker().dataset.selectedUrl, secondImage)
  await click(pickerButton('Close fictional picker'))
  assert.equal(picker(), null)
  assert.equal(rowImage(1), secondImage)

  await click(rowImageButton(1))
  await click(pickerButton('Choose fictional image'))
  assert.equal(picker(), null)
  assert.equal(rowImage(0), firstImage)
  assert.equal(rowImage(1), f.selectedLineImage)
  await click(rowImageButton(1))
  assert.equal(picker().dataset.selectedUrl, f.selectedLineImage)
  await click(pickerButton('Clear fictional image'))
  assert.equal(rowImage(1), undefined)
  assert.equal(rowImage(0), firstImage)
  assert.deepEqual(f.lineWrites, [])

  await click(submit())
  assert.equal(f.lineWrites.length, 3)
  assert.equal(f.lineWrites[0].line_image, firstImage)
  assert.equal(f.lineWrites[1].line_image, null)
  assert.equal(f.lineWrites[1].matched_product_ref.id, 'range-2')
  assert.equal(f.lineWrites[2].line_type, 'non_product')
  assert.equal(f.lineWrites[2].packable, false)
  assert.deepEqual(f.calls, [])
})

const totalsRows = () => [...host.querySelectorAll('h2')]
  .find(heading => heading.textContent === 'Order Totals').nextElementSibling
const totalRow = label => [...totalsRows().children]
  .find(row => row.textContent.trim().startsWith(label))

test('order total rows preserve PI comparison and charge placement as prices and discounts change', async () => {
  Object.assign(f.order, { currency: 'CAD', pi_subtotal: 100.01, pi_total: 115.01, deposit_paid: null })
  f.lines = [
    { ...f.lines[0], qty_ordered: 4, unit_price: 25 },
    { ...f.lines[0], id: 'freight', line_no: 2, qty_ordered: null, unit_price: 15, line_type: 'non_product' },
  ]
  await render()

  const subtotal = totalRow('Computed subtotal')
  const comparison = totalRow('PI stated subtotal')
  const charges = totalRow('Charges')
  const discount = totalRow('Discount')
  const total = totalRow('Total Amount')
  assert.equal(subtotal.nextElementSibling, comparison)
  assert.equal(comparison.nextElementSibling, charges)
  assert.equal(charges.nextElementSibling, discount)
  assert.equal(discount.nextElementSibling, total)
  assert.match(subtotal.textContent, /CAD 100\.00/)
  assert.match(comparison.textContent, /✓ match/)
  assert.match(comparison.textContent, /CAD 100\.01/)
  assert.match(charges.textContent, /\+ CAD 15\.00/)
  assert.match(total.textContent, /CAD 115\.00/)
  assert.doesNotMatch(total.textContent, /PI states/)

  await fill(lineCard(0).querySelector('[placeholder="Unit price"]'), '30')
  await fill(discount.querySelector('[placeholder="0"]'), '10')
  assert.equal(discount.querySelector('[placeholder="0.00"]').value, '10')
  assert.match(totalRow('Computed subtotal').textContent, /CAD 120\.00/)
  assert.match(totalRow('PI stated subtotal').textContent, /⚠ mismatch/)
  assert.match(totalRow('Total Amount').textContent, /CAD 125\.00/)
  assert.match(totalRow('Total Amount').textContent, /PI states CAD 115\.01/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.lineWrites, [])
  assert.deepEqual(f.calls, [])
})

test('order total rows omit unstated PI comparisons and nonpositive charges', async () => {
  f.lines = [
    { ...f.lines[0], qty_ordered: 2, unit_price: 10 },
    { ...f.lines[0], id: 'credit', line_no: 2, qty_ordered: null, unit_price: -5, line_type: 'non_product' },
  ]
  await render()
  assert.match(totalRow('Computed subtotal').textContent, /USD 20\.00/)
  assert.equal(totalRow('PI stated subtotal'), undefined)
  assert.equal(totalRow('Charges'), undefined)
  assert.match(totalRow('Total Amount').textContent, /USD 15\.00/)
  assert.doesNotMatch(totalRow('Total Amount').textContent, /PI states/)
  assert.equal(totalRow('Computed subtotal').nextElementSibling, totalRow('Discount'))
  assert.equal(totalRow('Discount').nextElementSibling, totalRow('Total Amount'))
  assert.deepEqual(f.orderWrites, [])
})

const discountPercentInput = () => totalRow('Discount').querySelector('[placeholder="0"]')
const discountAmountInput = () => totalRow('Discount').querySelector('[placeholder="0.00"]')

test('discount uses the PI subtotal in both directions and keeps both fields after save and reopen', async () => {
  Object.assign(f.order, { pi_subtotal: 80, deposit_paid: null })
  f.lines[0].qty_ordered = 4
  f.lines[0].unit_price = 25
  f.allowWrite = true
  await render()

  await fill(discountPercentInput(), '12.5')
  assert.equal(discountAmountInput().value, '10')
  assert.match(totalRow('Total Amount').textContent, /USD 90\.00/)
  await fill(discountAmountInput(), '17.77')
  assert.equal(discountPercentInput().value, '22.21')
  assert.match(totalRow('Total Amount').textContent, /USD 82\.23/)
  assert.deepEqual(f.orderWrites, [])

  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  const persisted = f.orderWrites[0].data
  assert.equal(persisted.pi_subtotal, 80)
  assert.equal(persisted.subtotal, 100)
  assert.equal(persisted.discount_pct, 22.21)
  assert.equal(persisted.discount_amount, 17.77)
  assert.equal(persisted.total_amount, 82.23)
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(discountPercentInput().value, '22.21')
  assert.equal(discountAmountInput().value, '17.77')
  assert.match(totalRow('Total Amount').textContent, /USD 82\.23/)
  assert.deepEqual(f.calls, [])
})

test('discount falls back to the computed subtotal when PI is zero, preserves explicit zero and clears both fields', async () => {
  Object.assign(f.order, { pi_subtotal: 0, deposit_paid: null })
  f.lines[0].qty_ordered = 4
  f.lines[0].unit_price = 30
  await render()

  await fill(discountPercentInput(), '12.5')
  assert.equal(discountAmountInput().value, '15')
  await fill(discountAmountInput(), '')
  assert.equal(discountPercentInput().value, '')
  assert.equal(discountAmountInput().value, '')
  assert.match(totalRow('Total Amount').textContent, /USD 120\.00/)

  await fill(discountAmountInput(), '18')
  assert.equal(discountPercentInput().value, '15')
  await fill(discountPercentInput(), '0')
  assert.equal(discountPercentInput().value, '0')
  assert.equal(discountAmountInput().value, '0')
  assert.match(totalRow('Total Amount').textContent, /USD 120\.00/)
  await fill(discountAmountInput(), '18')
  await fill(discountAmountInput(), '0')
  assert.equal(discountPercentInput().value, '0')
  assert.equal(discountAmountInput().value, '0')
  await fill(discountAmountInput(), '18')
  await fill(discountPercentInput(), '')
  assert.equal(discountPercentInput().value, '')
  assert.equal(discountAmountInput().value, '')
  assert.match(totalRow('Total Amount').textContent, /USD 120\.00/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.lineWrites, [])
})

test('an amount discount on a charge-only order leaves the percentage blank', async () => {
  Object.assign(f.order, { pi_subtotal: null, deposit_paid: null })
  f.lines[0].line_type = 'non_product'
  f.lines[0].qty_ordered = null
  f.lines[0].unit_price = 15
  await render()

  await fill(discountAmountInput(), '2')
  assert.equal(discountAmountInput().value, '2')
  assert.equal(discountPercentInput().value, '')
  assert.match(totalRow('Charges').textContent, /\+ USD 15\.00/)
  assert.match(totalRow('Total Amount').textContent, /USD 13\.00/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

const outstandingRow = () => [...totalsRows().querySelectorAll('span')]
  .find(span => span.textContent === 'Total outstanding').parentElement

test('accounting total appears with an invoice number and saves the current calculated total when left blank', async () => {
  savedInvoice({ erp_si_no: '', accounting_total: null, deposit_paid: 25 })
  await render()
  assert.equal(accountingInput(), undefined)
  assert.match(outstandingRow().textContent, /USD 75\.00/)

  await fill(input('Invoice No'), 'SI-QA-MANUAL')
  assert.equal(accountingInput().value, '')
  assert.equal(accountingInput().placeholder, '100.00')
  assert.equal(host.querySelector('[placeholder="Reason for the adjustment (required)"]'), null)
  await fill(lineCard(0).querySelector('[placeholder="Unit price"]'), '125')
  assert.equal(accountingInput().value, '')
  assert.equal(accountingInput().placeholder, '125.00')
  assert.match(outstandingRow().textContent, /USD 100\.00/)
  assert.deepEqual(f.orderWrites, [])

  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.equal(f.accountingWrites.length, 1)
  assert.equal(f.orderWrites[0].data.total_amount, 125)
  assert.equal(f.orderWrites[0].data.accounting_total, 125)
  assert.equal(f.orderWrites[0].data.adjustment, null)
  assert.equal(f.accountingWrites[0].total, 125)
  assert.equal(f.accountingWrites[0].accounting_total, 125)
  assert.deepEqual(f.calls, [])

  f.lines = f.lineWrites.map((line, index) => ({ ...line, id: f.lines[index].id }))
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(accountingInput().value, '125')
  assert.match(outstandingRow().textContent, /USD 100\.00/)
  assert.equal(host.querySelector('[placeholder="Reason for the adjustment (required)"]'), null)
})

test('negative accounting adjustment needs a reason and drives the balance due after save and reopen', async () => {
  savedInvoice({ deposit_paid: 25 })
  await render()
  await fill(accountingInput(), '88')
  assert.match(totalsRows().textContent, /AdjustmentUSD -12\.00/)
  assert.match(totalRow('Total Amount').textContent, /USD 100\.00/)
  assert.match(outstandingRow().textContent, /USD 63\.00/)
  assert.equal(host.querySelector('#deposit-paid').max, '88')

  const reason = () => host.querySelector('[placeholder="Reason for the adjustment (required)"]')
  await fill(reason(), '   ')
  await click(submit())
  assert.match(formError()?.textContent || '', /Accounting total differs.*reason is required/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.lineWrites, [])
  assert.deepEqual(f.accountingWrites, [])

  await fill(reason(), 'Agreed invoice adjustment')
  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.equal(f.accountingWrites.length, 1)
  assert.equal(f.orderWrites[0].data.total_amount, 100)
  assert.equal(f.orderWrites[0].data.accounting_total, 88)
  assert.equal(f.orderWrites[0].data.adjustment, -12)
  assert.equal(f.orderWrites[0].data.adjustment_reason, 'Agreed invoice adjustment')
  assert.equal(f.orderWrites[0].data.deposit_paid, 25)
  assert.equal(f.accountingWrites[0].total, 100)
  assert.equal(f.accountingWrites[0].accounting_total, 88)
  assert.deepEqual(f.calls, [])

  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.equal(accountingInput().value, '88')
  assert.equal(reason().value, 'Agreed invoice adjustment')
  assert.match(outstandingRow().textContent, /USD 63\.00/)

  await fill(accountingInput(), '')
  assert.equal(reason(), null)
  assert.match(outstandingRow().textContent, /USD 75\.00/)
})

test('deposit validation and its accessible description follow a changed invoice limit and recover after correction', async () => {
  savedInvoice()
  await render()
  const deposit = () => host.querySelector('#deposit-paid')
  const error = () => host.querySelector('#deposit-paid-error')
  assert.equal(deposit().labels[0].textContent, 'Deposit paid')
  assert.equal(deposit().max, '100')

  await fill(deposit(), '100')
  assert.match(outstandingRow().textContent, /USD 0\.00/)
  assert.equal(deposit().getAttribute('aria-invalid'), 'false')
  assert.equal(deposit().getAttribute('aria-describedby'), null)

  await fill(accountingInput(), '80')
  assert.equal(deposit().value, '100')
  assert.equal(deposit().max, '80')
  assert.equal(deposit().getAttribute('aria-invalid'), 'true')
  assert.equal(deposit().getAttribute('aria-describedby'), error().id)
  assert.equal(error().getAttribute('role'), 'alert')
  assert.match(error().textContent, /cannot exceed the invoice total/)
  assert.doesNotMatch(totalsRows().textContent, /Total outstanding/)

  await fill(deposit(), '80')
  assert.equal(error(), null)
  assert.equal(deposit().getAttribute('aria-invalid'), 'false')
  assert.equal(deposit().getAttribute('aria-describedby'), null)
  assert.match(outstandingRow().textContent, /USD 0\.00/)
  await fill(deposit(), '0')
  assert.equal(deposit().value, '0')
  assert.doesNotMatch(totalsRows().textContent, /Total outstanding/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.lineWrites, [])
  assert.deepEqual(f.accountingWrites, [])
})

const piUploadInput = () => host.querySelector('input[type="file"][accept="image/*,.pdf"]')
const piDropzone = () => piUploadInput().closest('label')
const piUploadCard = () => piDropzone().parentElement
const extractionProgress = () => piUploadCard().querySelector('.animate-pulse')

test('PI upload is limited to import mode', async () => {
  await render()
  assert.equal(piUploadInput(), null)
  f.id = undefined
  f.search = 'direct=1'
  await render()
  assert.equal(piUploadInput(), null)
  f.search = 'from_quote=qa-quote'
  f.quote = { quote_type: 'built', customer_id: 'qa-customer', client_name: 'Fictional quote buyer', quote_currency: 'USD' }
  await render()
  assert.equal(piUploadInput(), null)
  f.search = ''
  await render()
  assert.ok(piUploadInput())
  assert.match(piDropzone().textContent, /PDF, JPG, PNG/)
})

test('PI PDF selection shows its filename and progress, then populates the form from the response', { timeout: 4000 }, async () => {
  f.id = undefined
  const request = deferred()
  const response = deferred()
  f.extractPi = options => {
    request.resolve(options)
    return response.promise
  }
  await render()
  const fileBytes = Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x00])])
  const file = new dom.window.File([fileBytes], 'Fictional 訂單.pdf', { type: 'application/pdf' })
  const picker = piUploadInput()
  Object.defineProperty(picker, 'files', { value: [file] })
  await act(async () => Simulate.change(picker))
  assert.match(piUploadCard().textContent, /Fictional 訂單\.pdf/)
  assert.ok(extractionProgress())
  const options = await request.promise
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer fictional-pi-test')
  assert.deepEqual(JSON.parse(options.body), {
    image: fileBytes.toString('base64'), mimeType: 'application/pdf',
  })

  await act(async () => response.resolve({
    ok: true,
    json: async () => ({
      customer_name: 'Fictional imported PI customer', pi_no: 'UC-QA-PI',
      currency: 'EUR', lines: [{ item_code: 'PI-LINE', description: 'Fictional parsed line', qty_ordered: 2, unit_price: 15 }],
    }),
  }))
  assert.equal(extractionProgress(), null)
  assert.match(piUploadCard().textContent, /Fictional 訂單\.pdf/)
  assert.equal(input('UC#').value, 'UC-QA-PI')
  assert.equal(itemCodeInputs()[0].value, 'PI-LINE')
  assert.match(customerCard().textContent, /Fictional imported PI customer/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

test('PI drag and drop skips unsupported files, sends an image as PNG and displays extraction failure', { timeout: 4000 }, async () => {
  f.id = undefined
  const ignoredFile = new dom.window.File(['unsupported'], 'Ignored.csv', { type: 'text/csv' })
  const imageFile = new dom.window.File(['fictional image'], 'Fictional PI.jpg', { type: 'image/jpeg' })
  const request = deferred()
  const response = deferred()
  f.extractPi = options => {
    request.resolve(options)
    return response.promise
  }
  const originalBitmap = globalThis.createImageBitmap
  const originalCanvas = globalThis.OffscreenCanvas
  const pngText = 'fictional PNG'
  let decoded
  globalThis.createImageBitmap = async file => {
    decoded = file
    return { width: 1, height: 1 }
  }
  globalThis.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
        putImageData() {},
      }
    }
    async convertToBlob({ type }) { return new dom.window.Blob([pngText], { type }) }
  }
  try {
    await render()
    await act(async () => Simulate.dragOver(piDropzone()))
    assert.match(piDropzone().textContent, /Drop to import/)
    await act(async () => Simulate.dragLeave(piDropzone()))
    assert.match(piDropzone().textContent, /Click to upload/)
    await act(async () => Simulate.drop(piDropzone(), { dataTransfer: { files: [ignoredFile] } }))
    assert.equal(extractionProgress(), null)
    assert.doesNotMatch(piUploadCard().textContent, /Ignored\.csv/)

    await act(async () => Simulate.dragOver(piDropzone()))
    await act(async () => Simulate.drop(piDropzone(), { dataTransfer: { files: [ignoredFile, imageFile] } }))
    assert.match(piDropzone().textContent, /Click to upload/)
    assert.match(piUploadCard().textContent, /Fictional PI\.jpg/)
    assert.ok(extractionProgress())
    const options = await request.promise
    assert.equal(decoded, imageFile)
    assert.deepEqual(JSON.parse(options.body), { image: Buffer.from(pngText).toString('base64'), mimeType: 'image/png' })
    await act(async () => response.resolve({ ok: false }))
    assert.equal(extractionProgress(), null)
    assert.match(piUploadCard().textContent, /Could not read this PI/)
    assert.equal(itemCodeInputs().length, 0)
    assert.deepEqual(f.orderWrites, [])
    assert.deepEqual(f.calls, [])
  } finally {
    if (originalBitmap) globalThis.createImageBitmap = originalBitmap
    else delete globalThis.createImageBitmap
    if (originalCanvas) globalThis.OffscreenCanvas = originalCanvas
    else delete globalThis.OffscreenCanvas
  }
})

test('an image preparation failure stops PI progress before any extraction request', async () => {
  f.id = undefined
  const file = new dom.window.File(['unreadable image'], 'Unreadable PI.jpg', { type: 'image/jpeg' })
  let requests = 0
  f.extractPi = async () => {
    requests++
    return { ok: false }
  }
  const originalBitmap = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => { throw new Error('Fictional image decode failure') }
  try {
    await render()
    await act(async () => Simulate.drop(piDropzone(), { dataTransfer: { files: [file] } }))
    assert.equal(requests, 0)
    assert.equal(extractionProgress(), null)
    assert.match(piUploadCard().textContent, /Unreadable PI\.jpg/)
    assert.match(piUploadCard().textContent, /Could not read this PI/)
    assert.equal(itemCodeInputs().length, 0)
    assert.deepEqual(f.orderWrites, [])
    assert.deepEqual(f.calls, [])
  } finally {
    if (originalBitmap) globalThis.createImageBitmap = originalBitmap
    else delete globalThis.createImageBitmap
  }
})

async function startPiHeaderImport() {
  const request = deferred()
  const response = deferred()
  f.extractPi = () => {
    request.resolve()
    return response.promise
  }
  const picker = piUploadInput()
  const file = new dom.window.File(['%PDF-1.7 fictional'], 'Fictional PI.pdf', { type: 'application/pdf' })
  Object.defineProperty(picker, 'files', { value: [file], configurable: true })
  await act(async () => Simulate.change(picker))
  await request.promise
  return data => act(async () => response.resolve({ ok: true, json: async () => data }))
}

test('PI header matching applies supported values and separates stated amounts from calculated totals', { timeout: 4000 }, async () => {
  f.id = undefined
  f.customers = [{ id: 'pi-customer', company_name: 'Matching Fictional Customer' }]
  f.erpLookups = []
  const parsedLines = [{ item_code: 'FIC-PI-LINE', description: 'Fictional PI item', qty_ordered: 4, unit_price: 25 }]
  await render()

  const finish = await startPiHeaderImport()
  await finish({
    customer_name: 'MATCHING FICTIONAL CUSTOMER (on document)', pi_no: 'UC-FIC', so_no: 'SO-FIC',
    order_date: '2026-10-18', est_ship_date: '2026-11-08',
    currency: 'EUR', incoterm: 'DAP', payment_terms: 'Net 30 Days',
    subtotal: 125, discount_pct: 8, discount_amount: 10, total_amount: 115, lines: parsedLines,
  })
  assert.equal(customerSelect().value, 'pi-customer')
  assert.doesNotMatch(customerCard().textContent, /From PI:/)
  assert.equal(input('UC#').value, 'UC-FIC')
  assert.equal(input('SO / Doc No').value, 'SO-FIC')
  assert.equal(scheduleField('Order Date').value, '2026-10-18')
  assert.equal(scheduleField('Est. Ship Date').value, '2026-11-08')
  assert.equal(scheduleField('Currency').value, 'EUR')
  assert.equal(scheduleField('Incoterm').value, 'DAP')
  assert.equal(scheduleField('Payment Terms').value, 'Net 30 Days')
  assert.equal(discountPercentInput().value, '8')
  assert.equal(discountAmountInput().value, '10')
  assert.match(totalRow('Computed subtotal').textContent, /EUR 100\.00/)
  assert.match(totalRow('PI stated subtotal').textContent, /EUR 125\.00/)
  assert.match(totalRow('Total Amount').textContent, /EUR 90\.00/)
  assert.match(totalRow('Total Amount').textContent, /PI states EUR 115\.00/)

  const finishSecond = await startPiHeaderImport()
  await finishSecond({
    pi_no: '', order_date: '', currency: 'CAD', incoterm: 'UNSUPPORTED', payment_terms: null,
    subtotal: 0, discount_pct: 0, discount_amount: 0, total_amount: 0, lines: parsedLines,
  })
  assert.equal(input('UC#').value, 'UC-FIC')
  assert.equal(input('SO / Doc No').value, 'SO-FIC')
  assert.equal(scheduleField('Order Date').value, '2026-10-18')
  assert.equal(scheduleField('Est. Ship Date').value, '2026-11-08')
  assert.equal(scheduleField('Currency').value, 'EUR')
  assert.equal(scheduleField('Incoterm').value, 'DAP')
  assert.equal(scheduleField('Payment Terms').value, 'Net 30 Days')
  assert.equal(discountPercentInput().value, '0')
  assert.equal(discountAmountInput().value, '0')
  assert.equal(totalRow('PI stated subtotal'), undefined)
  assert.match(totalRow('Total Amount').textContent, /EUR 100\.00/)
  assert.doesNotMatch(totalRow('Total Amount').textContent, /PI states/)
  assert.deepEqual(f.erpLookups, ['SO-FIC'])
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

test('a late PI response retains the customer chosen while extraction is in flight', { timeout: 4000 }, async () => {
  f.id = undefined
  f.customers = [
    { id: 'first-customer', company_name: 'First fictional customer' },
    {
      id: 'current-customer', company_name: 'Selected fictional customer', country: 'Canada',
      contacts: [{ id: 'new-contact', name: 'Selected contact', is_primary: true }],
    },
  ]
  await render()
  await fill(customerSelect(), 'first-customer')
  await fill(scheduleField('Payment Terms'), 'Existing terms')
  const finish = await startPiHeaderImport()
  await fill(customerSelect(), 'current-customer')
  await finish({
    customer_name: 'First fictional customer', payment_terms: '',
    lines: [{ item_code: 'FIC-PI-LINE', qty_ordered: 1, unit_price: 10 }],
  })
  assert.equal(customerSelect().value, 'current-customer')
  assert.equal(addressedTo().value, 'new-contact')
  assert.equal(destinationInput('Dest. Country').value, 'Canada')
  assert.equal(scheduleField('Payment Terms').value, '')
  await fill(customerSelect(), '')
  assert.match(customerCard().textContent, /From PI: "Selected fictional customer"/)
  assert.deepEqual(f.orderWrites, [])
  assert.deepEqual(f.calls, [])
})

test('Woo metadata keeps empty reference fields and omits payout remarks when the gateway fee is absent', async () => {
  f.allowWrite = true
  Object.assign(f.order, {
    channel: 'woocommerce', customer_id: '', customer_po: '', woo_order_no: '',
    total_amount: 123.456, woo_fee: null, woo_net_payout_hkd: 999.99, woo_payout_date: '',
  })
  f.actions.si = async () => ({ si_no: 'SI-WOO-EMPTY', uc_no: 'UC-WOO-EMPTY', uc_id: 'qa-registry' })
  await render()
  await click(allocation('Invoice No'))
  assert.deepEqual(f.calls.find(call => call.kind === 'registry').args, [
    'qa-registry',
    {
      source: 'Online Shop', customer_id: null, order_no: '',
      total: 123.456, deposit: 123.456, balance: 0, bal_pay_date: null, remarks: '',
    },
  ])
  assert.equal(f.orderWrites.length, 1)
  assert.equal(input('Invoice No').value, 'SI-WOO-EMPTY')
})

test('Woo allocation without a registry id skips autofill and missing-total warnings', async () => {
  f.allowWrite = true
  Object.assign(f.order, { channel: 'woocommerce', total_amount: null })
  f.actions.si = async () => ({ si_no: 'SI-WOO-NO-REGISTRY', uc_no: 'UC-WOO-NO-REGISTRY' })
  await render()
  await click(allocation('Invoice No'))
  assert.equal(f.calls.filter(call => call.kind === 'registry').length, 0)
  assert.equal(f.calls.filter(call => call.kind === 'si').length, 1)
  assert.equal(f.orderWrites.length, 1)
  assert.equal(input('Invoice No').value, 'SI-WOO-NO-REGISTRY')
  assert.equal(allocation('Invoice No'), null)
  assert.doesNotMatch(panel().textContent, /could not be auto-filled|total is missing/)
})

test('saved invoice payload preserves explicit financial zeros and applies every blank-field fallback', async () => {
  savedInvoice({
    customer_id: 'qa-customer', contact_id: '', customer_name: 'Fictional payload customer',
    erp_pi_no: '', erp_so_no: '', erp_si_no: 'SI-FULL-PAYLOAD', uc_no: 'UC-FULL-PAYLOAD',
    customer_po: 'PO-EXACT', invoiced_at: '', invoice_date: '', order_date: '', est_ship_date: '',
    accounting_total: 0, adjustment_reason: '  Agreed zero accounting value  ',
    currency: 'USD', incoterm: 'FOB', payment_terms: 'Negotiated exact terms',
    destination: { country: '日本', city: '東京', address: 'Fictional address', port: '' },
    notes: 'Fictional remarks\n第二行', hide_total_qty: false, pi_revision: 0,
    pi_subtotal: 0, pi_total: 0, discount_pct: 0, discount_amount: 0, deposit_paid: 0,
  })
  await render()
  await click(submit())
  assert.equal(f.orderWrites.length, 1)
  assert.deepEqual(f.orderWrites[0].data, {
    customer_id: 'qa-customer', contact_id: null, customer_name: 'Fictional payload customer',
    erp_pi_no: '', erp_so_no: '', erp_si_no: 'SI-FULL-PAYLOAD', uc_no: 'UC-FULL-PAYLOAD',
    customer_po: 'PO-EXACT', invoiced_at: null, invoice_date: null,
    accounting_total: 0, adjustment: -100, adjustment_reason: 'Agreed zero accounting value',
    order_date: null, est_ship_date: null, currency: 'USD', incoterm: 'FOB',
    payment_terms: 'Negotiated exact terms', status: 'draft',
    destination: { country: '日本', city: '東京', address: 'Fictional address', port: '' },
    notes: 'Fictional remarks\n第二行', hide_total_qty: false, pi_revision: null,
    subtotal: 100, total_amount: 100, pi_subtotal: 0, pi_total: 0,
    discount_pct: 0, discount_amount: 0, deposit_paid: 0, updatedAt: 'FICTIONAL timestamp',
  })
  assert.deepEqual(f.accountingWrites, [{
    si_no: 'SI-FULL-PAYLOAD', uc_no: 'UC-FULL-PAYLOAD', order_id: 'qa-order',
    customer: 'Fictional payload customer', currency: 'USD', total: 100,
    invoiced_at: null, invoice_date: null, customer_po: 'PO-EXACT',
    remarks: 'Fictional remarks\n第二行', accounting_total: 0,
    adjustment_reason: 'Agreed zero accounting value', channel: null, external_order_no: '',
  }])
  assert.deepEqual(f.calls, [])
})

for (const piTotal of [null, 0, 55.5]) {
  test('charge-only saved invoice retains its existing PI fallback in the financial index (' + String(piTotal) + ')', async () => {
    savedInvoice({ source: 'manual', pi_total: piTotal, accounting_total: null })
    f.lines = [{
      id: 'flat-charge', line_no: 1, item_code: 'FREIGHT', description: 'Fictional freight',
      qty_ordered: null, unit_price: 10, line_type: 'non_product',
    }]
    await render()
    await click(submit())
    assert.equal(f.orderWrites.length, 1)
    assert.equal(f.orderWrites[0].data.subtotal, null)
    assert.equal(f.orderWrites[0].data.total_amount, null)
    assert.equal(f.accountingWrites.length, 1)
    assert.equal(f.accountingWrites[0].total, piTotal)
    assert.equal(f.accountingWrites[0].accounting_total, piTotal == null ? null : 10)
    assert.deepEqual(f.calls, [])
  })
}

for (const mode of ['manual', 'import', 'direct', 'quote']) {
  test(mode + ' creation preserves source, source file and exact normalized financial fields', { timeout: 4000 }, async () => {
    if (mode === 'import') {
      f.id = undefined
      await render()
      const finish = await startPiHeaderImport()
      await finish({
        customer_name: 'Fictional PI customer', subtotal: 1400, total_amount: 1300,
        discount_pct: 0, discount_amount: 0,
        lines: [{ item_code: 'IMPORT-PRECISION', description: 'Fictional precise item', qty_ordered: 1000, unit_price: 1.222 }],
      })
      await fill(host.querySelector('#deposit-paid'), '0')
      await fill(input('Revision'), '0')
    } else {
      await prepareNew(mode === 'manual' ? 'import' : mode)
      await fill(host.querySelector('[placeholder="Qty"]'), '1000')
      await fill(host.querySelector('[placeholder="Unit price"]'), '1.222')
    }
    // Explicit fictional document refs keep these mapping tests within the
    // create transaction, with no identifier/counter operation.
    if (mode !== 'direct') await fill(input('SO / Doc No'), 'SO-FICTIONAL-EXISTING')
    await fill(input('Invoice No'), 'SI-FICTIONAL-EXISTING')
    f.allowCreate = true
    await click(submit())

    assert.equal(f.createAttempts, 1)
    const created = f.createdRecords.find(record => record.path.flat(Infinity).at(-1) === 'orders').data
    const createdLines = f.createdRecords.filter(record => record.path.flat(Infinity).at(-1) === 'lines')
    assert.equal(created.source, mode === 'import' ? 'imported_pi' : mode === 'direct' ? 'direct_invoice' : 'manual')
    assert.equal(created.subtotal, 1222)
    assert.equal(created.total_amount, 1222)
    assert.equal(created.erp_si_no, 'SI-FICTIONAL-EXISTING')
    assert.equal(created.pi_revision, null)
    assert.equal(createdLines.length, 1)
    assert.equal(createdLines[0].data.qty_ordered, 1000)
    assert.equal(createdLines[0].data.unit_price, 1.222)
    if (mode === 'import') {
      assert.deepEqual(created.source_file, { url: 'https://fictional.invalid/uploaded-pi.pdf', name: 'Fictional PI.pdf' })
      assert.equal(created.pi_subtotal, 1400)
      assert.equal(created.pi_total, 1300)
      assert.equal(created.discount_pct, 0)
      assert.equal(created.discount_amount, 0)
      assert.equal(created.deposit_paid, 0)
      assert.equal(f.uploads.length, 1)
      assert.match(f.uploads[0].path, /^orders\/imports\/\d+_Fictional PI\.pdf$/)
      assert.deepEqual(f.uploads[0].metadata, { contentType: 'application/pdf' })
    } else {
      assert.equal(created.source_file, null)
      assert.equal(created.pi_subtotal, null)
      assert.equal(created.pi_total, null)
      assert.equal(created.discount_pct, null)
      assert.equal(created.discount_amount, null)
      assert.equal(created.deposit_paid, null)
      assert.equal(f.uploads.length, 0)
    }
    assert.equal(f.quoteLinks.length, mode === 'quote' ? 1 : 0)
    if (mode === 'quote') assert.deepEqual(f.quoteLinks[0].data, { converted_order_id: 'new-line' })
    assert.equal(f.destination, '/shipments/new-line')
    assert.deepEqual(f.orderWrites, [])
    assert.deepEqual(f.calls, [])
  })
}

test('manual type switches preserve descriptions, update product references and packing flags through save and reopen', async () => {
  f.rangeProducts = [{ id: 'range-target', design_code: 'D0001', format_code: '001', description: 'Matched catalogue description' }]
  f.lines = [
    { ...f.lines[0], item_code: 'D0001-001-C', description: 'Manual customer description' },
    { ...f.lines[0], id: 'second-line', line_no: 2, item_code: 'D0001-001-C', description: '' },
  ]
  f.allowWrite = true
  await render()
  await click(reconciliationButton('Crystocraft Range', lineCard(0)))
  await click(reconciliationButton('Crystocraft Range', lineCard(1)))
  assert.equal(lineCard(0).querySelector('[placeholder="Description"]').value, 'Manual customer description')
  assert.equal(lineCard(1).querySelector('[placeholder="Description"]').value, 'Matched catalogue description')
  assert.match(lineCard(0).textContent, /Matched catalogue description/)
  await click(reconciliationButton('Charge', lineCard(1)))
  assert.match(lineCard(1).textContent, /excluded from packing/)
  assert.equal(lineCard(1).querySelector('[placeholder="Description"]').value, 'Matched catalogue description')
  assert.equal(lineCard(1).querySelector('span[title]'), null)
  assert.deepEqual(f.lineWrites, [])
  await click(submit())

  assert.equal(f.lineWrites[0].line_type, 'range')
  assert.equal(f.lineWrites[0].match_status, 'manual')
  assert.equal(f.lineWrites[0].matched_product_ref.id, 'range-target')
  assert.equal(f.lineWrites[0].packable, true)
  assert.equal(f.lineWrites[0].description, 'Manual customer description')
  assert.equal(f.lineWrites[1].line_type, 'non_product')
  assert.equal(f.lineWrites[1].match_status, 'manual')
  assert.equal(f.lineWrites[1].matched_product_ref, null)
  assert.equal(f.lineWrites[1].packable, false)
  assert.equal(f.lineWrites[1].description, 'Matched catalogue description')

  f.lines = f.lineWrites.map((line, index) => ({ ...line, id: f.lines[index].id }))
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  assert.match(lineCard(1).textContent, /excluded from packing/)
  await click(reconciliationButton('Corp Gift', lineCard(1)))
  assert.doesNotMatch(lineCard(1).textContent, /excluded from packing/)
  await click(reconciliationButton('Ad-hoc', lineCard(1)))
  assert.equal(lineCard(1).querySelector('[placeholder="Description"]').value, 'Matched catalogue description')
  await click(submit())
  assert.equal(f.lineWrites.at(-1).line_type, 'ad_hoc')
  assert.equal(f.lineWrites.at(-1).match_status, 'manual')
  assert.equal(f.lineWrites.at(-1).matched_product_ref, null)
  assert.equal(f.lineWrites.at(-1).packable, true)
  assert.deepEqual(f.calls, [])
})

test('classifying an unmatched code as Range clears an old reference and retains the manual description', async () => {
  f.lines[0].item_code = 'NO-SUCH-PRODUCT'
  f.lines[0].description = 'Keep this manual description'
  f.lines[0].matched_product_ref = { collection: 'range_products', id: 'old-product', name: 'Old product label' }
  f.allowWrite = true
  await render()
  assert.match(lineCard(0).textContent, /Old product label/)
  await click(reconciliationButton('Crystocraft Range', lineCard(0)))
  assert.doesNotMatch(lineCard(0).textContent, /Old product label/)
  assert.equal(lineCard(0).querySelector('[placeholder="Description"]').value, 'Keep this manual description')
  await click(submit())
  assert.equal(f.lineWrites.length, 1)
  assert.equal(f.lineWrites[0].line_type, 'range')
  assert.equal(f.lineWrites[0].packable, true)
  assert.equal(f.lineWrites[0].matched_product_ref, null)
  assert.equal(f.lineWrites[0].match_status, 'unmatched')
  assert.equal(f.lineWrites[0].description, 'Keep this manual description')
  assert.deepEqual(f.calls, [])
})
