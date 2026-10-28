// Real form and submit handler; only Firebase/router boundaries are isolated.
import {before, after, test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React, {act} from 'react'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', {url:'http://quote.test'})
for (const key of ['window','document','HTMLElement','MouseEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', {value:dom.window.navigator, configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const {createRoot} = await import('react-dom/client')
const {Simulate} = await import('react-dom/test-utils')
let scratch, Form
const attachment = {file_url:'/source.pdf',file_name:'source.pdf',file_type:'pdf',metadata:{source:'supplier',revision:1}}
const initial = {
  supplier_id:'s',supplier_name:'Supplier',unit_cost:1.222,unit_cost_currency:'USD',moq:1000,
  tooling_sample_cost:155,tooling_sample_cost_currency:'USD',production_lead_time_days:30,
  is_preferred:true,notes:'Approved terms 中文',volume_tiers:[{min_qty:2000,unit_cost:1.111}],
  attachments:[attachment],createdAt:'original',agent_provenance:'preserve',
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(),'oc-quote-save-'))
  await build({entryPoints:['src/pages/SupplierQuoteForm.jsx'],outfile:join(scratch,'form.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{
    name:'isolated-quote-boundaries',setup(b) {
      b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
      b.onResolve({filter:/^(react-router-dom|firebase\/firestore|firebase\/storage)$|(^|\/)firebase$/},a=>({path:a.path,namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:
        a.path==='react-router-dom' ? `import React from 'react';export const useParams=()=>({productId:'p',componentId:'c',quoteId:'q'});export const useNavigate=()=>to=>globalThis.__quoteSave.destination=to;export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children);` :
        a.path==='firebase/firestore' ? `
          const state=()=>globalThis.__quoteSave;
          export const doc=(_, ...p)=>p.join('/'),collection=doc,query=x=>x,orderBy=x=>x,serverTimestamp=()=> 'timestamp';
          const snap=(p,data)=>({id:p.split('/').at(-1),ref:p,exists:()=>!!data,data:()=>structuredClone(data)});
          export const getDoc=async p=>snap(p,p.endsWith('/q')?state().quote:{name:'Fixture product/component'});
          export const getDocs=async p=>({docs:p==='suppliers'?[snap('suppliers/s',{name:'Supplier'})]:p.endsWith('/catalogs')?[snap(p+'/f',{file_name:'Additional.pdf',file_url:'/additional.pdf',file_type:'application/pdf'})]:[]});
          export const updateDoc=async(p,data)=>{state().writes.push({path:p,data:structuredClone(data)});state().quote={...state().quote,...data}};
          export async function runTransaction(_,fn){
            const pending=[];await fn({get:async p=>{if(state().error)throw Error(state().error);return snap(p,state().transactionQuote??state().quote)},update:(p,d)=>pending.push([p,d])});
            for(const [p,d] of pending)await updateDoc(p,d);
          }
          export const addDoc=async()=>{throw Error('No duplicate quotes')},deleteDoc=async()=>{throw Error('No deletions')};` :
        a.path==='firebase/storage' ? `export const ref=()=>{},uploadBytes=async()=>{throw Error('No upload expected')},getDownloadURL=async()=>{throw Error('No upload expected')};` :
        `export const db={},storage={},authHeader=async()=>{throw Error('No extraction expected')};`
      }))
    },
  }]})
  Form = (await import(pathToFileURL(join(scratch,'form.mjs')))).default
})
after(async()=>{dom.window.close();delete globalThis.__quoteSave;await rm(scratch,{recursive:true,force:true})})
async function withForm(fn, quote=initial) {
  const state = globalThis.__quoteSave = {quote:structuredClone(quote),writes:[],destination:null}
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async()=>root.render(React.createElement(Form)))
    assert.ok(host.querySelector('form'))
    await fn(host,state)
  } finally { await act(async()=>root.unmount()); host.remove() }
}
async function submit(host) {
  await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
}
const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v==='object'
  ? Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])) : v

test('unchanged agent-created attachment with reordered map keys saves and exits without rewriting terms',()=>withForm(async(host,state)=>{
  state.transactionQuote = reorder(state.quote)
  assert.notEqual(JSON.stringify(state.transactionQuote.attachments),JSON.stringify(state.quote.attachments))
  await submit(host)
  assert.equal(state.destination,'/products/p/components/c')
  assert.equal(state.writes.length,1)
  assert.deepEqual(Object.keys(state.writes[0].data),['attachments'])
  assert.deepEqual(state.quote,initial)
}))
test('linking another PDF preserves concurrent pricing, notes and preference changes',()=>withForm(async(host,state)=>{
  const button = text => [...host.querySelectorAll('button')].find(b=>b.textContent===text)
  await act(async()=>button('Choose supplier file').click())
  await act(async()=>button('Attach file').click())
  const approved = {...state.quote,unit_cost:1.444,moq:3000,tooling_sample_cost:175,notes:'Concurrent approved terms',is_preferred:false}
  state.quote = approved
  state.transactionQuote = reorder(approved)
  await submit(host)
  assert.equal(state.destination,'/products/p/components/c')
  assert.deepEqual(Object.keys(state.writes[0].data),['attachments'])
  assert.deepEqual({...state.quote,attachments:initial.attachments},approved)
  assert.equal(state.quote.attachments.length,2)
  assert.equal(state.quote.attachments[1].file_url,'/additional.pdf')
}))
for (const [label,change] of [
  ['file URL',a=>({...a,file_url:'/replacement.pdf'})],
  ['nested metadata',a=>({...a,metadata:{...a.metadata,revision:2}})],
  ['removed metadata',a=>{const {metadata,...rest}=a;return rest}],
]) test(`real concurrent attachment change (${label}) stays blocked with error beside Save Changes`,()=>withForm(async(host,state)=>{
  state.transactionQuote = {...state.quote,attachments:[change(attachment)]}
  await submit(host)
  assert.equal(state.destination,null); assert.deepEqual(state.writes,[])
  const alert = host.querySelector('[role="alert"]')
  assert.match(alert.textContent,/Attachments changed in another session/)
  assert.ok(alert.nextElementSibling.querySelector('button[type="submit"]'))
  assert.ok(document.activeElement===alert)
  assert.equal(host.querySelector('textarea').value,initial.notes)
}))
test('genuine attachment addition or removal is rejected',async()=>{
  for (const attachments of [[],[attachment,{...attachment,file_url:'/other.pdf'}]]) await withForm(async(host,state)=>{
    state.transactionQuote = {...state.quote,attachments}
    await submit(host)
    assert.deepEqual(state.writes,[]); assert.equal(state.destination,null)
  })
})
test('attachment array order remains significant',()=>withForm(async(host,state)=>{
  state.transactionQuote = {...state.quote,attachments:[...state.quote.attachments].reverse()}
  await submit(host)
  assert.deepEqual(state.writes,[]); assert.equal(state.destination,null)
}, {...initial,attachments:[attachment,{...attachment,file_url:'/second.pdf'}]}))
test('a transient save failure retains edits and unlocks retry',()=>withForm(async(host,state)=>{
  state.error = 'Temporary connection failure'
  await submit(host)
  assert.match(host.querySelector('[role="alert"]').textContent,/Temporary connection failure/)
  assert.equal(host.querySelector('button[type="submit"]').disabled,false)
  state.error = null
  await submit(host)
  assert.equal(state.destination,'/products/p/components/c'); assert.equal(state.writes.length,1)
}))
test('intentional main and tier cost edits retain exact three-decimal values',()=>withForm(async(host,state)=>{
  const inputs = host.querySelectorAll('input[step="0.001"]')
  await act(async()=>{Simulate.change(inputs[0],{target:{value:'1.223'}});Simulate.change(inputs[1],{target:{value:'1.112'}})})
  await submit(host)
  assert.equal(state.destination,'/products/p/components/c')
  assert.equal(state.quote.unit_cost,1.223); assert.equal(state.quote.volume_tiers[0].unit_cost,1.112)
  assert.equal(state.quote.moq,1000); assert.equal(state.quote.tooling_sample_cost,155)
  assert.equal(state.quote.notes,initial.notes); assert.equal(state.quote.is_preferred,true)
}))
