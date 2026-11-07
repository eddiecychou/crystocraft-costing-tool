import {test,before,after,beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act,useState} from 'react'
import {emptyCustomerFileMetadata} from '../src/customerFilesModel.js'
const require=createRequire(import.meta.url)
let scratch,api,dom,root,host,createRoot,Simulate,state
const find=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const change=async(el,value)=>{assert.ok(el);await act(async()=>Simulate.change(el,{target:{value}}))}
before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/qa/customer-files'})
  for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key]
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  createRoot=(await import('react-dom/client')).createRoot;Simulate=(await import('react-dom/test-utils')).Simulate
  scratch=await mkdtemp(join(tmpdir(),'oc-customer-files-ui-'))
  await build({stdin:{contents:'export{default as CustomerFiles,CustomerFileMetadataForm}from"./src/components/crm/CustomerFiles.jsx";export{AccessContext}from"./src/access.js";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',jsx:'automatic',outfile:join(scratch,'ui.mjs'),plugins:[{name:'customer-files-fictional-io',setup(b){
    b.onResolve({filter:/^(?:react(?:-dom)?(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
    b.onResolve({filter:/\/customerFiles$/},()=>({path:'api',namespace:'files-fixture'}))
    b.onResolve({filter:/CustomerFilePreview$/},()=>({path:'preview',namespace:'files-fixture'}))
    b.onLoad({filter:/.*/,namespace:'files-fixture'},a=>({contents:a.path==='preview'?'export default()=>null':`
      const f=()=>globalThis.__customerFilesUi;
      export const listCustomerFiles=async(id,cursor,signal)=>{f().reads.push(id);return f().list(id,signal)};
      export const uploadCustomerFile=(...a)=>f().upload(...a);
      export const updateCustomerFile=(...a)=>f().update(...a);
      export const readCustomerFile=()=>Promise.reject(Error('Unexpected private binary read'));
      export const downloadCustomerFile=readCustomerFile,saveCustomerFileThumbnail=readCustomerFile;
    `,loader:'js'}))
  }}]})
  api=await import(pathToFileURL(join(scratch,'ui.mjs')))
})
beforeEach(()=>{
  state={reads:[],writes:[],list:async()=>({files:[],contacts:[{id:'person_cindy',name:'Cindy'},{id:'person_tony',name:'Tony'}],next:null}),upload:async()=>{throw Error('Unexpected upload')},update:async()=>{throw Error('Unexpected metadata write')}}
  globalThis.__customerFilesUi=state;host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
after(async()=>{await rm(scratch,{recursive:true,force:true});dom.window.close();delete globalThis.__customerFilesUi})
const render=async(role='admin',modules=[],customerId='qa_a')=>act(async()=>root.render(React.createElement(api.AccessContext.Provider,{value:{role,modules}},React.createElement(api.CustomerFiles,{customerId}))))

test('actual UI refuses customer/unknown/unrelated staff without a file read, including forged customer modules',async()=>{
  for(const[role,modules]of [['customer',['customers']],['staff',['marketing']],['staff',['supply']],['unknown',['customers']]]){
    await render(role,modules);assert.equal(host.querySelector('[data-customer-files]'),null);assert.deepEqual(state.reads,[])
  }
  await render('staff',['customers']);assert.deepEqual(state.reads,['qa_a']);assert.ok(find('Upload files'))
})
test('form labels resolve exact controls and contact/side edits remain file-only',async()=>{
  let output,initial={...emptyCustomerFileMetadata(),card_side:'front',card_set:'Cindy card'},contacts=[{id:'person_cindy',name:'Cindy'},{id:'person_tony',name:'Tony'}],before=structuredClone(contacts)
  function Form(){const[value,setValue]=useState(initial);return React.createElement(api.CustomerFileMetadataForm,{value,contacts,onChange:next=>{output=next;setValue(next)}})}
  await act(async()=>root.render(React.createElement(Form)))
  const control=text=>{const label=[...host.querySelectorAll('label')].find(l=>l.textContent===text);assert.ok(label,text);return document.getElementById(label.htmlFor)}
  assert.equal(control('Card side').tagName,'SELECT');assert.equal(control('Title').tagName,'INPUT')
  assert.equal(new Set([...host.querySelectorAll('[id]')].map(n=>n.id)).size,host.querySelectorAll('[id]').length)
  await change(control('Title'),'Reviewed card');assert.equal(output.title,'Reviewed card')
  const cindy=[...host.querySelectorAll('input[type=checkbox]')][0]
  await act(async()=>Simulate.change(cindy,{target:{checked:true}}));assert.deepEqual(output.contact_ids,['person_cindy'])
  await change(control('Category'),'customer_document');assert.equal(output.card_side,'');assert.equal(output.card_set,'');assert.deepEqual(contacts,before);assert.deepEqual(state.writes,[])
})
test('late company A listing cannot replace company B files on the same route instance',async()=>{
  let release
  state.list=async id=>id==='qa_a'?new Promise(resolve=>{release=resolve}):({files:[],contacts:[],next:null})
  await render();assert.deepEqual(state.reads,['qa_a'])
  await render('admin',[],'qa_b');assert.deepEqual(state.reads,['qa_a','qa_b'])
  await act(async()=>release({files:[{id:'old',filename:'A private card',category:'other',content_type:'image/png',byte_size:10,status:'uploading'}],contacts:[],next:null}))
  assert.doesNotMatch(host.textContent,/A private card/);assert.match(host.textContent,/No business cards or customer files yet/)
})
test('upload is an explicit action and repeated clicks reserve only one in-flight batch',async()=>{
  await render();await act(async()=>find('Upload files').click())
  const input=host.querySelector('input[type=file]'),file={name:'Original card.png',type:'image/png',size:200}
  await act(async()=>Simulate.change(input,{target:{files:[file],value:''}}));assert.equal(state.writes.length,0)
  let release
  state.upload=async(...args)=>{state.writes.push(args);return new Promise(resolve=>{release=resolve})}
  const upload=[...host.querySelectorAll('dialog button')].find(b=>b.textContent==='Upload files')
  await act(async()=>{Simulate.click(upload);Simulate.click(upload)})
  assert.equal(state.writes.length,1);assert.equal(state.writes[0][0],'qa_a');assert.equal(state.writes[0][1],file)
  await act(async()=>release({file:{filename:file.name},alreadyStored:false,detailsPreserved:false}))
  assert.match(host.textContent,/Saved/)
})
test('pending metadata save visibly disables close; errors retain reviewed edits and restore controls',async()=>{
  const file={...emptyCustomerFileMetadata(),id:'existing',filename:'Existing.png',byte_size:10,content_type:'image/png',status:'uploading',revision:1}
  state.list=async()=>({files:[file],contacts:[],next:null})
  let reject
  state.update=(...args)=>{state.writes.push(args);return new Promise((resolve,no)=>{reject=no})}
  await render();await act(async()=>find('Edit details').click())
  const dialog=host.querySelector('dialog'),title=[...dialog.querySelectorAll('label')].find(l=>l.textContent==='Title')
  await change(document.getElementById(title.htmlFor),'Keep these reviewed edits')
  await act(async()=>Simulate.submit(dialog.querySelector('form')))
  assert.equal(dialog.querySelector('button[aria-label="Close dialog"]').disabled,true)
  assert.equal(find('Cancel').disabled,true)
  await act(async()=>reject(Error('Fictional save conflict — reload before saving.')))
  assert.equal(dialog.querySelector('button[aria-label="Close dialog"]').disabled,false)
  assert.equal(document.getElementById(title.htmlFor).value,'Keep these reviewed edits')
  assert.match(dialog.textContent,/Fictional save conflict/);assert.equal(state.writes.length,1)
})
