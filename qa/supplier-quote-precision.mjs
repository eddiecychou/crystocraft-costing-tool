// Real form/browser regression checks with isolated Firebase boundaries. No live records.
import {build} from 'esbuild'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const out='qa/out/supplier-quote-precision',root=process.cwd()
await mkdir(out,{recursive:true})
const stub=`
export const db={}, storage={}, authHeader=async()=>({});
export const doc=(_, ...p)=>p.join('/'), collection=doc, orderBy=x=>x, query=x=>x, serverTimestamp=()=> 'timestamp';
const qp='products/p/components/c/supplier_quotes/q';
const initial={supplier_id:'s',supplier_name:'Feihong',unit_cost:1.222,unit_cost_currency:'USD',moq:1000,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',is_preferred:true,notes:'Keep existing approved notes. 中文',volume_tiers:[{min_qty:2000,unit_cost:1.111}],attachments:[],createdAt:'original'};
let records={},writes=[],uploads=0;
const snap=p=>({id:p.split('/').at(-1),ref:p,exists:()=>!!records[p],data:()=>structuredClone(records[p])});
export const getDoc=async p=>snap(p);
export const getDocs=async p=>({docs:Object.keys(records).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(snap)});
export const updateDoc=async(p,d)=>{writes.push({path:p,data:structuredClone(d)});records[p]={...records[p],...d}};
export const addDoc=async(p,d)=>{await updateDoc(p+'/new',d);return{id:'new'}};
export const deleteDoc=async()=>{throw Error('Unexpected deletion')};
export async function runTransaction(_,fn){const pending=[];await fn({get:getDoc,update:(p,d)=>pending.push([p,d])});for(const [p,d] of pending)await updateDoc(p,d)}
export const ref=(_,p)=>p,uploadBytes=async()=>{uploads++},getDownloadURL=async()=>'/uploaded.pdf';
window.qa={reset:()=>{writes=[];uploads=0;records={'products/p':{name:'Hidden concept',active:false,status:'concept',image:'same.jpg'},'products/p/components/c':{name:'Fruit fork'},[qp]:structuredClone(initial),'products/p/components/c/supplier_quotes/other':{is_preferred:false},'suppliers/s':{name:'Feihong'},'suppliers/s/catalogs/f':{file_name:'Supplier quote.pdf',file_url:'/existing.pdf',file_type:'application/pdf',storage_path:'supplier/original.pdf'}}},state:()=>({records,writes,uploads}),change:d=>{records[qp]={...records[qp],...d}}};window.qa.reset();
`
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import Form from './src/pages/SupplierQuoteForm.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/products/:productId/components/:componentId/quotes/:quoteId' element={<Form/>}/><Route path='/products/:productId/components/:componentId/quotes' element={<Form/>}/><Route path='*' element={<p>Saved</p>}/></Routes></BrowserRouter>)`,resolveDir:root,loader:'jsx'},bundle:true,outfile:out+'/app.js',jsx:'automatic',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^(firebase\/(firestore|storage))$|(^|\/)firebase$/},()=>({path:'stub',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:stub,loader:'js'}))}}]})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://x').pathname;if(path==='/app.js'||path==='/style.css'){res.setHeader('Content-Type',path.endsWith('js')?'text/javascript':'text/css');res.end(await readFile(out+path))}else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>')}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base='http://127.0.0.1:'+server.address().port,require=createRequire(root+'/.qa-playwright/package.json'),{chromium}=require('playwright-core'),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
let extractions=0
await page.route('**/api/process-quote',async route=>{extractions++;await route.fulfill({json:{unit_cost:9.999,moq:99,tooling_sample_cost:999}})})
const url=base+'/products/p/components/c/quotes/q',qp='products/p/components/c/supplier_quotes/q',pdf={name:'quote.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')},main=page.locator('input[step="0.001"]').first(),tier=page.locator('input[step="0.001"]').nth(1)
const load=async()=>{await page.goto(url);await main.waitFor();await page.waitForFunction(()=>document.querySelector('input[step="0.001"]').value==='1.222')}
const unchanged=async()=>{assert.equal(await main.inputValue(),'1.222');assert.equal(await page.locator('input[placeholder="e.g. 200"]').inputValue(),'1000');assert.equal(await page.locator('input[step="0.01"]').inputValue(),'155');assert.equal(await page.locator('textarea').inputValue(),'Keep existing approved notes. 中文');assert.ok(await page.locator('#preferred').isChecked());assert.equal(await tier.inputValue(),'1.111')}
const results=[]
try{
 await load();await unchanged();assert.equal(await page.locator('h1').count(),1);assert.equal(await main.getAttribute('placeholder'),'0.000');assert.equal(await tier.getAttribute('placeholder'),'0.000');assert.ok(await main.evaluate(el=>el.checkValidity()));assert.ok(await tier.evaluate(el=>el.checkValidity()))
 for(const width of [320,375,414,1280]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow at '+width);if(width===320||width===1280)await page.screenshot({path:out+'/fixture-'+width+'.png'})}
 results.push('Three-decimal native validity, exact initial values and four widths')
 await page.locator('input[type=file]').setInputFiles(pdf);await unchanged();assert.equal(extractions,0)
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor()
 let state=await page.evaluate(()=>window.qa.state());assert.equal(state.writes.length,1);assert.deepEqual(Object.keys(state.writes[0].data),['attachments']);assert.equal(state.records[qp].unit_cost,1.222);assert.equal(state.records[qp].volume_tiers[0].unit_cost,1.111);assert.equal(state.uploads,1);assert.equal(state.records['products/p'].active,false)
 // Reopen without reload: retain the isolated database and mount the form again.
 await page.evaluate(()=>{history.pushState({},'', '/products/p/components/c/quotes/q');window.dispatchEvent(new PopStateEvent('popstate'))});await main.waitFor();await unchanged();await page.locator('a[href="/uploaded.pdf"]').waitFor();results.push('Uploaded PDF: no extraction; attachment-only patch; exact reopen')
 await load();await page.getByRole('button',{name:'Choose supplier file'}).click();await page.getByRole('button',{name:'Attach file',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Attached',exact:true}).isDisabled());await unchanged()
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor();state=await page.evaluate(()=>window.qa.state());assert.equal(state.uploads,0);assert.equal(state.writes.length,1);assert.deepEqual(Object.keys(state.writes[0].data),['attachments']);assert.equal(state.records[qp].attachments[0].supplier_file_id,'f');assert.equal(extractions,0);results.push('Existing supplier PDF: deduplicated link without upload or extraction')
 await load();await page.locator('input[type=file]').setInputFiles(pdf);await page.evaluate(()=>window.qa.change({unit_cost:1.333,notes:'Concurrent approved notes'}));await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor();state=await page.evaluate(()=>window.qa.state());assert.equal(state.records[qp].unit_cost,1.333);assert.equal(state.records[qp].notes,'Concurrent approved notes');results.push('Concurrent approved pricing/notes remain untouched')
 await load();await page.locator('input[type=file]').setInputFiles(pdf);await page.evaluate(()=>window.qa.change({attachments:[{file_url:'/other.pdf'}]}));await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'Attachments changed in another session'}).waitFor();state=await page.evaluate(()=>window.qa.state());assert.equal(state.writes.length,0);assert.equal(state.records[qp].attachments[0].file_url,'/other.pdf');results.push('Concurrent attachment edit rejected with recoverable error')
 await load();await main.fill('1.223');await tier.fill('1.112');await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor();state=await page.evaluate(()=>window.qa.state());assert.equal(state.records[qp].unit_cost,1.223);assert.equal(state.records[qp].volume_tiers[0].unit_cost,1.112);results.push('Intentional main/tier edits persist exact three decimals')
 await load();await page.evaluate(()=>window.qa.change({unit_cost:1.22249,volume_tiers:[{min_qty:2000,unit_cost:1.11149}]}));await page.evaluate(()=>{history.pushState({},'', '/');window.dispatchEvent(new PopStateEvent('popstate'))});await page.getByText('Saved',{exact:true}).waitFor();await page.evaluate(()=>{history.pushState({},'', '/products/p/components/c/quotes/q');window.dispatchEvent(new PopStateEvent('popstate'))});await main.waitFor();assert.equal(await main.inputValue(),'1.22249');assert.equal(await tier.inputValue(),'1.11149');results.push('Stored higher precision loads without rounding')
 await page.goto(base+'/products/p/components/c/quotes');await page.locator('input[type=file]').waitFor({state:'attached'});await page.locator('input[type=file]').setInputFiles(pdf);await page.waitForFunction(()=>document.querySelector('input[step="0.001"]').value==='9.999');assert.equal(extractions,1);results.push('New-quote extraction still runs once')
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({results,runtime_errors:errors},null,2));console.log(JSON.stringify({pass:results.length,results}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
