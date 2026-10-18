// Real feature pages, fictional data boundary; no Firebase access or writes.
import {build} from 'esbuild'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
const out='/private/tmp/oc-swatch-preview';await mkdir(out,{recursive:true})
const seed=[0,1,2].map((n)=>({id:'sw_'+String(n).repeat(64),color_name:n===2?'Very long colour name for narrow mobile screens':'Crystal AB',notes_key:'Crystal AB',style:n===1?'rock':'fabric',backing_label:n===1?'Black':'01',description:'Real photographed material',rgb:[.4,.4,.4],sort_order:n,publication:n===2?'draft':'published',revision:2,media:{thumbnail:'qa'+n,display:'qa'+n}}))
const stub=`
 const rows=${JSON.stringify(seed)};
 if(new URLSearchParams(location.search).has('dense'))for(let i=3;i<48;i++)rows.push({...rows[0],id:'sw_dense_sample_'+String(i).padStart(5,'0'),backing_label:String(i),sort_order:i});
 window.__sampleRows=rows;window.__cart=[];window.__photoReads=0;window.__abortedReads=0;
 export async function listCrystalSwatches(){if(new URLSearchParams(location.search).has('error'))throw Error('Offline; please retry.');return rows.slice()}
 export async function saveCrystalSwatch(args){window.__lastSave={...args,file:args.file?.name};if(window.__saveFail){window.__saveFail=false;throw Error('Upload interrupted; retry.')}args.onPrepared?.(1);const i=rows.findIndex(r=>r.id===args.id);const next={...args.values,id:args.id,revision:3,media:{thumbnail:'qa0',display:'qa0'}};if(i<0)rows.push(next);else rows[i]=next;return 3}
 export async function applySwatchImport(p,progress){progress({done:p.samples.length,total:p.samples.length,label:'Verified source'});}
 export async function fetchSwatchRegistry(){const {swatchesToRegistry}=await import(${JSON.stringify(process.cwd()+'/src/domain/crystalSwatches.js')});return swatchesToRegistry(rows.filter(r=>r.publication==='published'))}
 export async function fetchSwatchImageUrl(path,{signal}={}){window.__photoReads++;let loaded=false;signal?.addEventListener('abort',()=>{if(!loaded)window.__abortedReads++});const blob=await (await fetch('/photo.jpg?slot='+path,{signal})).blob();loaded=true;return URL.createObjectURL(blob)}
 export const loadSwatchNotes=async()=>({legacy_swarovski_refs:['Reference retained']});export const saveSwatchNotes=async()=>{};
 export const useCart=()=>({add:i=>window.__cart.push(i)});
`
await build({entryPoints:['qa/crystal-swatches-preview.jsx'],outfile:out+'/app.js',bundle:true,jsx:'automatic',format:'esm',plugins:[{name:'bounded-swatches',setup(b){
 b.onResolve({filter:/(^|\/)swatchLibraryApi$|^(\.\.\/|\.\/)crystalSwatches$|^\.\/store$/},()=>({path:'swatch-fixture',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,resolveDir:process.cwd()}))
}}]})
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/index.css','-o',out+'/style.css'],{stdio:'pipe'})
const files=await readdir('migration/crystal-swatches-v819.local/data/colors');const photo=files.find(p=>p.endsWith('.jpg'))
await writeFile(out+'/photo.jpg',await readFile('migration/crystal-swatches-v819.local/data/colors/'+photo))
await writeFile(out+'/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
createServer(async(req,res)=>{try{const path=req.url.split('?')[0],file=path==='/app.js'?'app.js':path==='/style.css'?'style.css':path==='/photo.jpg'?'photo.jpg':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html');res.end(await readFile(out+'/'+file))}catch{res.statusCode=500;res.end('Preview unavailable')}}).listen(5201,'127.0.0.1',()=>console.log('Fictional swatch preview http://127.0.0.1:5201'))
