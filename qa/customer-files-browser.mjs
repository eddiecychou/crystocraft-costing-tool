// Real UI/client/handler/Admin SDK/Storage, isolated behind fictional auth on
// loopback emulators. No production data, service keys or external requests.
import fs from 'node:fs/promises'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer as createViteServer} from 'vite'
import react from '@vitejs/plugin-react-swc'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore,FieldValue,FieldPath} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {createCustomerFilesHandler,createCustomerFilesRepository} from '../netlify/functions/lib/customerFiles.js'
import {createCustomerFileObjects} from '../netlify/functions/lib/customerFileObjects.js'
import {checksum,fictionalCompany} from './customer-files-fixtures.mjs'

for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error('Local emulators required; production writes forbidden.')
const root='qa/out/customer-files',out=root+'/browser',cid='customer_files_browser',project='crystocraft-rbac-test',bucketName=project+'.appspot.com'
await fs.mkdir(out,{recursive:true});const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const app=initializeApp({projectId:project,storageBucket:bucketName},'customer-files-browser'),db=getFirestore(app),bucket=getStorage(app).bucket(),objects=createCustomerFileObjects(bucket)
const roles={admin:{role:'admin'},crm:{role:'staff',modules:['customers']},marketing:{role:'staff',modules:['marketing']},customer:{role:'customer',status:'approved',customer_id:cid,modules:['customers']}}
for(const id of[cid,cid+'_other']){await db.recursiveDelete(db.doc('customers/'+id));await db.doc('customers/'+id).set({...fictionalCompany(),company_name:id})}
await objects.removePrefix('customer-files/'+cid+'/')
for(const[role,profile]of Object.entries(roles))await db.doc('users/cf_browser_'+role).set(profile)
const originalParent=(await db.doc('customers/'+cid).get()).data(),operations=[],runtime=[],external=[]
const handler=createCustomerFilesHandler({verifyToken:async token=>{assert.match(token,/^cf_browser_(admin|crm|marketing|customer)$/);return{uid:token}},getProfile:async uid=>(await db.doc('users/'+uid).get()).data(),repo:createCustomerFilesRepository(db,()=>FieldValue.serverTimestamp(),()=>FieldPath.documentId()),objects})
let injectedChunkFailure=false
const server=http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>4000000)throw Error('Request too large')}
    const url='http://127.0.0.1'+req.url,params=new URL(url).searchParams,op=params.get('op');operations.push({method:req.method,op,customer:params.get('customer'),chunk:params.get('chunk'),contentType:req.headers['content-type']||null})
    if(injectedChunkFailure&&op==='chunk'){injectedChunkFailure=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fictional interrupted chunk. Retry the same file.'}));return}
    const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}))
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const vite=await createViteServer({configFile:false,root:process.cwd(),optimizeDeps:{entries:['qa/customer-files-fixture.html'],include:['react','react-dom/client','lucide-react','pdfjs-dist/build/pdf.mjs']},plugins:[react(),{name:'fictional-customer-files-auth',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/src/customerFiles.js')&&source==='./firebase')return '\0qa-customer-files-auth'},load(id){if(id==='\0qa-customer-files-auth')return 'export const authHeader=async()=>({Authorization:"Bearer cf_browser_"+window.__customerFilesQaRole})'}}],server:{host:'127.0.0.1',port:5198,strictPort:true,proxy:{'/api/customer-files':{target:'http://127.0.0.1:'+server.address().port}}}})
await vite.listen();const origin='http://127.0.0.1:5198',browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:1000}}),page=await context.newPage()
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['blob:','data:'].includes(url.protocol))return route.continue();external.push(url.origin);return route.abort()})
page.on('pageerror',e=>runtime.push(e.message));page.setDefaultTimeout(30000)
page.on('console',message=>{if(message.text().includes('Customer file thumbnail unavailable:'))console.log(message.text())})
const fixture=role=>origin+'/qa/customer-files-fixture.html?role='+role
const names=['Cindy & Tony 中文 🎁 - front.png','Cindy & Tony 中文 🎁 - back.png','Customer reference 中文 & specifications.pdf']
const results=[]
try{
  await page.goto(fixture('admin'));await page.getByText('No business cards or customer files yet.',{exact:false}).waitFor()
  await page.getByRole('button',{name:'Upload files',exact:true}).click()
  // Native chooser invocation proves the ordinary Choose files button works.
  const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose files',exact:true}).click();await(await choosing).setFiles(names.map(name=>root+'/fixtures/'+name))
  const dialog=page.getByRole('dialog',{name:'Upload business cards & customer files'})
  const queued=dialog.locator('div.border.p-3')
  assert.equal(await queued.count(),3)
  for(const[index,name]of names.entries()){
    const item=queued.nth(index);await item.locator('summary').click()
    if(index<2){await item.getByLabel('Card side',{exact:true}).selectOption(index?'back':'front');await item.getByLabel('Card set (links front/back)').fill('Fictional VIP card set');await item.getByLabel(index?'Tony (fictional)':'Cindy (fictional)',{exact:true}).check()}
    else await item.getByLabel('Category',{exact:true}).selectOption('customer_document')
    await item.getByLabel('Title',{exact:true}).fill(index===0?'Fictional Cindy — front':index===1?'Fictional Tony — back':'Customer document — two pages')
    await item.getByLabel('Source',{exact:true}).fill('Fictional QA source');await item.getByLabel('Referrer',{exact:true}).fill('QA ONLY owner reference')
    await item.getByLabel('Notes',{exact:true}).fill(index===0?'Long internal notes remain intact. '.repeat(15):'Fictional file only; do not change contacts.')
  }
  await dialog.screenshot({path:out+'/upload-desktop.png'})
  injectedChunkFailure=true
  await dialog.getByRole('button',{name:'Upload files',exact:true}).click();await dialog.getByText('Fictional interrupted chunk. Retry the same file.').waitFor()
  await dialog.getByRole('button',{name:'Upload files',exact:true}).waitFor({state:'visible'});await dialog.getByRole('button',{name:'Upload files',exact:true}).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog progress')].length===0&&[...document.querySelectorAll('dialog p')].filter(p=>p.textContent.includes(' · Saved')).length===3)
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload()
  await page.locator('[data-customer-files] article').nth(2).waitFor();assert.equal(await page.locator('[data-customer-files] article').count(),3)
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-customer-files] article img')].length===3&&[...document.querySelectorAll('[data-customer-files] article img')].every(i=>i.complete&&i.naturalWidth>0))
  await page.screenshot({path:out+'/files-desktop.png',fullPage:true})
  results.push({case:'multiple original uploads, interrupted retry, persisted metadata/contacts and PDF/image thumbnails after reload',result:'PASS'})
  for(const name of names){
    const article=page.locator('article').filter({has:page.getByText(name,{exact:true})})
    const pending=page.waitForEvent('download');await article.getByRole('button',{name:'Download original',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),name);const destination=out+'/'+name;await download.saveAs(destination);assert.equal(await download.failure(),null)
    const expected=await fs.readFile(root+'/fixtures/'+name),actual=await fs.readFile(destination);assert.equal(checksum(actual),checksum(expected));assert.equal(new URL(page.url()).pathname,'/qa/customer-files-fixture.html')
    results.push({case:'original download',filename:name,bytes:actual.length,sha256:checksum(actual),pageRetained:true,result:'PASS'})
    await article.getByRole('button',{name:'Preview',exact:true}).click();const preview=page.getByRole('dialog',{name:'Customer file preview'});await preview.waitFor()
    if(name.endsWith('.pdf')){await preview.getByText('Page 1 of 2',{exact:true}).waitFor();await preview.getByRole('button',{name:'Next page',exact:true}).click();await preview.getByText('Page 2 of 2',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('dialog [role=status]'));await preview.screenshot({path:out+'/pdf-page-two.png'})}
    else await preview.locator('img').waitFor()
    await preview.getByRole('button',{name:'Close dialog',exact:true}).click()
  }
  const first=page.locator('article').filter({has:page.getByText(names[0],{exact:true})});await first.getByRole('button',{name:'Edit details',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'Edit customer file details'});await editor.getByLabel('Title',{exact:true}).fill('Reviewed fictional card title');await editor.getByRole('button',{name:'Save details',exact:true}).click();await page.getByText('Reviewed fictional card title',{exact:true}).waitFor();await page.reload();await page.getByText('Reviewed fictional card title',{exact:true}).waitFor()
  await page.setViewportSize({width:375,height:812})
  await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
  const layout=await page.evaluate(()=>({headings:document.querySelectorAll('h1').length,panels:document.querySelectorAll('[data-customer-files]').length,overflow:document.documentElement.scrollWidth>innerWidth,articles:[...document.querySelectorAll('article')].map(a=>({top:a.getBoundingClientRect().top,height:a.getBoundingClientRect().height}))}))
  assert.equal(layout.headings,1);assert.equal(layout.panels,1);assert.equal(layout.overflow,false)
  await page.screenshot({path:out+'/files-mobile.png',fullPage:true})
  for(let i=0;i<3;i++)await page.locator('article').nth(i).screenshot({path:out+'/mobile-file-'+i+'.png'})
  await fs.writeFile(out+'/mobile-layout.json',JSON.stringify(layout,null,2)+'\n')
  await first.getByRole('button',{name:'Edit details',exact:true}).click();await page.getByRole('dialog',{name:'Edit customer file details'}).screenshot({path:out+'/edit-mobile.png'});assert.equal(await page.evaluate(()=>[...document.querySelectorAll('dialog')].every(d=>d.scrollWidth<=d.clientWidth+1)),true);await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('button',{name:'Switch fictional company'}).click();await page.getByText('No business cards or customer files yet.',{exact:false}).waitFor();assert.equal(await page.locator('article').count(),0)
  results.push({case:'explicit metadata edit/reload, 375px layout, company-switch state isolation',result:'PASS'})
  for(const role of ['customer','marketing']){const before=operations.length;await page.goto(fixture(role));assert.equal(await page.locator('[data-customer-files]').count(),0);assert.equal(operations.length,before);results.push({case:role+' has no file controls or API reads',result:'PASS'})}
  await page.goto(fixture('crm'));await page.locator('article').nth(2).waitFor();results.push({case:'CRM-authorized staff sees internal company files',result:'PASS'})
  assert.deepEqual((await db.doc('customers/'+cid).get()).data(),originalParent);assert.equal((await db.collection('customers/'+cid+'/files').get()).size,3)
  assert.deepEqual(runtime,[]);assert.deepEqual(external,[])
  assert.ok(operations.filter(o=>['chunk','thumbnail'].includes(o.op)).every(o=>o.contentType==='application/octet-stream'),'Binary payloads are explicitly typed for the Netlify gateway')
  await fs.writeFile(out+'/report.json',JSON.stringify({method:'Actual UI/client/handler/Admin SDK and both local emulators; fictional token verification only',results,operations,parentPreserved:true,external,runtime},null,2)+'\n');console.log(JSON.stringify({checks:results.length,files:3,parentPreserved:true,external,runtime,status:'PASS'}))
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await fs.writeFile(out+'/failure.json',JSON.stringify({error:e.message,runtime,external,operations},null,2));throw e}
finally{await browser.close();await vite.close();await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app)}
