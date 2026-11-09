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
async function reload(model,options){const bytes=await rangeOrderFormBytes(model,options);const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);return {wb,ws:wb.getWorksheet('Order form'),bytes}}

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
test('retired-stock pools use component availability, combining options within a finish',()=>{
  const p=product({status:'stock',stock_finished:999,variants:[variant(),variant({crystal_colors:['AB'],ws_price_usd:6}),variant({plating_code:'G'})]})
  const rows=modelOf([p],{availabilityById:{[p.id]:{qty:30,byPlating:{CP:20,G:10}}}}).rows
  assert.equal(rows.filter(r=>r.pool.endsWith('|CP')).length,2)
  assert.equal(rows.find(r=>r.pool.endsWith('|CP')).stock,20)
  assert.equal(modelOf([p]).rows[0].stock,null,'Unknown is not fabricated zero or legacy finished stock')
  assert.equal(modelOf([p],{availabilityById:{[p.id]:{qty:0}}}).rows[0].stock,0)
  assert.equal(modelOf([p],{availabilityById:{[p.id]:{qty:null,byPlating:{CP:null,G:0}}}}).rows.find(r=>r.pool.endsWith('|CP')).stock,null,'An unbounded/unknown finish is not zero stock')
})
test('actual XLSX roundtrip has typed prices, editable whole quantities and protected formula cells',async()=>{
  const {wb,ws,bytes}=await reload(modelOf([product({variants:[variant({crystal_colors:['RO']})]})]))
  assert.deepEqual(wb.worksheets.map(s=>s.name),['Order form','Colour guide'])
  assert.equal(ws.getCell('D11').value,5.25);assert.equal(ws.getCell('D11').numFmt,'#,##0.00')
  assert.equal(ws.getCell('E11').protection.locked,false);assert.equal(ws.getCell('E11').dataValidation.type,'whole')
  assert.equal(ws.getCell('E11').dataValidation.errorStyle,'stop');assert.equal(ws.getCell('E11').dataValidation.formulae[0],0)
  assert.match(ws.getCell('E11').dataValidation.prompt,/D0026-001-CPRO/)
  assert.equal(ws.getCell('F11').formula,'SUM(E11)');assert.equal(ws.getCell('F11').result,0)
  assert.match(ws.getCell('G11').formula,/ROUND\(F11\*D11,2\)/)
  assert.notEqual(ws.getCell('F11').protection?.locked,false);assert.equal(ws.sheetProtection.sheet,true)
  assert.ok(ws.getCell('B2').value instanceof Date);assert.match(ws.getCell('B11').value,/D0026-001/)
  for(const address of ['B3','F3','B4','F4','B5'])assert.equal(ws.getCell(address).value,null,'Blank buyer input: '+address)
  assert.equal(ws.views[0].xSplit,4);assert.equal(ws.views[0].ySplit,10)
  assert.equal(ws.pageSetup.printTitlesRow,'10:10');assert.equal(ws.pageSetup.printTitlesColumn,'A:D')
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/workbook.xml').async('string')
  assert.match(xml,/calcMode="auto"/);assert.match(xml,/forceFullCalc="1"/);assert.match(xml,/fullCalcOnLoad="1"/)
  assert.equal(wb.worksheets.every(s=>s.state==='visible'),true)
})
test('unavailable combinations stay grey and locked; missing prices are explicit, not numeric zero',async()=>{
  const {ws}=await reload(modelOf([product({variants:[variant({crystal_colors:['RO']}),variant({crystal_colors:['AB'],ws_price_usd:null})]})]))
  assert.equal(ws.getCell('F11').value,'—');assert.notEqual(ws.getCell('F11').protection?.locked,false)
  assert.equal(ws.getCell('F11').fill.fgColor.argb,'FFECECEC')
  assert.equal(ws.getCell('D12').value,'Quotation required')
  assert.match(ws.getCell('B7').formula,/SUMIF\(D11:D12,"Quotation required",G11:G12\)/)
  assert.match(ws.getCell('I11').formula,/Check quantities/)
  assert.match(ws.getCell('H11').formula,/Check quantities/)
  assert.match(ws.getCell('D6').formula,/IF\(COUNTIF\(I11:I12,"Check quantities"\)>0,"Check quantities",SUM/,'Invalid pasted quantities cannot produce a plausible priced subtotal')
})
test('wrapped colour headings reserve space above native Excel filter buttons',async()=>{
  const heading='Clear (Dazzle Cut)'
  const model=modelOf([product()],{colors:[{code:'C1',name:heading,swatch:'#eeeeee'},{code:'RO',name:'Rose',swatch:'#eeaabb'}]})
  const {ws,bytes}=await reload(model)
  assert.equal(ws.getCell('E10').value,heading+'\nC1\nOrder qty')
  assert.ok(ws.getRow(10).height>=72,'52pt clipped the last line in native Excel')
  const longer=modelOf([product()],{colors:[{code:'C1',name:'非常長的水晶顏色名稱 Light Sapphire Crystal Finish',swatch:''},{code:'RO',name:'Rose',swatch:''}]})
  const {ws:longSheet}=await reload(longer)
  assert.ok(longSheet.getRow(10).height>ws.getRow(10).height,'Unusually long names expand the header further')
  if(process.env.RANGE_HEADER_EVIDENCE)await writeFile(process.env.RANGE_HEADER_EVIDENCE,bytes)
})
test('stock formulas aggregate all colour/price rows of the same product finish',async()=>{
  const p=product({status:'stock',variants:[variant({description:'Basic'}),variant({crystal_colors:['AB'],description:'Premium',ws_price_usd:6})]})
  const {ws}=await reload(modelOf([p],{availabilityById:{[p.id]:{qty:10,byPlating:{CP:10}}}}))
  assert.match(ws.getCell('J11').formula,/SUM\(H11,H12\)>10/)
  assert.match(ws.getCell('J12').formula,/SUM\(H11,H12\)>10/)
  assert.match(ws.getCell('C11').value,/Stock snapshot: 10 total for this finish/)
  assert.match(ws.getCell('C11').value,/MOQ: 100 \(mixing rule to confirm\)/)
  assert.doesNotMatch(ws.getCell('J11').formula,/100/,'No invented MOQ enforcement')
})
test('long English/Chinese specifications continue visibly without dropping text or exceeding Excel row height',async()=>{
  const description='Long English product detail. '.repeat(140)+' 天鵝水晶尺寸與禮盒說明'.repeat(70)
  const option='Crystal option with detailed finish. '.repeat(100)
  const {ws}=await reload(modelOf([product({description,variants:[variant({description:option})]})]))
  let b='',c='',editable=0
  for(let n=11;n<=ws.rowCount;n++){b+=ws.getCell(`B${n}`).value||'';c+=ws.getCell(`C${n}`).value||'';assert.ok(ws.getRow(n).height<=408);if(ws.getCell(`E${n}`).protection?.locked===false)editable++}
  assert.ok(b.includes(description));assert.ok(c.includes(option.trim()));assert.ok(ws.rowCount>12);assert.equal(editable,1)
  assert.equal(ws.getCell('B11').alignment.wrapText,true)
  for(let n=11;n<ws.rowCount;n++){
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
  const missing=await reload(model);assert.equal(missing.ws.getCell('A11').value,'Image unavailable')
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
  assert.equal(ws.getCell('B11').type,ExcelJS.ValueType.String);assert.match(ws.getCell('B11').value,/^=literal/)
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
async function clickDownload(host,label='Download Excel order form'){
  const b=button(host,label);assert.ok(b);assert.equal(b.disabled,false)
  await act(async()=>{b.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));for(let n=0;n<150&&!io.download;n++)await new Promise(r=>setTimeout(r,10))})
  assert.ok(io.download,'Actual button produced workbook bytes');const wb=new ExcelJS.Workbook();await wb.xlsx.load(await io.download.arrayBuffer());return wb.getWorksheet('Order form')
}
test('real modal exports current filtered IDs, not pagination/full catalogue, and selected customer prices',async()=>{
  resetIO();io.products=[product(),product({id:'other',description:'Not in current filter'}),product({id:'hidden',active:false})]
  io.users=[{id:'buyer',role:'customer',status:'approved',name:'買家 / & Co',base_currency:'EUR',ws_discount_pct:130,fx_rate:0.92},{id:'pending',role:'customer',status:'pending',name:'Pending hidden'}]
  const {host,dispose}=await mount({filteredProductIds:['fictional-swan']})
  try{
    assert.equal(host.querySelectorAll('select').length,3);assert.doesNotMatch(host.textContent,/Pending hidden/)
    await choose(host,'File format','xlsx');await choose(host,'Trade account','buyer');const ws=await clickDownload(host)
    assert.match(ws.getCell('B11').value,/Fictional swan/);assert.doesNotMatch(JSON.stringify(ws.model),/Not in current filter/)
    assert.equal(ws.getCell('D11').value,6.28);assert.equal(ws.getCell('D2').value,'EUR');assert.equal(io.closes,1)
    assert.match(io.name,/買家 - & Co.*\.xlsx$/)
  }finally{await dispose()}
})
test('empty current filter cannot silently export all, but explicit all-visible selection can',async()=>{
  resetIO();const {host,dispose}=await mount({filteredProductIds:[]})
  try{await choose(host,'File format','xlsx');assert.equal(button(host,'Download Excel').disabled,true);await choose(host,'Products to export','all');const ws=await clickDownload(host);assert.match(ws.getCell('B11').value,/Fictional swan/)}finally{await dispose()}
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
  try{await choose(host,'File format','xlsx');await act(async()=>{const b=button(host,'Download Excel');b.click();b.click();for(let n=0;n<100&&!io.download;n++)await new Promise(r=>setTimeout(r,10))});assert.ok(io.download);assert.equal(io.closes,1);const wb=new ExcelJS.Workbook();await wb.xlsx.load(await io.download.arrayBuffer());assert.equal(wb.getWorksheet('Order form').getCell('A11').value,'Image unavailable')}finally{await dispose()}
})
test('read failures show an error and never enable a partial catalogue export',async()=>{
  resetIO();io.fail=true;const {host,dispose}=await mount()
  try{assert.match(host.querySelector('[role="alert"]').textContent,/Fictional read failed/);assert.equal(button(host,'Build PDF').disabled,true);assert.equal(io.download,null)}finally{await dispose()}
})
test('save a fictional artifact from the production exporter for independent recalculation and visual QA',async()=>{
  if(!process.env.RANGE_ORDER_EVIDENCE)return
  const p=product({status:'stock',variants:[variant({description:'Bohemia crystals, Chrome plated'}),variant({description:'Premium Crystal AB',crystal_colors:['AB'],ws_price_usd:5.8}),variant({description:'Unpriced gold option',plating_code:'G',plating_name:'Gold',ws_price_usd:null,crystal_colors:['RO']})]})
  const model=modelOf([p,product({id:'long',design_no:'0027',description:'Long public specification. '.repeat(70)+' 每件水晶禮品說明'.repeat(35),variants:[variant({ws_price_usd:8})]})],{availabilityById:{[p.id]:{qty:10,byPlating:{CP:10,G:0}}}})
  await writeFile(process.env.RANGE_ORDER_EVIDENCE,await rangeOrderFormBytes(model))
})
