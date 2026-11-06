import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

async function fixture() {
 const key='__crystalPhotoQa_'+crypto.randomUUID().replaceAll('-','')
 const state={records:{},writes:[],assets:[],reads:[],deletedFiles:[],events:[],failFiles:[]};globalThis[key]=state
 const fire=`const s=globalThis.${key};export const doc=(...args)=>({path:args.map(x=>typeof x==='string'?x:x?.path||'').filter(Boolean).join('/')});export const collection=doc;export const query=x=>x;export const where=()=>{};export const getDoc=async ref=>({exists:()=>!!s.records[ref.path],data:()=>s.records[ref.path]});export const getDocs=async()=>({docs:[]});export const serverTimestamp=()=>123;export const runTransaction=async(db,fn)=>fn({get:getDoc,set:(ref,value)=>{s.records[ref.path]=value;s.writes.push({path:ref.path,value})},delete:ref=>{delete s.records[ref.path];s.events.push("record-deleted")}});`
 const media=`const s=globalThis.${key};export const photoAssets=async(pid,file,crop,paths)=>{s.assets.push({pid,file,crop});return {...paths(pid,'a'.repeat(64),file.type),mime:file.type,bytes:file.size,sha256:'original-hash'}};export const readSwatchPhoto=async path=>{s.reads.push(path);return new Blob(['original bytes'],{type:'image/png'})};`
 const result=await build({entryPoints:['src/crystalProducts.js'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fictional-photo-boundaries',setup(b){
  b.onResolve({filter:/^firebase\/storage$/},()=>({path:'storage',namespace:'qa'}))
  b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'fire',namespace:'qa'}))
  b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'qa'}))
  b.onResolve({filter:/(^|\/)crystalSwatches$/},()=>({path:'media',namespace:'qa'}))
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='fire'?fire:args.path==='media'?media:args.path==='storage'?`const s=globalThis.${key};export const ref=(storage,path)=>({path});export const deleteObject=async ref=>{s.events.push('file-delete');s.deletedFiles.push(ref.path);if(s.failFiles.includes(ref.path))throw Object.assign(Error('Fictional cleanup denied'),{code:'storage/unauthorized'})};`:'export const db={},storage={};'}))
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

const imagePath='crystal_products/cp_example/images/im_example'
const photoRoot='crystal-products/cp_example/im_example/'+'a'.repeat(64)
const photoMedia={original:photoRoot+'/original.png',display:photoRoot+'/display.jpg',thumbnail:photoRoot+'/thumbnail.jpg'}
function seedDelete(state){state.records['crystal_products/cp_example']={hero_id:'im_cover',revision:9};state.records[imagePath]={revision:3,publication:'published',media:photoMedia};state.records['private/quote']={notes:'Preserve supplier data'}}
test('confirmed deletion removes only the exact image before cleaning up its three files',async()=>{
 const {state,api,dispose}=await fixture();try{
  seedDelete(state);const parent=structuredClone(state.records['crystal_products/cp_example'])
  assert.deepEqual(await api.deleteCrystalImage({productId:'cp_example',id:'im_example',expectedRevision:3}),{pendingFiles:[]})
  assert.equal(state.records[imagePath],undefined);assert.deepEqual(state.records['crystal_products/cp_example'],parent);assert.deepEqual(state.records['private/quote'],{notes:'Preserve supplier data'})
  assert.deepEqual(state.deletedFiles,Object.values(photoMedia));assert.equal(state.events[0],'record-deleted')
 }finally{dispose()}
})
test('saved covers, stale revisions and foreign paths cannot remove a record or files',async()=>{
 const {state,api,dispose}=await fixture();try{
  seedDelete(state);state.records['crystal_products/cp_example'].hero_id='im_example'
  await assert.rejects(api.deleteCrystalImage({productId:'cp_example',id:'im_example',expectedRevision:3}),/Change the cover/)
  state.records['crystal_products/cp_example'].hero_id='im_cover'
  await assert.rejects(api.deleteCrystalImage({productId:'cp_example',id:'im_example',expectedRevision:2}),/photograph changed/)
  state.records[imagePath].media={...photoMedia,original:'suppliers/private.pdf'}
  await assert.rejects(api.deleteCrystalImage({productId:'cp_example',id:'im_example',expectedRevision:3}),/Invalid photograph file/)
  await assert.rejects(api.cleanupCrystalImageFiles({productId:'cp_example',id:'im_example',paths:['crystal-products/other/im_other/'+'a'.repeat(64)+'/original.png']}),/Invalid photograph file/)
  assert.ok(state.records[imagePath]);assert.deepEqual(state.deletedFiles,[]);assert.deepEqual(state.events,[])
 }finally{dispose()}
})
test('file cleanup failures can be retried without repeating the record deletion',async()=>{
 const {state,api,dispose}=await fixture();try{
  seedDelete(state);state.failFiles=[photoMedia.original]
  const result=await api.deleteCrystalImage({productId:'cp_example',id:'im_example',expectedRevision:3})
  assert.deepEqual(result.pendingFiles,[photoMedia.original]);assert.equal(state.records[imagePath],undefined)
  state.failFiles=[];assert.deepEqual(await api.cleanupCrystalImageFiles({productId:'cp_example',id:'im_example',paths:result.pendingFiles}),[])
  assert.equal(state.events.filter(e=>e==='record-deleted').length,1)
 }finally{dispose()}
})
