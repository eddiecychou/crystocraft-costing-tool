import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

async function fixture() {
 const key='__crystalPhotoQa_'+crypto.randomUUID().replaceAll('-','')
 const state={records:{},writes:[],assets:[],reads:[]};globalThis[key]=state
 const fire=`const s=globalThis.${key};export const doc=(...args)=>({path:args.map(x=>typeof x==='string'?x:x?.path||'').filter(Boolean).join('/')});export const collection=doc;export const query=x=>x;export const where=()=>{};export const getDoc=async ref=>({exists:()=>!!s.records[ref.path],data:()=>s.records[ref.path]});export const getDocs=async()=>({docs:[]});export const serverTimestamp=()=>123;export const runTransaction=async(db,fn)=>fn({get:getDoc,set:(ref,value)=>{s.records[ref.path]=value;s.writes.push({path:ref.path,value})}});`
 const media=`const s=globalThis.${key};export const photoAssets=async(pid,file,crop,paths)=>{s.assets.push({pid,file,crop});return {...paths(pid,'a'.repeat(64),file.type),mime:file.type,bytes:file.size,sha256:'original-hash'}};export const readSwatchPhoto=async path=>{s.reads.push(path);return new Blob(['original bytes'],{type:'image/png'})};`
 const result=await build({entryPoints:['src/crystalProducts.js'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fictional-photo-boundaries',setup(b){
  b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'fire',namespace:'qa'}))
  b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'qa'}))
  b.onResolve({filter:/(^|\/)crystalSwatches$/},()=>({path:'media',namespace:'qa'}))
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='fire'?fire:args.path==='media'?media:'export const db={};'}))
 }}]})
 const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))
 return {state,api,dispose:()=>delete globalThis[key]}
}

test('description-only edits retain protected media and publication with revision checking',async()=>{
 const {state,api,dispose}=await fixture();try{
  const path='crystal_products/cp_example/images/im_example',media={original:'protected-original',display:'protected-display',thumbnail:'protected-thumbnail',mime:'image/png'}
  state.records[path]={alt:'Old',publication:'archived',media,revision:3,created_at:12}
  assert.equal(await api.saveCrystalImage({productId:'cp_example',id:'im_example',alt:'Updated 中文',publication:'archived',expectedRevision:3}),4)
  assert.equal(state.assets.length,0);assert.deepEqual(state.records[path].media,media);assert.equal(state.records[path].publication,'archived');assert.equal(state.records[path].alt,'Updated 中文')
  await assert.rejects(api.saveCrystalImage({productId:'cp_example',id:'im_example',alt:'Stale',expectedRevision:3}),/record changed/)
  assert.equal(state.records[path].alt,'Updated 中文')
 }finally{dispose()}
})

test('edited copies pass original bytes separately from edited display bytes and stay draft',async()=>{
 const {state,api,dispose}=await fixture();try{
  const original=new File(['original PNG bytes'],'原始.png',{type:'image/png'}),crop=new Blob(['edited JPEG bytes'],{type:'image/jpeg'}),prepared=[]
  assert.equal(await api.saveCrystalImage({productId:'cp_example',id:'im_copy',file:original,croppedBlob:crop,alt:'Cropped copy',publication:'draft',onPrepared:r=>prepared.push(r)}),2)
  assert.deepEqual(prepared,[1]);assert.equal(state.writes[0].value.publication,'draft');assert.equal(state.writes[0].value.media,null)
  assert.equal(state.assets[0].file,original);assert.equal(state.assets[0].crop,crop);assert.equal(await state.assets[0].file.text(),'original PNG bytes')
  assert.match(state.records['crystal_products/cp_example/images/im_copy'].media.original,/crystal-products\/cp_example\/im_copy\/[a-f0-9]{64}\/original\.png$/)
  assert.equal(state.records['crystal_products/cp_example/images/im_copy'].publication,'draft')
  await assert.rejects(api.saveCrystalImage({productId:'cp_example',id:'invalid_copy',croppedBlob:crop}),/original photograph is required/)
 }finally{dispose()}
})

test('original download names preserve Unicode and MIME extensions while removing path/control characters',async()=>{
 const {api,dispose}=await fixture();try{
  assert.equal(api.crystalImageDownloadName('水晶 / "Clear" 🎁',{id:'im_example',media:{mime:'image/png'}}),'水晶 - -Clear- 🎁 - im_example.png')
  assert.equal(api.crystalImageDownloadName('',{id:'x',media:{mime:'image/webp'}}),'Crystal component - x.webp')
  assert.doesNotMatch(api.crystalImageDownloadName('bad\nname\\file',{id:'id'}),/[\\/\n\r]/)
  assert.equal([...api.crystalImageDownloadName('🎁'.repeat(200),{id:'x'})].length,148)
 }finally{dispose()}
})
