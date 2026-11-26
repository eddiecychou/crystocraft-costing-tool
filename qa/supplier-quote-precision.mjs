// Real form/browser regression checks with isolated Firebase boundaries. No live records.
import {build} from 'esbuild'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const out='qa/out/supplier-quote-precision',root=process.cwd()
const serve=process.argv.includes('--serve')
await mkdir(out,{recursive:true})
const stub=`
export const db={}, storage={}, authHeader=async()=>({});
const path=(base,parts)=>[typeof base==='string'?base:'',...parts].filter(Boolean).join('/');
export const collection=(base,...p)=>path(base,p),doc=(base,...p)=>path(base,p.length?p:['new']),orderBy=x=>x,query=x=>x,serverTimestamp=()=> 'timestamp';
const qp='products/p/components/c/supplier_quotes/q';
const initial={supplier_id:'s',supplier_name:'Feihong',unit_cost:1.222,unit_cost_currency:'USD',moq:1000,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',is_preferred:true,notes:'Keep existing approved notes. 中文',volume_tiers:[{min_qty:2000,unit_cost:1.111}],attachments:${serve?"[{file_url:'/source.pdf',file_name:'source.pdf',file_type:'pdf',ai_extracted:false}]":"[]"},createdAt:'original'};
let records={},writes=[],uploads=0,uploadDetails=[],previewUrls={};
const snap=p=>({id:p.split('/').at(-1),ref:p,exists:()=>!!records[p],data:()=>structuredClone(records[p])});
export const getDoc=async p=>snap(p);
export const getDocs=async p=>({docs:Object.keys(records).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(snap)});
export const getDocsFromServer=getDocs;
export const updateDoc=async(p,d)=>{writes.push({path:p,data:structuredClone(d)});records[p]={...records[p],...d}};
export const addDoc=async(p,d)=>{await updateDoc(p+'/new',d);return{id:'new'}};
export const deleteDoc=async()=>{throw Error('Unexpected deletion')};
const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
export async function runTransaction(_,fn){
  const pending=[];
  const stage=(p,d)=>pending.push([p,d]);
  await fn({get:async p=>({...snap(p),data:()=>reorder(structuredClone(records[p]))}),update:stage,set:stage});
  for(const [p,d] of pending)await updateDoc(p,d);
}
export const ref=(_,p)=>p;
export async function uploadBytes(path,blob,metadata){
  uploads++;
  const detail={path,contentType:metadata.contentType,blobType:blob.type};
  if(blob.type==='application/pdf'){
    detail.bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));
  }else{
    const bitmap=await createImageBitmap(blob);
    Object.assign(detail,{width:bitmap.width,height:bitmap.height});
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0);
    detail.sample=Array.from(ctx.getImageData(30,30,1,1).data);
    bitmap.close();
    previewUrls[path]=URL.createObjectURL(blob);
  }
  uploadDetails.push(detail);
}
export const getDownloadURL=async path=>previewUrls[path]||'/uploaded.pdf';
window.qa={
  reset:()=>{
    writes=[];uploads=0;uploadDetails=[];previewUrls={};
    records={
      'products/p':{name:'Hidden concept',active:false,status:'concept',image:'same.jpg'},
      'products/p/components/c':{name:'Fruit fork'},
      [qp]:structuredClone(initial),
      'products/p/components/c/supplier_quotes/other':{is_preferred:false},
      'range_components/range':{name:'Fictional Range part'},
      'range_components/range/supplier_quotes/q':structuredClone(initial),
      'range_components/crystal':{name:'Fictional Crystal part',crystal_product_id:'p',crystal_variant_id:'v',crystal_catalogue_unit:'pcs'},
      'range_components/crystal/supplier_quotes/q':structuredClone(initial),
      'crystal_products/p':{name:'Fictional Pear'},
      'crystal_products/p/variants/v':{code:'DEMO-ROS',label:'Fictional Rosaline',unit:'pcs'},
      'suppliers/s':{name:'Feihong'},
      'suppliers/s/catalogs/f':{file_name:'Supplier quote.pdf',file_url:'/existing.pdf',file_type:'application/pdf',storage_path:'supplier/original.pdf'},
    };
  },
  state:()=>({records,writes,uploads,uploadDetails}),
  change:(d,quotePath=qp)=>{records[quotePath]={...records[quotePath],...d}},
  saveRange:(id,quoteId,data,context)=>{
    if(id==='crystal' && (context?.crystal_product_id!=='p' || context?.crystal_variant_id!=='v')){
      throw Error('Expected exact Crystal variant context');
    }
    return updateDoc('range_components/'+id+'/supplier_quotes/'+(quoteId||'new'),data);
  },
};
window.qa.reset();
`
await build({
  stdin:{
    contents:`
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { BrowserRouter, Routes, Route } from 'react-router-dom'
      import Form from './src/pages/SupplierQuoteForm.jsx'
      import RangeQuoteForm from './src/pages/RangeQuoteForm.jsx'
      const corporate = '/products/:productId/components/:componentId/quotes'
      const range = '/components/critical/:id/quotes'
      const crystal = '/crystal-components/:productId/variants/:variantId/costing/:componentId/quotes'
      createRoot(document.getElementById('root')).render(
        <BrowserRouter><Routes>
          <Route path={corporate + '/:quoteId'} element={<Form/>}/>
          <Route path={corporate + '/new'} element={<Form/>}/>
          <Route path={range + '/:quoteId'} element={<RangeQuoteForm/>}/>
          <Route path={range + '/new'} element={<RangeQuoteForm/>}/>
          <Route path={crystal + '/:quoteId'} element={<Form mode="range"/>}/>
          <Route path={crystal + '/new'} element={<Form mode="range"/>}/>
          <Route path="*" element={<p>Saved</p>}/>
        </Routes></BrowserRouter>
      )
    `,
    resolveDir:root,loader:'jsx',
  },
  bundle:true,outfile:out+'/app.js',jsx:'automatic',format:'esm',
  plugins:[{
    name:'fixture',
    setup(builder){
      builder.onResolve({filter:/^firebase\/(firestore|storage)$|(^|\/)firebase$/},()=>({path:'stub',namespace:'qa'}))
      builder.onResolve({filter:/(^|\/)criticalComponents$/},()=>({path:'range-writer',namespace:'qa'}))
      builder.onLoad({filter:/.*/,namespace:'qa'},({path})=>({
        contents:path==='range-writer'?`
          export const getComponent=async id=>window.qa.state().records['range_components/'+id];
          export const saveComponentQuote=(...args)=>window.qa.saveRange(...args);
          export const deleteComponentQuote=()=>{throw Error('Unexpected deletion')};
        `:stub,
        loader:'js',
      }))
    },
  }],
})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
const controls=serve?`<aside style="padding:16px">Isolated fixture — no live OC. <button onclick="window.qa.change({attachments:[{file_url:'/other.pdf',file_name:'Concurrent.pdf',file_type:'pdf'}]})">Simulate concurrent attachment change</button></aside>`:''
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://x').pathname;if(path==='/app.js'||path==='/style.css'){res.setHeader('Content-Type',path.endsWith('js')?'text/javascript':'text/css');res.end(await readFile(out+path))}else res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">'+controls+'<div id="root"></div><script type="module" src="/app.js"></script>')}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base='http://127.0.0.1:'+server.address().port
if(serve){console.log('Isolated quote preview: '+base+'/products/p/components/c/quotes/q');await new Promise(()=>{})}
const require=createRequire(root+'/.qa-playwright/package.json'),{chromium}=require('playwright-core'),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
let extractions=0
const extractionRequests=[]
await page.route('**/api/process-quote',async route=>{
  extractions++;
  extractionRequests.push(route.request().postDataJSON())
  await route.fulfill({json:{unit_cost:9.999,moq:99,tooling_sample_cost:999}})
})
const url=base+'/products/p/components/c/quotes/q',qp='products/p/components/c/supplier_quotes/q',pdf={name:'quote.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')},main=page.locator('input[placeholder="0.000"]').first(),tier=page.locator('input[placeholder="0.000"]').nth(1)
const load=async()=>{await page.goto(url);await main.waitFor();await page.waitForFunction(()=>document.querySelector('input[step="0.001"]').value==='1.222')}
const unchanged=async()=>{assert.equal(await main.inputValue(),'1.222');assert.equal(await page.locator('input[placeholder="e.g. 200"]').inputValue(),'1000');assert.equal(await page.locator('input[step="0.01"]').inputValue(),'155');assert.equal(await page.locator('textarea').inputValue(),'Keep existing approved notes. 中文');assert.ok(await page.locator('#preferred').isChecked());assert.equal(await tier.inputValue(),'1.111')}
const results=[]
try{
 await load();await unchanged();assert.equal(await page.locator('h1').count(),1);assert.equal(await main.getAttribute('step'),'0.001');assert.equal(await tier.getAttribute('step'),'0.001');assert.ok(await main.evaluate(el=>el.checkValidity()));assert.ok(await tier.evaluate(el=>el.checkValidity()))
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
 const source = await page.evaluate(() => {
   const canvas = document.createElement('canvas')
   canvas.width = 3000
   canvas.height = 240
   const context = canvas.getContext('2d')
   context.fillStyle = '#d92b10'
   context.fillRect(0,0,1500,240)
   context.fillStyle = '#50ee75'
   context.fillRect(1500,0,1500,240)
   return canvas.toDataURL('image/png').split(',')[1]
 })
 const photo = {name:'Fictional supplier photo.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')}
 const flows = [
   {name:'Corporate Gifts', editor:'/products/p/components/c/quotes', component:'products/p/components/c'},
   {name:'Crystocraft Range', editor:'/components/critical/range/quotes', component:'range_components/range'},
   {name:'Crystal Components', editor:'/crystal-components/p/variants/v/costing/crystal/quotes', component:'range_components/crystal'},
 ]
 const showRoute = path => page.evaluate(path => {
   history.pushState({},'',path)
   window.dispatchEvent(new PopStateEvent('popstate'))
 },path)
 const waitForUploadInput = () => page.locator('input[type=file]').waitFor({state:'attached'})
 const originalSource = {file_url:'/source.pdf',file_name:'Existing source.pdf',file_type:'pdf'}
 for (const flow of flows) {
   for (const file of [pdf,photo]) {
     const isPdf = file.mimeType === 'application/pdf'
     const beforeExtraction = extractions
     await page.goto(base+flow.editor+'/new')
     await waitForUploadInput()
     await page.locator('input[type=file]').setInputFiles(file)
     await page.waitForFunction(() => document.querySelector('input[placeholder="0.000"]').value === '9.999')
     assert.equal(extractions,beforeExtraction+1,flow.name+' extracts once for a new quote')
     const payload = extractionRequests.at(-1)
     assert.equal(payload.mimeType,file.mimeType)
     if (isPdf) {
       assert.deepEqual(Buffer.from(payload.image,'base64'),file.buffer)
     } else {
       const scan = await page.evaluate(async ({image,mimeType}) => {
         const blob = await (await fetch('data:'+mimeType+';base64,'+image)).blob()
         const bitmap = await createImageBitmap(blob)
         const canvas = new OffscreenCanvas(bitmap.width,bitmap.height)
         const ctx = canvas.getContext('2d')
         ctx.drawImage(bitmap,0,0)
         const sample = x => Array.from(ctx.getImageData(x,30,1,1).data)
         const result = {width:bitmap.width,height:bitmap.height,dark:sample(30),light:sample(1500)}
         bitmap.close()
         return result
       },payload)
       assert.deepEqual(scan,{width:2400,height:192,dark:[0,0,0,255],light:[255,255,255,255]})
     }
     if (flow.name === 'Crystocraft Range') {
       await page.locator('form select').first().selectOption('s')
     } else {
       await page.getByText('Select supplier…',{exact:true}).click()
       await page.getByRole('button',{name:'Feihong',exact:true}).click()
     }
     assert.ok(await page.locator('form').evaluate(form=>form.checkValidity()),flow.name+' new quote is valid')
     await page.locator('form button[type=submit]').click()
     await page.getByText('Saved',{exact:true}).waitFor()
     const saved = await page.evaluate(() => window.qa.state())
     assert.equal(saved.uploads,1)
     assert.equal(saved.writes.length,1)
     assert.equal(saved.records[flow.component+'/supplier_quotes/new'].attachments[0].file_name,file.name)
     const uploaded = saved.uploadDetails[0]
     assert.ok(uploaded.path.startsWith(flow.component+'/quotes/'))
     if (isPdf) {
       assert.equal(uploaded.contentType,'application/pdf')
       assert.equal(uploaded.blobType,'application/pdf')
       assert.deepEqual(Buffer.from(uploaded.bytes),file.buffer)
     } else {
       assert.equal(uploaded.contentType,'image/jpeg')
       assert.equal(uploaded.blobType,'image/jpeg')
       assert.equal(uploaded.width,2400)
       assert.equal(uploaded.height,192)
       assert.ok(uploaded.sample[0] > uploaded.sample[1]+100,'Stored JPEG keeps supplier photo colour')
     }

     await page.goto(base+'/')
     await page.getByText('Saved',{exact:true}).waitFor()
     const recordPath = flow.component+'/supplier_quotes/q'
     const approved = await page.evaluate(({originalSource,recordPath}) => {
       window.qa.change({attachments:[originalSource]},recordPath)
       return window.qa.state().records[recordPath]
     },{originalSource,recordPath})
     await showRoute(flow.editor+'/q')
     await waitForUploadInput()
     await page.locator('input[type=file]').setInputFiles(file)
     assert.ok(await page.locator('form').evaluate(form=>form.checkValidity()),flow.name+' existing quote is valid')
     await page.locator('form button[type=submit]').click()
     await page.getByText('Saved',{exact:true}).waitFor()
     const edited = await page.evaluate(() => window.qa.state())
     assert.equal(extractions,beforeExtraction+1,flow.name+' skips extraction on an existing quote')
     assert.equal(edited.uploads,1)
     assert.equal(edited.writes.length,1)
     assert.deepEqual(Object.keys(edited.writes[0].data),['attachments'])
     const savedAttachment = edited.records[recordPath].attachments.at(-1)
     assert.equal(savedAttachment.file_name,file.name)
     assert.equal(savedAttachment.file_type,isPdf?'pdf':'image')
     assert.deepEqual(edited.records[recordPath],{...approved,attachments:[originalSource,savedAttachment]})
     await showRoute(flow.editor+'/q')
     await waitForUploadInput()
     await page.locator('a[href="/source.pdf"]').waitFor()
     assert.equal(await main.inputValue(),'1.222')
     assert.equal(await tier.inputValue(),'1.111')
   }
   results.push(flow.name+' PDF and photo uploads preserve quote terms and run extraction once on new quotes')
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({results,runtime_errors:errors},null,2));console.log(JSON.stringify({pass:results.length,results}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
