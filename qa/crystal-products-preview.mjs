// Actual pages; mutations are isolated in a browser-only fictional store.
import {build} from 'esbuild'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {cleanCrystalProduct,cleanCrystalVariant} from '../src/domain/crystalProducts.js'
const out='/private/tmp/oc-crystal-catalogue-preview';await mkdir(out,{recursive:true})
const products=[
 {id:'cp_own_example',code:'CC-OCT-EXAMPLE',name:'Octagon crystal 14 mm',origin:'crystocraft',family:'cut',shape:'Octagon',supply:'stock_and_made'},
 {id:'cp_original_example',code:'CC-ORIGINAL-EXAMPLE',name:'Original Strass stock example',origin:'swarovski_strass',family:'cut',shape:'Octagon',supply:'stock_only',condition:'Inspected stock in original packaging',article_reference:'EXAMPLE',provenance_reviewed:true},
 {id:'cp_fabric_example',code:'CC-FABRIC-EXAMPLE',name:'Crystal fabric for custom applications',origin:'crystocraft',family:'fabric',supply:'made_to_order',unit:'project'},
].map(p=>({...cleanCrystalProduct({...p,unit:p.unit||'pcs',publication:'published',hero_id:'im_example',primary_variant_id:'v_clear_example'}),id:p.id,revision:2,description:'Fictional preview content. Real component UI and enquiry workflow.'}))
const media={original:'qa_original',display:'qa_display',thumbnail:'qa_thumb'},seed={}
for(const p of products){
 seed['crystal_products/'+p.id]=p
 for(const colour of ['Clear','Blue']){const id='v_'+colour.toLowerCase()+'_example';seed['crystal_products/'+p.id+'/variants/'+id]={...cleanCrystalVariant({code:p.code+'-'+colour.toUpperCase(),label:colour,size:p.family==='cut'?'14 mm':'Custom drawing',colour,unit:p.unit,publication:'published',confirmed:true}),id,revision:2}}
 seed['crystal_products/'+p.id+'/images/im_example']={id:'im_example',media,alt:p.name,publication:'published',revision:2}
}
seed['crystals/stock_original_example']={code:'OLD-EXAMPLE',name:'Swarovski Strass original example',stock_qty:12,reserved_qty:2}
seed['crystal_product_private/cp_original_example/variants/v_clear_example']={collection:'crystals',inventory_id:'stock_original_example',stock_unit:'pcs',catalogue_unit:'pcs',stock_per_unit:1,reviewed:false,notes:'Private QA provenance'}
const samples=[{id:'sw_photo_example',publication:'published',color_name:'Crystal AB',style:'fabric',backing_label:'Black',revision:4,media}]
const prelude='window.__records='+JSON.stringify(seed)+';window.__samples='+JSON.stringify(samples)+';window.__notifications=[];window.__writes=[];'
const firebaseStub="export const db={},storage={},auth={currentUser:{uid:'qa_owner',getIdToken:async()=> 'fictional.token'}};export const authedUser=async()=>auth.currentUser;"
const fsStub=`
const watchers=new Map();let seq=0;
export const doc=(...a)=>{let path=a.map(x=>typeof x==='string'?x:x?.path||'').filter(Boolean).join('/');if(a.length===1)path+='/enquiry_example_'+(++seq);return {path,id:path.split('/').pop()}};
export const collection=doc;export const query=(ref,...conditions)=>({...ref,conditions});export const where=(...v)=>v;export const orderBy=(...v)=>v;
export const serverTimestamp=()=>({toDate:()=>new Date()});export const Timestamp={fromDate:d=>d};
const snap=ref=>({id:ref.path.split('/').pop(),exists:()=>!!window.__records[ref.path],data:()=>window.__records[ref.path]});
export const getDoc=async ref=>snap(ref);
export const getDocs=async ref=>({docs:Object.keys(window.__records).filter(k=>k.startsWith(ref.path+'/')&&k.slice(ref.path.length+1).split('/').length===1).map(path=>snap({path}))});
export const onSnapshot=(ref,fn)=>{watchers.set(ref.path,fn);fn(ref.path==='enquiries'?{docs:[]}:snap(ref));return()=>watchers.delete(ref.path)};
export const setDoc=async(ref,value)=>{window.__records[ref.path]=value;window.__writes.push({path:ref.path,value});watchers.get(ref.path)?.(snap(ref))};
export const updateDoc=async(ref,value)=>setDoc(ref,{...window.__records[ref.path],...value});
export const deleteDoc=async ref=>{delete window.__records[ref.path]};
export const runTransaction=async(db,fn)=>fn({get:getDoc,set:setDoc,update:updateDoc});
`
const productStub=`
export const listCrystalProducts=async()=>{if(new URLSearchParams(location.search).has('error'))throw Error('Offline');if(new URLSearchParams(location.search).has('empty'))return [];return Object.entries(window.__records).filter(([k])=>k.split('/').length===2&&k.startsWith('crystal_products/')).map(([,p])=>p)};
export const loadCrystalProduct=async(id)=>{const p=window.__records['crystal_products/'+id];if(!p)return null;const child=(type)=>Object.entries(window.__records).filter(([k])=>k.startsWith('crystal_products/'+id+'/'+type+'/')).map(([k,d])=>({...d,id:k.split('/').pop()}));return {...p,variants:child('variants'),images:child('images'),hero_media:{display:'qa_display',thumbnail:'qa_thumb'}}};
export const saveCrystalProduct=async({id,values,expectedRevision})=>{const v={...values,id,revision:expectedRevision+1};window.__writes.push({path:'crystal_products/'+id,value:v});window.__records['crystal_products/'+id]=v;return v.revision};
export const saveCrystalVariant=async({productId,id,values})=>{window.__records['crystal_products/'+productId+'/variants/'+id]={...values,id,revision:1}};
export const saveCrystalImage=async()=>{};
export const loadCrystalMapping=async(pid,vid)=>window.__records['crystal_product_private/'+pid+'/variants/'+vid]||null;
export const saveCrystalMapping=async(pid,vid,values)=>{window.__lastMapping=values;window.__records['crystal_product_private/'+pid+'/variants/'+vid]=values};
export const createCrystalStockDraft=async(stock,origin)=>{const id='cp_stock_'+stock.id;window.__writes.push({path:'crystal_products/'+id,origin,stock_id:stock.id});return id};
`
const swatchStub=`
export const listCrystalSwatches=async()=>window.__samples;
export const readSwatchPhoto=async()=> (await fetch('/photo.jpg')).blob();
export const fetchSwatchImageUrl=async(path,{signal}={})=>URL.createObjectURL(await(await fetch('/photo.jpg',{signal})).blob());
`
await build({entryPoints:['qa/crystal-products-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',format:'esm',plugins:[{name:'fictional-catalogue',setup(b){
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}))
 b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'fixture'}))
 b.onResolve({filter:/(^|\/)crystalProducts$/},args=>args.path.includes('/domain/')?null:({path:'products',namespace:'fixture'}))
 b.onResolve({filter:/(^|\/)(crystalSwatches|swatchLibraryApi)$/},()=>({path:'swatches',namespace:'fixture'}))
 b.onResolve({filter:/(^|\/)notify$/},()=>({path:'notify',namespace:'fixture'}))
 b.onResolve({filter:/(^|\/)crystalEnquiries$/},()=>({path:'enquiry',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{firestore:fsStub,firebase:firebaseStub,products:productStub,swatches:swatchStub,notify:'export const notifyEmail=(...v)=>window.__notifications.push(v)',enquiry:"export const validateCrystalEnquirySelections=async()=>{};export const uploadEnquiryDrawing=async(e,file,id)=>({path:'enquiry-files/qa_owner/'+e+'/'+id+'.pdf',name:file.name,sha256:'example'});export const downloadEnquiryAttachment=async()=>{}"}[args.path],resolveDir:process.cwd()}))
}}]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
const files=await readdir('migration/crystal-swatches-v819.local/data/colors'),photo=files.find(f=>f.endsWith('.jpg'));await writeFile(out+'/photo.jpg',await readFile('migration/crystal-swatches-v819.local/data/colors/'+photo))
await writeFile(out+'/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script>'+prelude+'</script><script type="module" src="/app.js"></script></body></html>')
createServer(async(req,res)=>{try{
 if(req.url==='/api/crystal-availability'){res.setHeader('Content-Type','application/json');let raw='';for await(const data of req)raw+=data;const body=JSON.parse(raw);res.end(JSON.stringify({...body,availability:{verified:true,available:10,unit:'pcs',message:'10 pieces available · subject to confirmation.'}}));return}
 const path=req.url.split('?')[0],file=path==='/app.js'?'app.js':path==='/style.css'?'style.css':path==='/photo.jpg'?'photo.jpg':'index.html'
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html');res.end(await readFile(out+'/'+file))
}catch{res.statusCode=500;res.end('Preview unavailable')}}).listen(5202,'127.0.0.1',()=>console.log('Fictional catalogue http://127.0.0.1:5202'))
