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
 await build({stdin:{contents:`export {default as form} from './src/pages/CatalogueForm.jsx';export {default as print} from './src/pages/CataloguePreview.jsx';export {default as cover} from './src/components/CatalogueCover.jsx'`,resolveDir:rootDir},outfile:join(scratch,'pages.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'cover-boundaries',setup(b){
 b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
 b.onResolve({filter:/^(react-router-dom|firebase\/firestore|firebase\/storage)$/},a=>({path:a.path,namespace:'mock'}))
 b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react-router-dom'?`import React from 'react';export const useParams=()=>({id:globalThis.__coverFixture.id});export const useNavigate=()=>x=>globalThis.__coverFixture.destination=x;export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children)`:
 a.path==='firebase/firestore'?`export const doc=(...a)=>a;export const collection=(...a)=>a;export const query=x=>x;export const orderBy=()=>{};export const serverTimestamp=()=> 'QA-TIME';export const getDoc=async()=>({exists:()=>true,data:()=>globalThis.__coverFixture.catalogue});export const getDocs=async()=>({docs:[]});export const updateDoc=async(ref,value)=>{globalThis.__coverFixture.saved=value};export const addDoc=async(ref,value)=>{globalThis.__coverFixture.saved=value;return{id:'new'}}`:
 a.path==='firebase/storage'?`export const ref=()=>{};export const uploadBytes=()=>{throw Error('Unexpected upload')};export const getDownloadURL=()=>{throw Error('Unexpected upload')}`:'export const db={};export const storage={}',loader:'js'}))
 b.onResolve({filter:/\.(png|ttf)$/},a=>({path:resolve(a.resolveDir,a.path),namespace:'asset'}))
 b.onLoad({filter:/.*/,namespace:'asset'},async a=>({contents:`export default ${JSON.stringify(`data:${a.path.endsWith('.ttf')?'font/ttf':'image/png'};base64,`+(await readFile(a.path)).toString('base64'))}`,loader:'js'}))
 }}]})
 pages=await import(pathToFileURL(join(scratch,'pages.mjs')))
})
after(async()=>{dom.window.close();delete globalThis.__coverFixture;await rm(scratch,{recursive:true,force:true})})
async function withPage(kind,catalogue,fn,{id='catalogue',compact=false}={}){
 globalThis.__coverFixture={catalogue,id}
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
