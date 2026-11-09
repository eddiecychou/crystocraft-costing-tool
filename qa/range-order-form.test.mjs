import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const rates = { USD:7.78, EUR:8.6, HKD:1 }
const colors = [{code:'C1',name:'Crystal',swatch:'#eeeeee'},{code:'RO',name:'Rose',swatch:'#eeaabb'},{code:'AB',name:'Crystal AB',swatch:''}]
const variant = overrides => ({brand_code:'D',plating_code:'CP',plating_name:'Chrome',description:'Bohemia crystals, Chrome plated',crystal_colors:['C1','RO'],ws_price_usd:5.25,...overrides})
const product = overrides => ({id:'fictional-swan',design_no:'0026',format_code:'001',description:'Fictional swan 天鵝 & gift',size:'8.2 × 7.3 cm',status:'mto',active:true,moq:100,lead_time_weeks:6,variants:[variant()],...overrides})
let scratch, prepareRangeOrderForm, buildRangeOrderWorkbook, rangeOrderFormBytes, Modal
const dom = new JSDOM('<!doctype html><body></body>',{url:'http://range-order-form.test'})
for(const key of ['window','document','HTMLElement','MouseEvent'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const originalFetch=globalThis.fetch,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
const io=globalThis.__rangeOrderIO={products:[],users:[],colors,fail:false,colorGate:null,pdfCalls:[],download:null,name:'',closes:0,fetchGate:null}

before(async()=>{
  scratch=await mkdtemp(join(tmpdir(),'oc-range-order-form-test-'))
  await build({entryPoints:[fileURLToPath(new URL('../src/rangeOrderForm.js',import.meta.url)),fileURLToPath(new URL('../src/rangeOrderFormExcel.js',import.meta.url)),fileURLToPath(new URL('../src/components/RangeCatalogueExport.jsx',import.meta.url))],outdir:scratch,bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'only-io-boundaries',setup(b){
    b.onResolve({filter:/^(react(?:\/.*)?|exceljs|jszip|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
    b.onResolve({filter:/^(firebase\/firestore|.*\/firebase|@react-pdf\/renderer)$/},a=>({path:a.path,namespace:'io'}))
    b.onLoad({filter:/.*/,namespace:'io'},a=>({contents:a.path==='@react-pdf/renderer'?
      'export const pdf=element=>({toBlob:async()=>{globalThis.__rangeOrderIO.pdfCalls.push(element.props);return new Blob(["fictional-pdf"])} }); export const StyleSheet={create:x=>x}; export const Font={register(){},registerHyphenationCallback(){}}; export const Document="div",Page="div",View="div",Text="span",Image="img";':
      a.path==='firebase/firestore'?`const io=globalThis.__rangeOrderIO;export const collection=(db,name)=>name;export const doc=(db,...parts)=>parts.join('/');export async function getDocs(name){if(io.fail)throw Error('Fictional read failed');return {docs:(name==='users'?io.users:io.products).map(x=>({id:x.id,data:()=>x}))}};export async function getDoc(ref){if(ref.endsWith('crystal_colors')){if(io.colorGate)await io.colorGate;return {exists:()=>true,data:()=>({colors:io.colors})}}return {exists:()=>true,data:()=>({USD:7.78,EUR:8.6,HKD:1})}};export const setDoc=()=>{throw Error('Export must never write')};export const serverTimestamp=()=>{throw Error('Export must never write')};`:'export const db={};',loader:'js'}))
    b.onResolve({filter:/\.(png|jpg|ttf)$/},a=>({path:resolve(a.resolveDir,a.path),namespace:'asset'}))
    b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "fictional-logo"',loader:'js'}))
  }}]})
  const model=await import(pathToFileURL(join(scratch,'rangeOrderForm.js')))
  prepareRangeOrderForm=model.prepareRangeOrderForm
  ;({buildRangeOrderWorkbook,rangeOrderFormBytes}=await import(pathToFileURL(join(scratch,'rangeOrderFormExcel.js'))))
  Modal=(await import(pathToFileURL(join(scratch,'components/RangeCatalogueExport.js')))).default
  globalThis.fetch=async()=>{if(io.fetchGate)await io.fetchGate;throw Error('Offline image unavailable')}
  URL.createObjectURL=blob=>{io.download=blob;return 'blob:range-order-form-test'}
  URL.revokeObjectURL=()=>{}
  dom.window.HTMLAnchorElement.prototype.click=function(){io.name=this.download}
})
after(async()=>{globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;delete globalThis.__rangeOrderIO;dom.window.close();await rm(scratch,{recursive:true,force:true})})
const modelOf=(products=[product()],options={})=>prepareRangeOrderForm(products,{colors,rates,generatedAt:new Date('2026-11-09T09:00:00Z'),...options})
async function reload(model,options){const bytes=await rangeOrderFormBytes(model,options);const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);return {wb,ws:wb.getWorksheet('Price list'),bytes}}

test('customer price uses existing percentage and FX, preserving original prices',()=>{
  const p=product({variants:[variant({ws_price_usd:1.255})]})
  assert.equal(modelOf([p]).rows[0].price,1.26,'Matches displayed currency rounding')
  assert.equal(modelOf([p],{profile:{base_currency:'EUR',ws_discount_pct:130,fx_rate:0.92}}).rows[0].price,1.5)
  assert.equal(modelOf([p],{profile:{base_currency:'HKD',ws_discount_pct:90,fx_rate:7.8}}).rows[0].price,8.8)
  assert.equal(p.variants[0].ws_price_usd,1.255)
  assert.equal(modelOf([product()],{profile:{base_currency:'GBP'}}).rows[0].price,null,'Missing FX is never labelled GBP at USD price')
  for(const price of [undefined,null,'',0,-1,'invalid',0.001])assert.equal(modelOf([product({variants:[variant({ws_price_usd:price})]})]).rows[0].price,null)
})
test('premium options and repeated SKUs remain distinct; exact code keeps leading zeroes and running number',()=>{
  const p=product({variants:[variant({sku:'repeated',running_no:'01'}),variant({sku:'repeated',crystal_colors:['AB'],ws_price_usd:5.8,description:'Premium AB'}),variant({brand_code:'UA',plating_code:'G',crystal_colors:['RO'],ws_price_usd:6})]})
  const model=modelOf([p]);assert.equal(model.rows.length,3)
  assert.equal(model.rows.find(r=>r.price===5.25).skuByColor.RO,'D0026-001-CPRO01')
  assert.deepEqual(model.rows.find(r=>r.price===5.8).colors,['AB'])
  assert.ok(model.rows.some(r=>r.code==='UA0026-001'))
  const overlap=modelOf([product({variants:[variant(),variant({ws_price_usd:7})]})]);assert.ok(overlap.rows.every(r=>r.review))
})
test('customer visibility, concepts, legacy fixed-colour rows and unknown colours are handled',()=>{
  const model=modelOf([product({id:'hidden',active:false}),product({id:'retired',status:'retired'}),product({id:'concept',status:'concept'}),product({id:'legacy',variants:[],finishes:[{finish_code:'G',finish_name:'Gold',crystal_code:'XX',ws_price_usd:7}]})])
  assert.equal(model.productCount,2);assert.equal(model.rows.length,2)
  assert.equal(model.rows.find(r=>r.productId==='concept').price,null)
  assert.deepEqual(model.rows.find(r=>r.productId==='legacy').colors,['XX'])
  assert.equal(model.colors.find(c=>c.code==='XX').name,'XX')
  assert.deepEqual(modelOf([product({variants:[]})]).colors.map(c=>c.name),['As shown'])
})
test('sorts by numeric design and format, grouping U D A H M before UA UB and other series',()=>{
  const brands=['M','H','A','D','U']
  const p=(design,format='001',prefixes=brands)=>product({id:design+format+prefixes.join(''),design_no:design,format_code:format,variants:prefixes.map(brand_code=>variant({brand_code}))})
  const rows=modelOf([p('10'),p('2','033',['U']),p('2'),p('001','001',['UB','UA','B','UC'])]).rows
  assert.deepEqual(rows.map(r=>r.code),['U2-001','D2-001','A2-001','H2-001','M2-001','U2-033','U10-001','D10-001','A10-001','H10-001','M10-001','UA001-001','UB001-001','B001-001','UC001-001'])
  const legacy=modelOf([product({design_no:undefined,design_code:'UB061',variants:[],finishes:[{finish_code:'G',ws_price_usd:3}]})])
  assert.equal(legacy.rows[0].code,'UB061-001','Legacy multi-letter series identity survives')
  const body=modelOf([p('A061','231',['U'])]);assert.equal(body.rows[0].code,'UA061-231')
})
test('price list has seven separate columns, typed prices/date/codes, and no order controls or totals',async()=>{
  const {wb,ws,bytes}=await reload(modelOf())
  assert.deepEqual(wb.worksheets.map(s=>s.name),['Price list','Code guide'])
  assert.deepEqual(ws.getRow(4).values.slice(1),['Photo','Product','Code','Size','Plating','Crystal options available','Unit price (USD)'])
  assert.equal(ws.getCell('B5').value,'Fictional swan 天鵝 & gift');assert.equal(ws.getCell('C5').value,'D0026-001');assert.equal(ws.getCell('D5').value,'8.2 × 7.3 cm')
  assert.equal(ws.getCell('E5').value,'CP — Chrome');assert.equal(ws.getCell('G5').value,5.25);assert.equal(ws.getCell('G5').numFmt,'#,##0.00')
  assert.match(ws.getCell('F5').value,/Bohemia crystals\nC1 — Crystal; RO — Rose/);assert.doesNotMatch(ws.getCell('F5').value,/Chrome plated/)
  assert.equal(ws.getCell('C5').type,ExcelJS.ValueType.String);assert.ok(ws.getCell('G2').value instanceof Date)
  assert.equal(ws.columnCount,7);assert.equal(ws.autoFilter,undefined);assert.equal(ws.views[0].showGridLines,false)
  assert.equal(ws.views[0].xSplit,3);assert.equal(ws.views[0].ySplit,4)
  assert.equal(ws.pageSetup.printTitlesRow,'4:4');assert.equal(ws.pageSetup.fitToWidth,1)
  const zip=await JSZip.loadAsync(bytes)
  for(const part of Object.values(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name))){const xml=await part.async('string');assert.doesNotMatch(xml,/<f[ >]|<dataValidation|<conditionalFormatting|hidden="1"/)}
  assert.doesNotMatch(JSON.stringify(ws.model),/Order form|Qty|Amount|Check quantities|Subtotal|Buyer PO|Buyer notes|Rows to review/)
})
test('code guide explains exact prefixes, format, plating and available colour codes without inventing unknown meanings',async()=>{
  const {wb,ws}=await reload(modelOf([product({variants:[variant({brand_code:'H',crystal_colors:['XX'],running_no:'01'}),variant({brand_code:'UA'})]})]))
  const guide=wb.getWorksheet('Code guide'),text=JSON.stringify(guide.model)
  assert.match(text,/D0002-001-GC1/);assert.match(text,/0002 = design/);assert.match(text,/running number/)
  assert.match(text,/H series/);assert.match(text,/No additional crystal type is inferred/)
  assert.match(text,/Swarovski, crystal body/);assert.match(text,/Freestand Figurine/);assert.match(text,/CP/);assert.match(text,/XX/)
  const format=guide.getColumn(1).values.findIndex(v=>v==='001')
  assert.ok(format>0);assert.equal(guide.getCell(format,1).numFmt,'000');assert.equal(guide.getCell(format,1).type,ExcelJS.ValueType.String)
  assert.match(ws.getCell('C5').value,/Running no. 01/);assert.match(ws.getCell('F5').value,/XX — XX/)
})
test('unpriced and concept options stay enquiry-only; premium and ambiguous options retain their distinctions',async()=>{
  const {ws}=await reload(modelOf([product({variants:[variant({crystal_colors:['AB'],ws_price_usd:null,description:'Premium Crystal AB'}),variant(),variant({ws_price_usd:7})]}),product({id:'concept',design_no:'0027',status:'concept'})]))
  const rows=Array.from({length:ws.rowCount-4},(_,i)=>ws.getRow(i+5).values)
  assert.ok(rows.some(r=>r[7]==='Quotation required'&&String(r[6]).includes('Premium Crystal AB')))
  assert.equal(rows.filter(r=>String(r[6]).includes('Please confirm specification')).length,2)
  assert.ok(rows.some(r=>r[7]==='Quotation required'&&String(r[2]).includes('Concept — enquiry only')))
})
test('price list is independent of stock/order quantities and preserves retired-stock context',async()=>{
  const p=product({status:'stock',stock_finished:999})
  const a=modelOf([p]),b=modelOf([p],{availabilityById:{[p.id]:{qty:0,byPlating:{CP:0}}}})
  assert.deepEqual(a,b);assert.equal(Object.hasOwn(a.rows[0],'stock'),false)
  const {ws}=await reload(a);assert.match(ws.getCell('B5').value,/Retired stock/)
  assert.match(ws.getCell(`A${ws.rowCount}`).value,/no further production/)
})
test('long English/Chinese specifications continue visibly without dropping text or exceeding Excel row height',async()=>{
  const description='Long English product detail. '.repeat(140)+' 天鵝水晶尺寸與禮盒說明'.repeat(70)
  const option='Crystal option with detailed finish. '.repeat(100)
  const {ws}=await reload(modelOf([product({description,variants:[variant({description:option})]})]))
  let b='',c=''
  for(let n=5;n<=ws.rowCount;n++){b+=ws.getCell(`B${n}`).value||'';c+=ws.getCell(`F${n}`).value||'';assert.ok((ws.getRow(n).height??15)<=408)}
  assert.ok(b.includes(description));assert.ok(c.includes(option.trim()));assert.ok(ws.rowCount>6)
  assert.equal(ws.getCell('B5').alignment.wrapText,true)
  for(let n=5;n<ws.rowCount;n++){
    const left=ws.getCell(`B${n}`).value||'',right=ws.getCell(`B${n+1}`).value||''
    assert.ok(!(/[a-z]$/i.test(left)&&/^[a-z]/i.test(right)),'English words are not split between continuation rows')
  }
})
test('photos embed once, preserve portrait/landscape proportions, and tolerate missing images',async()=>{
  const image='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
  const model=modelOf([product({gallery:['fictional-image'],variants:[variant(),variant({ws_price_usd:6})]})])
  const {wb,ws}=await reload(model,{images:new Map([['fictional-image',{data:image,width:180,height:90}]])})
  assert.equal(wb.media.length,1);assert.equal(ws.getImages().length,2)
  assert.equal(ws.getImages()[0].range.ext.width/ws.getImages()[0].range.ext.height,2)
  const missing=await reload(model);assert.equal(missing.ws.getCell('A5').value,null)
})
test('private costs, attachments, BOMs, profiles and notes are absent from all workbook ZIP parts',async()=>{
  const secret='PRIVATE-SUPPLIER-SECRET-92839'
  const p=product({supplier_cost:secret,internal_remarks:secret,bom:[{cost:secret}],attachments:[secret],variants:[variant({supplier:secret,cost:secret})]})
  const profile={name:'Fictional buyer',email:'buyer@example.invalid',base_currency:'USD',admin_notes:secret,password:secret}
  const model=modelOf([p],{profile});assert.doesNotMatch(JSON.stringify(model),new RegExp(secret))
  const {bytes}=await reload(model),zip=await JSZip.loadAsync(bytes)
  for(const part of Object.values(zip.files).filter(f=>!f.dir))assert.ok(!(await part.async('nodebuffer')).includes(Buffer.from(secret)),part.name)
})
test('literal leading equals and Chinese/special product labels stay text; zero-selection refuses export',async()=>{
  const {ws}=await reload(modelOf([product({description:'=literal 天鵝 / & "gift"'})]))
  assert.equal(ws.getCell('B5').type,ExcelJS.ValueType.String);assert.match(ws.getCell('B5').value,/^=literal/)
  await assert.rejects(()=>rangeOrderFormBytes(modelOf([])),/no buyer-visible products/)
})

function resetIO(){Object.assign(io,{products:[product()],users:[],colors,fail:false,colorGate:null,pdfCalls:[],download:null,name:'',closes:0,fetchGate:null})}
async function mount(props={}){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  await act(async()=>{root.render(React.createElement(Modal,{onClose(){io.closes++},...props}));await new Promise(r=>setTimeout(r,5))})
  return {host,dispose:async()=>{await act(async()=>root.unmount());host.remove()}}
}
async function choose(host,label,value){const select=host.querySelector(`select[aria-label="${label}"]`);assert.ok(select,label);await act(async()=>{select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text))
async function clickDownload(host,label='Download Excel price list'){
  const b=button(host,label);assert.ok(b);assert.equal(b.disabled,false)
  await act(async()=>{b.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));for(let n=0;n<150&&!io.download;n++)await new Promise(r=>setTimeout(r,10))})
  assert.ok(io.download,'Actual button produced workbook bytes');const wb=new ExcelJS.Workbook();await wb.xlsx.load(await io.download.arrayBuffer());return wb.getWorksheet('Price list')
}
test('real modal exports current filtered IDs, not pagination/full catalogue, and selected customer prices',async()=>{
  resetIO();io.products=[product(),product({id:'other',description:'Not in current filter'}),product({id:'hidden',active:false})]
  io.users=[{id:'buyer',role:'customer',status:'approved',name:'買家 / & Co',base_currency:'EUR',ws_discount_pct:130,fx_rate:0.92},{id:'pending',role:'customer',status:'pending',name:'Pending hidden'}]
  const {host,dispose}=await mount({filteredProductIds:['fictional-swan']})
  try{
    assert.equal(host.querySelectorAll('select').length,3);assert.doesNotMatch(host.textContent,/Pending hidden/)
    await choose(host,'File format','xlsx');await choose(host,'Trade account','buyer');const ws=await clickDownload(host)
    assert.match(ws.getCell('B5').value,/Fictional swan/);assert.doesNotMatch(JSON.stringify(ws.model),/Not in current filter/)
    assert.equal(ws.getCell('G5').value,6.28);assert.equal(ws.getCell('G4').value,'Unit price (EUR)');assert.equal(io.closes,1)
    assert.match(io.name,/Crystocraft Range Price List.*買家 - & Co.*\.xlsx$/)
  }finally{await dispose()}
})
test('empty current filter cannot silently export all, but explicit all-visible selection can',async()=>{
  resetIO();const {host,dispose}=await mount({filteredProductIds:[]})
  try{await choose(host,'File format','xlsx');assert.equal(button(host,'Download Excel').disabled,true);await choose(host,'Products to export','all');const ws=await clickDownload(host);assert.match(ws.getCell('B5').value,/Fictional swan/)}finally{await dispose()}
})
test('PDF option preserves its existing price and labelled option generation',async()=>{
  resetIO();io.products=[product({variants:[variant(),variant({crystal_colors:['AB'],ws_price_usd:5.8})]})]
  const {host,dispose}=await mount()
  try{await act(async()=>{button(host,'Build PDF').click();for(let n=0;n<50&&!io.download;n++)await new Promise(r=>setTimeout(r,10))});assert.equal(io.pdfCalls.length,1);const p=io.pdfCalls[0].groups[0].products[0];assert.equal(p.prices.length,2);assert.match(p.prices[0].price,/USD 5.25/);assert.match(p.prices[1].plating,/Crystal AB/);assert.match(io.name,/\.pdf$/)}finally{await dispose()}
})
test('export waits for colour metadata; cancel/unmount cannot download stale work',async()=>{
  resetIO();let release;io.colorGate=new Promise(r=>{release=r})
  const view=await mount();await choose(view.host,'File format','xlsx');assert.equal(button(view.host,'Download Excel').disabled,true)
  await act(async()=>{release();await new Promise(r=>setTimeout(r,5))});assert.equal(button(view.host,'Download Excel').disabled,false)
  await view.dispose()
  resetIO();io.products=[product({gallery:['https://example.invalid/slow.jpg']})];let finish;io.fetchGate=new Promise(r=>{finish=r})
  const {host,dispose}=await mount();await choose(host,'File format','xlsx')
  await act(async()=>{button(host,'Download Excel').click();await new Promise(r=>setTimeout(r,5));button(host,'Cancel').click()})
  await act(async()=>{finish();await new Promise(r=>setTimeout(r,15))});assert.equal(io.download,null);assert.equal(io.closes,1);await dispose()
})
test('double-click has one build and image failures still yield a usable download',async()=>{
  resetIO();io.products=[product({gallery:['https://example.invalid/unavailable.jpg']})]
  const {host,dispose}=await mount()
  try{await choose(host,'File format','xlsx');await act(async()=>{const b=button(host,'Download Excel');b.click();b.click();for(let n=0;n<100&&!io.download;n++)await new Promise(r=>setTimeout(r,10))});assert.ok(io.download);assert.equal(io.closes,1);const wb=new ExcelJS.Workbook();await wb.xlsx.load(await io.download.arrayBuffer());assert.equal(wb.getWorksheet('Price list').getCell('A5').value,null)}finally{await dispose()}
})
test('read failures show an error and never enable a partial catalogue export',async()=>{
  resetIO();io.fail=true;const {host,dispose}=await mount()
  try{assert.match(host.querySelector('[role="alert"]').textContent,/Fictional read failed/);assert.equal(button(host,'Build PDF').disabled,true);assert.equal(io.download,null)}finally{await dispose()}
})
test('save a fictional price-list artifact from the production exporter for visual and type QA',async()=>{
  if(!process.env.RANGE_ORDER_EVIDENCE)return
  const p=product({status:'stock',variants:[variant({description:'Bohemia crystals, Chrome plated'}),variant({description:'Premium Crystal AB',crystal_colors:['AB'],ws_price_usd:5.8}),variant({description:'Unpriced gold option',plating_code:'G',plating_name:'Gold',ws_price_usd:null,crystal_colors:['RO']})]})
  const model=modelOf([p,product({id:'long',design_no:'0027',description:'Long public specification. '.repeat(70)+' 每件水晶禮品說明'.repeat(35),variants:[variant({ws_price_usd:8})]})],{availabilityById:{[p.id]:{qty:10,byPlating:{CP:10,G:0}}}})
  await writeFile(process.env.RANGE_ORDER_EVIDENCE,await rangeOrderFormBytes(model))
})
