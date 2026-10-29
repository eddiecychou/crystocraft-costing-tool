// Actual reservation card + engine in an isolated browser fixture. No live APIs.
import {build} from 'esbuild'
import {mkdir,readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
const out='qa/out/order-reservation-add-preview'
await mkdir(out,{recursive:true})
const stub=`
export const db={};
let records={},listeners=[],seq=0;const copy=x=>structuredClone(x),path=(a,p)=>[...(typeof a==='string'?[a]:[]),...p].join('/');
export const collection=(a,...p)=>path(a,p),doc=(a,...p)=>{const q=path(a,p);return q.split('/').length%2?q+'/auto_'+(++seq):q};
export const query=x=>x,orderBy=x=>x,serverTimestamp=()=>new Date();
const snap=p=>({id:p.split('/').at(-1),ref:p,exists:()=>!!records[p],data:()=>copy(records[p])});
export const getDoc=async p=>snap(p),getDocs=async p=>({docs:Object.keys(records).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(snap)});
const observe=p=>p.split('/').length%2?{docs:Object.keys(records).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(snap)}:snap(p);
export const onSnapshot=(p,fn)=>{const l={p,fn};listeners.push(l);fn(observe(p));return()=>{listeners=listeners.filter(x=>x!==l)}};
const notify=()=>listeners.forEach(l=>l.fn(observe(l.p)));
export async function runTransaction(_,fn){const writes=[];let writing=false;const result=await fn({get:async p=>{if(writing)throw Error('Read after write');return snap(p)},set:(p,d)=>{writing=true;writes.push([p,copy(d),false])},update:(p,d)=>{writing=true;writes.push([p,copy(d),true])}});for(const[p,d,merge]of writes)records[p]=merge?{...records[p],...d}:d;notify();return result}
export const updateDoc=async(p,d)=>{records[p]={...records[p],...copy(d)};notify()};
export const setDoc=async()=>{throw Error('Unsupported fixture write')},addDoc=setDoc,deleteDoc=setDoc,writeBatch=setDoc,increment=setDoc;
export const loadComponents=async()=>[];
export const computeRequirements=()=>{throw Error('BOM preview is outside this crystal/packaging fixture')};
export function init(){
 records={'orders/fixture':{crystals_reserved:true,crystals_reserved_generation:1,crystal_lines:[{crystal_id:'sapphire',code:'C01-1028-18-001',qty:3600},{crystal_id:'clear',code:'C01-1028-18-002',qty:2040},{crystal_id:'large',code:'C01-1028-26-002',qty:400}],packaging_reserved:true,packaging_reserved_generation:1,packaging_lines:[{packaging_id:'box',code:'BOX-01',qty:100}]}};
 for(const[id,code,name,colour,stock,reserved]of [['sapphire','C01-1028-18-001','Swarovski PP#1028/18 Sapphire','BL',73018,3600],['clear','C01-1028-18-002','Swarovski PP#1028/18 Crystal','C1',99571,2040],['large','C01-1028-26-002','Swarovski PP#1028/26 Crystal','C1',16940,400],['extra','C01-1028-18-003','Additional crystal','AB',500,15]])records['crystals/'+id]={code,name,colour,stock_qty:stock,reserved_qty:reserved,ledger_seeded:true,movement_seq:0};
 for(const[id,code,stock,reserved]of [['box','BOX-01',1000,100],['insert','INSERT-01',500,0]])records['packaging/'+id]={code,name:'Fixture packaging',type:'Box',stock_qty:stock,reserved_qty:reserved,ledger_seeded:true,movement_seq:0};
}
`
await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import Card from './src/components/OrderInventoryIssue.jsx';import{crystalInventory}from'./src/crystals.js';import{packagingInventory}from'./src/packaging.js';import{init,db,doc,onSnapshot}from'reservation-fixture';init();function Proof(){const[state,set]=useState({});useEffect(()=>onSnapshot(doc(db,'crystals','extra'),s=>set(s.data())),[]);return <section className="card p-4 mt-4" aria-label="Fixture stock readback"><p>New crystal on hand: {state.stock_qty} · Reserved: {state.reserved_qty}</p><p>Expected before addition: on hand 500 · Reserved for other orders 15</p></section>}function App(){return <main className="max-w-5xl mx-auto p-4"><p className="text-sm mb-4">Isolated reservation test — no live OC data.</p><div className="space-y-4"><Card orderId="fixture" orderLabel="UC-FIXTURE" inv={crystalInventory}/><Card orderId="fixture" orderLabel="UC-FIXTURE" inv={packagingInventory}/></div><Proof/></main>}createRoot(document.getElementById('root')).render(<App/>);`},outfile:out+'/app.js',bundle:true,format:'esm',jsx:'automatic',plugins:[{name:'reservation-fixture',setup(b){
 b.onResolve({filter:/^(reservation-fixture|firebase\/firestore)$|(^|\/)(firebase|criticalComponents|mrp)$/},()=>({path:'stub',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}));
}}]})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
if(process.argv.includes('--build-only'))process.exit(0)
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname;try{
 if(path==='/app.js'||path==='/style.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(out+path))}
 else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>')}
}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('Reservation fixture: http://127.0.0.1:'+server.address().port)
