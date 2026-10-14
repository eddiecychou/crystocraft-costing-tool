import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from '../.qa-playwright/node_modules/playwright-core/index.mjs'

const pixel = readFileSync('src/assets/logo.png').toString('base64')
const products=Array.from({length:60},(_,i)=>({id:`p${i}`,name:`Design ${String(i+1).padStart(3,'0')}`,category:'Accessories',active:true,status:'active',createdAt:i,heroImage:`https://www.crystocraft.com/wp-content/uploads/fixture-${i}.jpg`,heroImage_visibility:i===1?'internal':'public',pricing_summary:[],description:'Fixture catalogue specification'}))
const ranges=products.map((p,i)=>({...p,design_no:String(i+1).padStart(4,'0'),design_code:`D${String(i+1).padStart(4,'0')}`,design_name:p.name,description:p.name,format_code:'001',gallery:[{url:p.heroImage}],variants:[{brand_code:'D',plating_code:'G',plating_name:'Gold',sku:`D${String(i+1).padStart(4,'0')}-001-GC1`,ws_price_usd:5}]}))
const stubs={
  firebase:'export const db={}; export const storage={}; export const auth={currentUser:{uid:"viewer"}}; export const authHeader=async()=>({}); export const authedUser=async()=>({uid:"viewer"});',
  firestore:`
  const products=${JSON.stringify(products)}, ranges=${JSON.stringify(ranges)};
  const q=new URLSearchParams(location.search), url=n=>'https://firebasestorage.googleapis.com/v0/b/b/o/'+encodeURIComponent('products/gallery/images/'+n)+ '?alt=media&token=fixture';
  window.__qa={gallery:q.get('case')==='empty'?[]:[{id:'legacy',file_url:url('legacy.jpg'),storage_path:'products/gallery/images/legacy.jpg',visibility:'public',sort_order:0},{id:'second',file_url:url('second.jpg'),storage_path:'products/gallery/images/second.jpg',visibility:'internal',sort_order:1}],product:{heroImage:q.get('case')==='empty'?null:url('legacy.jpg'),price:62,status:'active'},uploads:[],deleted:[],batches:[],failBatch:false,maintenanceWrites:0};
  const listeners=new Set(); let nextId=0;
  export const collection=(...a)=>({path:a.filter(x=>typeof x==='string').join('/')});
  export const doc=(...a)=>a.length===1?{path:a[0].path+'/new-'+(++nextId)}:collection(...a);
  export const query=r=>r; export const orderBy=()=>({}); export const where=()=>({}); export const limit=()=>({}); export const serverTimestamp=()=>null;
  const snapshot=rows=>({docs:rows.map(r=>({id:r.id,data:()=>r})),size:rows.length});
  const rows=r=>r.path==='range_products'?ranges:r.path==='products'?products:r.path==='products/gallery/images'?window.__qa.gallery:r.path.endsWith('/images')?(()=>{const id=r.path.split('/')[1], p=products.find(p=>p.id===id); return p?[{id:'photo',file_url:p.heroImage,visibility:id==='p1'?'internal':'public',branded_for_customer_id:id==='p0'?'other':null,sort_order:0},...(id==='p1'?[{id:'safe',file_url:'https://www.crystocraft.com/wp-content/uploads/safe.jpg',visibility:'public',sort_order:1}]:[])]:[]})():[];
  export const onSnapshot=(r,next)=>{const fn=()=>next(snapshot(rows(r)));fn();listeners.add(fn);return()=>listeners.delete(fn)};
  export const getDocs=async r=>snapshot(rows(r)); export const getDoc=async()=>({exists:()=>false,data:()=>({})});
  export const updateDoc=async()=>{};export const deleteDoc=async()=>{};export const addDoc=async()=>({id:'new'});export const setDoc=async()=>{};
  export const writeBatch=()=>{const ops=[]; return {set:(r,d)=>ops.push({op:'set',path:r.path,data:d}),update:(r,d)=>ops.push({op:'update',path:r.path,data:d}),delete:r=>ops.push({op:'delete',path:r.path}),commit:async()=>{if(window.__qa.failBatch)throw Error('simulated commit failure'); for(const o of ops){if(o.path==='products/gallery'){Object.assign(window.__qa.product,o.data);continue}const id=o.path.split('/').at(-1),i=window.__qa.gallery.findIndex(x=>x.id===id);if(o.op==='delete')window.__qa.gallery.splice(i,1);else if(o.op==='set')window.__qa.gallery.push({id,...o.data});else Object.assign(window.__qa.gallery[i],o.data)}window.__qa.batches.push(ops);listeners.forEach(f=>f())}}};
  `,
  storage:`export const ref=(_s,path='')=>({path,bucket:'b'}); export const uploadBytes=async(r,_b,m)=>{window.__qa.uploads.push({path:r.path,metadata:m})}; export const getDownloadURL=async r=>'https://firebasestorage.googleapis.com/v0/b/b/o/'+encodeURIComponent(r.path)+'?alt=media&token=fixture'; export const deleteObject=async r=>window.__qa.deleted.push(r.path);`,
  currency:'const rates={};export const useRates=()=>rates;export const convertFromUSD=n=>n;export const convertFromHKD=n=>n;export const fmtMoney=(n,c)=>c+" "+n;export const wsPriceFactor=()=>1;',
  formatMoq:'export const useFormatMoq=()=>({labels:{}});',
  crystalColors:'export const useCrystalColors=()=>({colors:[]});export const colorMap=()=>({});',
  criticalComponents:'export const useComponents=()=>({components:[]});export const buildableFromComponents=()=>({qty:0,byPlating:{}});',
  catalogueCollections:'export const collectionProducts=(_c,items)=>items;',
  emptyComponent:'export default function Empty(){return null}',
  access:'export const useRole=()=>new URLSearchParams(location.search).get("role")||"admin";export const useCan=()=>()=>true;',
  i18n:'export const useT=()=>s=>s;',
  enhanceImage:`export const enhanceProductImage=async()=>({image:'${pixel}',mimeType:'image/png'});`,
  maintenance:'export const previewCatalogueImageRepairs=async()=>({products:60,ranges:60,heroChanges:[{id:"legacy",name:"Legacy product",before:{heroImage:"old"},after:{heroImage:"new"}}],cacheChanges:[{},{}],skipped:[]});export const applyCatalogueImageRepairs=async()=>{window.__qa.maintenanceWrites++;return{heroes:1,images:2,skipped:[],failed:[]}};',
}
const mapping={firebase:/(^|\/)firebase$/,firestore:/^firebase\/firestore$/,storage:/^firebase\/storage$/,currency:/(^|\/)currency$/,formatMoq:/(^|\/)formatMoq$/,crystalColors:/(^|\/)crystalColors$/,criticalComponents:/(^|\/)criticalComponents$/,catalogueCollections:/(^|\/)catalogueCollections$/,access:/(^|\/)access$/,i18n:/(^|\/)i18n$/,enhanceImage:/(^|\/)enhanceImage$/,maintenance:/(^|\/)catalogueImageMaintenance$/,emptyComponent:/(^|\/)(CollectionBand|ErpProductImport|RangeCatalogueExport|FavHeart|ManualAdjust)$/}
await build({entryPoints:['qa/catalogue-image-preview.jsx'],bundle:true,outfile:'qa/catalogue-image-preview-seeded.js',format:'esm',jsx:'automatic',loader:{'.png':'file','.jpg':'file','.ttf':'file','.css':'css'},plugins:[{name:'fixtures',setup(b){for(const [key,filter]of Object.entries(mapping))b.onResolve({filter},()=>({path:key,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}))}}]})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o','qa/catalogue-image-preview-seeded.css','--content','./src/**/*.{js,jsx},./qa/catalogue-image-preview.jsx'])
writeFileSync('qa/catalogue-image-preview-seeded.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./catalogue-image-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./catalogue-image-preview-seeded.js"></script></body></html>')
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://x'); if(url.pathname==='/.netlify/images'){res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=86400'});res.end(Buffer.from(pixel,'base64'));return}
  try{const path=join(process.cwd(),decodeURIComponent(url.pathname));res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});res.end(readFileSync(path))}catch{res.writeHead(404);res.end('not found')}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({channel:'chrome',headless:true})
let passed=0;const check=(name,value)=>{if(!value)throw Error(name);passed++;console.log('ok',name)}
const base=`http://127.0.0.1:${server.address().port}/qa/catalogue-image-preview-seeded.html`
async function pageFor(width,surface,extra=''){
 const page=await browser.newPage({viewport:{width,height:850}});page.errors=[];page.on('pageerror',e=>page.errors.push(String(e)));
 await page.route(/https:\/\/(www\.crystocraft\.com|firebasestorage\.googleapis\.com)\//,r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from(pixel,'base64'),headers:{'access-control-allow-origin':'*'}}));
 await page.goto(base+'?surface='+surface+extra);return page;
}
try{
 for(const width of [375,1280])for(const surface of ['products','corporate','range','figurine']){
  const page=await pageFor(width,surface);const prefix={products:'product-card-',corporate:'corp-card-',range:'range-card-',figurine:'fig-card-'}[surface];const cards=page.locator(`[id^="${prefix}"]`);
  await cards.first().waitFor();check(`${width} ${surface}: 24 initial cards`,await cards.count()===24);
  await page.getByRole('button',{name:/Load more/}).click();check(`${width} ${surface}: 48 after Load more`,await cards.count()===48);
  await cards.nth(30).click();await page.getByRole('button',{name:'Back to catalogue'}).click();await cards.nth(30).waitFor();check(`${width} ${surface}: return retains loaded page`,await cards.count()===48);
  const search=page.getByPlaceholder(surface==='range'?'Search name, code or SKU…':surface==='figurine'?'Search name or code…':surface==='corporate'?'Search products…':'Search…');
  await search.fill('Design 060');await cards.first().waitFor();check(`${width} ${surface}: search finds item beyond first page`,await cards.count()===1);
  await search.fill('');await page.getByRole('button',{name:/Load more/}).waitFor();check(`${width} ${surface}: changed filter resets page`,await cards.count()===24);
  const img=cards.first().locator('img');await img.waitFor();check(`${width} ${surface}: WordPress thumbnail uses WebP request`,(await img.getAttribute('src')).includes('fm=webp'));
  check(`${width} ${surface}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check(`${width} ${surface}: no runtime errors`,page.errors.length===0);
  if(surface==='figurine')await page.screenshot({path:`/private/tmp/catalogue-${surface}-${width}.png`});await page.close();
 }
 const sensitive=await pageFor(1280,'corporate','&sensitive=true');await sensitive.locator('[id^="corp-card-"]').first().waitFor();check('Sensitive customer: other client image and product excluded',await sensitive.locator('#corp-card-p0').count()===0);check('Sensitive customer: internal hero replaced by allowed gallery image',(await sensitive.locator('#corp-card-p1 img').getAttribute('src')).includes('safe.jpg'));await sensitive.close();
 const maintenance=await pageFor(375,'maintenance');await maintenance.getByRole('button',{name:'Preview repairs'}).click();await maintenance.getByRole('button',{name:'Apply repairs'}).waitFor();check('Maintenance preview writes nothing',await maintenance.evaluate(()=>window.__qa.maintenanceWrites===0));await maintenance.getByRole('button',{name:'Apply repairs'}).click();await maintenance.getByText('Updated 1 main-image references and caching for 2 photos.').waitFor();check('Maintenance apply reports verified counts',await maintenance.evaluate(()=>window.__qa.maintenanceWrites===1));check('Maintenance mobile has no overflow',await maintenance.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await maintenance.close();
 const staff=await pageFor(1280,'maintenance','&role=staff');check('Maintenance hidden from staff',await staff.getByRole('button',{name:'Preview repairs'}).count()===0);await staff.close();
 const gallery=await pageFor(1280,'gallery','&case=empty');await gallery.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});await gallery.waitForFunction(()=>window.__qa.gallery.length===1&&window.__qa.product.heroImage);
 check('First upload sets the main image atomically',await gallery.evaluate(()=>window.__qa.batches[0].some(o=>o.path==='products/gallery')&&window.__qa.batches[0].some(o=>o.op==='set')));check('Upload uses private browser cache',await gallery.evaluate(()=>window.__qa.uploads[0].metadata.cacheControl==='private, max-age=86400'));check('Internal first upload remains marked internal',await gallery.evaluate(()=>window.__qa.product.heroImage_visibility==='internal'));await gallery.close();
 const legacy=await pageFor(1280,'gallery');await legacy.locator('button[title^="Enhance image"]').first().click({force:true});await legacy.getByRole('button',{name:'Clean (white bg, faithful)',exact:true}).click();await legacy.getByRole('button',{name:'Replace original',exact:true}).click();await legacy.waitForFunction(()=>window.__qa.deleted.length===1);
 check('Legacy replacement updates image and main reference in the same batch',await legacy.evaluate(()=>window.__qa.batches[0].some(o=>o.path==='products/gallery')&&window.__qa.product.heroImage===window.__qa.gallery[0].file_url));check('Replacement preserves price and status',await legacy.evaluate(()=>window.__qa.product.price===62&&window.__qa.product.status==='active'));
 await legacy.locator('button[title="Delete image"]').first().click({force:true});await legacy.getByRole('button',{name:'Delete',exact:true}).click();await legacy.waitForFunction(()=>window.__qa.gallery.length===1);check('Delete selects remaining main image atomically',await legacy.evaluate(()=>window.__qa.product.heroImage===window.__qa.gallery[0].file_url&&window.__qa.product.heroImage_visibility==='internal'));await legacy.close();
 const failed=await pageFor(1280,'gallery');await failed.evaluate(()=>window.__qa.failBatch=true);await failed.locator('button[title^="Enhance image"]').first().click({force:true});await failed.getByRole('button',{name:'Clean (white bg, faithful)',exact:true}).click();await failed.getByRole('button',{name:'Replace original',exact:true}).click();await failed.getByText('simulated commit failure',{exact:true}).waitFor();check('Failed replacement preserves original photo and cache',await failed.evaluate(()=>window.__qa.deleted.length===0&&window.__qa.batches.length===0&&window.__qa.product.heroImage===window.__qa.gallery[0].file_url));await failed.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
console.log(`${passed} catalogue image browser checks passed`)
