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
let scratch, Form, RangeForm, QuickAdd
const attachment = {file_url:'/source.pdf',file_name:'source.pdf',file_type:'pdf',metadata:{source:'supplier',revision:1}}
const initial = {
  supplier_id:'s',supplier_name:'Supplier',unit_cost:1.222,unit_cost_currency:'USD',moq:1000,
  tooling_sample_cost:155,tooling_sample_cost_currency:'USD',production_lead_time_days:30,
  is_preferred:true,notes:'Approved terms 中文',volume_tiers:[{min_qty:2000,unit_cost:1.111}],
  attachments:[attachment],createdAt:'original',agent_provenance:'preserve',
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(),'oc-quote-save-'))
  await build({entryPoints:{SupplierQuoteForm:'src/pages/SupplierQuoteForm.jsx',RangeQuoteForm:'src/pages/RangeQuoteForm.jsx',SupplierAddQuoteModal:'src/components/SupplierAddQuoteModal.jsx'},outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{
    name:'isolated-quote-boundaries',setup(b) {
      b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
      b.onResolve({filter:/^(react-router-dom|firebase\/firestore|firebase\/storage)$|(^|\/)(firebase|criticalComponents|i18n)$/},a=>({path:a.path,namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:
        a.path==='react-router-dom' ? `import React from 'react';
          export const useParams=()=>({id:'c',productId:'p',componentId:'c',quoteId:globalThis.__quoteSave.newRange ? undefined : 'q'});
          export const useSearchParams=()=>[new URLSearchParams('back=%2Frange%2Fexample%2Fcosting')];
          export const useNavigate=()=>to=>globalThis.__quoteSave.destination=to;
          export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children);` :
        a.path==='firebase/firestore' ? `
          const state=()=>globalThis.__quoteSave;
          const path=(base, parts)=>[typeof base==='string'?base:'',...parts].filter(Boolean).join('/');
          export const collection=(base,...p)=>path(base,p),doc=(base,...p)=>path(base,p.length?p:['new-quote']);
          export const query=x=>x,orderBy=x=>x,serverTimestamp=()=> 'timestamp';
          const snap=(p,data)=>({id:p.split('/').at(-1),ref:p,exists:()=>!!data,data:()=>structuredClone(data)});
          export const getDoc=async p=>snap(p,p.endsWith('/q')?state().quote:{name:'Fixture product/component'});
          export const getDocs=async p=>({docs:p==='suppliers'?[snap('suppliers/s',{name:'Supplier'})]:
            p.endsWith('/catalogs')?[snap(p+'/f',{file_name:'Additional.pdf',file_url:'/additional.pdf',file_type:'application/pdf'})]:
            p==='products'?[snap(p+'/p',{name:'Fixture gift'})]:
            p==='products/p/components'?[snap(p+'/c',{name:'Fixture component'})]:
            p.endsWith('/supplier_quotes')?[snap(p+'/q',state().quote)]:[]});
          export const getDocsFromServer=getDocs;
          const dataAt=p=>p.endsWith('/q')?(state().transactionQuote??state().quote):p.endsWith('/new-quote')?state().newQuote:{name:'Fixture component'};
          const write=(p,data)=>{state().writes.push({path:p,data:structuredClone(data)});if(p.endsWith('/q'))state().quote={...state().quote,...data};if(p.endsWith('/new-quote'))state().newQuote={...data};};
          export async function runTransaction(_,fn){
            const pending=[],stage=(p,d)=>pending.push([p,d]);
            await fn({get:async p=>{if(state().error)throw Error(state().error);return snap(p,dataAt(p))},update:stage,set:stage});
            if(state().commitError) throw Error(state().commitError);
            if(state().transactionQuote) state().quote=structuredClone(state().transactionQuote);
            for(const [p,d] of pending)write(p,d);
          }
          export const deleteDoc=async()=>{throw Error('No deletions')};` :
        a.path.endsWith('/i18n') ? 'export const useT = () => text => text' :
        /(^|\/)criticalComponents$/.test(a.path) ? `
          export const getComponent=async id=>({id,name:'Fixture range component'});
          export const saveComponentQuote=async (id,quoteId,data,_context,options)=>{
            const state=globalThis.__quoteSave;
            if(!state.range) throw Error('Corporate quotes must use their own writer');
            const path='range_components/'+id+'/supplier_quotes/'+(quoteId || options.createId);
            const attempt={path,data,original:options.original?.stored};
            state.rangeAttempts.push(attempt);
            if(state.commitError) throw Error(state.commitError);
            state.writes.push({path,data});
            state.quote={...state.quote,...data};
          };
          export const deleteComponentQuote=async (id,quoteId,_context,options)=>{
            const state=globalThis.__quoteSave;
            state.deleteAttempts.push({id,quoteId,original:options.original});
            if(state.commitError) throw Error(state.commitError);
            state.quote=null;
          };` :
        a.path==='firebase/storage' ? `
          export const ref=(_storage,path)=>path;
          export const uploadBytes=async(path,file,metadata)=>{
            const state=globalThis.__quoteSave;
            if(!state.range) throw Error('No upload expected');
            if(state.uploadError===file.name) throw Error('Fictional upload rejected');
            state.uploads.push({path,file,metadata});
          };
          export const getDownloadURL=async()=>'/uploaded.pdf';` :
        `export const db={},storage={},authHeader=async()=>{throw Error('No extraction expected')};`
      }))
    },
  }]})
  Form = (await import(pathToFileURL(join(scratch,'SupplierQuoteForm.mjs')))).default
  RangeForm = (await import(pathToFileURL(join(scratch,'RangeQuoteForm.mjs')))).default
  QuickAdd = (await import(pathToFileURL(join(scratch,'SupplierAddQuoteModal.mjs')))).default
})
after(async()=>{dom.window.close();delete globalThis.__quoteSave;await rm(scratch,{recursive:true,force:true})})
async function withForm(fn, quote=initial, Editor=Form, options={}) {
  const state = globalThis.__quoteSave = {
    quote:structuredClone(quote),writes:[],uploads:[],destination:null,range:Editor===RangeForm,
    rangeAttempts:[],deleteAttempts:[],...options,
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async()=>root.render(React.createElement(Editor, {
      supplier: { id: 'supplier-new', name: 'Fictional new supplier' },
      onSaved: () => { state.saved = true },
      onClose: () => { state.closed = true },
    })))
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

test('Range accepts and reopens three-decimal main and tier costs through the real submit button', async () => {
  let saved
  await withForm(async (host, state) => {
    const [unit, tier] = host.querySelectorAll('input[placeholder="0.000"]')
    assert.equal(unit.step, '0.001')
    assert.equal(tier.step, '0.001')
    assert.equal(unit.value, '1.222')
    assert.equal(tier.value, '1.111')
    await act(async () => {
      Simulate.change(unit, { target: { value: '1.223' } })
      Simulate.change(tier, { target: { value: '1.112' } })
    })
    assert.equal(host.querySelector('form').checkValidity(), true)
    await act(async () => host.querySelector('button[type="submit"]').click())
    assert.equal(state.destination, '/range/example/costing')
    assert.equal(state.writes.length, 1)
    assert.equal(state.writes[0].path, 'range_components/c/supplier_quotes/q')
    assert.equal(Number(state.quote.unit_cost), 1.223)
    assert.equal(Number(state.quote.volume_tiers[0].unit_cost), 1.112)
    assert.equal(state.quote.notes, initial.notes)
    assert.equal(state.quote.is_preferred, true)
    assert.equal(state.quote.tooling_sample_cost, 155)
    assert.deepEqual(state.quote.attachments, initial.attachments)
    saved = state.quote
  }, initial, RangeForm)
  await withForm(async host => {
    const [unit, tier] = host.querySelectorAll('input[placeholder="0.000"]')
    assert.equal(unit.value, '1.223')
    assert.equal(tier.value, '1.112')
  }, saved, RangeForm)
})

test('Range PDF attachment preserves current approved terms and original source upon reopen', async () => {
  let saved
  await withForm(async (host, state) => {
    const pdf = new dom.window.File(['%PDF-fictional'], 'reference.pdf', { type: 'application/pdf' })
    const input = host.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { value: [pdf] })
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.match(host.textContent, /reference\.pdf/)
    assert.doesNotMatch(host.textContent, /Extracting|Could not extract/)
    state.transactionQuote = { ...initial, unit_cost: 1.333, notes: 'Concurrent approved terms', is_preferred: false }
    await act(async () => host.querySelector('button[type="submit"]').click())
    assert.equal(state.destination, '/range/example/costing')
    assert.equal(state.uploads.length, 1)
    assert.match(state.uploads[0].path, /^range_components\/c\/quotes\//)
    assert.equal(state.uploads[0].file, pdf)
    assert.deepEqual(Object.keys(state.writes[0].data), ['attachments'])
    assert.equal(state.quote.unit_cost, 1.333)
    assert.equal(state.quote.notes, 'Concurrent approved terms')
    assert.equal(state.quote.is_preferred, false)
    assert.equal(state.quote.attachments.length, 2)
    assert.deepEqual(state.quote.attachments[0], attachment)
    saved = state.quote
  }, initial, RangeForm)
  await withForm(async host => {
    assert.equal(host.querySelector('input[placeholder="0.000"]').value, '1.333')
    assert.ok(host.querySelector('a[href="/source.pdf"]'))
    assert.ok(host.querySelector('a[href="/uploaded.pdf"]'))
  }, saved, RangeForm)
})

test('Range new quote keeps the same ID and staged files when upload and save both need retry', () => withForm(async (host, state) => {
  const price = host.querySelector('input[placeholder="0.000"]')
  const notes = host.querySelector('textarea')
  const first = new dom.window.File(['%PDF-fictional'], 'quote.pdf', { type: 'application/pdf' })
  const second = new dom.window.File(['%PDF-fictional'], 'details.pdf', { type: 'application/pdf' })
  const fileInput = host.querySelector('input[type="file"]')
  Object.defineProperty(fileInput, 'files', { value: [first, second] })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    Simulate.change(price, { target: { value: '1.234' } })
    Simulate.change(notes, { target: { value: 'Fictional new quote terms' } })
  })

  state.uploadError = second.name
  await submit(host)
  assert.match(host.querySelector('[role=alert]').textContent, /Fictional upload rejected/)
  assert.equal(state.rangeAttempts.length, 0)
  assert.deepEqual(state.uploads.map(item => item.file.name), [first.name])

  state.uploadError = null
  state.commitError = 'Fictional commit rejected'
  await submit(host)
  assert.match(host.querySelector('[role=alert]').textContent, /Fictional commit rejected/)
  assert.equal(state.destination, null)
  assert.equal(notes.value, 'Fictional new quote terms')
  assert.equal(price.value, '1.234')
  assert.match(host.textContent, /quote\.pdf/)
  assert.match(host.textContent, /details\.pdf/)
  assert.deepEqual(state.uploads.map(item => item.file.name), [first.name, second.name])

  state.commitError = null
  await submit(host)
  assert.equal(state.destination, '/range/example/costing')
  assert.equal(state.rangeAttempts.length, 2)
  assert.deepEqual(state.rangeAttempts[0], state.rangeAttempts[1])
  assert.match(state.rangeAttempts[0].path, /^range_components\/c\/supplier_quotes\/[0-9a-f-]+$/)
  assert.deepEqual(state.uploads.map(item => item.file.name), [first.name, second.name])
}, null, RangeForm, { newRange: true }))

test('Range conflicting edit and rejected delete keep the open quote draft and original baseline', () => withForm(async (host, state) => {
  const notes = host.querySelector('textarea')
  await act(async () => Simulate.change(notes, { target: { value: 'My unsaved Range draft' } }))
  state.commitError = 'These quote terms changed in another session.'
  await submit(host)
  let alert = host.querySelector('[role=alert]')
  assert.match(alert.textContent, /changed in another session/)
  assert.equal(document.activeElement, alert)
  assert.equal(notes.value, 'My unsaved Range draft')
  assert.deepEqual(state.rangeAttempts[0].original, initial)
  assert.equal(state.destination, null)

  const button = name => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name)
  await act(async () => button('Delete Quote').click())
  assert.ok(host.querySelector('[role=dialog]'))
  state.commitError = 'Fictional delete rejected'
  await act(async () => button('Delete').click())
  alert = host.querySelector('[role=alert]')
  assert.match(alert.textContent, /Fictional delete rejected/)
  assert.equal(document.activeElement, alert)
  assert.equal(notes.value, 'My unsaved Range draft')
  assert.equal(state.destination, null)
  assert.deepEqual(state.deleteAttempts[0].original, initial)

  state.commitError = null
  await act(async () => button('Delete Quote').click())
  await act(async () => button('Delete').click())
  assert.equal(state.destination, '/range/example/costing')
  assert.equal(state.quote, null)
}, initial, RangeForm))

test('both editors can save existing finer precision without rounding either price', async () => {
  const higherPrecision = {
    ...initial, unit_cost: 1.22249, volume_tiers: [{ min_qty: 2000, unit_cost: 1.11149 }],
  }
  for (const Editor of [Form, RangeForm]) {
    await withForm(async (host, state) => {
      const [unit, tier] = host.querySelectorAll('input[placeholder="0.000"]')
      assert.equal(unit.value, '1.22249')
      assert.equal(tier.value, '1.11149')
      assert.equal(host.querySelector('form').checkValidity(), true)
      await act(async () => host.querySelector('button[type="submit"]').click())
      assert.equal(state.writes.length, 1)
      assert.deepEqual(Object.keys(state.writes[0].data), ['attachments'])
      assert.deepEqual(state.quote, higherPrecision)
    }, higherPrecision, Editor)
  }
})

test('a Corporate Gifts cost edit does not reselect a quote or replace concurrent attachments', () => withForm(async (host, state) => {
  const concurrentAttachments = [...initial.attachments, { file_url: '/newer.pdf' }]
  state.transactionQuote = { ...initial, is_preferred: false, notes: 'Concurrent approved note', attachments: concurrentAttachments }
  await act(async () => Simulate.change(host.querySelector('input[placeholder="0.000"]'), { target: { value: '1.333' } }))
  await submit(host)
  assert.equal(state.destination, '/products/p/components/c')
  assert.deepEqual(state.writes, [{ path: 'products/p/components/c/supplier_quotes/q', data: { unit_cost: 1.333 } }])
  assert.deepEqual(state.quote, { ...state.transactionQuote, unit_cost: 1.333 })
}))

test('supplier quick-add keeps the existing preference on rejected commit and can retry with its draft', () => withForm(async (host, state) => {
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  await act(async () => Simulate.focus(host.querySelector('input[placeholder="Search products…"]')))
  await act(async () => Simulate.mouseDown(button('Fixture gift')))
  await act(async () => button('Fixture component').click())
  const price = host.querySelector('input[placeholder="0.000"]')
  await act(async () => {
    Simulate.change(price, { target: { value: '1.234' } })
    Simulate.change(host.querySelector('input[type="checkbox"]'), { target: { checked: true } })
  })
  state.commitError = 'Fictional transaction rejected at commit'
  await submit(host)
  assert.deepEqual(state.writes, [])
  assert.equal(state.quote.is_preferred, true)
  assert.equal(price.value, '1.234')
  assert.match(host.textContent, /Fictional transaction rejected/)
  state.commitError = null
  await submit(host)
  assert.equal(state.quote.is_preferred, false)
  assert.equal(state.newQuote.is_preferred, true)
  assert.equal(state.newQuote.unit_cost, 1.234)
  assert.deepEqual(state.quote.attachments, initial.attachments)
  assert.equal(state.saved, true)
  assert.equal(state.closed, true)
}, initial, QuickAdd))
