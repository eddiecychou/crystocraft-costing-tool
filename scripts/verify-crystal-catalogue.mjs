// Read-only business setup evidence; no Firestore/Storage mutation.
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {firebaseReadonly,decodeFirestore} from './lib/swatch-read-only.mjs'
const get=firebaseReadonly(),dir='migration/crystal-catalogue-v819.local'
const expected=JSON.parse(readFileSync(dir+'/own-products-reviewed.json','utf8'))
const root='https://firestore.googleapis.com/v1/projects/crystocraft-costing/databases/(default)/documents'
const list=path=>{
 let token='',rows=[]
 do{const res=get(root+'/'+path+'?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):''));rows.push(...(res.documents||[]));token=res.nextPageToken;assert.ok(rows.length<=5000,'Unexpected catalogue size.')}while(token)
 return rows.map(d=>({...decodeFirestore({mapValue:{fields:d.fields}}),id:d.name.split('/').pop()}))
}
const products=list('crystal_products'),published=products.filter(p=>p.publication==='published'),result={checked_at:new Date().toISOString(),published:[],other_records:[],stocks_unchanged:null}
assert.equal(published.length,3)
for(const row of expected){
 const p=published.find(p=>p.code===row.code);assert.ok(p);assert.equal(p.origin,'crystocraft');assert.equal(p.supply,'made_to_order');assert.equal(p.name,row.name)
 const variants=list('crystal_products/'+p.id+'/variants'),images=list('crystal_products/'+p.id+'/images')
 assert.equal(variants.length,1)
 const v=variants.find(v=>v.id===p.primary_variant_id),i=images.find(i=>i.id===p.hero_id)
 assert.ok(v?.confirmed);assert.equal(v.publication,'published');assert.equal(v.size,row.size);assert.equal(v.colour,'Clear');assert.equal(v.holes,row.holes);assert.equal(v.unit,'pcs')
 assert.equal(i.publication,'published');assert.equal(i.media.sha256,row.sha256)
 const object=get('https://storage.googleapis.com/storage/v1/b/crystocraft-costing.firebasestorage.app/o/'+encodeURIComponent(i.media.original)+'?fields=name,size,md5Hash,contentType,cacheControl')
 assert.equal(object.md5Hash,createHash('md5').update(readFileSync(row.file)).digest('base64'))
 for(const path of [i.media.display,i.media.thumbnail]){const object=get('https://storage.googleapis.com/storage/v1/b/crystocraft-costing.firebasestorage.app/o/'+encodeURIComponent(path)+'?fields=name,size,contentType');assert.ok(Number(object.size)>0);assert.equal(object.contentType,'image/jpeg')}
 assert.equal(list('crystal_product_private/'+p.id+'/variants').length,0,'No guessed inventory links.')
 result.published.push({id:p.id,code:p.code,variant_id:v.id,original_checksum:'PASS',three_media_objects:'PASS',inventory_link:'unconfirmed; not guessed'})
}
result.other_records=products.filter(p=>p.publication!=='published').map(p=>({id:p.id,code:p.code,publication:p.publication}))
assert.equal(products.filter(p=>p.origin==='swarovski_strass').length,0,'Clearance remains for owner review.')
const before=JSON.parse(readFileSync(dir+'/before-crystals.json','utf8')).map(d=>({id:d.name.split('/').pop(),...decodeFirestore({mapValue:{fields:d.fields}})})),after=list('crystals')
const balances=rows=>JSON.stringify(rows.map(p=>({id:p.id,code:p.code,stock:p.stock_qty,reserved:p.reserved_qty??0,sequence:p.movement_seq??0})).sort((a,b)=>a.id.localeCompare(b.id)))
assert.equal(balances(after),balances(before),'Stock changed during release; review independently without overwriting.')
result.stocks_unchanged={masters:after.length,balances_reservations_sequences:'PASS'}
const first=published[0],image=list('crystal_products/'+first.id+'/images').find(i=>i.id===first.hero_id)
const status=Number(execFileSync('curl',['-sS','--max-time','20','-o','/dev/null','-w','%{http_code}','https://firebasestorage.googleapis.com/v0/b/crystocraft-costing.firebasestorage.app/o/'+encodeURIComponent(image.media.thumbnail)+'?alt=media'],{encoding:'utf8'}))
assert.ok([401,403].includes(status));result.anonymous_photo_status=status
writeFileSync(dir+'/catalogue-readback.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result))
