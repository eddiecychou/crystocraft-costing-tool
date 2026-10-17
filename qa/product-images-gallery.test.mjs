import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url),dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.test'})
for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
globalThis.createImageBitmap=async()=>({width:20,height:20,close(){}})
globalThis.OffscreenCanvas=class{getContext(){return {drawImage(){}}}async convertToBlob(){return new Blob(['fictional edited bytes'],{type:'image/jpeg'})}}
let scratch,Gallery
before(async()=>{
 scratch=await mkdtemp(resolve('.qa-image-access-'))
 await build({entryPoints:['src/components/ImageGallery.jsx'],outfile:join(scratch,'gallery.mjs'),bundle:true,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'image-access-boundaries',setup(b){
 b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
 b.onResolve({filter:/^firebase\/|\/firebase$|\/i18n$|\/ManualAdjust$|^@dnd-kit\//},a=>({path:a.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',contents:a.path==='firebase/firestore'?`
 export const collection=(db,...p)=>p.join('/');export const doc=(db,...p)=>typeof db==='string'?db+'/new-image':p.join('/');export const serverTimestamp=()=>'SERVER';export const updateDoc=async()=>{};export const addDoc=async(path,data)=>{globalThis.__imageAccessWrites.push({path,data})};export const runTransaction=async(db,fn)=>fn({get:async path=>({exists:()=>true,data:()=>path==='products/qa_product'?{heroImage:globalThis.__imageAccessHero}:globalThis.__imageAccessCurrent}),update:(path,data)=>globalThis.__imageAccessWrites.push({path,data}),set:(path,data)=>globalThis.__imageAccessWrites.push({path,data})});export const writeBatch=()=>({update:(path,data)=>globalThis.__imageAccessWrites.push({path,data}),set:()=>{},delete:()=>{},commit:async()=>{}});
 `:a.path==='firebase/storage'?`export const ref=(s,p)=>p;export const uploadBytes=async()=>{};export const getDownloadURL=async p=>'https://example.test/'+p;export const deleteObject=async()=>{};`
 :a.path.endsWith('/firebase')?'export const db={},storage={};'
 :a.path.endsWith('/i18n')?'export const useT=()=>s=>s;'
 :a.path.endsWith('/ManualAdjust')?`import React from 'react';export default ({onResult})=><button onClick={()=>onResult('data:image/png;base64,AQID')}>Produce fictional edit</button>;`
 :a.path==='@dnd-kit/core'?`import React from 'react';export const DndContext=({children})=><>{children}</>;export const PointerSensor={};export const useSensor=()=>({});export const useSensors=()=>[];export const closestCenter=()=>null;`
 :a.path==='@dnd-kit/sortable'?`import React from 'react';export const SortableContext=({children})=><>{children}</>;export const rectSortingStrategy=()=>null;export const arrayMove=x=>x;export const useSortable=()=>({attributes:{},listeners:{},setNodeRef:()=>{},transform:null,transition:null});`
 :`export const CSS={Transform:{toString:()=>''}};`}))
 }}]});Gallery=(await import(pathToFileURL(join(scratch,'gallery.mjs')))).default
})
after(async()=>{await rm(scratch,{recursive:true,force:true});dom.window.close()})
async function click(host,text){const button=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(button,`Missing ${text}`);await act(async()=>button.click())}
for(const action of ['Replace original','Save as new'])for(const scenario of ['unchanged','retagged','replaced','hero-changed'])test(`actual Gallery ${action}: ${scenario} source preserves current privacy and prevents stale saves`,async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);globalThis.__imageAccessWrites=[];let mirrored
 const image={id:'approved',file_url:'https://example.test/original.jpg',storage_path:'products/qa_product/images/original.jpg',visibility:'public',branded_for_customer_id:'client',is_hero:true}
 globalThis.__imageAccessCurrent={...image};globalThis.__imageAccessHero=image.file_url
 try{
 await act(async()=>root.render(React.createElement(Gallery,{images:[image],firestorePath:'products/qa_product/images',storagePath:'products/qa_product/images',showVisibility:true,enhanceable:true,onHeroChange:async(url,data)=>{mirrored=data},heroUrl:image.file_url})))
 await act(async()=>host.querySelector('button[title^="Enhance image"]').click());await click(host,'Adjust (manual)');assert.match(host.textContent,/Edited images need Public approval again/);await click(host,'Produce fictional edit');if(scenario==='retagged')globalThis.__imageAccessCurrent={...image,branded_for_customer_id:'new-client',visibility:'internal'};if(scenario==='hero-changed')globalThis.__imageAccessHero='https://example.test/another-hero.jpg';if(scenario==='replaced')globalThis.__imageAccessCurrent={...image,file_url:'https://example.test/new-source.jpg'};await click(host,action)
 if(scenario==='replaced'){assert.match(host.textContent,/image changed while you were editing/);assert.equal(globalThis.__imageAccessWrites.length,0);return}
 const write=globalThis.__imageAccessWrites.find(w=>w.data.file_url);assert.ok(write);assert.equal(write.data.visibility,scenario==='retagged'?'internal':'private');assert.equal(write.data.branded_for_customer_id,scenario==='retagged'?'new-client':'client')
 if(action==='Replace original'&&scenario==='hero-changed'){assert.equal(globalThis.__imageAccessWrites.some(w=>w.path==='products/qa_product'),false);assert.equal(mirrored,undefined)}
 if(action==='Replace original'&&scenario!=='hero-changed'){const product=globalThis.__imageAccessWrites.find(w=>w.path==='products/qa_product');assert.equal(product.data.heroImage_visibility,scenario==='retagged'?'internal':'private');assert.equal(product.data.heroImage_branded_for_customer_id,scenario==='retagged'?'new-client':'client');assert.equal(mirrored.visibility,scenario==='retagged'?'internal':'private')}
 assert.equal(host.querySelector('button')?.textContent==='Produce fictional edit',false)
 }finally{await act(async()=>root.unmount());host.remove()}
})
