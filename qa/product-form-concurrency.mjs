import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve,basename} from 'node:path';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const scratch=await mkdtemp(tmpdir()+'/oc-product-form-');
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const require=createRequire(import.meta.url);
const dom=new JSDOM('<body></body>',{url:'https://fictional.invalid/products/A/edit'});
for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.fetch=()=>{throw Error('Network forbidden')};
const {createRoot}=await import('react-dom/client');
const {MemoryRouter,Routes,Route}=await import('react-router-dom');
const {Simulate}=await import('react-dom/test-utils');
const stored={name:'Fictional product',category:'Others',status:'concept',description:'Old description',assembly_notes:'Old notes',heroImage:'https://fictional.invalid/old.jpg',heroImage_visibility:'public',heroImage_branded_for_customer_id:null,active:true};
const read=structuredClone(stored),writes=[];
globalThis.__productReview={read:()=>structuredClone(read),current:()=>structuredClone(stored),write:async(path,patch)=>{writes.push({path,patch});Object.assign(stored,patch)}};
const stubs={firebase:'export const db={};',firestore:`export const doc=(...a)=>a.slice(1),collection=(...a)=>a.slice(1),serverTimestamp=()=> 'fictional timestamp';export const getDoc=async()=>({exists:()=>true,data:()=>globalThis.__productReview.read()});export const runTransaction=async(_,fn)=>fn({get:async()=>({exists:()=>true,data:()=>globalThis.__productReview.current()}),update:(...args)=>globalThis.__productReview.write(...args)});export const addDoc=()=>{throw Error('Unexpected create')};`};
await build({entryPoints:['src/pages/ProductForm.jsx'],outfile:scratch+'/form-bundle.mjs',bundle:true,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'fictional-io',setup(b){
 b.onResolve({filter:/^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}));
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fake'}));
 b.onResolve({filter:/^\.\.?\//},a=>{const n=basename(a.path).replace(/\.jsx?$/,'');if(n==='firebase')return{path:n,namespace:'fake'};if(['MarketingCopyEditor','VideoUrlsEditor','BlogLinksEditor'].includes(n))return{path:'child',namespace:'fake'}});
 b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:stubs[a.path]||'export default()=>null;',loader:'js'}));
}}]});
const Page=(await import(pathToFileURL(resolve(scratch+'/form-bundle.mjs')))).default;
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
try{
 await act(async()=>root.render(React.createElement(MemoryRouter,{initialEntries:['/products/A/edit'],future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(Routes,null,React.createElement(Route,{path:'/products/:id/edit',element:React.createElement(Page)}),React.createElement(Route,{path:'/products/:id',element:React.createElement('p',null,'Saved')})))));
 // Another operator replaces the hero and hides the product after this editor loaded.
 stored.heroImage='https://fictional.invalid/replacement.jpg';stored.heroImage_visibility='internal';stored.active=false;
 const before=structuredClone(stored);
 await act(async()=>Simulate.change(host.querySelector('input'),{target:{value:'Renamed product only'}}));
 await act(async()=>Simulate.submit(host.querySelector('form')));
 assert.equal(writes.length,1);assert.equal(stored.name,'Renamed product only');
 assert.equal(stored.heroImage,'https://fictional.invalid/replacement.jpg');assert.equal(stored.active,false);assert.equal(stored.heroImage_visibility,'internal');
 assert.deepEqual(Object.keys(writes[0].patch).sort(),['name','updatedAt']);
 await act(async()=>root.unmount());
 const root2=createRoot(host);
 try {
  Object.assign(stored,read);writes.length=0;
  await act(async()=>root2.render(React.createElement(MemoryRouter,{initialEntries:['/products/A/edit'],future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(Routes,null,React.createElement(Route,{path:'/products/:id/edit',element:React.createElement(Page)})))));
  await act(async()=>Simulate.change(host.querySelector('input'),{target:{value:'Keep my unsaved draft'}}));
  stored.name='Another operator';
  const savedConsole=console.error;console.error=()=>{};
  try { await act(async()=>Simulate.submit(host.querySelector('form'))); } finally { console.error=savedConsole }
  assert.equal(writes.length,0);assert.equal(stored.name,'Another operator');
  assert.equal(host.querySelector('input').value,'Keep my unsaved draft');assert.match(host.textContent,/draft has been kept/);
 } finally {await act(async()=>root2.unmount())}
 console.log('Actual ProductForm: unrelated concurrent changes preserved; same-field conflict kept unsaved draft.');
}finally{await act(async()=>root.unmount());dom.window.close();await rm(scratch,{recursive:true,force:true})}
