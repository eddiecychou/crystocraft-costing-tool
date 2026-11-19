// Auth comes from a short-lived Google OAuth access token on stdin. Never log
// object names, customer data, token URLs or the credential.
import {createHash} from 'node:crypto'
import {galleryUrl} from '../src/brandGalleryUrls.js'

const project = 'crystocraft-costing', bucket = process.env.VITE_FIREBASE_STORAGE_BUCKET
if (![project+'.appspot.com',project+'.firebasestorage.app'].includes(bucket)) throw Error('Expected the OC bucket')
let oauth = ''
for await (const value of process.stdin) oauth += value.toString()
oauth = oauth.trim()
if (!oauth) throw Error('Supply the operator OAuth access token on stdin')
async function google(url, options={}) {
  const response = await fetch(url, {...options, headers: {Authorization:'Bearer '+oauth, 'Content-Type':'application/json'}})
  if (!response.ok) throw Error('Google request failed with HTTP '+response.status+'; rerun the inventory before continuing.')
  return response.json()
}
const base = 'https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents'
const storage = 'https://storage.googleapis.com/storage/v1/b/'+bucket+'/o'
async function inventory() {
  const rows = await google(base+':runQuery', {method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'assets',allDescendants:true}]}})})
  const entries = new Map()
  for (const {document:d} of rows) {
    const ids = d?.name.match(/\/documents\/customers\/([^/]+)\/assets\/([^/]+)$/)
    if (!ids) continue
    const path = d.fields.storage_path?.stringValue, filename = d.fields.filename?.stringValue
    if (!path || !filename || entries.has(path) || path.split('/').length!==4 ||
        !(path.startsWith('customer-assets/'+ids[1]+'/'+ids[2]+'/') || d.fields.gallery_original_path?.stringValue===path)) throw Error('Review unexpected gallery descriptor')
    const current = d.fields.file_url?.stringValue, stable = galleryUrl(ids[1],ids[2],filename)
    if (current && current!==stable) {
      const url=new URL(current), prefix='/v0/b/'+bucket+'/o/'
      if(url.origin!=='https://firebasestorage.googleapis.com' || !url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname.slice(prefix.length))!==path) throw Error('Review mismatched gallery link')
    }
    entries.set(path,{d,stable,current})
  }
  let page
  do {
    const q=new URLSearchParams({prefix:'customer-assets/',fields:'nextPageToken,items(name,generation,metageneration,size,crc32c,md5Hash,cacheControl,metadata)'})
    if(page)q.set('pageToken',page)
    const list=await google(storage+'?'+q)
    for(const object of list.items||[]) {
      const entry=entries.get(object.name)
      if(!entry || entry.object || !object.crc32c) throw Error('Review unpaired gallery object')
      entry.object=object
    }
    page=list.nextPageToken
  } while(page)
  if([...entries.values()].some(e=>!e.object)) throw Error('Review missing gallery original')
  return [...entries].sort(([a],[b])=>a.localeCompare(b)).map(([,entry])=>entry)
}
function report(entries) {
  const identity = entries.map(({object:o,d})=>[d.name,o.name,o.generation,o.size,o.crc32c,o.md5Hash])
  return {files:entries.length,originalFingerprint:createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    tokenized:entries.filter(e=>e.object.metadata?.firebaseStorageDownloadTokens).length,
    legacyDescriptors:entries.filter(e=>e.current!==e.stable).length,
    cacheUpdates:entries.filter(e=>e.object.cacheControl!=='private, no-store').length}
}
const entries=await inventory(), before=report(entries)
console.log(JSON.stringify(before))
const apply=process.argv[2]
if(apply) {
  if(apply!=='--apply='+before.originalFingerprint)throw Error('Supply the reviewed inventory fingerprint')
  for(const {d,stable,current,object:o} of entries) {
    if(current!==stable) {
      const q=new URLSearchParams({'updateMask.fieldPaths':'file_url','currentDocument.updateTime':d.updateTime})
      await google('https://firestore.googleapis.com/v1/'+d.name+'?'+q,{method:'PATCH',body:JSON.stringify({fields:{file_url:{stringValue:stable}}})})
    }
    if(o.metadata?.firebaseStorageDownloadTokens || o.cacheControl!=='private, no-store') {
      const q=new URLSearchParams({ifGenerationMatch:o.generation,ifMetagenerationMatch:o.metageneration})
      await google(storage+'/'+encodeURIComponent(o.name)+'?'+q,{method:'PATCH',body:JSON.stringify({cacheControl:'private, no-store',metadata:{...o.metadata,firebaseStorageDownloadTokens:null}})})
    }
  }
  const after=report(await inventory())
  console.log(JSON.stringify(after))
  if(after.originalFingerprint!==before.originalFingerprint || after.tokenized || after.legacyDescriptors || after.cacheUpdates)throw Error('Gallery migration readback failed')
}
