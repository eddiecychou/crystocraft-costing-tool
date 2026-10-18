import {test,before,after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {sha256,legacySampleId} from '../src/domain/crystalSwatches.js'
let scratch,api,originalFetch,originalBitmap
const bytes=new Uint8Array([255,216,255,1,2,3]),checksum=await sha256(bytes)
const values={color_name:'Crystal AB',notes_key:'Crystal AB',style:'fabric',backing_label:'01',publication:'draft',sort_order:0,rgb:[.5,.6,.7]}
const id=await legacySampleId(values.color_name,values.style,values.backing_label)
const file=()=>new File([bytes],'actual.jpg',{type:'image/jpeg'})
before(async()=>{
 scratch=await mkdtemp(resolve('node_modules/.swatch-api-'))
 await build({entryPoints:['src/crystalSwatches.js'],outfile:join(scratch,'api.mjs'),bundle:true,format:'esm',platform:'node',plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/firebase\/firestore$|firebase\/storage$|\/firebase$|\/imageResize$/},a=>({path:a.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='firebase/firestore'?`
   export const collection=(d,...p)=>p.join('/'),doc=(d,...p)=>p.join('/'),where=(...a)=>a,query=(...a)=>a;
   export const serverTimestamp=()=> 'SERVER_TIME';export const getDocs=async()=>({docs:[]});
   export const getDoc=async p=>({exists:()=>!!globalThis.__swatchDocs[p],data:()=>globalThis.__swatchDocs[p]});
   export const setDoc=async(p,v)=>{globalThis.__swatchDocs[p]={...globalThis.__swatchDocs[p],...v}};
   export const runTransaction=async(d,fn)=>fn({get:getDoc,set:(p,v)=>{globalThis.__swatchDocs[p]=v},update:(p,v)=>{globalThis.__swatchDocs[p]={...globalThis.__swatchDocs[p],...v}}});`
   :a.path==='firebase/storage'?`export const ref=(s,p)=>p;export const uploadBytes=async(p,b)=>{if(globalThis.__swatchStorage[p])throw Object.assign(Error('Immutable'),{code:'storage/unauthorized'});globalThis.__swatchStorage[p]=b};`
   :a.path.endsWith('/imageResize')?`export const resizeToJpeg=async file=>({blob:new Blob([await file.arrayBuffer()],{type:'image/jpeg'})});`
   :`export const db={},storage={};export const authedUser=async()=>({getIdToken:async()=> 'qa.token'});`}))
 }}]})
 api=await import(pathToFileURL(join(scratch,'api.mjs')));originalFetch=globalThis.fetch;originalBitmap=globalThis.createImageBitmap
 globalThis.createImageBitmap=async()=>({width:500,height:400,close(){}})
 globalThis.fetch=async url=>{
  const path=new URL(url,'http://localhost').searchParams.get('file')
  if(globalThis.__failRead && path.endsWith('thumbnail.jpg')){globalThis.__failRead=false;return new Response('interrupted',{status:503})}
  const blob=globalThis.__swatchStorage[path];return blob?new Response(blob):new Response('missing',{status:404})
 }
})
beforeEach(()=>{globalThis.__swatchDocs={};globalThis.__swatchStorage={};globalThis.__failRead=false})
after(async()=>{globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalBitmap;await rm(scratch,{recursive:true,force:true})})
test('new photo is private before upload and all three byte-verified objects precede publication',async()=>{
 let prepared=false
 const revision=await api.saveCrystalSwatch({id,values:{...values,publication:'published'},file:file(),onPrepared:r=>{
  prepared=true;assert.equal(r,1);assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].publication,'draft');assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].media,null)
 }})
 assert.ok(prepared);assert.equal(revision,2);assert.equal(Object.keys(globalThis.__swatchStorage).length,3)
 const result=globalThis.__swatchDocs['crystal_swatches/'+id];assert.equal(result.media.sha256,checksum);assert.equal(result.publication,'published')
})
test('interrupted readback leaves a recoverable draft and retry reuses immutable objects',async()=>{
 globalThis.__failRead=true
 await assert.rejects(()=>api.saveCrystalSwatch({id,values,file:file()}),/503/)
 assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].publication,'draft');assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].revision,1)
 await api.saveCrystalSwatch({id,expectedRevision:1,values,file:file()})
 assert.equal(Object.keys(globalThis.__swatchStorage).length,3);assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].revision,2)
})
test('metadata update uses revision guard and cannot silently overwrite another editor',async()=>{
 await api.saveCrystalSwatch({id,values,file:file()})
 await api.saveCrystalSwatch({id,expectedRevision:2,values:{...values,description:'Reviewed'}})
 await assert.rejects(()=>api.saveCrystalSwatch({id,expectedRevision:2,values:{...values,description:'Stale'}}),/another window/)
 assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].description,'Reviewed')
})
test('manual crop changes display revision while preserving exact original bytes',async()=>{
 const cropped=new Blob([new Uint8Array([255,216,255,9,9])],{type:'image/jpeg'})
 await api.saveCrystalSwatch({id,values,file:file(),croppedBlob:cropped})
 const media=globalThis.__swatchDocs['crystal_swatches/'+id].media
 assert.equal(media.sha256,checksum);assert.equal(media.display_sha256,await sha256(await cropped.arrayBuffer()))
 assert.deepEqual(new Uint8Array(await globalThis.__swatchStorage[media.original].arrayBuffer()),bytes)
 assert.notEqual(media.sha256,media.display_sha256)
})
test('migration resumes partial upload, repeat apply is a no-op, and modified targets stop the run',async()=>{
 const prepared={manifestHash:'test-manifest',manifest:{source_inventory:{}},samples:[{id,...values,publication:'published',bytes,type:'image/jpeg',source_file:'actual.jpg',source:{sha256:checksum},legacy_slot:{pitch:20}}]}
 globalThis.__failRead=true;await assert.rejects(()=>api.applySwatchImport(prepared),/503/)
 assert.equal(globalThis.__swatchDocs['crystal_migration_runs/test-manifest'].state,'failed')
 await api.applySwatchImport(prepared);const snapshot=structuredClone(globalThis.__swatchDocs['crystal_swatches/'+id])
 await api.applySwatchImport(prepared);assert.deepEqual(globalThis.__swatchDocs['crystal_swatches/'+id],snapshot);assert.equal(Object.keys(globalThis.__swatchStorage).length,3)
 globalThis.__swatchDocs['crystal_swatches/'+id].description='Changed by operator'
 await assert.rejects(()=>api.applySwatchImport(prepared),/Target changed/);assert.equal(globalThis.__swatchDocs['crystal_swatches/'+id].description,'Changed by operator')
})
test('failed batch settles, records accurate progress, and does not start the next batch',async()=>{
 const samples=[]
 for(let i=0;i<6;i++)samples.push({id:await legacySampleId('Colour '+i,'fabric','01'),...values,color_name:'Colour '+i,notes_key:'Colour '+i,publication:'published',bytes,type:'image/jpeg',source_file:'actual.jpg',source:{sha256:checksum},legacy_slot:{pitch:20}})
 globalThis.__swatchDocs['crystal_swatches/'+samples[1].id]={revision:9,description:'Operator change'}
 await assert.rejects(()=>api.applySwatchImport({manifestHash:'batch',manifest:{},samples}),/Target changed/)
 assert.equal(globalThis.__swatchDocs['crystal_migration_runs/batch'].state,'failed');assert.equal(globalThis.__swatchDocs['crystal_migration_runs/batch'].verified_count,3)
 assert.equal(globalThis.__swatchDocs['crystal_swatches/'+samples[4].id],undefined)
 assert.equal(globalThis.__swatchDocs['crystal_swatches/'+samples[1].id].description,'Operator change')
})
