// Actual customer function wrappers/handlers; only Admin SDK I/O is fictional.
// Customer output must not acquire private costing links, quote/PDF URLs or costs.
import {before,beforeEach,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {crystalEnquiryLine,crystalEnquirySnapshot} from '../src/domain/crystalProducts.js'
import {publicComponent} from '../src/domain/rangeUpload.js'
const PRIVATE={crystal_product_id:'PRIVATE_CRYSTAL_LINK',crystal_variant_id:'PRIVATE_VARIANT_LINK',crystal_catalogue_unit:'PRIVATE_LINK_UNIT',crystal_product_code:'PRIVATE_PRODUCT_CODE',crystal_variant_code:'PRIVATE_VARIANT_CODE',crystal_linked_at:'PRIVATE_LINK_TIME',unit_cost:987.654,supplier_id:'PRIVATE_SUPPLIER',preferred_quote_id:'PRIVATE_QUOTE',attachments:[{file_url:'https://private.invalid/SUPPLIER_PDF_SECRET',file_name:'PRIVATE_PDF.pdf'}],notes:'PRIVATE_SOURCE_NOTES'}
const rangeId='range_public_fixture',pid='cp_public_fixture',vid='v_public_fixture',cid='rc_private_fixture',stockId='stock_private_fixture',imageId='im_public_fixture',photo=`crystal-products/${pid}/${imageId}/${'c'.repeat(64)}/display.jpg`
let scratch,endpoints,f,originalBucket
before(async()=>{
 scratch=await mkdtemp(resolve('qa/out/crystal-costing-privacy-engine-'))
 await build({stdin:{contents:"export {default as range} from './netlify/functions/customer-availability.js';export {default as crystal} from './netlify/functions/crystal-availability.js';export {default as media} from './netlify/functions/crystal-product-media.js'",resolveDir:process.cwd()},outfile:join(scratch,'endpoints.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'fictional-admin-privacy-boundaries',setup(b){
  b.onResolve({filter:/^firebase-admin\/(auth|firestore|storage)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));b.onResolve({filter:/\/firebaseAdmin\.js$/},()=>({path:'init',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?"export const getAuth=()=>({verifyIdToken:async token=>{if(token!=='FICTIONAL')throw Error('Invalid fixture token');return{uid:'fictional_customer'}}})":a.path==='firestore'?'export const getFirestore=()=>globalThis.__crystalPrivacy.db':a.path==='storage'?'export const getStorage=()=>globalThis.__crystalPrivacy.storage':'export const initAdminApp=()=>{}'}))
 }}]})
 endpoints=await import(pathToFileURL(join(scratch,'endpoints.mjs')));originalBucket=process.env.VITE_FIREBASE_STORAGE_BUCKET;process.env.VITE_FIREBASE_STORAGE_BUCKET='fictional.appspot.com'
},{timeout:20000})
beforeEach(()=>{
 const component={id:cid,code:'PRIVATE_BODY',plating_code:'C',stock_qty:10,reserved_qty:2,lead_time_weeks:4,...structuredClone(PRIVATE)}
 const product={id:pid,code:'CC-PUBLIC',name:'Public crystal',description:'Public description',family:'cut',origin:'crystocraft',supply:'made_to_order',unit:'pcs',publication:'published',revision:3,hero_media:{thumbnail:photo},...structuredClone(PRIVATE)}
 const variant={id:vid,code:'CC-PUBLIC-CLEAR',label:'Public clear',size:'14 mm',unit:'pcs',confirmed:true,publication:'published',revision:2,...structuredClone(PRIVATE)}
 f=globalThis.__crystalPrivacy={component,product,variant,reads:[],masks:[],selects:[],objects:[],records:new Map([
  ['users/fictional_customer',{role:'customer',status:'approved'}],
  ['range_products/'+rangeId,{active:true,status:'stock',variants:[{plating_code:'C'}],critical_components:[{id:cid,code:component.code,qty_per_unit:1}],lead_time_weeks:2}],
  ['settings/productDefaults',{default_parts_lead_weeks:6}],['range_components/'+cid,component],
  ['crystal_products/'+pid,product],['crystal_products/'+pid+'/variants/'+vid,variant],
  ['crystal_product_private/'+pid+'/variants/'+vid,{collection:'crystals',inventory_id:stockId,stock_unit:'pcs',catalogue_unit:'pcs',stock_per_unit:1,reviewed:true,...structuredClone(PRIVATE)}],
  ['crystals/'+stockId,{stock_qty:10,reserved_qty:2,...structuredClone(PRIVATE)}],
  ['crystal_products/'+pid+'/images/'+imageId,{publication:'published',media:{original:photo,display:photo,thumbnail:photo},...structuredClone(PRIVATE)}],
 ])}
 const project=(data,mask)=>Object.fromEntries(mask.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]))
 const snap=(path,mask)=>{if(!f.records.has(path))throw Error('Unexpected document read: '+path);const data=f.records.get(path);return{id:path.split('/').at(-1),exists:true,data:()=>structuredClone(mask?project(data,mask):data)}}
 f.db={
  doc:path=>({path,get:async()=>{f.reads.push(path);return snap(path)}}),
  getAll:async(...args)=>{const options=args.pop();assert.ok(Array.isArray(options.fieldMask));f.masks.push([...options.fieldMask]);return args.map(r=>snap(r.path,options.fieldMask))},
  collection:name=>({where:(field,operator,codes)=>({select:(...fields)=>({get:async()=>{
   assert.equal(name,'range_components');assert.equal(field,'code');assert.equal(operator,'in');f.selects.push(fields)
   return{docs:[...f.records].filter(([path,data])=>path.startsWith('range_components/')&&!path.slice('range_components/'.length).includes('/')&&codes.includes(data.code)).map(([path])=>snap(path,fields))}
  }})})}),
 }
 f.storage={bucket:name=>{assert.equal(name,'fictional.appspot.com');return{file:path=>({getMetadata:async()=>{assert.equal(path,photo);f.objects.push(path);return[{size:4,contentType:'image/jpeg'}]},download:async()=>[Buffer.from([255,216,255,217])]})}}}
})
after(async()=>{delete globalThis.__crystalPrivacy;if(originalBucket===undefined)delete process.env.VITE_FIREBASE_STORAGE_BUCKET;else process.env.VITE_FIREBASE_STORAGE_BUCKET=originalBucket;if(scratch)await rm(scratch,{recursive:true,force:true})})
const request=(key,body)=>endpoints[key](new Request('https://fictional.invalid/api/'+(key==='range'?'customer-availability':'crystal-availability'),{method:'POST',headers:{Authorization:'Bearer FICTIONAL'},body:JSON.stringify(body)}))
const noPrivate=value=>assert.doesNotMatch(typeof value==='string'?value:JSON.stringify(value),/PRIVATE_|SUPPLIER_PDF_SECRET|987\.654|crystal_product_id|crystal_variant_id|crystal_catalogue_unit|crystal_linked_at|preferred_quote_id|supplier_id|unit_cost|attachments/)

test('actual Range availability wrapper reads only its five stock/lead fields and serializes no linked supplier data',async()=>{
 const response=await request('range',{productId:rangeId});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store')
 const body=await response.json();assert.equal(body.availability.buildable,8);noPrivate(body)
 assert.deepEqual(f.masks,[['code','plating_code','stock_qty','reserved_qty','lead_time_weeks']]);assert.deepEqual(f.selects,[])
 assert.equal(f.reads.some(path=>path.includes('supplier_quotes')),false)
})
test('actual Range code fallback also selects only the five public-availability inputs',async()=>{
 f.records.get('range_products/'+rangeId).critical_components=[{code:'PRIVATE_BODY',qty_per_unit:1}]
 const response=await request('range',{productId:rangeId});assert.equal(response.status,200);noPrivate(await response.json())
 assert.deepEqual(f.masks,[]);assert.deepEqual(f.selects,[['code','plating_code','stock_qty','reserved_qty','lead_time_weeks']])
})
test('actual Crystal availability wrapper reads crystal stock counts only and never the supplier-cost component/quote',async()=>{
 const response=await request('crystal',{productId:pid,variantId:vid});assert.equal(response.status,200)
 const body=await response.json();assert.equal(body.availability.available,8);noPrivate(body)
 assert.deepEqual(f.masks,[['stock_qty','reserved_qty']]);assert.equal(f.reads.some(path=>path.startsWith('range_components/')||path.includes('supplier_quotes')),false)
})
test('actual customer media endpoint returns image bytes only and refuses supplier PDF paths before any object read',async()=>{
 const good=await endpoints.media(new Request('https://fictional.invalid/api/crystal-product-media?file='+encodeURIComponent(photo),{headers:{Authorization:'Bearer FICTIONAL'}}))
 assert.equal(good.status,200);assert.equal(good.headers.get('content-type'),'image/jpeg');assert.deepEqual([...new Uint8Array(await good.arrayBuffer())],[255,216,255,217]);assert.deepEqual(f.objects,[photo])
 for(const path of ['range_components/'+cid+'/quotes/PRIVATE_PDF.pdf','suppliers/PRIVATE_SUPPLIER/catalog.pdf']){
  const response=await endpoints.media(new Request('https://fictional.invalid/api/crystal-product-media?file='+encodeURIComponent(path),{headers:{Authorization:'Bearer FICTIONAL'}}));assert.equal(response.status,400);noPrivate(await response.text())
 }
 assert.deepEqual(f.objects,[photo])
})
test('actual enquiry line/snapshot projections do not transfer private links, costs or PDF URLs into cart payloads',()=>{
 const line=crystalEnquiryLine(f.product,f.variant);assert.equal(line.ws_price_usd,null);noPrivate(line)
 const snapshot=crystalEnquirySnapshot({...line,...PRIVATE});noPrivate(snapshot);assert.equal(snapshot.source_collection,'crystal_products');assert.equal(snapshot.variant_id,vid)
})
test('existing restricted Range component API projection excludes new private Crystal links and supplier evidence',()=>{
 const output=publicComponent({id:cid,version:'fixture-version',data:f.component});const{code,...safe}=output;noPrivate(safe)
 assert.equal(output.id,cid);assert.equal(output.code,'PRIVATE_BODY')
})
