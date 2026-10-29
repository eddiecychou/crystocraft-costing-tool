// Local actual-screen fixture. Firebase is replaced; no live auth/data/API.
import {build} from 'esbuild'
import {mkdir,readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
const out='qa/out/po-receive-preview'
await mkdir(out,{recursive:true})
const stub=`
export const db={},storage={},authedUser=async()=>({uid:'fixture_admin'}),authHeader=async()=>{throw Error('No network API in fixture')};
export const components=['RE','PI','FU','VL','PE','C1'].map((s,i)=>({id:'c'+i,code:'P-CF001-'+s,name:'Crystal fabric petal '+s}));
export const useComponents=()=>({components,loading:false});
let records={},listeners=[],seq=0;
const clone=x=>x==null?x:structuredClone(x),path=(a,p)=>[...(typeof a==='string'?[a]:[]),...p].join('/');
export const collection=(a,...p)=>path(a,p),doc=(a,...p)=>{const q=path(a,p);return q.split('/').length%2?q+'/auto_'+(++seq):q},query=x=>x,orderBy=x=>x,where=x=>x;
export const serverTimestamp=()=>new Date('2026-10-29T03:00:00Z');
const snapshot=p=>({id:p.split('/').at(-1),ref:p,exists:()=>!!records[p],data:()=>clone(records[p])});
export const getDoc=async p=>snapshot(p),getDocs=async p=>({docs:Object.keys(records).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(snapshot)});
const notify=()=>listeners.forEach(l=>l.fn(snapshot(l.p)));
export const onSnapshot=(p,fn)=>{const l={p,fn};listeners.push(l);fn(snapshot(p));return()=>{listeners=listeners.filter(x=>x!==l)}};
export const updateDoc=async(p,d)=>{records[p]={...records[p],...clone(d)};notify()},deleteDoc=async()=>{throw Error('No deletions in fixture')},addDoc=async()=>{throw Error('No duplicate POs in fixture')};
export async function runTransaction(_,fn){const writes=[];let writing=false;const result=await fn({get:async p=>{if(writing)throw Error('Read after write');return snapshot(p)},set:(p,d)=>{writing=true;writes.push([p,clone(d),false])},update:(p,d)=>{writing=true;writes.push([p,clone(d),true])}});for(const[p,d,merge]of writes)records[p]=merge?{...records[p],...d}:d;notify();return result}
export const loadComponents=async()=>components.map(c=>({...records['range_components/'+c.id],id:c.id})),loadCrystals=async()=>[],loadPackaging=async()=>[];
export const ref=()=>{},uploadBytes=async()=>{throw Error('No uploads in fixture')},getDownloadURL=async()=>{throw Error('No uploads in fixture')};
export function init(){
 const quantities=[102,60,64,65,60,65],fresh=new URLSearchParams(location.search).has('fresh');
 const lines=components.map((c,i)=>({code:c.code,description:components[0].name,qty:quantities[i],unit:'pcs',unit_price:5.8,linked:{type:'range',component_id:'c0',label:components[0].code}}));
 records={'purchase_orders/p':{pu_number:'PU-FIXTURE',supplier_id:'supplier',supplier_name:'Isolated test supplier',currency:'RMB',status:'issued',issued_date:'2026-10-28',lines,adjustments:[{kind:'charge',label:'Tooling',amount:3000}],stock_received:!fresh,stock_received_at:new Date('2026-10-29T02:32:19Z'),received_lines:fresh?[]:lines.map(l=>({cls:'metal',sku_id:'c0',code:components[0].code,qty:l.qty})),receive_generation:0},'suppliers/supplier':{name:'Isolated test supplier'}};
 for(const[i,c]of components.entries())records['range_components/'+c.id]={code:c.code,name:c.name,stock_qty:!fresh&&!i?102:0,reserved_qty:0,movement_seq:!fresh&&!i?1:0,ledger_seeded:true};
 if(!fresh)records['range_components/c0/movements/po_receive_p_g0_c0']={type:'receipt',qty:102,seq:1,note:'Received PU PU-FIXTURE'};
}
`
await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import Detail from './src/pages/PurchaseOrderDetail.jsx';import Form from './src/pages/PurchaseOrderForm.jsx';import{init}from'po-fixture';init();createRoot(document.getElementById('root')).render(<BrowserRouter><aside className="p-3 text-sm">Isolated fixture — no live OC data.</aside><Routes><Route path='/purchase-orders/:id' element={<Detail/>}/><Route path='/purchase-orders/:id/edit' element={<Form/>}/></Routes></BrowserRouter>);`},outfile:out+'/app.js',bundle:true,format:'esm',jsx:'automatic',plugins:[{name:'local-po',setup(b){
 b.onResolve({filter:/^(po-fixture|firebase\/(firestore|storage))$|(^|\/)(firebase|criticalComponents|crystals|packaging)$/},()=>({path:'stub',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}));
 b.onResolve({filter:/(^|\/)puNumber$/},()=>({path:'pu',namespace:'fixture-pu'}));b.onLoad({filter:/.*/,namespace:'fixture-pu'},()=>({contents:"export const allocatePuNo=async()=>{throw Error('No live number allocation')};"}));
}}]})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
if(process.argv.includes('--build-only'))process.exit(0)
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname;try{
 if(path==='/app.js'||path==='/style.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(out+path))}
 else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>')}
}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('PO fixture: http://127.0.0.1:'+server.address().port+'/purchase-orders/p')
