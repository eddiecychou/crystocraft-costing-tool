// No credentials or live APIs. Bundles the actual pages with fictional reads.
import {build} from 'esbuild'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {workspaceSyncPlugin} from './customer-workspace-sync-fixture.mjs'
const out='/private/tmp/oc-summary-mobile-preview'
await mkdir(out,{recursive:true})
const mock=`
const long='The customer requested updated samples, pricing and delivery options for a repeat order. '.repeat(18)+'Final detail: confirm packaging before dispatch. '+ 'https://example.invalid/'+ 'long-reference-'.repeat(55);
const customer={company_name:'Mobile QA Customer '+ 'LongCompanyName'.repeat(8),contacts:[],tags:[],channels:[],email_summary:{summary:long,recent_activity:long,open_commitments:['Keep this commitment visible']}};
const rows=p=>p==='customers'?[{id:'mobile_qa',...customer}]:p.endsWith('/email_threads')?[{id:'email',subject:'Fictional email',messages:[],last_date:'2026-10-18'}]:[];
const data=p=>p==='customers/mobile_qa'?customer:p.startsWith('dashboard_cache/')?{items:[{customerId:'mobile_qa',digest:long}]}:null;
const snap=p=>({exists:()=>!!data(p),data:()=>data(p),docs:rows(p).map(r=>({id:r.id,data:()=>r,ref:{parent:{parent:{id:'mobile_qa',parent:{id:'customers'}}}}}))});
export const doc=(db,...p)=>p.join('/'),collection=doc,collectionGroup=(db,p)=>'group/'+p,query=p=>p,where=()=>null,orderBy=()=>null;
export const onSnapshot=(p,fn)=>{queueMicrotask(()=>fn(snap(p)));return()=>{}},getDoc=async p=>snap(p),getDocs=async p=>snap(p),serverTimestamp=()=>null;
const blocked=()=>{throw Error('Mobile fixture: all writes forbidden')};export const deleteDoc=blocked,updateDoc=blocked,runTransaction=blocked;
`
await build({entryPoints:['qa/summary-mobile-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',loader:{'.png':'dataurl'},plugins:[{name:'fictional-firestore',setup(b){b.onResolve({filter:/^firebase\/auth$/},()=>({path:'auth',namespace:'shell'}));b.onResolve({filter:/\/access$/},()=>({path:'access',namespace:'shell'}));b.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'shell'}));b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'shell'}));b.onLoad({filter:/.*/,namespace:'shell'},a=>({loader:'js',contents:a.path==='auth'?`export const signOut=()=>{throw Error('No fixture writes')};`:a.path==='access'?`const modules=[];export const useAccess=()=>({role:'admin',modules}),canAccess=()=>true,useRole=()=> 'admin',useCan=()=>()=>false;`:a.path==='i18n'?`export const useT=()=>s=>s;`:`export const db={},storage={},auth={},authedUser=async()=>({uid:'fixture'}),authHeader=async()=>({});`}));b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'mobile'}));b.onLoad({filter:/.*/,namespace:'mobile'},()=>({contents:mock,loader:'js'}))}},await workspaceSyncPlugin()]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
await writeFile(out+'/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
await writeFile(out+'/audit.html',await readFile('qa/summary-mobile-audit.html','utf8'))
if(!process.argv.includes('--build-only'))createServer(async(req,res)=>{const name={'/audit':'audit.html','/dashboard':'index.html','/customer':'index.html','/style.css':'style.css','/app.js':'app.js'}[req.url];if(!name){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(out+'/'+name))}).listen(5199,'127.0.0.1',()=>console.log('Mobile summary fixture ready'))
