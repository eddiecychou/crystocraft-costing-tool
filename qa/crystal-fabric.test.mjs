import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fabricCatalogueEntry,fabricEnquiryLine,fabricEnquirySnapshot,fabricCartKey} from '../src/domain/crystalFabric.js'
import {filterCrystalProducts} from '../src/domain/crystalProducts.js'
const sample={id:'sw_fabric_reference',publication:'published',color_name:'Crystal AB',style:'fabric',backing_label:'01',sort_order:2,revision:4,media:{display:'existing/display.jpg',thumbnail:'existing/thumb.jpg'}}
test('a single Fabric range reuses published photos without creating variants or copying records',()=>{
 const samples=[sample,{...sample,id:'sw_rock_reference',style:'rock',sort_order:1},{...sample,id:'sw_draft_reference',publication:'draft',color_name:'Hidden'}],before=JSON.stringify(samples)
 const range=fabricCatalogueEntry(samples)
 assert.equal(range.id,'fabric');assert.equal(range.hero_media,sample.media);assert.equal(range.image_path,sample.media.thumbnail)
 assert.deepEqual(range.variants,[]);assert.deepEqual(range.colours,['Crystal AB']);assert.ok(range.materials.includes('Fine Rock / Rock'));assert.equal(JSON.stringify(samples),before)
 assert.equal(filterCrystalProducts([range],{view:'materials'}).length,1);assert.equal(filterCrystalProducts([range],{view:'clearance'}).length,0)
 assert.equal(fabricCatalogueEntry(samples.filter(s=>s.publication==='draft')),null)
})
test('project quotation retains the exact sample, backing label and application, always unpriced',()=>{
 const line=fabricEnquiryLine(sample,{application:'Hotel lighting panel',note:'Discuss adhesive'})
 assert.equal(line.type,'crystal_fabric');assert.equal(line.unit,'project');assert.equal(line.swatch_sample_id,sample.id);assert.equal(line.swatch_revision,4);assert.equal(line.ws_price_usd,null);assert.match(line.description_snapshot,/Backing: 01/)
 const out=fabricEnquirySnapshot({...line,cost:800,inventory_id:'private',unit:'sqm'})
 assert.equal(out.application,'Hotel lighting panel');assert.equal(out.unit,'project');assert.equal(out.cost,undefined);assert.equal(out.inventory_id,undefined);assert.equal(out.swatch_revision,4)
 assert.throws(()=>fabricEnquiryLine({...sample,publication:'archived'}));assert.throws(()=>fabricEnquiryLine({...sample,revision:null}))
})
test('an early project enquiry may omit both sample and drawing without guessing construction',()=>{
 const line=fabricEnquiryLine()
 assert.equal(line.swatch_sample_id,'');assert.equal(line.swatch_revision,null);assert.equal(line.application,'');assert.equal(line.image_path,'');assert.equal(line.ws_price_usd,null)
 assert.equal(fabricEnquirySnapshot(line).source_collection,'crystal_swatches')
})
test('repeated project reference deduplicates, different physical references stay separate',()=>{
 const line=fabricEnquiryLine(sample)
 assert.equal(fabricCartKey(line),fabricCartKey({...line,note:'Another note'}))
 assert.notEqual(fabricCartKey(line),fabricCartKey(fabricEnquiryLine()))
 assert.notEqual(fabricCartKey(line),fabricCartKey(fabricEnquiryLine({...sample,id:'sw_other_backing'})))
})

test('sending rechecks sample publication/revision while early project enquiries need no sample',async()=>{
 const {build}=await import('esbuild')
 const stubs={
  firebase:"export const db={},storage={},auth={};export const authedUser=async()=>null",
  firestore:"export const doc=(db,col,id)=>({id});export const getDoc=async()=>{const data=globalThis.__fabricValidationSample;return {exists:()=>!!data,data:()=>data}}",
  storage:"export const ref=()=>{};export const uploadBytes=async()=>{}",
  products:"export const loadCrystalProduct=async()=>null",
 }
 const bundled=await build({entryPoints:['src/crystalEnquiries.js'],bundle:true,write:false,format:'esm',plugins:[{name:'read-only-sample-fixture',setup(b){
  b.onResolve({filter:/^(firebase\/firestore|firebase\/storage|\.\/firebase|\.\/crystalProducts)$/},args=>({path:args.path==='firebase/firestore'?'firestore':args.path==='firebase/storage'?'storage':args.path==='./firebase'?'firebase':'products',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path]}))
 }}]})
 const {validateCrystalEnquirySelections:validate}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'))
 try{
  globalThis.__fabricValidationSample=sample
  await validate([fabricEnquiryLine(sample),fabricEnquiryLine()])
  globalThis.__fabricValidationSample={...sample,revision:5}
  await assert.rejects(()=>validate([fabricEnquiryLine(sample)]),/reselect/)
  globalThis.__fabricValidationSample={...sample,publication:'archived'}
  await assert.rejects(()=>validate([fabricEnquiryLine(sample)]),/reselect/)
  globalThis.__fabricValidationSample=null
  await assert.rejects(()=>validate([fabricEnquiryLine(sample)]),/reselect/)
  await assert.rejects(()=>validate([{type:'swatch_sample'}]),/reselect/)
  await validate([fabricEnquiryLine()])
 }finally{delete globalThis.__fabricValidationSample}
})
