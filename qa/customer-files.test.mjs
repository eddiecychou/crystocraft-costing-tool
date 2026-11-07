import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {CUSTOMER_FILE_CHUNK_BYTES as CHUNK,emptyCustomerFileMetadata,savedCustomerFileContacts,validateCustomerFileMetadata,validateCustomerFileOriginal,customerFileAttachmentHeader} from '../src/customerFilesModel.js'
import {customerFilesFixture,checksum,smallPng,fictionalCompany} from './customer-files-fixtures.mjs'

async function upload(f,bytes=smallPng,metadata={},name,type){
  const {response,file}=await f.begin(bytes,metadata,name,type);assert.equal(response.status,200)
  for(let n=0;n<Math.ceil(bytes.length/CHUNK);n++)assert.equal((await f.request('chunk',{method:'POST',id:file.id,chunk:n,body:bytes.subarray(n*CHUNK,(n+1)*CHUNK)})).status,200)
  const r=await f.request('complete',{method:'POST',id:file.id});assert.equal(r.status,200);return(await r.json()).file
}
test('metadata accepts only explicit categories/contact links and preserves prior historical links',()=>{
  const customer=fictionalCompany(),before=structuredClone(customer),input={...emptyCustomerFileMetadata(),contact_ids:['person_cindy'],card_side:'front',card_set:'Cindy'}
  assert.deepEqual(validateCustomerFileMetadata(input,customer),input);assert.deepEqual(customer,before)
  for(const patch of [{category:'brand_asset'},{contact_ids:['foreign']},{contact_ids:['person_cindy','person_cindy']},{notes:'x'.repeat(8001)},{visibility:'public_reference'},{subscribe:true},{category:'other',card_side:'back'}])assert.throws(()=>validateCustomerFileMetadata({...input,...patch},customer))
  assert.deepEqual(validateCustomerFileMetadata({...input,contact_ids:['old_contact']},customer,{contact_ids:['old_contact']}).contact_ids,['old_contact'])
  assert.deepEqual(savedCustomerFileContacts({contact_name:'Legacy person'}),[])
  assert.deepEqual(savedCustomerFileContacts({contacts:[{id:'same',name:'A'},{id:'same',name:'B'}, {name:'No ID'},{id:'real',name:'C'}]}),[{id:'real',name:'C',title:''}])
})
test('original names retain Unicode/punctuation and headers encode them without path/header injection',()=>{
  const name='Cindy & Tony 中文 🎁 + front.png',original={filename:name,content_type:'image/png',byte_size:3,sha256:'a'.repeat(64)}
  validateCustomerFileOriginal(original)
  const header=customerFileAttachmentHeader(name);assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]),name);assert.match(header,/^[\x20-\x7e]+$/)
  for(const patch of [{filename:'../private.pdf'},{filename:'bad\r\nHeader.png'},{filename:'\ud800.png'},{content_type:'image/svg+xml'},{byte_size:0},{byte_size:20*1048576+1},{sha256:'../'}])assert.throws(()=>validateCustomerFileOriginal({...original,...patch}))
})
for(const token of [null,'bad','customer','pending','supply','marketing','none','unknown','mcp-range-upload-service'])test(`backend denies ${token??'anonymous'} before customer/file access`,async()=>{
  const f=customerFilesFixture()
  for(const op of ['list','content','begin','chunk','complete','thumbnail','details']){
    const response=await f.request(op,{token,method:op==='list'||op==='content'?'GET':op==='details'?'PATCH':'POST',body:op==='begin'?{}:undefined})
    assert.equal(response.status,[null,'bad','mcp-range-upload-service'].includes(token)?401:403,op)
  }
  assert.deepEqual(f.calls,[])
})
for(const token of ['admin','crm'])test(`${token} can save/reload exact originals and metadata without changing the company`,async()=>{
  const f=customerFilesFixture(),before=structuredClone(f.customers.get('qa_vip'))
  const file=await upload(f,smallPng,{title:'Card front',contact_ids:['person_cindy','person_tony'],notes:'Original internal notes',source:'Owner supplied',referrer:'Existing referrer',card_side:'front',card_set:'Cindy / Tony'})
  const list=await f.request('list',{token}),data=await list.json();assert.equal(list.status,200);assert.equal(data.files.length,1);assert.equal(data.files[0].filename,'Cindy & Tony 中文 🎁.png');assert.equal(data.files[0].uploaded_at,'2026-11-07T08:00:00.000Z');assert.deepEqual(data.files[0].contact_ids,['person_cindy','person_tony']);assert.equal(data.files[0].notes,'Original internal notes')
  const content=await f.request('content',{id:file.id,chunk:0,token});assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),smallPng);assert.equal(content.headers.get('cache-control'),'private, no-store');assert.match(content.headers.get('Content-Disposition'),/filename\*=/);assert.equal(content.headers.get('Content-Security-Policy'),"default-src 'none'; sandbox")
  assert.deepEqual(f.customers.get('qa_vip'),before);assert.doesNotMatch(JSON.stringify(data),/file_url|storage_customer_id|downloadTokens|visibility|can_use_in_marketing/)
})
test('interrupted multi-chunk upload resumes the same record and checksum before making it available',async()=>{
  const f=customerFilesFixture(),bytes=Buffer.alloc(CHUNK+257,42);bytes.write('%PDF-1.7\n')
  const first=await f.begin(bytes,{},'Reference.pdf','application/pdf');assert.equal(first.response.status,200)
  await f.request('chunk',{method:'POST',id:first.file.id,chunk:0,body:bytes.subarray(0,CHUNK)})
  assert.equal((await f.request('content',{id:first.file.id,chunk:0})).status,409)
  assert.equal((await f.request('complete',{method:'POST',id:first.file.id})).status,404)
  assert.equal((await f.begin(bytes,{},'Reference.pdf','application/pdf')).file.id,first.file.id)
  const file=await upload(f,bytes,{},'Reference.pdf','application/pdf');assert.equal(f.files.size,1)
  const parts=[];for(const n of [0,1]){const r=await f.request('content',{id:file.id,chunk:n});assert.equal(r.status,200);parts.push(Buffer.from(await r.arrayBuffer()))}
  assert.deepEqual(Buffer.concat(parts),bytes);assert.equal(checksum(Buffer.concat(parts)),file.sha256)
  assert.equal((await f.request('complete',{method:'POST',id:file.id})).status,200)
  assert.equal((await f.begin(bytes,{},'Changed filename.pdf','application/pdf')).file.filename,'Reference.pdf')
})
test('20 MiB originals round-trip as seven bounded authenticated chunks without byte changes',async()=>{
  const f=customerFilesFixture(),bytes=Buffer.alloc(20*1048576,37);bytes.write('%PDF-1.7\n')
  const file=await upload(f,bytes,{},'Maximum-size original.pdf','application/pdf'),chunks=[]
  for(let n=0;n<7;n++){
    const response=await f.request('content',{id:file.id,chunk:n});assert.equal(response.status,200)
    const chunk=Buffer.from(await response.arrayBuffer());assert.ok(chunk.length<=CHUNK);chunks.push(chunk)
  }
  assert.equal(checksum(Buffer.concat(chunks)),checksum(bytes));assert.equal(f.files.size,1)
})
test('mismatched type/size/checksum never publishes an original; retries cannot replace a different chunk',async()=>{
  const f=customerFilesFixture(),{file}=await f.begin()
  assert.equal((await f.request('chunk',{method:'POST',id:file.id,chunk:0,body:Buffer.alloc(smallPng.length)})).status,400)
  assert.equal((await f.request('chunk',{method:'POST',id:file.id,chunk:0,body:smallPng.subarray(0,10)})).status,400)
  await f.request('chunk',{method:'POST',id:file.id,chunk:0,body:smallPng})
  const other=Buffer.from(smallPng);other[20]^=1
  assert.equal((await f.request('chunk',{method:'POST',id:file.id,chunk:0,body:other})).status,409)
  f.blobs.get(`customer-files/qa_vip/${file.sha256}/parts/0`).bytes=other
  assert.equal((await f.request('complete',{method:'POST',id:file.id})).status,400)
  assert.equal(f.files.get('qa_vip/'+file.id).status,'uploading');assert.ok(!f.blobs.has(`customer-files/qa_vip/${file.sha256}/original`))
})
test('metadata edits are explicit and revision checked; original/contacts/notes/IDs remain intact',async()=>{
  const f=customerFilesFixture(),parent=structuredClone(f.customers.get('qa_vip')),file=await upload(f),base=`customer-files/qa_vip/${file.sha256}/original`,original=Buffer.from(f.blobs.get(base).bytes)
  const metadata={...emptyCustomerFileMetadata(),title:'Reviewed title',category:'customer_document',contact_ids:['person_tony'],notes:'File-only notes'}
  assert.equal((await f.request('details',{method:'PATCH',id:file.id,body:{revision:file.revision,metadata}})).status,200)
  assert.equal((await f.request('details',{method:'PATCH',id:file.id,body:{revision:file.revision,metadata:{...metadata,title:'Stale'}}})).status,409)
  assert.equal((await f.request('details',{method:'PATCH',id:file.id,body:{revision:file.revision+1,metadata:{...metadata,filename:'replace.png'}}})).status,400)
  assert.equal(f.files.get('qa_vip/'+file.id).title,'Reviewed title');assert.deepEqual(f.blobs.get(base).bytes,original);assert.deepEqual(f.customers.get('qa_vip'),parent)
})
test('revocation is checked on every content request and a foreign company cannot select another record',async()=>{
  const f=customerFilesFixture(),file=await upload(f)
  assert.equal((await f.request('content',{token:'crm',id:file.id,chunk:0})).status,200)
  f.profiles.crm.modules=[];const before=f.calls.length
  assert.equal((await f.request('content',{token:'crm',id:file.id,chunk:0})).status,403);assert.equal(f.calls.length,before)
  assert.equal((await f.request('content',{cid:'other',id:file.id,chunk:0})).status,404)
  assert.equal((await f.request('content',{cid:'../other',id:file.id,chunk:0})).status,400)
})
test('separate thumbnails do not alter originals; damaged thumbnails are refused',async()=>{
  const f=customerFilesFixture(),file=await upload(f),jpeg=Buffer.from([255,216,255,224,0,0,255,217]),base=`customer-files/qa_vip/${file.sha256}`
  assert.equal((await f.request('thumbnail',{method:'POST',id:file.id,body:jpeg})).status,200)
  const r=await f.request('content',{id:file.id,kind:'thumbnail'});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),jpeg)
  assert.deepEqual(f.blobs.get(base+'/original').bytes,smallPng)
  f.blobs.get(base+'/thumbnails/'+checksum(jpeg)+'.jpg').bytes=Buffer.from(jpeg).fill(0)
  assert.equal((await f.request('content',{id:file.id,kind:'thumbnail'})).status,502)
})
test('merge-frozen customer refuses writes; moved files retain original storage provenance',async()=>{
  const f=customerFilesFixture(),file=await upload(f)
  f.customers.get('qa_vip').customer_merge_lock='other'
  assert.equal((await f.begin()).response.status,409)
  const moved={...f.files.get('qa_vip/'+file.id),id:'merged_file',customer_id:'other',contact_ids:[]};f.files.set('other/merged_file',moved)
  const r=await f.request('content',{cid:'other',id:'merged_file',chunk:0});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),smallPng)
})
test('private files have no path to public galleries, OCR, contact mutation or outreach',async()=>{
  const client=await readFile(new URL('../src/customerFiles.js',import.meta.url),'utf8'),server=await readFile(new URL('../netlify/functions/lib/customerFiles.js',import.meta.url),'utf8'),objects=await readFile(new URL('../netlify/functions/lib/customerFileObjects.js',import.meta.url),'utf8')
  assert.doesNotMatch(client+server+objects,/getDownloadURL|firebaseStorageDownloadTokens|\.getSignedUrl\(|send-personal-email|send-campaign|\/api\/subscribe|marketing_contacts|addContact|saveCustomer\(/)
  assert.doesNotMatch(objects,/publicRead|makePublic/)
  for(const path of ['../src/customer/Storefront.jsx','../src/components/CustomerBrandGallery.jsx']){
    try{assert.doesNotMatch(await readFile(new URL(path,import.meta.url),'utf8'),/customerFiles|CustomerFiles/)}catch(e){if(e.code!=='ENOENT')throw e}
  }
})
