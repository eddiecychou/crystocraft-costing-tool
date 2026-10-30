import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
const require=createRequire(import.meta.url),rootDir=fileURLToPath(new URL('../',import.meta.url))
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://catalogue.test'})
for(const k of ['window','document','HTMLElement','MouseEvent'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const sample={name:'Manulife VIP Drinkware Gifts',season:'15 Oct 2026',tagline:'Crafted for every moment',status:'published',cover_image:'https://example.invalid/cover.jpg',overlay_color:'black',overlay_opacity:0.5}
let scratch,pages
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-cover-'))
 await build({stdin:{contents:`export {default as builder} from './src/pages/CatalogueDetail.jsx';export {default as form} from './src/pages/CatalogueForm.jsx';export {default as print} from './src/pages/CataloguePreview.jsx';export {default as cover} from './src/components/CatalogueCover.jsx'`,resolveDir:rootDir},outfile:join(scratch,'pages.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'cover-boundaries',setup(b){
 b.onResolve({filter:/^(react(?:-dom)?(?:\/.*)?|lucide-react|@dnd-kit\/(?:core|sortable|utilities))$/},a=>({path:require.resolve(a.path),external:true}))
 b.onResolve({filter:/^(react-router-dom|firebase\/firestore|firebase\/storage)$/},a=>({path:a.path,namespace:'mock'}))
 b.onResolve({filter:/productSource$/},()=>({path:'products',namespace:'mock'}))
 b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='products'?`export const PRODUCT_SOURCES=[{value:'corporate',label:'Corporate Gifts'}];export const loadBlogProducts=async()=>[];export const loadBlogImages=async()=>[];`:a.path==='react-router-dom'?`import React from 'react';export const useParams=()=>({id:globalThis.__coverFixture.id});export const useNavigate=()=>x=>globalThis.__coverFixture.destination=x;export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children)`:
 a.path==='firebase/firestore'?`export const doc=(...a)=>a;export const collection=(...a)=>a;export const query=x=>x;export const orderBy=()=>{};export const serverTimestamp=()=> 'QA-TIME';export const getDoc=async()=>({exists:()=>true,data:()=>globalThis.__coverFixture.catalogue});export const deleteDoc=async()=>{throw Error('Unexpected delete')};export const runTransaction=async(db,fn)=>{const f=globalThis.__coverFixture;if(f.failSizeSave)throw Error('Size save failed');return await fn({get:async ref=>{const item=f.items.find(i=>i.id===ref.at(-1));return{exists:()=>!!item,data:()=>item}},update:(ref,value)=>{f.saved=value;Object.assign(f.items.find(i=>i.id===ref.at(-1)),value);f.notify?.()}})};export const getDocs=async()=>({docs:[]});export const onSnapshot=(ref,cb)=>{const f=globalThis.__coverFixture;f.notify=()=>cb({docs:(f.items||[]).map(i=>({id:i.id,data:()=>i}))});f.notify();return()=>{f.notify=null}};export const updateDoc=async(ref,value)=>{globalThis.__coverFixture.saved=value};export const addDoc=async(ref,value)=>{globalThis.__coverFixture.saved=value;return{id:'new'}}`:
 a.path==='firebase/storage'?`export const ref=()=>{};export const uploadBytes=()=>{throw Error('Unexpected upload')};export const getDownloadURL=()=>{throw Error('Unexpected upload')}`:'export const db={};export const storage={}',loader:'js'}))
 b.onResolve({filter:/\.(png|ttf)$/},a=>({path:resolve(a.resolveDir,a.path),namespace:'asset'}))
 b.onLoad({filter:/.*/,namespace:'asset'},async a=>({contents:`export default ${JSON.stringify(`data:${a.path.endsWith('.ttf')?'font/ttf':'image/png'};base64,`+(await readFile(a.path)).toString('base64'))}`,loader:'js'}))
 }}]})
 pages=await import(pathToFileURL(join(scratch,'pages.mjs')))
})
after(async()=>{dom.window.close();delete globalThis.__coverFixture;await rm(scratch,{recursive:true,force:true})})
async function withPage(kind,catalogue,fn,{id='catalogue',compact=false,items=[]}={}){
 globalThis.__coverFixture={catalogue,id,items}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(React.createElement(pages[kind],{catalogue,compact})));await act(async()=>{await new Promise(r=>setTimeout(r,0))});await fn(host)}finally{await act(async()=>root.unmount());host.remove()}
}
function assertInk(host,color){
 const inner=host.querySelector('.cover-inner');assert.ok(inner)
 assert.equal(inner.style.color,color==='black'?'rgb(0, 0, 0)':'rgb(255, 255, 255)')
 for(const cls of ['cover-title','cover-season','cover-tagline']){const el=host.querySelector('.'+cls);assert.ok(el);assert.equal(el.style.color,'inherit');assert.equal(el.style.opacity,'')}
 assert.equal(host.querySelector('.cover-divider').style.background,'currentcolor')
 assert.equal(host.querySelector('.cover-inner').style.opacity,'')
 assert.equal(host.querySelector('.cover-logo').style.filter,color==='black'?'none':'invert(1) brightness(2)')
}
for(const color of ['white','black'])test(`${color} cover text is solid and shared by editor preview and print/PDF`,async()=>{
 const catalogue={...sample,cover_text_color:color}
 await withPage('cover',catalogue,host=>assertInk(host,color),{compact:true})
 await withPage('print',catalogue,host=>{
  assertInk(host,color);assert.equal(host.querySelector('.cover-overlay').style.opacity,'0.5')
  assert.doesNotMatch(host.querySelector('style').textContent,/\.cover-(?:season|tagline|divider)\s*\{/, 'Print stylesheet must not override the shared cover colours')
 })
})
test('legacy and invalid text-colour values safely use white without changing the overlay',async()=>{
 for(const value of [undefined,null,'gold','WHITE'])await withPage('cover',{...sample,cover_text_color:value,overlay_color:'white',overlay_opacity:0},host=>{assertInk(host,'white');assert.equal(host.querySelector('.cover-overlay').style.opacity,'0')})
})
test('editor saves the selected colour, keeps other cover fields and restores it on reload',async()=>{
 let saved
 await withPage('form',sample,async host=>{
  assert.equal(host.querySelector('[aria-label="White cover text"]').getAttribute('aria-pressed'),'true')
  await act(async()=>host.querySelector('[aria-label="Black cover text"]').click())
  assertInk(host,'black')
  assert.equal(host.querySelector('[aria-label="Black cover text"]').getAttribute('aria-pressed'),'true')
  await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
  saved=globalThis.__coverFixture.saved
  assert.equal(saved.cover_text_color,'black');assert.equal(saved.overlay_color,sample.overlay_color);assert.equal(saved.overlay_opacity,sample.overlay_opacity)
  for(const key of ['name','season','tagline','cover_image','status'])assert.equal(saved[key],sample[key])
 })
 await withPage('form',saved,host=>{assertInk(host,'black');assert.equal(host.querySelector('[aria-label="Black cover text"]').getAttribute('aria-pressed'),'true')})
})
test('new catalogue defaults to white and persists a white selection',async()=>withPage('form',sample,async host=>{
 assert.equal(host.querySelector('[aria-label="White cover text"]').getAttribute('aria-pressed'),'true')
 await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
 assert.equal(globalThis.__coverFixture.saved.cover_text_color,'white')
},{id:null}))
test('without a photo, either ink colour has a contrasting background and optional lines stay absent',async()=>{
 for(const color of ['white','black'])await withPage('cover',{name:'Catalogue',cover_text_color:color},host=>{
  assert.equal(host.querySelector('.cover-page').style.background,color==='black'?'rgb(255, 255, 255)':'rgb(26, 26, 26)')
  assert.equal(host.querySelectorAll('.cover-season,.cover-tagline,.cover-overlay').length,0)
 })
})
test('catalogue print rules unmount with the preview and a cover-only catalogue has no trailing page break',async()=>{
 await withPage('print',sample,host=>{
  assert.match(host.querySelector('style').textContent, /\[data-print-shell\]/)
  assert.ok(host.querySelector('.catalogue-sheet.cat-last-sheet .cover-page'))
 })
 assert.equal(document.querySelectorAll('style').length,0)
})

test('builder adds seventh and eighth images, preserves the snapshot, and saves layout choices', async()=>{
 const item={id:'item-1',product_id:'original-product',product_name:'Original product',product_description:'Complete original specifications',hero_image:'image-1',product_images:Array.from({length:7},(_,i)=>'image-'+(i+2)),selected_images:Array.from({length:6},(_,i)=>'image-'+(i+1)),sort_order:0}
 await withPage('builder',sample,async host=>{
  for(const n of [7,8]){
   const add=[...host.querySelectorAll('button')].find(b=>b.querySelector('img')?.getAttribute('src')==='image-'+n)
   assert.ok(add,`Image ${n} remains selectable`)
   await act(async()=>add.click())
   assert.deepEqual(globalThis.__coverFixture.saved,{selected_images:Array.from({length:n},(_,i)=>'image-'+(i+1))})
  }
  const select=host.querySelector('select[aria-label^="Page layout"]')
  await act(async()=>{select.value='feature';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.deepEqual(globalThis.__coverFixture.saved,{layout_mode:'feature'})
  await act(async()=>host.querySelector('input[type=checkbox]').click())
  assert.deepEqual(globalThis.__coverFixture.saved,{page_break_before:true})
  assert.equal(item.product_description,'Complete original specifications')
  assert.doesNotMatch(host.textContent,/Maximum 6 images|blank slot/)
  assert.match(host.textContent,/8 images/)
  for(const img of host.querySelectorAll('.group\\/img img'))assert.match(img.className,/object-contain/)
 },{items:[item]})
})

test('image-size controls persist URL choices through reorder/reopen and preserve all other item fields', async()=>{
 const item={id:'sizes',product_name:'Infographic product',product_description:'Original complete specifications',marketing_description:'Original introduction',selected_images:['a','b','c'],hero_image:'a',product_images:['b','c'],layout_mode:'feature',page_break_before:true,image_layouts:[{url:'c',size:'large',note:'keep'}]}
 await withPage('builder',sample,async host=>{
  const change=async(n,size)=>{const select=host.querySelector(`select[aria-label="Image ${n} size"]`);await act(async()=>{select.value=size;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
  await change(2,'full');await change(1,'large')
  assert.equal(item.image_layouts.find(i=>i.url==='b').size,'full')
  assert.equal(item.image_layouts.find(i=>i.url==='a').size,'large')
  assert.deepEqual(item.image_layouts.find(i=>i.url==='c'),{url:'c',size:'large',note:'keep'})
  assert.deepEqual(Object.keys(globalThis.__coverFixture.saved),['image_layouts'])
  assert.equal(item.product_description,'Original complete specifications');assert.equal(item.marketing_description,'Original introduction')
  assert.equal(item.layout_mode,'feature');assert.equal(item.page_break_before,true)
  assert.deepEqual(item.selected_images,['a','b','c'])
 },{items:[item]})
 await withPage('builder',sample,host=>{
  assert.equal(host.querySelector('select[aria-label="Image 1 size"]').value,'large')
  assert.equal(host.querySelector('select[aria-label="Image 3 size"]').value,'full')
 },{items:[{...item,selected_images:['c','a','b']}]})
})

test('a failed image-size save is visible and restores the previous choice',async()=>{
 const item={id:'size-error',product_name:'Product',selected_images:['a']}
 await withPage('builder',sample,async host=>{
  globalThis.__coverFixture.failSizeSave=true
  const select=host.querySelector('select[aria-label="Image 1 size"]')
  await act(async()=>{select.value='full';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.equal(select.value,'standard');assert.equal(select.disabled,false)
  assert.match(host.querySelector('[role=alert]').textContent,/Size save failed/)
  assert.equal(item.image_layouts,undefined)
 },{items:[item]})
})
