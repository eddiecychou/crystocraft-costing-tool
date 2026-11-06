// Actual private linking/code-reservation/guarded-quote code; fictional I/O only.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
let scratch, engine, f
const P='cp_costing_fixture',V='v_rose_fixture',C='rc_costing_fixture',Q='quote_costing_fixture',S='supplier_costing_fixture'
const cp='crystal_products/'+P,vp=cp+'/variants/'+V,cc='range_components/'+C,qp=cc+'/supplier_quotes/'+Q
const product={id:P,code:'CC-FIXTURE',name:'Fictional Pear Crystal'},variant={id:V,code:'CC-FIXTURE-ROSE',label:'Fictional Rose',unit:'pcs'}
const attachment={file_url:'/private-fixture.pdf',file_name:'Fictional source 中文.pdf',file_type:'pdf',storage_path:cc+'/quotes/fixture.pdf',sha256:'a'.repeat(64)}
const quote={supplier_id:S,supplier_name:'Fictional supplier',unit_cost:1.222,unit_cost_currency:'USD',volume_tiers:[{min_qty:1000,unit_cost:1.111}],moq:500,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',sampling_lead_time_days:null,tooling_lead_time_days:12,production_lead_time_days:30,is_preferred:true,notes:'Approved fictional terms 中文',attachments:[attachment],createdAt:'original',provenance:{keep:true}}
const component={code:variant.code,name:'Fictional private crystal',stock_qty:102,reserved_qty:10,stock_marker:'PRESERVE',images:['/existing-image.jpg'],notes:'Keep internal component',unit_cost:1.222,unit_cost_currency:'USD',volume_tiers:quote.volume_tiers,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',preferred_quote_id:Q,preferred_supplier_name:quote.supplier_name,createdAt:'original-component'}
const clone=structuredClone,ctx=()=>({crystal_product_id:P,crystal_variant_id:V}),snapshot=()=>clone([...f.records]),read=path=>clone(f.records.get(path))
before(async()=>{
 scratch=await mkdtemp(resolve('qa/out/crystal-costing-engine-'))
 const firestore=`const f=()=>globalThis.__crystalCostingFixture;const copy=structuredClone;
 export const doc=(...parts)=>{const p=parts.flatMap(x=>x?.path?[x.path]:typeof x==='string'?[x]:[]);if(p.length&&p.join('/').split('/').length%2)p.push('generated-'+(++f().ids));const path=p.join('/');return{path,id:path.split('/').at(-1)}};
 export const collection=(...parts)=>{const p=parts.flatMap(x=>x?.path?[x.path]:typeof x==='string'?[x]:[]).join('/');return{path:p}};
 export const where=(key,op,value)=>({key,op,value}),limit=count=>({count}),orderBy=()=>({}),query=(ref,...filters)=>({...ref,filters});
 const snap=ref=>({id:ref.id,ref,exists:()=>f().records.has(ref.path),data:()=>copy(f().records.get(ref.path))});
 export const getDoc=async ref=>snap(ref);export const getDocs=async ref=>{let docs=[...f().records].filter(([path])=>path.startsWith(ref.path+'/')&&path.slice(ref.path.length+1).split('/').length===1).map(([path])=>snap({path,id:path.split('/').at(-1)}));for(const filter of ref.filters||[]){if(filter.key)docs=docs.filter(d=>d.data()[filter.key]===filter.value);if(filter.count)docs=docs.slice(0,filter.count)}return{docs,size:docs.length,empty:!docs.length}};
 export const serverTimestamp=()=> 'FICTIONAL_SERVER_TIMESTAMP';
 export const runTransaction=async(_,fn)=>{const record={reads:[],writes:[],committed:false};f().transactions.push(record);const tx={get:async ref=>{if(record.writes.length)throw Error('Read after write');record.reads.push(ref.path);return snap(ref)},update:(ref,data)=>record.writes.push({kind:'update',path:ref.path,data:copy(data)}),set:(ref,data,options)=>record.writes.push({kind:'set',path:ref.path,data:copy(data),options}),delete:ref=>record.writes.push({kind:'delete',path:ref.path})};const result=await fn(tx);if(f().commitError)throw f().commitError;const updated=new Map(f().records);for(const op of record.writes){if(op.kind==='delete')updated.delete(op.path);else{if(op.kind==='update'&&!updated.has(op.path))throw Error('Missing document');updated.set(op.path,op.kind==='update'||op.options?.merge?{...updated.get(op.path),...op.data}:op.data)}}f().records=updated;record.committed=true;return result};
 const fail=()=>{throw Error('Independent write forbidden')};export{fail as setDoc,fail as addDoc,fail as deleteDoc,fail as updateDoc,fail as onSnapshot,fail as writeBatch,fail as increment};`
 await build({stdin:{contents:"export * from './src/crystalSupplierCosting.js';export {saveComponentQuote,setPreferredQuote,deleteComponentQuote} from './src/criticalComponents.js'",resolveDir:process.cwd()},outfile:join(scratch,'engine.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'fictional-costing-boundaries',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}));b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='firestore'?firestore:a.path==='react'?'export const useState=()=>{},useEffect=()=>{}':'export const db={};'}))}}]})
 engine=await import(pathToFileURL(join(scratch,'engine.mjs')))
},{timeout:20000})
beforeEach(()=>{f=globalThis.__crystalCostingFixture={ids:0,transactions:[],records:new Map([[cp,{code:product.code,name:product.name,publication:'draft'}],[vp,{code:variant.code,label:variant.label,unit:variant.unit,confirmed:true,publication:'draft'}],[cc,clone(component)],[qp,clone(quote)],['suppliers/'+S,{name:quote.supplier_name}]])}})
after(async()=>{delete globalThis.__crystalCostingFixture;if(scratch)await rm(scratch,{recursive:true,force:true})})
const link=extra=>engine.linkCrystalCosting({productId:P,variantId:V,componentId:C,quoteId:Q,...extra})
async function linked(){await link();f.transactions=[]}
const assertPreserved=()=>{const c=read(cc);for(const key of ['stock_qty','reserved_qty','stock_marker','images','notes','createdAt'])assert.deepEqual(c[key],component[key],key)}

test('link writes only six association fields; supplier quote/PDF, preference, stock and public records remain exact',async()=>{
 const before=snapshot();await link({expectedLink:{product:'',variant:'',unit:''}})
 const writes=f.transactions.flatMap(t=>t.writes);assert.equal(writes.length,1);assert.equal(writes[0].path,cc)
 assert.deepEqual(Object.keys(writes[0].data).sort(),['crystal_catalogue_unit','crystal_linked_at','crystal_product_code','crystal_product_id','crystal_variant_code','crystal_variant_id'])
 for(const[path,data]of before)if(path!==cc)assert.deepEqual(read(path),data,path)
 for(const[key,value]of Object.entries(component))assert.deepEqual(read(cc)[key],value,key)
 assert.equal(read(cc).crystal_variant_id,V);assert.equal(read(cc).crystal_catalogue_unit,'pcs')
})
test('same-link retry is idempotent and issues no timestamp/cost/quote writes',async()=>{
 await link();const before=snapshot();await link({expectedLink:{product:P,variant:V,unit:'pcs'}})
 assert.deepEqual(snapshot(),before);assert.equal(f.transactions.at(-1).writes.length,0)
})
for(const[label,path]of[['product',cp],['variant',vp],['component',cc],['quote',qp],['supplier','suppliers/'+S]])test('missing '+label+' rejects linking without mutations',async()=>{
 f.records.delete(path);const before=snapshot();await assert.rejects(link(),/no longer exists|existing supplier/);assert.deepEqual(snapshot(),before)
})
test('stale expected association rejects the operator confirmation',async()=>{
 await linked();const before=snapshot();await assert.rejects(link({expectedLink:{product:'',variant:'',unit:''}}),/association changed/);assert.deepEqual(snapshot(),before)
})
for(const unit of [undefined,'','   '])test('link rejects an absent or blank variant unit: '+String(unit),async()=>{
 if(unit===undefined)delete f.records.get(vp).unit;else f.records.get(vp).unit=unit
 const before=snapshot();await assert.rejects(link(),/variant unit needs review/);assert.deepEqual(snapshot(),before);assert.equal(f.transactions.at(-1).writes.length,0)
})
test('one existing component cannot be reassigned across catalogue variants',async()=>{
 Object.assign(f.records.get(cc),{crystal_product_id:P,crystal_variant_id:'v_other_fixture',crystal_catalogue_unit:'pcs'})
 const before=snapshot();await assert.rejects(link(),/already linked/);assert.deepEqual(snapshot(),before)
})
for(const fields of [{crystal_product_id:P},{crystal_variant_id:V}])test('incomplete saved association requires review: '+Object.keys(fields)[0],async()=>{
 Object.assign(f.records.get(cc),fields);const before=snapshot();await assert.rejects(link(),/incomplete crystal association/);assert.deepEqual(snapshot(),before)
})
test('source reads retain exact quote values and private attachment metadata',async()=>{
 await linked();const rows=await engine.loadCrystalCostings(P);assert.equal(rows.length,1)
 assert.deepEqual(rows[0].quotes,[{...clone(quote),id:Q}]);assert.equal(rows[0].quotes[0].unit_cost,1.222);assert.equal(rows[0].quotes[0].volume_tiers[0].unit_cost,1.111)
 assert.deepEqual((await engine.inspectCrystalCostingComponent(C)).quotes[0].attachments,[attachment])
})
test('stable component creation retries reuse the same ID and one canonical code claim',async()=>{
 f.records.delete(cc);f.records.delete(qp)
 const first=await engine.createCrystalCostingComponent(product,variant),before=snapshot();const second=await engine.createCrystalCostingComponent(product,variant)
 assert.equal(first,second);assert.match(first,/^rc_cc_[a-f0-9]{28}$/);assert.deepEqual(snapshot(),before)
 assert.equal([...f.records.keys()].filter(p=>/^range_components\/[^/]+$/.test(p)).length,1)
 assert.equal([...f.records.keys()].filter(p=>p.startsWith('range_component_claims/')).length,1)
 assert.equal(read('range_components/'+first).crystal_variant_id,V)
})
test('an existing punctuation-equivalent canonical code is rejected rather than copied',async()=>{
 f.records.get(cc).code='CC FIXTURE ROSE';const before=snapshot()
 await assert.rejects(engine.createCrystalCostingComponent(product,variant),/punctuation-equivalent|canonical/);assert.deepEqual(snapshot(),before)
})
test('guarded quote save preserves exact precision/PDF/unknown provenance and atomically refreshes preferred cost',async()=>{
 await linked();const price={...clone(quote),unit_cost:1.223,volume_tiers:[{min_qty:1000,unit_cost:1.112}]}
 await engine.saveComponentQuote(C,Q,price,ctx())
 assert.equal(read(qp).unit_cost,1.223);assert.equal(read(cc).unit_cost,1.223);assert.equal(read(qp).volume_tiers[0].unit_cost,1.112)
 assert.deepEqual(read(qp).attachments,[attachment]);assert.deepEqual(read(qp).provenance,quote.provenance);assert.equal(read(qp).createdAt,'original');assert.equal(read(cc).preferred_quote_id,Q);assertPreserved()
 assert.equal(f.transactions.length,1);assert.ok(f.transactions[0].committed)
})
test('guarded new preferred quote updates exactly its existing quote tree and component',async()=>{
 await linked();const id=await engine.saveComponentQuote(C,null,{...clone(quote),unit_cost:1.333,is_preferred:true},ctx())
 assert.equal(read(cc).preferred_quote_id,id);assert.equal(read(cc).unit_cost,1.333);assert.equal(read(qp).is_preferred,false);assert.deepEqual(read(qp).attachments,[attachment]);assertPreserved()
 const quotePaths=[...f.records.keys()].filter(p=>p.startsWith(cc+'/supplier_quotes/'));assert.equal(quotePaths.length,2)
 assert.equal(f.transactions.length,1);assert.ok(f.transactions[0].committed)
})
test('preference selection is atomic and never replaces quote prices/attachments or stock',async()=>{
 await linked();const other='quote_other_fixture',path=cc+'/supplier_quotes/'+other;f.records.set(path,{...clone(quote),unit_cost:1.444,is_preferred:false})
 await engine.setPreferredQuote(C,other,ctx());assert.equal(read(cc).preferred_quote_id,other);assert.equal(read(cc).unit_cost,1.444);assert.equal(read(qp).is_preferred,false);assert.equal(read(path).is_preferred,true);assert.deepEqual(read(path).attachments,[attachment]);assertPreserved()
 assert.equal(f.transactions.length,1);assert.ok(f.transactions[0].committed)
})
test('deleting the preferred quote atomically clears only its cost snapshot and preserves stock',async()=>{
 await linked();await engine.deleteComponentQuote(C,Q,ctx());assert.equal(f.records.has(qp),false);assert.equal(read(cc).preferred_quote_id,null);assert.equal(read(cc).unit_cost,null);assertPreserved();assert.equal(f.transactions.length,1)
})
const changes={save:()=>engine.saveComponentQuote(C,Q,clone(quote),ctx()),prefer:()=>engine.setPreferredQuote(C,Q,ctx()),delete:()=>engine.deleteComponentQuote(C,Q,ctx())}
for(const[name,change]of Object.entries(changes))for(const unit of [undefined,'','   '])test(name+' refuses matching but absent/blank source and linked units: '+String(unit),async()=>{
 await linked();if(unit===undefined){delete f.records.get(vp).unit;delete f.records.get(cc).crystal_catalogue_unit}else{f.records.get(vp).unit=unit;f.records.get(cc).crystal_catalogue_unit=unit}
 const before=snapshot();await assert.rejects(change(),/costing link changed/);assert.deepEqual(snapshot(),before);assert.equal(f.transactions.at(-1).writes.length,0)
})
for(const[name,change]of Object.entries(changes))for(const[kind,mutate]of[
 ['association',()=>{f.records.get(cc).crystal_variant_id='v_changed_fixture'}],
 ['unit',()=>{f.records.get(vp).unit='sheet'}],
 ['missing quote',()=>{f.records.delete(qp)}],
])test(name+' rejects changed '+kind+' before every quote or component write',async()=>{
 await linked();mutate();const before=snapshot();await assert.rejects(change(),/link changed|quote no longer exists/);assert.deepEqual(snapshot(),before);assert.equal(f.transactions.at(-1).writes.length,0)
})
test('guarded save refuses a deleted supplier instead of denormalizing its cost',async()=>{
 await linked();f.records.delete('suppliers/'+S);const before=snapshot();await assert.rejects(changes.save(),/supplier no longer exists/);assert.deepEqual(snapshot(),before)
})
test('guarded preference refuses a deleted supplier instead of selecting stale supply',async()=>{
 await linked();f.records.delete('suppliers/'+S);const before=snapshot();await assert.rejects(changes.prefer(),/supplier no longer exists|existing supplier/);assert.deepEqual(snapshot(),before)
})
for(const[name,change]of Object.entries(changes))test(name+' commit rejection leaves the whole quote/preference/stock state unchanged',async()=>{
 await linked();const before=snapshot();f.commitError=Error('Fictional transaction rejected');await assert.rejects(change(),/transaction rejected/);assert.deepEqual(snapshot(),before)
})
