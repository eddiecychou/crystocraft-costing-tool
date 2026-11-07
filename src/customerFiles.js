import {authHeader} from './firebase'
import {
  CUSTOMER_FILE_CHUNK_BYTES as CHUNK, CUSTOMER_FILE_META_KEYS, customerFileType, validateCustomerFileOriginal,
} from './customerFilesModel.js'

const endpoint = (customer, op, extra = {}) => '/api/customer-files?' + new URLSearchParams({customer,op,...extra})
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')
async function request(customer,op,{method='GET',body,extra={},signal,json=true} = {}) {
  const response = await fetch(endpoint(customer,op,extra),{
    method,headers:{...await authHeader(),...(body!==undefined?{'Content-Type':typeof body==='string'?'application/json':'application/octet-stream'}:{})},
    body,signal:AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]),cache:'no-store',
  })
  if (!response.ok) {
    const message = await response.json().catch(()=>({}))
    throw Error(message.error || `Customer file request failed (${response.status}). Please retry.`)
  }
  return json ? response.json() : response
}
export const listCustomerFiles = (customer, cursor, signal) => request(customer,'list',{extra:cursor?{cursor}:{},signal})
export const updateCustomerFile = (customer,file,metadata,signal) => request(customer,'details',{
  method:'PATCH',extra:{file:file.id},body:JSON.stringify({revision:file.revision,metadata}),signal,
})
export async function readCustomerFile(customer,file,{thumbnail=false,signal} = {}) {
  const chunks = [], count = thumbnail ? 1 : Math.ceil(file.byte_size / CHUNK)
  for (let i=0;i<count;i++) {
    const response = await request(customer,'content',{extra:{file:file.id,kind:thumbnail?'thumbnail':'original',chunk:String(i)},signal,json:false})
    chunks.push(await response.arrayBuffer())
  }
  const blob = new Blob(chunks,{type:thumbnail?'image/jpeg':file.content_type})
  if (blob.size !== (thumbnail?file.thumbnail_size:file.byte_size) || await sha256(await blob.arrayBuffer()) !== (thumbnail?file.thumbnail_sha256:file.sha256)) throw Error('The downloaded file did not match its saved original. Please retry.')
  return blob
}
export async function saveCustomerFileThumbnail(customer,file,original,signal) {
  const {customerFileThumbnail} = await import('./customerFilePreview.js')
  const thumbnail = await customerFileThumbnail(original)
  signal?.throwIfAborted()
  return request(customer,'thumbnail',{method:'POST',extra:{file:file.id},body:thumbnail,signal})
}
export async function uploadCustomerFile(customer,file,metadata,{onProgress=()=>{},signal} = {}) {
  const bytes = await file.arrayBuffer(), checksum = await sha256(bytes)
  const input = {filename:file.name,content_type:customerFileType(file),byte_size:file.size,sha256:checksum,metadata}
  validateCustomerFileOriginal(input)
  signal?.throwIfAborted()
  let {file:saved} = await request(customer,'begin',{method:'POST',body:JSON.stringify(input),signal})
  const alreadyStored = saved.status === 'ready'
  const detailsPreserved = CUSTOMER_FILE_META_KEYS.some(key=>JSON.stringify(saved[key])!==JSON.stringify(metadata[key]))
  if (!alreadyStored) {
    for (let i=0;i<Math.ceil(file.size/CHUNK);i++) {
      await request(customer,'chunk',{method:'POST',extra:{file:saved.id,chunk:String(i)},body:bytes.slice(i*CHUNK,(i+1)*CHUNK),signal})
      onProgress(Math.round(Math.min(file.size,(i+1)*CHUNK)/file.size*90))
    }
    ;({file:saved} = await request(customer,'complete',{method:'POST',extra:{file:saved.id},signal}))
  }
  let thumbnailWarning = ''
  if (!saved.thumbnail_sha256) {
    try { await saveCustomerFileThumbnail(customer,saved,new Blob([bytes],{type:input.content_type}),signal) }
    catch (e) { if (signal?.aborted) throw e; console.warn('Customer file thumbnail unavailable:',e);thumbnailWarning = 'Original saved. A thumbnail could not be made; preview or download the original.' }
  }
  onProgress(100)
  return {file:saved,alreadyStored,detailsPreserved,thumbnailWarning}
}
export async function downloadCustomerFile(customer,file,signal) {
  const blob = await readCustomerFile(customer,file,{signal})
  signal?.throwIfAborted()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href=url;anchor.download=file.filename;document.body.appendChild(anchor)
  try { anchor.click() } finally { anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000) }
}
