import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import ExcelJS from 'exceljs'
import {quoteItemToOrderLine} from '../src/rangeQuote.js'
const require=createRequire(import.meta.url),rootDir=fileURLToPath(new URL('../',import.meta.url))
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://invoice.test'})
for(const k of ['window','document','HTMLElement','MouseEvent'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
let scratch,pages,downloaded,printed=0
const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
const units=['pcs','set','pair','box','kg','g','m']
const fixture={order:{customer_id:'qa-customer',customer_name:'QA invoice units',erp_so_no:'SO-QA',erp_si_no:'SI-QA',uc_no:'UC-QA',currency:'HKD',order_date:'2026-10-15',discount_amount:10},lines:[
 ...units.map((unit,i)=>({id:`line${i}`,line_no:i+1,item_code:`QA-${i}`,description:`Unit ${unit}`,qty_ordered:i===4?1.25:80+i,unit,unit_price:10,line_type:'ad_hoc',supplier_name:'PRIVATE-SUPPLIER',unit_cost_hkd:999})),
 {id:'legacy',line_no:8,item_code:'LEGACY',description:'Legacy default',qty_ordered:25,unit_price:2},
 {id:'freight',line_no:9,item_code:'FREIGHT',description:'Freight',qty_ordered:null,unit_price:30,line_type:'charge'},
]}
globalThis.__invoiceFixture=fixture
const stubs={
 firebase:'export const db={}',
 firestore:`const f=()=>globalThis.__invoiceFixture;export const doc=(...a)=>a;export const collection=(...a)=>a;export const query=(...a)=>a;export const orderBy=()=>{};
 export const getDoc=async p=>({id:'qa-order',exists:()=>p.includes('orders'),data:()=>f().order});export const getDocs=async()=>({docs:f().lines.map(l=>({id:l.id,data:()=>l}))});
 const fail=()=>{throw Error('Forbidden database write')};export {fail as addDoc,fail as updateDoc,fail as deleteDoc,fail as onSnapshot,fail as serverTimestamp,fail as writeBatch,fail as runTransaction};`,
 customer:'export const loadCustomers=async()=>[];export const primaryContact=()=>null;export const contactAddress=()=>""',
 bankAccounts:'export const listBankAccounts=async()=>[];export const accountForCurrency=()=>null;export const formatBankDetails=()=>""',
 criticalComponents:'export const buildProductIndex=()=>({});export const matchProductCode=()=>null',
 customerOrderHistoryApi:'export const myInvoiceDetail=async code=>({header:{code:"ERP-QA",currency:"USD"},lines:[{item_code:"ERP",description:"Historical unit unavailable",qty:code==="RETURN"?-5:5,unit_price:2,amount:code==="RETURN"?-10:10}]})',
 router:'export const useParams=()=>globalThis.__invoiceParams',
}
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-invoice-units-'))
 await build({stdin:{contents:`export {default as pi} from './src/pages/ProformaInvoicePrint.jsx';export {default as sales} from './src/pages/SalesInvoicePrint.jsx';export {default as customer} from './src/customer/CustomerInvoicePrint.jsx';export {LINE_TYPES,lineTypeOf,isPackable} from './src/shipping.js'`,resolveDir:rootDir},outfile:join(scratch,'pages.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'invoice-network-boundaries',setup(b){
  b.onResolve({filter:/^(react(?:\/.*)?|exceljs|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
  b.onResolve({filter:/react-router-dom/},()=>({path:'router',namespace:'mock'}))
  b.onResolve({filter:/firebase\/firestore/},()=>({path:'firestore',namespace:'mock'}))
  b.onResolve({filter:/^\.\.?\//},a=>{const n=basename(a.path).replace(/\.jsx?$/,'');if(n in stubs)return{path:n,namespace:'mock'}})
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:stubs[a.path],loader:'js'}))
  b.onResolve({filter:/\.png$/},()=>({path:'logo',namespace:'asset'}))
  b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default ""',loader:'js'}))
 }}]})
 pages=await import(pathToFileURL(join(scratch,'pages.mjs')))
 URL.createObjectURL=blob=>{downloaded=blob;return'blob:invoice-test'};URL.revokeObjectURL=()=>{}
 dom.window.HTMLAnchorElement.prototype.click=function(){}
 dom.window.print=()=>{printed++}
})
after(async()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;delete globalThis.__invoiceFixture;dom.window.close();await rm(scratch,{recursive:true,force:true})})
async function withPage(kind,fn,{customer='qa-customer',key='app-qa-order'}={}){
 globalThis.__invoiceParams={id:'qa-order',key};downloaded=null
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(React.createElement(pages[kind],{profile:{customer_id:customer,company_name:'QA fixture'}})))
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  await fn(host)
 }finally{await act(async()=>root.unmount());host.remove()}
}
async function workbook(host){
 const button=[...host.querySelectorAll('button')].find(x=>x.textContent==='Download Excel');assert.ok(button)
 await act(async()=>{button.click();for(let i=0;i<100&&!downloaded;i++)await new Promise(r=>setTimeout(r,10))})
 assert.ok(downloaded);const bytes=Buffer.from(await downloaded.arrayBuffer());const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);return{ws:w.getWorksheet('Invoice'),bytes}
}
for(const kind of ['pi','sales','customer']){
 test(`${kind}: real print/PDF table shows all saved units and legacy pcs; charges stay blank`,async()=>withPage(kind,async host=>{
  const rows=[...host.querySelectorAll('table.'+(kind==='pi'?'pi':'si')+'-lines tbody tr')]
  assert.equal(rows.length,9)
  for(const[i,unit]of units.entries())assert.match(rows[i].children[3].textContent,new RegExp(` ${unit}$`))
  assert.match(rows[7].children[3].textContent,/25 pcs/);assert.equal(rows[8].children[3].textContent,'')
  assert.equal(rows[8].children[5].textContent,'30.00')
  const button=[...host.querySelectorAll('button')].find(x=>x.textContent==='Print / Save as PDF');const before=printed;button.click();assert.equal(printed,before+1)
  if(process.env.INVOICE_EVIDENCE_DIR)await writeFile(join(process.env.INVOICE_EVIDENCE_DIR,`${kind}-units.html`),`<!doctype html><meta charset="utf-8">${host.innerHTML}`)
 }))
 test(`${kind}: actual Excel download retains units, numeric values and charge semantics`,async()=>withPage(kind,async host=>{
  const {ws,bytes}=await workbook(host)
  assert.equal(ws.getCell('D6').value,'Unit')
  assert.doesNotMatch(JSON.stringify(ws.model),/PRIVATE-SUPPLIER|unit_cost_hkd/)
  for(const[i,unit]of units.entries()){
   assert.equal(ws.getCell('D'+(7+i)).value,unit);assert.equal(ws.getCell('C'+(7+i)).value,i===4?1.25:80+i)
   assert.equal(ws.getCell('E'+(7+i)).value,10)
  }
  assert.equal(ws.getCell('D14').value,'pcs');assert.equal(ws.getCell('C15').value,null);assert.equal(ws.getCell('D15').value,'');assert.equal(ws.getCell('F15').value,30)
  const totalRow=ws.getRows(1,ws.rowCount).find(r=>r.getCell(5).value==='Total')
  assert.equal(totalRow.getCell(6).value,5052.5)
  if(process.env.INVOICE_EVIDENCE_DIR)await writeFile(join(process.env.INVOICE_EVIDENCE_DIR,`${kind}-units.xlsx`),bytes)
 }))
}
test('quote conversion preserves selected units into order lines',()=>{
 for(const unit of units)assert.equal(quoteItemToOrderLine({product_unit:unit,tiers:[{quantity:80,price:10}]},0).unit,unit)
})
test('customer cannot export another customer invoice',async()=>withPage('customer',async host=>{assert.match(host.textContent,/Invoice not found/);assert.equal(host.querySelectorAll('button').length,0)},{customer:'other-customer'}))
test('legacy ERP invoices without unit evidence remain unspecified rather than inventing pcs',async()=>withPage('customer',async host=>{
 const {ws}=await workbook(host);assert.equal(ws.getCell('C7').value,5);assert.equal(ws.getCell('D7').value,'')
},{key:'erp-ERP-QA'}))

for(const priced of [true,false])test(`PI CSV keeps units with prices=${priced}`,async()=>withPage('pi',async host=>{
 const label=priced?'Export CSV':'Export CSV — no prices'
 const button=[...host.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(button);button.click()
 const csv=await downloaded.text();assert.match(csv, /"Unit"/)
 for(const unit of units)assert.ok(csv.includes(`"${unit}"`),unit)
 assert.equal(csv.includes('Unit Price'),priced)
}))
test('sales Excel preserves the displayed accounting adjustment and amount payable',async()=>{
 fixture.order.adjustment=0.5;fixture.order.accounting_total=5053
 try{await withPage('sales',async host=>{
  const {ws}=await workbook(host)
  const rows=ws.getRows(1,ws.rowCount)
  assert.equal(rows.find(r=>r.getCell(5).value==='Adjustment').getCell(6).value,0.5)
  assert.equal(rows.find(r=>r.getCell(5).value==='Amount Payable').getCell(6).value,5053)
 })}finally{delete fixture.order.adjustment;delete fixture.order.accounting_total}
})

test('historical negative quantities and amounts remain visible and numeric',async()=>withPage('customer',async host=>{
 const row=host.querySelector('table.si-lines tbody tr');assert.equal(row.children[3].textContent,'-5')
 const {ws}=await workbook(host);assert.equal(ws.getCell('C7').value,-5);assert.equal(ws.getCell('F7').value,-10)
},{key:'erp-RETURN'}))

const tierNote='1 pair 2 glasses in a gift box\n獨立禮盒及紙套'
for(const kind of ['pi','sales','customer'])test(`${kind}: quote tier remark survives normalization into PDF and Excel beside the correct amount`,async()=>{
 const original=fixture.lines
 const converted=quoteItemToOrderLine({product_name:'Gift glasses',product_unit:'pair',remarks:'PRODUCT NOTE',tiers:[{quantity:10,price:800,remarks:tierNote},{quantity:20,price:630,remarks:'ALTERNATIVE TIER'}]},0)
 fixture.lines=[{id:'converted',...converted,supplier_name:'PRIVATE-SUPPLIER',unit_cost_hkd:999},
  {id:'blank',line_no:2,description:'Blank remark',qty_ordered:5,unit:'set',unit_price:2,tier_remarks:'  '}]
 try{await withPage(kind,async host=>{
  const rows=host.querySelectorAll('tbody tr');assert.equal(rows[0].querySelector('.tier-remarks').textContent,tierNote)
  assert.match(rows[0].textContent,/10 pair/);assert.match(rows[0].textContent,/8,000.00/)
  assert.equal(rows[1].querySelector('.tier-remarks'),null)
  assert.doesNotMatch(host.textContent,/ALTERNATIVE TIER|PRODUCT NOTE|PRIVATE-SUPPLIER/)
  const {ws,bytes}=await workbook(host);assert.equal(ws.getCell('G6').value,'Tier remarks');assert.equal(ws.getCell('G7').value,tierNote)
  assert.equal(ws.getCell('G7').alignment.wrapText,true);assert.equal(ws.getCell('G8').value,'')
  assert.equal(ws.getCell('C7').value,10);assert.equal(ws.getCell('D7').value,'pair');assert.equal(ws.getCell('E7').value,800);assert.equal(ws.getCell('F7').value,8000)
  assert.doesNotMatch(JSON.stringify(ws.model),/ALTERNATIVE TIER|PRODUCT NOTE|PRIVATE-SUPPLIER|unit_cost_hkd/)
  if(process.env.INVOICE_EVIDENCE_DIR){await writeFile(join(process.env.INVOICE_EVIDENCE_DIR,`${kind}-tier-remarks.xlsx`),bytes);await writeFile(join(process.env.INVOICE_EVIDENCE_DIR,`${kind}-tier-remarks.html`),`<!doctype html><meta charset="utf-8">${host.innerHTML}`)}
 })}finally{fixture.lines=original}
})
test('quote conversion copies only the chosen first tier remark, never other tiers or product remarks',()=>{
 for(const item of [{is_custom:true},{product_id:'corp'},{product_id:'range',product_collection:'range_products'}]){
  assert.equal(quoteItemToOrderLine({...item,remarks:'product note',tiers:[{quantity:1,price:2,remarks:'chosen'},{quantity:4,price:6,remarks:'alternative'}]},0).tier_remarks,'chosen')
  assert.equal(quoteItemToOrderLine({...item,remarks:'product note',tiers:[{quantity:1,price:2}]},0).tier_remarks,'')
 }
})
for(const kind of ['pi','sales'])test(`${kind}: long tier remarks wrap and formula-like text stays literal`,async()=>{
 const original=fixture.lines;const note='=HYPERLINK("https://example.invalid")\n'+('獨立禮盒及紙套 '.repeat(40)).trim()
 fixture.lines=[{id:'long',line_no:1,description:'Long remarks',qty_ordered:2,unit:'pair',unit_price:20,tier_remarks:note}]
 try{await withPage(kind,async host=>{assert.equal(host.querySelector('.tier-remarks').textContent,note);const {ws}=await workbook(host);assert.equal(ws.getCell('G7').value,note);assert.equal(typeof ws.getCell('G7').value,'string');assert.ok(ws.getRow(7).height>180);assert.equal(ws.getCell('F7').value,40)})}finally{fixture.lines=original}
})

for(const kind of ['pi','sales','customer'])test(`${kind}: PDF and Excel exclude legacy catalogue metadata and preserve product text`,async()=>{
 const original=fixture.lines
 fixture.lines=[{id:'range-name',line_no:1,item_code:'D0009-001-C',description:'Crystocraft Range sample',product_category:'Figurine Gifts',catalogue:'Gift Range',line_type:'range',qty_ordered:10,unit:'pair',unit_price:20,tier_remarks:'Original tier remark'}]
 try{await withPage(kind,async host=>{
  assert.match(host.textContent,/Crystocraft Range sample/);assert.doesNotMatch(host.textContent,/Figurine Gifts|Gift Range/)
  const {ws}=await workbook(host)
  assert.equal(ws.getCell('B7').value,'Crystocraft Range sample');assert.equal(ws.getCell('C7').value,10);assert.equal(ws.getCell('D7').value,'pair');assert.equal(ws.getCell('F7').value,200);assert.equal(ws.getCell('G7').value,'Original tier remark')
  assert.doesNotMatch(JSON.stringify(ws.model),/Figurine Gifts|Gift Range/)
 })}finally{fixture.lines=original}
})

test('invoice classification uses Crystocraft Range without changing saved type or packing behavior',()=>{
 assert.equal(pages.lineTypeOf('range').label,'Crystocraft Range')
 assert.equal(pages.lineTypeOf('range').value,'range')
 assert.equal(pages.isPackable('range'),true)
 assert.equal(pages.isPackable('non_product'),false)
})
