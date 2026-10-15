import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import React from 'react'
import { Text, renderToBuffer } from '@react-pdf/renderer'

const require = createRequire(import.meta.url)
let dir, QuotePDF
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-quote-units-'))
  await build({
    entryPoints: [fileURLToPath(new URL('../src/components/QuotePDF.jsx', import.meta.url))],
    outfile: join(dir, 'quote.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    plugins: [{ name:'local-pdf-runtime', setup(b) {
      b.onResolve({ filter:/^(react(?:\/.*)?|@react-pdf\/renderer)$/ }, a => ({path:require.resolve(a.path),external:true}))
      b.onResolve({ filter:/\.(ttf|png)$/ }, a => ({path:resolve(a.resolveDir,a.path),namespace:'local-asset'}))
      b.onLoad({filter:/.*/,namespace:'local-asset'}, a => ({contents:`export default ${JSON.stringify(a.path)}`,loader:'js'}))
    } }],
  })
  QuotePDF = (await import(pathToFileURL(join(dir,'quote.mjs')))).default
})
after(async () => rm(dir,{recursive:true,force:true}))
const quote = {client_name:'Unit regression sample',quote_currency:'HKD',quote_date:'2026-10-15'}
function texts(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(texts)
  const content = node.props?.children
  return [...(node.type === Text ? [React.Children.toArray(content).filter(x=>typeof x==='string'||typeof x==='number').join('')] : []), ...texts(content)]
}
const items = ['pcs','set','pair','box','kg','g','m'].map((unit,i)=>({
  product_name:`Unit ${unit} sample`,product_description:'Selected unit must accompany every quantity.',
  product_unit:unit,is_custom:i%2===0,product_collection:i%2===0?'products':'range_products',tiers:[{quantity:80+i,price:90}],
}))
test('PDF quantity cells include every selectable unit, including custom and catalogue lines', () => {
  const output=texts(QuotePDF({quote,items}))
  for(const [i,unit] of ['pcs','set','pair','box','kg','g','m'].entries()) assert.ok(output.includes(`${80+i} ${unit}`),`Missing quantity/unit: ${unit}`)
})
test('every price tier carries the item unit; prices and amounts remain numeric', () => {
  const output=texts(QuotePDF({quote,items:[{product_name:'Set',product_unit:'set',tiers:[{quantity:100,price:30},{quantity:200,price:25},{quantity:1000,price:18}]}]}))
  for(const label of ['100 set','200 set','1000 set','30.00','25.00','18.00','3,000.00','5,000.00','18,000.00']) assert.ok(output.includes(label),label)
})
test('older quote lines without a saved unit retain the editor default pcs', () => {
  const output=texts(QuotePDF({quote,items:[{product_name:'Legacy',quantity:25,price_hkd:10}]}))
  assert.ok(output.includes('25 pcs'));assert.ok(output.includes('250.00'))
})
test('unit display does not change the primary-tier grand total', () => {
  const output=texts(QuotePDF({quote,items:[{product_name:'Pairs',product_unit:'pair',tiers:[{quantity:80,price:90},{quantity:100,price:85}]}],includeTotal:true}))
  assert.ok(output.includes('80 pair'));assert.ok(output.includes('100 pair'))
  assert.equal(output.filter(t=>t==='7,200.00').length,2) // line amount and primary-tier total
})
test('real renderer produces the mixed-unit PDF, including a large multi-tier quantity', async () => {
  const pdfItems=[...items,{product_name:'Multi-tier pairs',product_unit:'pair',tiers:[{quantity:1000,price:2},{quantity:10000,price:1.5}]}]
  const buffer=await renderToBuffer(React.createElement(QuotePDF,{quote,items:pdfItems,includeTotal:true}))
  assert.equal(buffer.subarray(0,5).toString(),'%PDF-')
  assert.ok(buffer.length>1000)
  if(process.env.QUOTE_PDF_EVIDENCE)await writeFile(process.env.QUOTE_PDF_EVIDENCE,buffer)
})

function nodes(node) {
  if(!node || typeof node!=='object')return []
  if(Array.isArray(node))return node.flatMap(nodes)
  return [node,...nodes(node.props?.children)]
}
const remarkedItem={product_name:'Crystal Spinning Glass Bordeaux Edition',product_description:'Crystal glass with spinning base.',product_unit:'pair',item_remarks:'Product-level customization stays separate.',tiers:[
 {quantity:10,price:800,remarks:'1 pair 2 glasses in a gift box'},
 {quantity:10,price:630,remarks:'1 pair 2 glasses in single gift box combined with paper sleeve'},
]}
test('each tier remark shares a group with its own quantity, price and amount',()=>{
 const tree=QuotePDF({quote,items:[remarkedItem]})
 for(const [remark,price,amount]of [[remarkedItem.tiers[0].remarks,'800.00','8,000.00'],[remarkedItem.tiers[1].remarks,'630.00','6,300.00']]){
  const group=nodes(tree).find(n=>n.props?.wrap===false && texts(n).includes(remark) && !texts(n).includes(remark===remarkedItem.tiers[0].remarks?remarkedItem.tiers[1].remarks:remarkedItem.tiers[0].remarks))
  assert.ok(group,'Each remark has a dedicated tier group')
  assert.deepEqual(texts(group),['10 pair',price,amount,remark])
 }
 assert.ok(texts(tree).includes(remarkedItem.item_remarks))
})
test('blank tier remarks add no remark text, and quote notes stay separate',()=>{
 const tree=QuotePDF({quote:{...quote,notes:'Quote-wide delivery note'},items:[{...remarkedItem,tiers:[{quantity:10,price:800},{quantity:20,price:700,remarks:'  \n '}]}]})
 assert.ok(texts(tree).includes('20 pair'));assert.ok(texts(tree).includes('14,000.00'))
 assert.ok(texts(tree).includes('Quote-wide delivery note'))
 assert.ok(!texts(tree).includes('  \n '))
})
test('Chinese tier remarks select the existing Chinese fallback font',()=>{
 const remark='每對兩個玻璃杯，附禮盒'
 const node=nodes(QuotePDF({quote,items:[{...remarkedItem,tiers:[{quantity:10,price:800,remarks:remark}]}]})).find(n=>n.type===Text&&n.props.children===remark)
 assert.ok(node);assert.ok(node.props.style.some(s=>s?.fontFamily==='Noto Sans TC'))
})
test('real PDF renderer wraps multiline and long tier remarks across a multipage quote',async()=>{
 const fixtures=Array.from({length:8},(_,i)=>({...remarkedItem,product_name:`Tier remark layout sample ${i+1}`,tiers:[remarkedItem.tiers[0],{...remarkedItem.tiers[1],remarks:remarkedItem.tiers[1].remarks+'\n'+ 'Packaging and customization details must remain attached to this price tier. '.repeat(3)}]}))
 const buffer=await renderToBuffer(React.createElement(QuotePDF,{quote,items:fixtures,includeTotal:true}))
 assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(buffer.length>1000)
 if(process.env.QUOTE_TIER_REMARKS_EVIDENCE)await writeFile(process.env.QUOTE_TIER_REMARKS_EVIDENCE,buffer)
})
