import {test} from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {sha256,legacySampleId,validatePhoto,swatchPaths,cleanSwatch,swatchesToRegistry,prepareSwatchImport,assertSampleRevision} from '../src/domain/crystalSwatches.js'
import {createSwatchImageHandler} from '../netlify/edge-functions/lib/swatchImage.js'
const jpeg=new Uint8Array([255,216,255,1,2,3]), hash=await sha256(jpeg)
const values={color_name:'Crystal AB',notes_key:'Crystal AB',style:'fabric',backing_label:'01',publication:'published',sort_order:0,rgb:[.5,.6,.7]}
async function archive(change=()=>{}){
 const zip=new JSZip(), registry=Buffer.from(JSON.stringify({crystal:{'Crystal AB':{rgb:values.rgb,fabric:{'01':{file:'a.jpg',pitch:20}}}}}))
 const inventory={'colors/registry.json':{bytes:registry.length,sha256:await sha256(registry)},'colors/a.jpg':{bytes:jpeg.length,sha256:hash},'colors/extra.jpg':{bytes:jpeg.length,sha256:hash}}
 zip.file('data/colors/registry.json',registry);zip.file('data/colors/a.jpg',jpeg);zip.file('data/colors/extra.jpg',jpeg)
 zip.file('migration-manifest.json',JSON.stringify({schema_version:1,registry_sha256:inventory['colors/registry.json'].sha256,source_inventory:inventory}));change(zip)
 return zip
}
test('exact legacy tuple is stable and cannot collide through slug normalization',async()=>{
 assert.equal(await legacySampleId('A B','fabric','01'),await legacySampleId('A B','fabric','01'))
 assert.notEqual(await legacySampleId('A B','fabric','01'),await legacySampleId('A-B','fabric','01'))
 assert.notEqual(await legacySampleId('A','fabric','01'),await legacySampleId('A','fabric','1'))
})
test('actual source registry imports only registered photos and preserves original labels/calibration privately',async()=>{
 const p=await prepareSwatchImport(await archive());assert.equal(p.samples.length,1);assert.equal(p.colourCount,1)
 assert.equal(p.samples[0].backing_label,'01');assert.equal(p.samples[0].legacy_slot.pitch,20);assert.deepEqual(p.extraFiles,['colors/extra.jpg'])
 const safe=cleanSwatch(p.samples[0]);assert.equal(safe.pitch,undefined);assert.equal(safe.bytes,undefined)
 assert.equal(p.manifestHash,(await prepareSwatchImport(await archive())).manifestHash)
})
test('all backup files are checked, including private extras',async()=>{
 const zip=await archive(z=>z.file('data/colors/extra.jpg','changed'))
 await assert.rejects(()=>prepareSwatchImport(zip),/verification failed/)
})
test('missing files, registry drift and unsafe paths stop import',async()=>{
 const missing=await archive(z=>z.remove('data/colors/a.jpg'))
 await assert.rejects(()=>prepareSwatchImport(missing),/Missing backup file/)
 const bad=await archive(z=>z.file('data/colors/registry.json','{}'));await assert.rejects(()=>prepareSwatchImport(bad),/Registry checksum/)
})
test('JPEG signature, format and file size are validated',()=>{
 validatePhoto(jpeg,'image/jpeg');assert.throws(()=>validatePhoto(jpeg,'image/png'));assert.throws(()=>validatePhoto(new Uint8Array(21*1024*1024),'image/jpeg'))
})
test('only customer-safe fields survive normalization; invalid input fails',()=>{
 const clean=cleanSwatch({...values,cost:999,pitch:20,description:' Real sample '});assert.equal(clean.cost,undefined);assert.equal(clean.description,'Real sample')
 for(const patch of [{rgb:[2,0,0]},{sort_order:-1},{style:'invented'},{publication:'public'},{backing_label:'../other'}])assert.throws(()=>cleanSwatch({...values,...patch}))
})
test('colour browsing never drops duplicate backing labels or renames sample identities',()=>{
 const a={...cleanSwatch(values),id:'sw_'+hash,revision:2,media:swatchPaths('sw_'+hash,hash,'image/jpeg')}
 const reg=swatchesToRegistry([a,{...a,id:'sw_other_sample_123456',notes_key:'Crystal AB'}]);assert.equal(Object.keys(reg).length,1);assert.equal(Object.keys(reg['Crystal AB'].slots.fabric).length,2)
 assert.equal(reg['Crystal AB'].notes_key,'Crystal AB');assert.equal(reg['Crystal AB'].slots.fabric['01'].sample_id,a.id)
})
test('stale edits fail rather than overwrite another operator',()=>{assertSampleRevision({revision:2},2);assert.throws(()=>assertSampleRevision({revision:3},2),/another window/)})
test('uploaded labels cannot become inherited object keys or pollute other colour groups',()=>{
 const sample={...cleanSwatch({...values,color_name:'__proto__',backing_label:'constructor'}),id:'sw_'+hash,revision:2,media:swatchPaths('sw_'+hash,hash,'image/jpeg')}
 const reg=swatchesToRegistry([sample]);assert.equal(Object.keys(reg).length,1);assert.equal(reg.__proto__.slots.fabric.constructor.sample_id,sample.id);assert.equal(Object.prototype.slots,undefined)
})
const path=swatchPaths('sw_'+hash,hash,'image/jpeg').display
const request=(p=path,token='test.token.value')=>new Request('https://example.com/api/swatch-library?action=image&file='+encodeURIComponent(p),{headers:token?{Authorization:'Bearer '+token}:{}})
test('image proxy forwards caller token to fixed Firebase endpoint and prevents cache persistence',async()=>{
 let called
 const h=createSwatchImageHandler({bucket:'example.firebasestorage.app',fetcher:async(...args)=>{called=args;return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}})}})
 const res=await h(request());assert.equal(res.status,200);assert.equal(called[1].headers.Authorization,'Firebase test.token.value')
 assert.match(called[0],/^https:\/\/firebasestorage.googleapis.com\/v0\/b\/example.firebasestorage.app\/o\//);assert.equal(called[1].redirect,'error');assert.match(res.headers.get('Cache-Control'),/no-store/)
})
test('proxy refuses signed-out requests, traversal, external URLs and old Fly filenames without fetching',async()=>{
 const h=createSwatchImageHandler({bucket:'example.app',fetcher:()=>assert.fail('must not fetch')})
 assert.equal((await h(request(path,''))).status,401)
 for(const bad of ['../secret','https://elsewhere/image.jpg','old.jpg',path.replace('display.jpg','secret.txt')])assert.equal((await h(request(bad))).status,400)
})
test('Storage denial and unexpected image formats do not become successful images',async()=>{
 for(const code of [401,403,404,500]){
  const h=createSwatchImageHandler({bucket:'example.app',fetcher:async()=>new Response('secret upstream detail',{status:code})})
  const res=await h(request());assert.equal(res.status,code===500?502:code);assert.doesNotMatch(await res.text(),/secret upstream/)
 }
 const h=createSwatchImageHandler({bucket:'example.app',fetcher:async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})});assert.equal((await h(request())).status,502)
})
