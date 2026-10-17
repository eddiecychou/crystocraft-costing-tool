// Fictional browser fixture; Firebase and all business writers are replaced.
import {build} from 'esbuild'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
const out='/private/tmp/dashboard-summary-preview'
await mkdir(out,{recursive:true})
await build({entryPoints:['qa/dashboard-summary-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',plugins:[{name:'dashboard-fixtures',setup(b){
  b.onResolve({filter:/firebase\/firestore$|\/firebase$|domain\/customerWorkItems$|domain\/customer$|domain\/weeklySummary$|domain\/customerPipeline$|\/shipping$/},a=>({path:a.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='firebase/firestore'?`export const doc=(...a)=>a.slice(1).join('/');export const collection=(...a)=>a.slice(1).join('/');export const collectionGroup=(db,name)=>'group/'+name;export const query=x=>x;export const onSnapshot=(path,fn)=>{const rows=globalThis.__dashboardRows[path]||[];fn({docs:rows.map((r,i)=>({id:r.id||String(i),data:()=>r,ref:{parent:{parent:{id:'c1',parent:{id:'customers'}}}}})),exists:()=>true,data:()=>({items:[{customerId:'c1',digest:'Fixture summary'}]})});return()=>{}};`
   :a.path.endsWith('/firebase')?'export const db={};'
   :a.path.endsWith('customerWorkItems')?'export const useCustomerWorkItems=()=>({items:[],loading:false,error:""});export async function saveCustomerWorkItem(){};'
   :a.path.endsWith('weeklySummary')?'export async function generateWeeklySummary(days){globalThis.__dashboardAiCalls.push(days);return {items:[]}};'
   :a.path.endsWith('customerPipeline')?'export async function savePipelineDecision(){};export async function suggestCustomerPipeline(customers,progress,days){globalThis.__dashboardSuggestionCalls.push(days);return 0};'
   :a.path.endsWith('/shipping')?'export const orderStatusOf=v=>({label:v});export const orderUc=o=>o.uc_no;'
   :'export const normalizeCustomer=c=>c;export const RETAIL_TAG="Retail Customer";'}))
 }}]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
await writeFile(out+'/index.html','<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')
await writeFile(out+'/mobile.html',`<!doctype html><title>375px Dashboard QA</title><p id="size"></p><iframe title="Mobile Dashboard" src="/" style="width:375px;height:1300px;border:1px solid #ddd"></iframe><script>const f=document.querySelector('iframe');f.onload=()=>{const measure=()=>document.querySelector('#size').textContent='Viewport '+f.contentDocument.documentElement.clientWidth+'px / content '+f.contentDocument.documentElement.scrollWidth+'px';new ResizeObserver(measure).observe(f.contentDocument.body);measure()}</script>`)
if(!process.argv.includes('--build-only'))createServer(async(req,res)=>{try{const name=({'/':'index.html','/mobile.html':'mobile.html','/style.css':'style.css','/app.js':'app.js'})[req.url];if(!name){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(out+'/'+name))}catch{res.writeHead(500);res.end()}}).listen(5196,'127.0.0.1',()=>console.log('Fictional Dashboard at http://127.0.0.1:5196'))
