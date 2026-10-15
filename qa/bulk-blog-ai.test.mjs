import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {fixtureSource} from './marketing-copy-fixture.mjs'
import {validateBlogContent} from '../src/blogAiContent.js'
const require=createRequire(import.meta.url),rootDir=fileURLToPath(new URL('../',import.meta.url))
const products=[{id:'a',name:'Glass A',category:'Dining',description:'Glass',status:'concept'},{id:'b',name:'Glass B',category:'Dining',description:'Glass',status:'concept'}]
const meta={seo_title:'Glass gifts',meta_description:'A gift guide',slug:'glass-gifts',focus_keyword:'glass gifts',tags:['glass','gifts']}
const spotlight=()=>({...meta,hero_alt_text:'Glass',sections:['intro','product_story','use_cases','customisation','cta'].map(type=>({type,heading:type==='intro'?null:type,body:`Original ${type} draft text`}))})
const roundup=()=>({...meta,intro:{heading:null,body:'Guide intro'},items:products.map(p=>({product_name:p.name,heading:p.name,body:`Original ${p.name} item`,image_caption:p.name})),conclusion:{heading:'Conclusion',body:'Guide end'}})
const output=(value,finishReason='STOP')=>Response.json({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(value)}]}}]})
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://bulk-blog.test'})
for(const k of ['window','document','HTMLElement','MouseEvent','Event','localStorage'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno
let scratch,mod,requests=[],responses=[]
before(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'bulk-blog-ai-'))
 await build({stdin:{contents:`export {default as marketing} from './netlify/edge-functions/generate-marketing-copy.js';export {default as blog} from './netlify/edge-functions/generate-blog.js';export {generatePreview,applyApproved} from './src/marketingRegeneration.js';export {fixtureRecords} from './src/firebase';export {SpotlightTab,RoundupTab,RewritePanel} from './src/pages/BlogGenerator.jsx';export {default as bulk} from './src/pages/MarketingCopyBulk.jsx'`,resolveDir:rootDir},outfile:join(scratch,'suite.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'test-boundaries',setup(b){
  b.onResolve({filter:/^(react(?:\/.*)?|lucide-react)$/},a=>({path:require.resolve(a.path),external:true}))
  b.onResolve({filter:/firebase\/firestore|(?:^|\/)firebase(?:\.js)?$/},()=>({path:'fixture',namespace:'stub'}))
  b.onResolve({filter:/react-router-dom/},()=>({path:'router',namespace:'stub'}))
  b.onResolve({filter:/^\.\.?\//},a=>{if(a.path==='./lib/auth.js')return{path:'auth',namespace:'stub'};const n=basename(a.path);if(['productSource','access'].includes(n))return{path:n,namespace:'stub'}})
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='fixture'?fixtureSource+`\nexport const getDoc=async()=>({exists:()=>false});export const getDocs=async()=>({docs:[]});export const query=x=>x;export const orderBy=()=>{};`:a.path==='auth'?'export const requireModule=async()=>globalThis.__denied?{ok:false,response:new Response("Forbidden",{status:403})}:{ok:true}':a.path==='productSource'?`export const PRODUCT_SOURCES=[{value:'corporate',label:'Corporate Gifts'}];export const loadBlogProducts=async()=>${JSON.stringify(products)};export const loadBlogImages=async()=>[];`:a.path==='access'?'export const useRole=()=>"admin"':'export const useParams=()=>({});export const Link=()=>null;export const Navigate=()=>null;',loader:'js'}))
  b.onLoad({filter:/BlogGenerator\.jsx$/},async a=>({contents:await readFile(a.path,'utf8')+'\nexport {SpotlightTab,RoundupTab,RewritePanel};',loader:'jsx'}))
 }}]})
 mod=await import(pathToFileURL(join(scratch,'suite.mjs')))
 globalThis.Deno={env:{get:()=> 'test-key'}}
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});const r=responses.shift();if(r instanceof Error)throw r;assert.ok(r,'unexpected request');return r}
})
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__denied;dom.window.close();await rm(scratch,{recursive:true,force:true})})
const req=body=>new Request('http://bulk-blog.test',{method:'POST',body:JSON.stringify(body)})
test('bulk generator rejects malformed/truncated model content and retries with schema',async()=>{
 requests=[];responses=[output({marketing_description:'unfinished'},'MAX_TOKENS'),output({marketing_description:'Complete safe copy'})];const r=await mod.marketing(req({product:products[0]}));assert.equal(r.status,200);assert.equal((await r.json()).marketing_description,'Complete safe copy');assert.equal(requests.length,2);for(const q of requests)assert.deepEqual(q.body.generationConfig.responseSchema.required,['marketing_description'])
})
test('bulk generator failure always returns friendly JSON; length cap includes ellipsis',async()=>{
 responses=[output({marketing_description:null}),new Response('{broken')];const bad=await mod.marketing(req({product:products[0]}));assert.equal(bad.status,500);assert.match((await bad.json()).error,/kept/)
 responses=[output({marketing_description:'x'.repeat(450)})];assert.equal((await(await mod.marketing(req({product:products[0]}))).json()).marketing_description.length,300)
})
test('bulk preview never writes on invalid transport; approval and atomic history backup remain required',async()=>{
 const before=JSON.stringify(mod.fixtureRecords());responses=[new Response('{"marketing_description":"unfinished')];await assert.rejects(mod.generatePreview(products[0]),/incomplete response/);assert.equal(JSON.stringify(mod.fixtureRecords()),before)
 responses=[Response.json({marketing_description:'Approved safe copy'})];const after=await mod.generatePreview(products[0]);const entry={before:'',after,status:'previewed',approved:false,guidance:'',instructionsApplied:'',previewId:'ai-qa'}
 await assert.rejects(mod.applyApproved('new-mcp-id',entry,'ai-qa-run'),/not been approved/);assert.equal(JSON.stringify(mod.fixtureRecords()),before)
 await mod.applyApproved('new-mcp-id',{...entry,approved:true},'ai-qa-run');const records=mod.fixtureRecords();assert.equal(records.find(([k])=>k==='products/new-mcp-id')[1].marketing_description,after);assert.equal(records.find(([k])=>k.startsWith('product_marketing_history/'))[1].previous_description,'')
})
for(const type of ['spotlight','roundup'])test(`blog ${type} retries malformed or incomplete content before returning a complete draft`,async()=>{
 const valid=type==='spotlight'?spotlight():roundup();const incomplete=type==='spotlight'?{...valid,sections:[]}:{...valid,items:valid.items.slice(0,1)}
 requests=[];responses=[output(incomplete),output(valid)];const r=await mod.blog(req({type,product:products[0],products}));assert.equal(r.status,200);assert.deepEqual(await r.json(),valid);assert.equal(requests.length,2);assert.ok(requests[0].body.generationConfig.responseSchema.required.includes(type==='spotlight'?'sections':'items'))
})
test('blog truncation and invalid JSON exhaustion returns a safe error',async()=>{responses=[output(spotlight(),'MAX_TOKENS'),new Response('{"candidates":')];const r=await mod.blog(req({type:'spotlight',product:products[0]}));assert.equal(r.status,502);const text=await r.text();assert.match(JSON.parse(text).error,/existing draft has been kept/);assert.doesNotMatch(text,/position|SyntaxError|Unterminated/)})
test('blog validation rejects missing/wrong product assignments and malformed sections',()=>{
 assert.throws(()=>validateBlogContent({...roundup(),items:[roundup().items[0],roundup().items[0]]},'roundup',products));assert.throws(()=>validateBlogContent({...spotlight(),sections:[{body:null}]},'spotlight'));assert.throws(()=>validateBlogContent({},'spotlight'))
})
test('bulk and blog keep authorization and request validation before AI calls',async()=>{requests=[];globalThis.__denied=true;for(const fn of [mod.marketing,mod.blog])assert.equal((await fn(req({}))).status,403);globalThis.__denied=false;assert.equal((await mod.blog(req({type:'roundup',products:[]}))).status,400);assert.equal((await mod.marketing(req({product:{name:2}}))).status,400);assert.equal(requests.length,0)})
async function withPage(Component,props,fn){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);requests=[];try{await act(async()=>root.render(React.createElement(Component,props)));await act(async()=>{await new Promise(r=>setTimeout(r,0))});await fn(host)}finally{await act(async()=>root.unmount());host.remove()}}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text))
const click=async b=>{assert.ok(b);await act(async()=>{b.click();await new Promise(r=>setTimeout(r,0))})}
for(const kind of ['SpotlightTab','RoundupTab'])test(`${kind}: a failed regeneration preserves the current editable draft`,async()=>withPage(mod[kind],kind==='SpotlightTab'?{preloadedProduct:products[0]}:{},async host=>{
 if(kind==='RoundupTab'){await click(button(host,'Glass A'));await click(button(host,'Glass B'))}
 const label=kind==='SpotlightTab'?'Generate Product Spotlight':'Generate Roundup';const data=kind==='SpotlightTab'?spotlight():roundup();responses=[Response.json(data)];await click(button(host,label));assert.ok(host.querySelector('textarea'))
 const original=host.querySelector('textarea').value;assert.ok(original)
 responses=[new Response('{broken')];await click(button(host,label));assert.equal(host.querySelector('textarea').value,original);assert.match(host.textContent,/incomplete response/)
 responses=[Response.json({})];await click(button(host,label));assert.equal(host.querySelector('textarea').value,original);assert.match(host.textContent,/incomplete blog draft/)
 if(kind==='RoundupTab')await click(button(host,'Glass B'))
 else await act(async()=>{const select=host.querySelector('select');select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
 assert.equal(host.querySelector('textarea'),null,'changing products must clear the old product draft')
}))
test('blog section rewrite keeps original content/instructions after malformed JSON and succeeds on retry',async()=>{
 let changed=null;await withPage(mod.RewritePanel,{sectionType:'intro',body:'Original section',context:'Glass',onRewrite:d=>{changed=d}},async host=>{
 await click(button(host,'Rewrite'));const input=host.querySelector('textarea');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'Shorter');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
 responses=[new Response('{broken')];await click(button(host,'Rewrite'));assert.equal(changed,null);assert.equal(host.querySelector('textarea').value,'Shorter');assert.match(host.textContent,/incomplete response/)
 responses=[Response.json({body:'Short rewrite'})];await click(button(host,'Rewrite'));assert.deepEqual(changed,{body:'Short rewrite'})
 })
})
test('bulk review failed regeneration preserves preview and prevents saving or reapproval',async()=>{
 localStorage.clear();await withPage(mod.bulk,{},async host=>{
 const card=()=>[...host.querySelectorAll('.card')].find(e=>e.textContent.includes('Awaiting product'))
 responses=[Response.json({marketing_description:'First valid preview'})];await click(button(card(),'Generate preview'));assert.match(card().textContent,/First valid preview/)
 responses=[new Response('{broken')];await click(button(card(),'Regenerate preview'));assert.match(card().textContent,/First valid preview/);assert.match(card().textContent,/incomplete response/);assert.equal(card().querySelector('input[type="checkbox"]').disabled,true);assert.equal(button(host,'Save 0 approved').disabled,true)
 })
})
