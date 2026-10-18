// Independent readback: source original MD5s against GCS metadata and all
// published records/paths against the reviewed manifest. No data mutation.
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {firebaseReadonly,decodeFirestore} from './lib/swatch-read-only.mjs'
const read=firebaseReadonly(),dir='migration/crystal-swatches-v819.local'
const review=JSON.parse(readFileSync(dir+'/review.json','utf8')),project='projects/crystocraft-costing'
const docs=read(`https://firestore.googleapis.com/v1/${project}/databases/(default)/documents/crystal_swatches?pageSize=1000`)
assert.ok(!docs.nextPageToken)
const samples=new Map((docs.documents||[]).map(d=>[d.name.split('/').at(-1),Object.fromEntries(Object.entries(d.fields).map(([k,v])=>[k,decodeFirestore(v)]))]))
const raw=read(`https://firestore.googleapis.com/v1/${project}/databases/(default)/documents/crystal_migration_runs/${review.manifest_hash}`)
const run=Object.fromEntries(Object.entries(raw.fields).map(([k,v])=>[k,decodeFirestore(v)]))
assert.equal(run.state,'verified');assert.equal(run.verified_count,review.registered_photos)
const objects=read('https://storage.googleapis.com/storage/v1/b/crystocraft-costing.firebasestorage.app/o?prefix=crystal-swatches%2F&maxResults=1000&fields=items(name,size,md5Hash,cacheControl,contentType,generation),nextPageToken')
assert.ok(!objects.nextPageToken)
const media=new Map((objects.items||[]).map(o=>[o.name,o])),referenced=new Set()
for(const source of review.mappings){
 const sample=samples.get(source.id);assert.ok(sample,source.id);assert.equal(sample.publication,'published');assert.equal(sample.revision,2)
 assert.equal(sample.color_name,source.colour);assert.equal(sample.style,source.style);assert.equal(sample.backing_label,source.backing);assert.equal(sample.media.sha256,source.sha256)
 const original=media.get(sample.media.original);assert.ok(original);assert.equal(original.md5Hash,createHash('md5').update(readFileSync(dir+'/data/colors/'+source.file)).digest('base64'))
 for(const path of [sample.media.original,sample.media.display,sample.media.thumbnail]){
  assert.ok(path.startsWith('crystal-swatches/'+source.id+'/'));const object=media.get(path);assert.ok(object,path);assert.ok(Number(object.size)>0);assert.equal(object.contentType,'image/jpeg');assert.equal(object.cacheControl,'private, no-cache');referenced.add(path)
 }
}
const result={checked_at:new Date().toISOString(),manifest_hash:review.manifest_hash,run_state:run.state,source_photos:review.registered_photos,published_records:[...samples.values()].filter(s=>s.publication==='published').length,sample_records:samples.size,verified_original_md5:review.registered_photos,referenced_media:referenced.size,stored_media:media.size,unreferenced_media:[...media.keys()].filter(p=>!referenced.has(p)),result:'PASS'}
const releases=read(`https://firebaserules.googleapis.com/v1/${project}/releases`).releases
result.rule_releases={}
for(const type of ['firestore','storage']){
 const release=releases.find(r=>r.name.includes('/releases/'+(type==='firestore'?'cloud.firestore':'firebase.storage/')))
 assert.ok(release)
 const rules=read('https://firebaserules.googleapis.com/v1/'+release.rulesetName).source.files.map(f=>f.content).join('\n')
 assert.equal(rules.trim(),readFileSync(type+'.rules','utf8').trim(),'Deployed '+type+' rules must match tested source.')
 result.rule_releases[type]={ruleset:release.rulesetName,sha256:createHash('sha256').update(rules).digest('hex'),matches_tested_source:true}
}
const probePath=samples.get(review.mappings[0].id).media.thumbnail
const anonymousUrls=[`https://storage.googleapis.com/crystocraft-costing.firebasestorage.app/${probePath}`,`https://firebasestorage.googleapis.com/v0/b/crystocraft-costing.firebasestorage.app/o/${encodeURIComponent(probePath)}?alt=media`]
result.anonymous_image_status=anonymousUrls.map(url=>Number(execFileSync('curl',['-sS','--max-time','20','-o','/dev/null','-w','%{http_code}',url],{encoding:'utf8'})))
assert.ok(result.anonymous_image_status.every(status=>status===401||status===403),'Anonymous direct image access must be denied.')
writeFileSync(dir+'/firebase-readback.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result))
