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
import {packingItemUnit,quantityUnitTotals} from '../src/packingUnits.js'
const require=createRequire(import.meta.url),rootDir=fileURLToPath(new URL('../',import.meta.url))
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://packing.test'})
for(const k of ['window','document','HTMLElement','MouseEvent','Event'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const units=['pcs','set','pair','box','kg','g','m']
const lines=units.map((unit,i)=>({id:`l${i}`,item_code:`QA${i}`,code:`QA${i}`,description:`Sample ${unit}`,qty: i===4?1.25:10+i,qty_ordered:20+i,unit,unit_price:2,packable:true,line_type:'corp_gift'}))
const fixture={pl:{id:'pl',order_id:'order',selected:true,pallets:[]},order:{erp_so_no:'SO-QA',customer_po:'CUSTOMER-PO',uc_no:'UC-QA',supplier_name:'PRIVATE-SUPPLIER',unit_cost_hkd:999},
 po:{pu_number:'PU-QA',supplier_name:'QA SUPPLIER',currency:'RMB',lines,adjustments:[{kind:'discount',label:'Discount',amount:5},{kind:'charge',label:'Freight',amount:20}],deposit_pct:30},
 cartons:[{id:'c1',carton_seq:1,carton_count:2,pallet_no:1,length_cm:40,width_cm:30,height_cm:20,gw_kg_standard:10,nw_kg:8,contents:lines.map(l=>({id:l.id,item_code:l.item_code,description:l.description,qty:l.qty,order_line_id:l.id}))}]}
globalThis.__packingFixture=fixture;globalThis.__packingWrites=[]
let scratch,pages,downloaded,prints=0
const origCreate=URL.createObjectURL,origRevoke=URL.revokeObjectURL
const firestore=`const f=()=>globalThis.__packingFixture;const snap=(x)=>({id:x.id||'qa',ref:[],exists:()=>true,data:()=>x});
 export const doc=(...a)=>a;export const collection=(...a)=>a;export const query=(p)=>p;export const orderBy=()=>{};export const where=()=>{};
 export const getDoc=async p=>snap(p.includes('purchase_orders')?f().po:p.includes('packing_lists')?f().pl:f().order);
 export const getDocs=async p=>({docs:(p.includes('contents')?f().cartons.find(c=>p.includes(c.id))?.contents||[]:p.includes('cartons')?f().cartons:p.includes('orders')?f().po.lines:p.includes('packing_lists')?[f().pl]:[]).map(snap)});
 export const addDoc=async()=>({id:'new-carton'});export const updateDoc=async()=>{};export const deleteDoc=async()=>{};export const serverTimestamp=()=>null;
 export const writeBatch=()=>({delete(){},set(ref,value){globalThis.__packingWrites.push(value)},update(){},async commit(){}});`
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-packing-po-'))
 await build({stdin:{contents:`export {default as packing} from './src/pages/PackingListPrint.jsx';export {default as po} from './src/pages/PurchaseOrderPrint.jsx';export {default as editor} from './src/pages/PackingListEditor.jsx';export {saveCartonsWithContents,buildFullCartonPlan,palletisedTotals} from './src/packing.js'`,resolveDir:rootDir},outfile:join(scratch,'pages.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'packing-network',setup(b){
 b.onResolve({filter:/^(react(?:\/.*)?|exceljs|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
 b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'mock'}))
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'mock'}))
 b.onResolve({filter:/^\.\.?\//},a=>{const n=basename(a.path);if(['firebase','i18n'].includes(n))return{path:n,namespace:'mock'}})
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='firestore'?firestore:a.path==='router'?'export const useParams=()=>({id:"po",plId:"pl"})':a.path==='firebase'?'export const db={}':'export const useUiLang=()=>"en"',loader:'js'}))
 }}]})
 pages=await import(pathToFileURL(join(scratch,'pages.mjs')))
 URL.createObjectURL=blob=>{downloaded=blob;return'blob:packing'};URL.revokeObjectURL=()=>{}
 dom.window.HTMLAnchorElement.prototype.click=function(){}
 dom.window.print=()=>{prints++}
})
after(async()=>{URL.createObjectURL=origCreate;URL.revokeObjectURL=origRevoke;dom.window.close();await rm(scratch,{recursive:true,force:true});delete globalThis.__packingFixture;delete globalThis.__packingWrites})
async function withPage(kind,fn){
 downloaded=null;const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(React.createElement(pages[kind],{orderId:'order',orderLines:lines})));await act(async()=>{await new Promise(r=>setTimeout(r,0))});await fn(host)}finally{await act(async()=>root.unmount());host.remove()}
}
async function excel(host,label='Download Excel'){
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label)
 await act(async()=>{button.click();for(let i=0;i<100&&!downloaded;i++)await new Promise(r=>setTimeout(r,10))})
 assert.ok(downloaded);const bytes=Buffer.from(await downloaded.arrayBuffer());const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);return{wb,bytes}
}
async function evidence(kind,host,bytes){if(process.env.PACKING_PO_EVIDENCE_DIR){await writeFile(join(process.env.PACKING_PO_EVIDENCE_DIR,`${kind}-units.html`),`<!doctype html><meta charset="utf-8">${host.innerHTML}`);await writeFile(join(process.env.PACKING_PO_EVIDENCE_DIR,`${kind}-units.xlsx`),bytes)}}
test('packing unit recovery respects explicit snapshots, linked IDs and unambiguous codes',()=>{
 assert.equal(packingItemUnit({unit:'box',order_line_id:'l2'},lines),'box')
 assert.equal(packingItemUnit({order_line_id:'l2'},lines),'pair')
 assert.equal(packingItemUnit({item_code:' qa2 '},lines),'pair')
 assert.equal(packingItemUnit({},[]),'pcs')
 assert.equal(packingItemUnit({item_code:'X'},[{item_code:'X',unit:'set'},{item_code:'X',unit:'pair'}]),'')
})
test('packing PDF table resolves all units for mixed cartons, with units on per-carton and multiplied quantities',async()=>withPage('packing',async host=>{
 for(const[i,u]of units.entries()){const row=[...host.querySelectorAll('tr')].find(r=>r.textContent.includes(`Sample ${u}`));assert.ok(row);assert.equal(row.children[4].textContent,`${lines[i].qty} ${u}`);assert.equal(row.children[7].textContent,`${lines[i].qty*2} ${u}`)}
 assert.match(host.textContent,/Qty\/Ctn/);assert.doesNotMatch(host.textContent,/Pcs\/Ctn/)
 const total=host.querySelector('.total-row').textContent;for(const u of units)assert.ok(total.includes(u))
 assert.equal(prints,0,'Packing now allows choosing Excel without auto-printing')
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Print / Save as PDF');button.click();assert.equal(prints,1)
}))
test('packing Excel keeps numeric quantities, carton multiplier, weight/CBM and excludes supplier costs',async()=>withPage('packing',async host=>{
 const{wb,bytes}=await excel(host),ws=wb.getWorksheet('Packing List')
 for(const[i,u]of units.entries()){assert.equal(ws.getCell(`E${10+i}`).value,lines[i].qty);assert.equal(ws.getCell(`F${10+i}`).value,u);assert.equal(ws.getCell(`H${10+i}`).value,lines[i].qty*2)}
 assert.equal(ws.getCell('J10').value,20);assert.equal(ws.getCell('J11').value,null)
 assert.equal(ws.getCell('M10').value,0.048)
 assert.equal(ws.getCell('B4').value,'CUSTOMER-PO')
 assert.doesNotMatch(JSON.stringify(ws.model),/PRIVATE-SUPPLIER|unit_cost_hkd/)
 await evidence('packing',host,bytes)
}))
test('packing editor displays recovered units and supports selecting a different unit',async()=>withPage('editor',async host=>{
 const selects=[...host.querySelectorAll('select[aria-label="Quantity unit"]')];assert.equal(selects.length,7,host.textContent.slice(0,1500))
 assert.equal(selects[2].value,'pair')
 await act(async()=>{selects[2].value='box';selects[2].dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
 assert.equal(host.querySelectorAll('select[aria-label="Quantity unit"]')[2].value,'box')
}))
test('actual packing save retains recovered and explicit units; auto-packing propagates order units',async()=>{
 globalThis.__packingWrites=[]
 await pages.saveCartonsWithContents('pl',fixture.cartons,lines)
 assert.deepEqual(globalThis.__packingWrites.map(x=>x.unit),units)
 globalThis.__packingWrites=[]
 const explicit=structuredClone(fixture.cartons);explicit[0].contents[2].unit='box'
 await pages.saveCartonsWithContents('pl',explicit,lines);assert.equal(globalThis.__packingWrites[2].unit,'box')
 const plan=pages.buildFullCartonPlan(lines,[]);assert.deepEqual(plan.map(c=>c.contents[0].unit),units)
})
for(const lang of ['en','zh'])test(`purchase order PDF and Excel keep units, adjustments and deposit (${lang})`,async()=>withPage('po',async host=>{
 if(lang==='zh')await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='简体中文').click())
 const rows=[...host.querySelectorAll('.po-lines tbody tr')];for(const[i,u]of units.entries())assert.equal(rows[i].children[3].textContent,`${lines[i].qty} ${u}`)
 const{wb,bytes}=await excel(host,lang==='zh'?'下载 Excel':'Download Excel'),ws=wb.getWorksheet('Purchase Order')
 for(const[i,u]of units.entries()){assert.equal(ws.getCell(`C${12+i}`).value,lines[i].qty);assert.equal(ws.getCell(`D${12+i}`).value,u);assert.equal(ws.getCell(`F${12+i}`).value,lines[i].qty*2)}
 const all=ws.getRows(1,ws.rowCount);const total=lines.reduce((s,l)=>s+l.qty*2,0)+15
 assert.equal(all.find(r=>r.getCell(5).value===(lang==='zh'?'订单总额':'Order Total')).getCell(6).value,total)
 assert.equal(all.find(r=>r.getCell(5).value===(lang==='zh'?'定金':'Deposit')).getCell(6).value,total*.3)
 await evidence(`po-${lang}`,host,bytes)
}))
test('quantity totals keep unlike units separate and preserve decimal quantities',()=>assert.deepEqual(quantityUnitTotals([{qty:2,unit:'pair'},{qty:1.25,unit:'kg'},{qty:3,unit:'pair'}]),[{qty:5,unit:'pair'},{qty:1.25,unit:'kg'}]))

test('ambiguous legacy packing units are visibly unresolved in PDF and Excel',async()=>{
 const item=fixture.cartons[0].contents[2],oldId=item.order_line_id;item.order_line_id='missing'
 fixture.po.lines.push({...lines[2],id:'another',unit:'set'})
 try{await withPage('packing',async host=>{
  const row=[...host.querySelectorAll('tr')].find(r=>r.textContent.includes('Sample pair'));assert.match(row.children[4].textContent,/unit not set/)
  const{wb}=await excel(host);assert.equal(wb.getWorksheet('Packing List').getCell('F12').value,'unit not set')
 })}finally{fixture.po.lines.pop();item.order_line_id=oldId}
})

test('packing Excel preserves palletised weight and volume separately from carton totals',async()=>{
 fixture.pl.pallets=[{pallet_no:1,length_m:1.2,width_m:1,height_m:1}]
 try{await withPage('packing',async host=>{
  const{wb}=await excel(host),ws=wb.getWorksheet('Packing List'),rows=ws.getRows(1,ws.rowCount)
  const value=label=>rows.find(r=>r.getCell(1).value===label).getCell(2).value
  assert.equal(value('Carton GW (kg)'),20);assert.equal(value('Shipping GW (kg)'),28)
  assert.equal(value('Carton CBM'),0.048);assert.equal(value('Shipping CBM'),1.2)
 })}finally{fixture.pl.pallets=[]}
})
