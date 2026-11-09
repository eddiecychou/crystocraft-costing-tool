// Real Dashboard/components with fictional service boundaries. No production data or sends.
import {build} from 'esbuild'
import {mkdir,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const out='qa/out/dashboard-visual'
await mkdir(out,{recursive:true})
const fixture=`
const day=n=>new Date(Date.now()+8*3600000-n*86400000).toISOString().slice(0,10);
const customers=[{id:'c1',company_name:'Fictional Harbour Gifts',crm_category:'Distributor',dashboard_work:{stages:['exploration'],revision:1},sales_pipeline:{revision:1,status:'active',detail:'Two ongoing sample projects',suggestion:null,last_reviewed_source:''}},{id:'c2',company_name:'Fictional Northline Trade',customer_type:'b2b',tags:['Retail'],crm_category:'Gift / OEM'},{id:'c3',company_name:'Fictional Long Project',sales_pipeline:{revision:1,status:'active',detail:'Custom design project remains open for six months',suggestion:null,last_reviewed_source:''}},{id:'c4',company_name:'Fictional Quiet Customer'},{id:'retail',company_name:'EXCLUDED RETAIL',customer_type:'retail'}];
const records={...Object.fromEntries(customers.map(c=>['customers/'+c.id,c])),
'customers/c1/work_items/past':{kind:'task',text:'Confirm the revised sample colour',state:'todo',due_on:day(3),revision:1},
'customers/c2/work_items/today':{kind:'task',text:'Send the updated quotation',state:'todo',due_on:day(0),revision:1},
'customers/c2/work_items/future':{kind:'task',text:'Review the packaging proof next week',state:'todo',due_on:day(-7),revision:1},
'customers/c1/work_items/waiting':{kind:'task',text:'Await the buyer’s artwork approval',state:'waiting',due_on:'',revision:1},
'customers/c3/work_items/undated':{kind:'task',text:'Check the custom design requirements',state:'todo',due_on:'',revision:1},
'customers/c1/work_items/note':{kind:'note',text:'Fictional reference note, hidden in the detail layer.',state:'todo',due_on:'',revision:1},
'customers/retail/work_items/task':{kind:'task',text:'EXCLUDED B2C TASK',state:'todo',due_on:day(1),revision:1},
'client_quotes/q1':{customer_id:'c1',status:'sent',quote_number:'FICTIONAL-Q1'},
'orders/o1':{customer_id:'c1',status:'packing',uc_no:'FICTIONAL-UC',order_date:day(4)},
'dashboard_cache/weekly_summary':{items:[{customerId:'c1',digest:'Fictional summary for context only. '.repeat(35)}]}};
const watchers=new Set();
const snapshot=path=>({exists:()=>!!records[path],data:()=>records[path]});
const doc=(path,data)=>({id:path.split('/').at(-1),data:()=>data,ref:{parent:{parent:{id:path.split('/')[1],parent:{id:path.split('/')[0]}}}}});
const publish=(path,cb)=>{if(path.startsWith('dashboard_cache/')){cb(snapshot(path));return}const rows=Object.entries(records).filter(([key])=>path.startsWith('group/')?key.split('/')[2]===path.slice(6):key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1);cb({docs:rows.map(([key,value])=>doc(key,value))})};
globalThis.__dashboardFixture={records,watchers,snapshot,publish};
`
await writeFile(out+'/entry.jsx',`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Dashboard from '../../../src/pages/Dashboard';${fixture}
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="qa-main"><aside className="hidden md:block fixed left-0 top-0 bottom-0 w-64 bg-ink text-white p-6"><p className="text-xl">CRYSTOCRAFT</p><p className="text-xs mt-2 text-white/70">OPERATION CENTER · FICTIONAL QA</p><p className="mt-10">Dashboard</p></aside><Dashboard/></div></MemoryRouter>);`)
await build({entryPoints:[out+'/entry.jsx'],outfile:out+'/app.js',bundle:true,format:'esm',jsx:'automatic',plugins:[{name:'fictional-dashboard-boundaries',setup(b){
 b.onResolve({filter:/firebase\/firestore$|\/firebase$|domain\/customer$|customerActivityApi$|domain\/weeklySummary$/},a=>({path:a.path,namespace:'qa'}))
 b.onLoad({filter:/.*/,namespace:'qa'},a=>({loader:'js',contents:a.path==='firebase/firestore'?`
 const f=()=>globalThis.__dashboardFixture;export const collection=(...p)=>p.slice(1).join('/'),collectionGroup=(_,name)=>'group/'+name,doc=collection,query=x=>x,serverTimestamp=()=>new Date().toISOString();
 export const onSnapshot=(path,cb)=>{const watch=()=>f().publish(path,cb);f().watchers.add(watch);watch();return()=>f().watchers.delete(watch)};
 export const runTransaction=async(_,fn)=>{const writes=[];const result=await fn({get:async path=>f().snapshot(path),set:(path,data)=>writes.push([path,data]),update:(path,data)=>writes.push([path,{...f().records[path],...data}])});for(const[path,data]of writes)f().records[path]=data;queueMicrotask(()=>{for(const cb of f().watchers)cb()});return result};
 export const getDoc=async path=>f().snapshot(path);
 `:a.path.endsWith('/firebase')?'export const db={};export const authedUser=async()=>({uid:"fictional_admin"});'
 :a.path.endsWith('domain/customer')?'export const normalizeCustomer=c=>c;export const RETAIL_TAG="Retail Customer";'
 :a.path.endsWith('customerActivityApi')?`export const fetchCustomerActivity=async()=>({checkedAt:new Date().toISOString(),customers:['c1','c2','c3','c4'].map((customerId,i)=>({customerId,lastContactAt:new Date(Date.now()-[5,45,180,120][i]*86400000).toISOString(),historyState:'known'}))});`
 :'export const generateWeeklySummary=async()=>{throw Error("AI disabled in fictional QA")};'}))
}}]})
await writeFile(out+'/index.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><style>@media(min-width:768px){.qa-main{margin-left:256px}}</style></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>')
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'ignore'});child.on('exit',code=>code?reject(Error('CSS build failed')):resolve())})
if(process.argv.includes('--prepare-only'))process.exit(0)
const {chromium}=createRequire('/Users/eddie/Developer/costing-tool/.qa-playwright/package.json')('playwright-core')
const server=spawn('python3',['-m','http.server','5198','--bind','127.0.0.1','--directory',out],{stdio:'ignore'})
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const errors=[],results=[]
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message))
 for(let n=0;n<30;n++){try{await page.goto('http://127.0.0.1:5198');break}catch{await new Promise(r=>setTimeout(r,100))}}
 await page.getByRole('heading',{name:/My tasks/}).waitFor()
 for(const width of [1440,375,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.screenshot({path:out+`/dashboard-${width}.png`,fullPage:true})
  const check=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,taskY:document.querySelector('[aria-label="Outstanding tasks"] li')?.getBoundingClientRect().top,count:document.querySelector('[aria-label="Outstanding tasks"]').children.length}))
  assert.equal(check.overflow,false);assert.equal(check.count,5);assert.ok(check.taskY<400);results.push({width,...check})
 }
 await page.setViewportSize({width:1440,height:1000})
 const tasks=page.getByRole('region',{name:'My tasks',exact:true})
 await tasks.getByRole('button',{name:/Due 2/}).click();assert.equal(await page.locator('[aria-label="Follow-ups due"] li').count(),2)
 await tasks.getByRole('button',{name:'Show all open tasks'}).click()
 await page.getByRole('button',{name:'+ Add task',exact:true}).click()
 let dialog=page.getByRole('dialog');assert.equal(await dialog.locator('select option').filter({hasText:'EXCLUDED RETAIL'}).count(),0)
 await dialog.locator('select').selectOption('c4')
 await dialog.getByRole('textbox',{name:'Task',exact:true}).fill('Fictional new follow-up')
 await dialog.getByRole('button',{name:'Close customer details'}).click();await dialog.getByRole('button',{name:'Keep editing'}).click()
 assert.equal(await dialog.getByRole('textbox',{name:'Task',exact:true}).inputValue(),'Fictional new follow-up')
 await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('button',{name:'Close customer details'}).click()
 assert.equal(await page.locator('[aria-label="Outstanding tasks"] li').count(),6)
 await page.getByRole('button',{name:/Fictional Quiet Customer.*Stage not set/}).click()
 dialog=page.getByRole('dialog');await dialog.locator('summary').filter({hasText:'Current work and linked records'}).click()
 await dialog.getByRole('button',{name:'Set work stages',exact:true}).click();await dialog.getByRole('checkbox',{name:'Exploration',exact:true}).check();await dialog.getByRole('button',{name:'Save stages'}).click()
 await dialog.getByRole('button',{name:'Close customer details'}).click()
 await page.getByRole('button',{name:/Fictional Harbour Gifts.*Exploration/}).click()
 dialog=page.getByRole('dialog');assert.equal(await dialog.locator('details[open]').count(),0)
 await dialog.locator('summary').filter({hasText:'Email & conversation summary'}).click();await dialog.getByRole('button',{name:'Show more'}).click();await page.screenshot({path:out+'/customer-detail.png'})
 await dialog.getByRole('button',{name:'Close customer details'}).click()
 const payload=await page.evaluate(()=>globalThis.__dashboardFixture.records)
 assert.equal(Object.keys(payload).filter(k=>k.startsWith('customers/c4/work_items/')).length,1)
 assert.equal(payload['customers/c4'].sales_pipeline.status,'active');assert.deepEqual(payload['customers/c4'].dashboard_work.stages,['exploration'])
 await tasks.getByRole('button',{name:'Complete task: Fictional new follow-up',exact:true}).click();assert.equal(await page.locator('[aria-label="Outstanding tasks"] li').count(),5);assert.ok(await page.getByRole('button',{name:/Fictional Quiet Customer.*Exploration/}).count());assert.equal(errors.length,0,errors.join('\n'))
 await writeFile(out+'/results.json',JSON.stringify({results,errors,checks:['All open/Due','B2B picker','draft close protection','task activation','stage save','collapsed detail','summary expansion','completion preserves customer work']},null,2))
 console.log(JSON.stringify({results,errors}))
}finally{await browser.close();server.kill()}
