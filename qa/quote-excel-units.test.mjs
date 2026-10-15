import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import ExcelJS from 'exceljs'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://quote.test' })
for (const key of ['window','document','HTMLElement','MouseEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const originalFetch = globalThis.fetch
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
let scratch, QuoteExport, downloaded, filename
before(async () => {
  scratch = await mkdtemp(join(tmpdir(),'oc-quote-excel-'))
  await build({
    entryPoints:[fileURLToPath(new URL('../src/components/QuoteExport.jsx',import.meta.url))],
    outfile:join(scratch,'export.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',
    plugins:[{name:'offline-excel-boundaries',setup(b){
      b.onResolve({filter:/^(react(?:\/.*)?|exceljs|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
      b.onResolve({filter:/^(firebase\/firestore|.*\/firebase|.*\/QuotePDF)$/},a=>({path:a.path,namespace:'mock'}))
      b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const db={};export const doc=()=>{};export const getDoc=()=>{throw Error("Unexpected database read")};export const updateDoc=()=>{throw Error("Export must not write")};export default ()=>null',loader:'js'}))
      b.onResolve({filter:/\.png$/},a=>({path:resolve(a.resolveDir,a.path),namespace:'asset'}))
      b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "offline-logo"',loader:'js'}))
    }}],
  })
  QuoteExport=(await import(pathToFileURL(join(scratch,'export.mjs')))).default
  globalThis.fetch=async()=>{throw Error('Offline: no network in workbook tests')}
  URL.createObjectURL=blob=>{downloaded=blob;return 'blob:quote-test'}
  URL.revokeObjectURL=()=>{}
  dom.window.HTMLAnchorElement.prototype.click=function(){filename=this.download}
})
after(async()=>{globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.close();await rm(scratch,{recursive:true,force:true})})
async function exportWorkbook(items){
  downloaded=null
  const host=document.createElement('div');document.body.append(host)
  const root=createRoot(host)
  try {
    await act(async()=>root.render(React.createElement(QuoteExport,{quote:{client_name:'Unit regression',quote_currency:'HKD',quote_date:'2026-10-15'},items,onClose(){}})))
    const button=[...host.querySelectorAll('button')].find(x=>x.textContent.includes('Download Excel'))
    assert.ok(button,'Actual Excel download button exists')
    await act(async()=>{
      button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))
      for(let i=0;i<100&&!downloaded;i++)await new Promise(r=>setTimeout(r,10))
    })
    assert.ok(downloaded,'Actual exporter produced its download')
    const bytes=Buffer.from(await downloaded.arrayBuffer())
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes)
    return {wb,ws:wb.getWorksheet('Quotation'),bytes}
  }finally{await act(async()=>root.unmount());host.remove()}
}
const units=['pcs','set','pair','box','kg','g','m']
test('actual Excel download preserves every selected unit and numeric quantity',async()=>{
  const items=units.map((unit,i)=>({product_name:`Unit ${unit}`,product_unit:unit,is_custom:i%2===0,tiers:[{quantity:80+i,price:90+i}]}))
  const {ws,bytes}=await exportWorkbook(items)
  for(const [i,unit]of units.entries()){
    assert.equal(ws.getCell(`E${9+i}`).value,80+i)
    assert.equal(ws.getCell(`E${9+i}`).numFmt,`General" ${unit}"`)
    assert.equal(ws.getCell(`F${9+i}`).value,90+i)
    assert.equal(ws.getCell(`F${9+i}`).numFmt,'#,##0.00')
  }
  assert.equal(ws.getCell('E8').value,'QTY');assert.equal(ws.getCell('F8').value,'UNIT PRICE (HKD)')
  assert.equal(ws.columnCount,7);assert.equal(ws.pageSetup.orientation,'portrait')
  assert.match(filename,/\.xlsx$/)
  if(process.env.QUOTE_EXCEL_EVIDENCE)await writeFile(process.env.QUOTE_EXCEL_EVIDENCE,bytes)
})
test('all tiers retain the selected unit, decimals, zero and usable arithmetic',async()=>{
  const {ws}=await exportWorkbook([{product_name:'Weight',product_unit:'kg',tiers:[{quantity:1.25,price:20},{quantity:0,price:18},{quantity:10000,price:15}]}])
  for(const [i,qty]of [1.25,0,10000].entries()){
    assert.equal(ws.getCell(`E${9+i}`).value,qty)
    assert.equal(ws.getCell(`E${9+i}`).numFmt,'General" kg"')
  }
  assert.equal(ws.getCell('E9').value*ws.getCell('F9').value,25)
  assert.equal(ws.getCell('E11').value*ws.getCell('F11').value,150000)
})
test('older lines without a unit use pcs without changing stored quantities or prices',async()=>{
  const {ws}=await exportWorkbook([{product_name:'Legacy',tiers:[{quantity:80,price_hkd:90}]},{product_name:'Empty unit',product_unit:'',tiers:[{quantity:20,price:5}]}])
  assert.equal(ws.getCell('E9').value,80);assert.equal(ws.getCell('F9').value,90)
  assert.equal(ws.getCell('E9').numFmt,'General" pcs"');assert.equal(ws.getCell('E10').numFmt,'General" pcs"')
})

const tierRemarks=[
 '1 pair 2 glasses in a gift box',
 '1 pair 2 glasses in single gift box combined with paper sleeve',
]
test('actual Excel download places each tier remark on the matching quantity/price row',async()=>{
 const {ws,bytes}=await exportWorkbook([
  {product_name:'Crystal Spinning Glass Bordeaux Edition',product_unit:'pair',tiers:[{quantity:10,price:800,remarks:tierRemarks[0]},{quantity:10,price:630,remarks:tierRemarks[1]}]},
  {product_name:'Second product',product_unit:'set',tiers:[{quantity:20,price:12,remarks:'Second product tier'}]},
 ])
 assert.equal(ws.getCell('G8').value,'TIER REMARKS')
 for(const[i,price]of [800,630,12].entries()){
  assert.equal(ws.getCell(`G${9+i}`).value,[...tierRemarks,'Second product tier'][i])
  assert.equal(ws.getCell(`E${9+i}`).value,[10,10,20][i]);assert.equal(ws.getCell(`F${9+i}`).value,price)
  assert.equal(ws.getCell(`G${9+i}`).alignment.wrapText,true)
  assert.equal(ws.getCell(`G${9+i}`).isMerged,false)
 }
 assert.equal(ws.getCell('C10').master.address,'C9')
 assert.equal(ws.getCell('E9').value*ws.getCell('F9').value,8000)
 if(process.env.QUOTE_EXCEL_TIER_EVIDENCE)await writeFile(process.env.QUOTE_EXCEL_TIER_EVIDENCE,bytes)
})
test('multiline, long and Chinese remarks retain text and have room to wrap',async()=>{
 const remark='First packaging note\n'+ 'Packaging and customization details for this tier. '.repeat(12)+'\n每對兩個玻璃杯，附禮盒'
 const {ws}=await exportWorkbook([{product_name:'Long remark',product_unit:'pair',tiers:[{quantity:10,price:800,remarks:remark},{quantity:20,price:700,remarks:'=literal text, never an Excel formula'}]}])
 assert.equal(ws.getCell('G9').value,remark)
 assert.ok(ws.getRow(9).height>180)
 assert.equal(ws.getCell('G10').value,'=literal text, never an Excel formula')
 assert.equal(ws.getCell('G10').type,ExcelJS.ValueType.String)
 assert.equal(ws.getCell('F10').value,700)
 const chinese='每對兩個玻璃杯，附禮盒'.repeat(25)
 const {ws:zh}=await exportWorkbook([{product_name:'Chinese remark',tiers:[{quantity:10,price:800,remarks:chinese},{quantity:20,price:700}]}])
 assert.equal(zh.getCell('G9').value,chinese)
 assert.ok(zh.getRow(9).height>180,'Wide Chinese characters need additional row height')
})
test('missing and whitespace-only tier remarks leave blank cells without changing numbers',async()=>{
 const {ws}=await exportWorkbook([{product_name:'Blank remarks',tiers:[{quantity:80,price:90},{quantity:100,price:85,remarks:'  \n  '}]}])
 assert.equal(ws.getCell('G9').value,'');assert.equal(ws.getCell('G10').value,'')
 assert.equal(ws.getCell('E9').value,80);assert.equal(ws.getCell('F10').value,85)
 assert.equal(ws.getCell('E9').numFmt,'General" pcs"')
})

test('quote Excel keeps product text and excludes legacy catalogue category metadata',async()=>{
 const item={product_name:'Crystocraft Range sample',product_description:'Original product description',product_category:'Figurine Gifts',product_collection:'range_products',product_unit:'pair',tiers:[{quantity:10,price:20,remarks:'Original tier remark'}]}
 const {ws}=await exportWorkbook([item])
 assert.equal(ws.getCell('C9').value,item.product_name);assert.equal(ws.getCell('D9').value,item.product_description)
 assert.equal(ws.getCell('E9').value,10);assert.equal(ws.getCell('E9').numFmt,'General" pair"');assert.equal(ws.getCell('F9').value,20);assert.equal(ws.getCell('G9').value,'Original tier remark')
 assert.doesNotMatch(JSON.stringify(ws.model),/Figurine Gifts/)
 assert.equal(item.product_category,'Figurine Gifts')
})
