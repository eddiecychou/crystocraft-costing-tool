import { build } from 'esbuild'
import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const output = `/private/tmp/oc-image-maintenance-tests-${process.pid}.cjs`
const firestore = `
const state = () => globalThis.imageTestState;
export const doc = (...a) => ({ path: a.filter(x => typeof x === 'string').join('/') });
export const collection = doc;
export const query = ref => ref;
export const orderBy = () => ({});
const snap = (path, data) => ({ id: path.split('/').at(-1), exists: () => !!data, data: () => structuredClone(data) });
export const getDoc = async r => snap(r.path, state().docs[r.path]);
export const getDocs = async r => { const docs = Object.entries(state().docs).filter(([p]) => p.startsWith(r.path + '/') && p.split('/').length === r.path.split('/').length + 1).map(([p,d]) => snap(p,d)); return { docs, size: docs.length }; };
export const runTransaction = async (_db, work) => {
 const writes = [];
 await work({ get: getDoc, update: (r,p) => writes.push([r.path,p]) });
 if (state().failTransaction) throw Error('simulated transaction failure');
 writes.forEach(([p,d]) => {Object.assign(state().docs[p], d); state().writes.push({path:p,data:d});});
};`
const storage = `
const state = () => globalThis.imageTestState;
export const ref = (_storage, path='') => ({bucket:'b',path:path.replace('gs://b/','')});
export const getMetadata = async r => {if(!state().objects[r.path])throw Object.assign(Error('missing'),{code:'storage/object-not-found'});return structuredClone(state().objects[r.path]);};
export const updateMetadata = async (r,p) => {Object.assign(state().objects[r.path],p);state().writes.push({path:r.path,data:p});return structuredClone(state().objects[r.path]);};`
await build({ stdin: { contents: 'export * from "./src/catalogueImageMaintenance.js"', resolveDir: process.cwd() }, bundle:true, platform:'node', format:'cjs', outfile:output,
  plugins:[{name:'data-stubs',setup(b){
    b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fake'}));
    b.onResolve({filter:/^firebase\/storage$/},()=>({path:'storage',namespace:'fake'}));
    b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'fake'}));
    b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path==='firestore'?firestore:a.path==='storage'?storage:'export const db={}; export const storage={}; export const authedUser=async()=>({uid:"admin"});',loader:'js'}));
  }}] })
const { previewCatalogueImageRepairs, applyCatalogueImageRepairs } = createRequire(import.meta.url)(output)
const url = path => `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(path)}?alt=media&token=fixture`
function fixture() {
  return globalThis.imageTestState={
    writes:[], docs:{
      'users/admin':{role:'admin'},
      'products/p':{name:'Legacy product',heroImage:url('products/p/images/deleted.jpg'),status:'active',active:true,price:62},
      'products/p/images/a':{file_url:url('products/p/images/a.jpg'),sort_order:0,visibility:'internal',branded_for_customer_id:'client-a'},
      'range_products/r':{design_no:'0016',gallery:[{url:url('range_products/r/a.jpg')}],variants:[]},
    }, objects:{
      'products/p/images/a.jpg':{generation:'1',contentType:'image/jpeg',cacheControl:''},
      'range_products/r/a.jpg':{generation:'2',contentType:'image/jpeg',cacheControl:''},
    },
  }
}
test('preview is write-free, repairs only the live hero, and retains visibility and branding',async()=>{
  const s=fixture(); const p=await previewCatalogueImageRepairs();
  assert.equal(s.writes.length,0);assert.equal(p.cacheChanges.length,2);assert.equal(p.heroChanges.length,1);
  assert.equal(p.heroChanges[0].after.heroImage_visibility,'internal');assert.equal(p.heroChanges[0].after.heroImage_branded_for_customer_id,'client-a');
})
test('non-admin cannot preview or apply any maintenance',async()=>{
  const s=fixture();s.docs['users/admin'].role='staff';
  await assert.rejects(previewCatalogueImageRepairs(),/administrator/);
  await assert.rejects(applyCatalogueImageRepairs({cacheChanges:[],heroChanges:[]}),/administrator/);assert.equal(s.writes.length,0);
})
test('apply updates only caching and main-image fields, and a second preview is empty',async()=>{
  const s=fixture();const p=await previewCatalogueImageRepairs();const r=await applyCatalogueImageRepairs(p);
  assert.equal(r.images,2);assert.equal(r.heroes,1);assert.equal(r.failed.length,0);
  assert.equal(s.docs['products/p'].price,62);assert.equal(s.docs['products/p'].status,'active');assert.equal(s.docs['products/p'].active,true);
  assert.equal(s.objects['products/p/images/a.jpg'].cacheControl,'private, max-age=86400');
  assert.deepEqual(s.docs['range_products/r'].variants,[]);
  const again=await previewCatalogueImageRepairs();assert.equal(again.heroChanges.length,0);assert.equal(again.cacheChanges.length,0);
})
test('a changed gallery after preview is rejected without overwriting the product',async()=>{
  const s=fixture();const p=await previewCatalogueImageRepairs();p.cacheChanges=[];
  s.docs['products/p/images/a'].visibility='public';const before=structuredClone(s.docs['products/p']);
  const r=await applyCatalogueImageRepairs(p);assert.equal(r.heroes,0);assert.equal(r.failed.length,1);assert.deepEqual(s.docs['products/p'],before);
})
test('failed transaction leaves the old main image and unrelated product fields intact',async()=>{
  const s=fixture();const p=await previewCatalogueImageRepairs();p.cacheChanges=[];s.failTransaction=true;
  const before=structuredClone(s.docs['products/p']);const r=await applyCatalogueImageRepairs(p);
  assert.equal(r.failed.length,1);assert.deepEqual(s.docs['products/p'],before);assert.equal(s.writes.length,0);
})
test('replaced object generation and unrelated paths cannot be overwritten',async()=>{
  const s=fixture();const p=await previewCatalogueImageRepairs();p.heroChanges=[];
  s.objects['products/p/images/a.jpg'].generation='new';p.cacheChanges[1].path='customer-assets/c/logo.png';
  const r=await applyCatalogueImageRepairs(p);assert.equal(r.images,0);assert.equal(r.skipped.length,1);assert.equal(r.failed.length,1);assert.equal(s.writes.length,0);
})
test('an unavailable gallery image is reported and does not clear a legacy main image',async()=>{
  const s=fixture();delete s.objects['products/p/images/a.jpg'];const p=await previewCatalogueImageRepairs();
  assert.equal(p.skipped.length,1);assert.equal(p.heroChanges.length,0);assert.equal(s.writes.length,0);
})
