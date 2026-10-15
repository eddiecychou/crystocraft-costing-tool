import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {rewriteResult} from '../netlify/edge-functions/lib/rewriteResult.js'
const good=(body,extra={})=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({body,...extra})}]}}]})
test('rewrite rejects the screenshot malformed JSON instead of forwarding it',()=>assert.throws(()=>rewriteResult({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"body":"a soft, low-pitched ring'}]}}]})))
test('rewrite rejects truncated, blocked, empty and wrong-shaped replies',()=>{
 for(const data of [{candidates:[{...good('ok').candidates[0],finishReason:'MAX_TOKENS'}]},{candidates:[]},good(''),good(null),good({text:'no'})])assert.throws(()=>rewriteResult(data))
})
test('rewrite joins visible parts and excludes thought content',()=>assert.deepEqual(rewriteResult({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:'{"body":"Soft '},{text:'ring"}'}]}}]}),{body:'Soft ring'}))
test('rewrite length backstop includes ellipsis within the exact budget',()=>{for(const body of ['a'.repeat(400),'A long description '.repeat(30)])assert.ok(rewriteResult(good(body),{budget:300}).body.length<=300)})
test('blog rewrite retains optional heading contract and strips unexpected fields',()=>{assert.deepEqual(rewriteResult(good('Body',{heading:null,extra:'ignore'}),{withHeading:true}),{heading:null,body:'Body'});assert.throws(()=>rewriteResult(good('Body'),{withHeading:true}))})
const require=createRequire(import.meta.url),rootDir=fileURLToPath(new URL('../',import.meta.url))
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://writer.test'})
for(const k of ['window','document','HTMLElement','MouseEvent','Event'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
let scratch,Editor,handler,responses=[],requests=[],allowed=true
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'ai-writer-'))
 await build({stdin:{contents:`export {default as Editor} from './src/components/MarketingCopyEditor.jsx';export {default as handler} from './netlify/edge-functions/rewrite-section.js'`,resolveDir:rootDir},outfile:join(scratch,'writer.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'network-boundaries',setup(b){
 b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
 b.onResolve({filter:/^\.\.?\//},a=>{const n=basename(a.path);if(n==='firebase')return{path:n,namespace:'stub'};if(a.path==='./lib/auth.js')return{path:'auth',namespace:'stub'}})
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='auth'?'export const requireModule=async()=>globalThis.__writerAuth?{ok:true}:{ok:false,response:new Response("Forbidden",{status:403})}':'export const authHeader=async()=>({})',loader:'js'}))
 }}]})
 ;({Editor,handler}=await import(pathToFileURL(join(scratch,'writer.mjs'))))
 globalThis.Deno={env:{get:()=> 'test-key'}}
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});const r=responses.shift();if(r instanceof Error)throw r;assert.ok(r,'unexpected fetch');return r}
})
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__writerAuth;dom.window.close();await rm(scratch,{recursive:true,force:true})})
const request=(body)=>new Request('http://writer.test/api/rewrite-section',{method:'POST',body:JSON.stringify(body)})
const input={section_type:'marketing_description',body:'Current copy',guidance:'Highlight the soft, low-pitched ring when two glasses are gently clinked.',max_chars:300}
test('endpoint retries malformed/truncated output and returns validated JSON',async()=>{
 globalThis.__writerAuth=true;requests=[];responses=[Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"body":"broken'}]}}]}),Response.json(good('A soft, low-pitched ring when two glasses are gently clinked.'))]
 const res=await handler(request(input));assert.equal(res.status,200);assert.match((await res.json()).body,/low-pitched/);assert.equal(requests.length,2)
 for(const r of requests){assert.equal(r.body.generationConfig.responseMimeType,'application/json');assert.deepEqual(r.body.generationConfig.responseSchema.required,['body']);assert.equal(r.body.generationConfig.thinkingConfig.thinkingBudget,0)}
})
test('endpoint returns a friendly JSON error after both attempts fail',async()=>{requests=[];responses=[Response.json(good(null)),Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"body":"broken'}]}}]})];const r=await handler(request(input));assert.equal(r.status,500);const d=await r.json();assert.match(d.error,/current copy has been kept/);assert.doesNotMatch(d.error,/JSON|position|SyntaxError/);assert.equal(requests.length,2)})
test('endpoint validates input and keeps authorization gate',async()=>{requests=[];globalThis.__writerAuth=false;assert.equal((await handler(request(input))).status,403);globalThis.__writerAuth=true;assert.equal((await handler(request({...input,body:null}))).status,400);assert.equal((await handler(new Request('http://writer.test',{method:'POST',body:'bad'}))).status,400);assert.equal(requests.length,0)})
test('endpoint blog heading and marketing character limit remain compatible',async()=>{
 responses=[Response.json(good('a'.repeat(500)))];const r=await handler(request({...input,max_chars:900}));assert.equal((await r.json()).body.length,300)
 responses=[Response.json(good('Blog text',{heading:'New heading'}))];assert.deepEqual(await(await handler(request({...input,section_type:'blog',heading:'Old heading',max_chars:null}))).json(),{heading:'New heading',body:'Blog text'})
})
async function withEditor(copy,fn){let value=copy;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const render=()=>root.render(React.createElement(Editor,{product:{name:'Burgundy glass',description:'Soft, low-pitched ring when two glasses are gently clinked.'},value,onChange:text=>{value=text;render()}}));requests=[];try{await act(async()=>render());await fn(host,()=>value)}finally{await act(async()=>root.unmount());host.remove()}}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)
async function click(b){assert.ok(b);await act(async()=>{b.click();await new Promise(r=>setTimeout(r,0))})}
async function guide(host,text){await act(async()=>{const el=host.querySelector('#marketing-ai-instructions');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
test('one instruction field rewrites into a preview and requires Use this copy',async()=>withEditor('Original copy',async(host,value)=>{
 assert.equal(host.querySelectorAll('#marketing-ai-instructions').length,1);assert.equal(host.querySelectorAll('textarea').length,2)
 await guide(host,input.guidance);responses=[Response.json({body:'Soft, low-pitched ringing when gently clinked.'})];await click(button(host,'AI Rewrite'))
 assert.equal(value(),'Original copy');assert.equal(requests[0].url,'/api/rewrite-section');assert.equal(requests[0].body.guidance,input.guidance);assert.match(host.textContent,/AI draft/)
 await click(button(host,'Use this copy'));assert.equal(value(),'Soft, low-pitched ringing when gently clinked.');assert.equal(host.querySelector('#marketing-ai-instructions').value,input.guidance)
}))
test('empty copy generates with the same instructions and Discard keeps it blank',async()=>withEditor('',async(host,value)=>{await guide(host,'Highlight engraving');responses=[Response.json({marketing_description:'An engraved gift.'})];await click(button(host,'AI Write'));assert.equal(requests[0].url,'/api/generate-marketing-copy');assert.equal(requests[0].body.instructions,'Highlight engraving');await click(button(host,'Discard'));assert.equal(value(),'');assert.equal(host.querySelector('#marketing-ai-instructions').value,'Highlight engraving')}))
test('malformed response keeps existing copy and instructions, offers a clean retry',async()=>withEditor('Keep this copy',async(host,value)=>{
 await guide(host,input.guidance);responses=[new Response('{"body":"broken')];await click(button(host,'AI Rewrite'));assert.equal(value(),'Keep this copy');assert.match(host.querySelector('[role="alert"]').textContent,/incomplete response/);assert.doesNotMatch(host.textContent,/Unterminated|string in JSON/)
 assert.equal(host.querySelector('#marketing-ai-instructions').value,input.guidance);responses=[Response.json({body:'Good retry'})];await click(button(host,'AI Rewrite'));assert.equal(host.querySelector('[role="alert"]'),null);await click(button(host,'Use this copy'));assert.equal(value(),'Good retry')
}))
test('invalid, empty, over-limit and HTTP failure replies never replace copy',async()=>withEditor('Keep',async(host,value)=>{for(const r of [Response.json({body:null}),Response.json({body:''}),Response.json({body:'x'.repeat(301)}),Response.json({error:'Try again'},{status:503})]){responses=[r];await click(button(host,'AI Rewrite'));assert.equal(value(),'Keep');assert.ok(host.querySelector('[role="alert"]'));assert.equal(button(host,'Use this copy'),undefined)}}))
