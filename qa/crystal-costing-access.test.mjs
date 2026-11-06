// Real components, AccessContext/useCan, loaders and Router. Only Firebase I/O
// is fictional. In particular, do not stub useCan as a boolean: it is a predicate.
import {test as nodeTest,before,after,beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {MemoryRouter} from 'react-router-dom'

const require=createRequire(import.meta.url),test=(name,fn)=>nodeTest(name,{timeout:10000},fn)
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://fictional.test'})
for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const variant={id:'v_example',code:'CC-FICTIONAL-RED',label:'Red',size:'14 mm',colour:'Red',holes:'2',effect:'',backing:'',unit:'pcs',confirmed:true,publication:'published'}
const product={id:'cp_example',code:'CC-FICTIONAL',name:'Fictional crystal',family:'cut',origin:'crystocraft',supply:'made_to_order',publication:'draft',hero_id:'',primary_variant_id:variant.id,variants:[variant],images:[]}
let scratch,ui,host,root,f,errors,originalError,originalFetch
const firestore=`
 const f=()=>globalThis.__crystalAccessFixture;
 export const collection=(...args)=>({path:args.map(x=>typeof x==='string'?x:x?.path||'').filter(Boolean).join('/')});
 export const doc=collection,query=(ref,...filters)=>({...ref,filters}),where=(...values)=>values,limit=value=>value,orderBy=(...values)=>values;
 export const getDocs=async ref=>{
  if(ref.path==='range_components'){f().privateCalls.push(ref.path);return{docs:[]}}
  if(ref.path==='crystal_products'){f().publicCalls.push(ref.path);return{docs:[{id:'cp_example',data:()=>f().product}]}}
  if(ref.path==='crystal_swatches'){f().publicCalls.push(ref.path);return{docs:[]}}
  if(ref.path==='crystals'){f().privateCalls.push(ref.path);return{docs:[]}}
  throw Error('Unexpected fictional collection read: '+ref.path);
 };
 const forbidden=(...args)=>{f().unexpected.push(args);throw Error('No other Firebase operation is permitted')};
 export{forbidden as getDoc,forbidden as runTransaction,forbidden as setDoc,forbidden as addDoc,forbidden as deleteDoc,forbidden as updateDoc,forbidden as onSnapshot,forbidden as writeBatch,forbidden as increment,forbidden as serverTimestamp};
`
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'oc-crystal-access-'))
 await build({stdin:{contents:"export{AccessContext}from'./src/access';export{default as Panel}from'./src/components/CrystalSupplierCosting';export{CrystalStockLink as StockLink}from'./src/components/CrystalVariantEditor';export{default as Catalogue}from'./src/pages/CrystalComponents';",resolveDir:resolve('.')},outfile:join(scratch,'ui.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'fictional-firebase-only',setup(b){
  b.onResolve({filter:/^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
  b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}))
  b.onResolve({filter:/^firebase\/storage$/},()=>({path:'storage',namespace:'fixture'}))
  b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='firestore'?firestore:a.path==='storage'?"const fail=()=>{throw Error('No Storage calls permitted')};export{fail as ref,fail as uploadBytes,fail as getDownloadURL,fail as deleteObject};":"export const db={},storage={};export const authedUser=async()=>{throw Error('No media or authentication calls permitted')};"}))
 }}]})
 ui=await import(pathToFileURL(join(scratch,'ui.mjs')))
 originalFetch=globalThis.fetch
 globalThis.fetch=(...args)=>{f.unexpected.push(args);throw Error('No network calls permitted')}
})
beforeEach(()=>{
 f=globalThis.__crystalAccessFixture={product:structuredClone(product),privateCalls:[],publicCalls:[],unexpected:[]}
 errors=[];originalError=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
 try{await act(async()=>root.unmount());assert.deepEqual(errors,[]);assert.deepEqual(f.unexpected,[])}
 finally{console.error=originalError;host.remove();delete globalThis.__crystalAccessFixture}
})
after(async()=>{globalThis.fetch=originalFetch;dom.window.close();if(scratch)await rm(scratch,{recursive:true,force:true})})
async function render(profile,children){
 await act(async()=>root.render(React.createElement(MemoryRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(ui.AccessContext.Provider,{value:profile},children))))
 await act(async()=>{await Promise.resolve();await Promise.resolve()})
}
const panelAndStock=()=>React.createElement(React.Fragment,null,React.createElement(ui.Panel,{product}),React.createElement(ui.StockLink,{product,variant}))
const button=label=>[...host.querySelectorAll('button')].find(el=>el.textContent.trim()===label)
for(const [name,profile]of[
 ['swatch-only staff',{role:'staff',modules:['swatch']}],
 ['customer',{role:'customer',modules:[]}],
 ['anonymous',{role:null,modules:[]}],
])test(name+' renders no supplier costing or stock controls and performs zero private reads',async()=>{
 await render(profile,panelAndStock())
 assert.equal(host.querySelector('[aria-label="Supplier quotes and costing"]'),null)
 assert.equal(button('Review stock link'),undefined)
 assert.deepEqual(f.privateCalls,[])
 assert.equal(host.textContent,'')
})
for(const [name,profile]of[
 ['admin',{role:'admin',modules:[]}],
 ['staff with swatch and supply',{role:'staff',modules:['swatch','supply']}],
])test(name+' mounts supplier costing, loads its real private loader and shows stock linking',async()=>{
 await render(profile,panelAndStock())
 assert.ok(host.querySelector('[aria-label="Supplier quotes and costing"]'))
 assert.match(host.textContent,/No internal cost component linked/)
 assert.ok(button('Review stock link'))
 assert.deepEqual(f.privateCalls,['range_components'])
})
test('swatch-only staff sees the catalogue without stock preparation or any stock/costing read',async()=>{
 await render({role:'staff',modules:['swatch']},React.createElement(ui.Catalogue))
 assert.match(host.textContent,/Crystal Components/)
 assert.equal(button('Prepare from existing stock'),undefined)
 assert.deepEqual(f.privateCalls,[])
 assert.deepEqual(f.publicCalls.sort(),['crystal_products','crystal_swatches'])
})
test('staff with both modules sees the stock-preparation action without reading stock before a click',async()=>{
 await render({role:'staff',modules:['swatch','supply']},React.createElement(ui.Catalogue))
 assert.ok(button('Prepare from existing stock'))
 assert.deepEqual(f.privateCalls,[])
})
