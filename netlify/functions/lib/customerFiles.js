import { createHash } from 'node:crypto'
import {
  CUSTOMER_FILE_CHUNK_BYTES as CHUNK, CUSTOMER_FILE_THUMB_MAX_BYTES as THUMB_MAX,
  CUSTOMER_FILE_META_KEYS, validCustomerFileId, validateCustomerFileOriginal,
  validateCustomerFileMetadata, savedCustomerFileContacts, customerFileMatchesType,
  customerFileStorageBase, customerFileAttachmentHeader,
} from '../../../src/customerFilesModel.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const headers = {'Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer',Vary:'Authorization','X-Content-Type-Options':'nosniff'}
export class CustomerFileError extends Error {
  constructor(message, status = 409) { super(message); this.status = status }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{...headers, 'Content-Type':'application/json'}})
const date = value => value?.toDate?.().toISOString() || null
export function customerFileView(record) {
  return Object.fromEntries(['id','filename','content_type','byte_size','sha256','status','revision',
    ...CUSTOMER_FILE_META_KEYS, 'thumbnail_sha256','thumbnail_size'].map(k => [k, record[k] ?? null])
    .concat([['uploaded_at',date(record.uploaded_at)],['created_at',date(record.created_at)]]))
}
function metadata(input, customer, previous) {
  try { return validateCustomerFileMetadata(input, customer, previous) }
  catch (e) { throw new CustomerFileError(e.message, 400) }
}
export function assertCustomerFilesWritable(customer) {
  if (!customer) throw new CustomerFileError('Customer not found.', 404)
  if (customer.customer_merge_lock) throw new CustomerFileError('This customer is being merged. Reopen it after the merge finishes.')
}

// No supplied URL/path/token is accepted. Every binary operation resolves a
// private record after a fresh identity/profile check, even for previews.
export function createCustomerFilesHandler({verifyToken, getProfile, repo, objects}) {
  return async req => {
    if (!['GET','POST','PATCH'].includes(req.method)) return json({error:'Method not allowed.'},405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return json({error:'Please sign in.'},401)
    let uid
    try { uid = (await verifyToken(token)).uid; if (!uid || uid === 'mcp-range-upload-service') throw Error() }
    catch { return json({error:'Please sign in.'},401) }
    try {
      const profile = await getProfile(uid)
      if (!(profile?.role === 'admin' || profile?.role === 'staff' && Array.isArray(profile.modules) && profile.modules.includes('customers'))) return json({error:'Access denied.'},403)
      const params = new URL(req.url).searchParams, cid = params.get('customer'), id = params.get('file'), op = params.get('op') || 'list'
      if (!validCustomerFileId(cid) || id !== null && !validCustomerFileId(id)) throw new CustomerFileError('Invalid customer or file.',400)
      const customer = await repo.getCustomer(cid)
      if (!customer) throw new CustomerFileError('Customer not found.',404)
      if (req.method !== 'GET') assertCustomerFilesWritable(customer)
      const readJson = async () => {
        const text = await req.text()
        if (Buffer.byteLength(text) > 65536) throw new CustomerFileError('File details are too large.',400)
        try { return JSON.parse(text) } catch { throw new CustomerFileError('Invalid file details.',400) }
      }
      if (req.method === 'GET' && op === 'list' && !id) {
        const cursor = params.get('cursor')
        if (cursor && !validCustomerFileId(cursor)) throw new CustomerFileError('Invalid page.',400)
        const result = await repo.list(cid, cursor)
        return json({files:result.files.map(customerFileView), next:result.next, contacts:savedCustomerFileContacts(customer)})
      }
      if (req.method === 'POST' && op === 'begin' && !id) {
        const input = await readJson()
        if (!input || Object.keys(input).some(k => !['filename','content_type','byte_size','sha256','metadata'].includes(k))) throw new CustomerFileError('Invalid upload.',400)
        try { validateCustomerFileOriginal(input) } catch (e) { throw new CustomerFileError(e.message,400) }
        metadata(input.metadata, customer)
        const record = await repo.begin(cid,input,uid)
        return json({file:customerFileView(record)})
      }
      if (!id) throw new CustomerFileError('Choose a file.',400)
      const record = await repo.get(cid,id)
      if (!record) throw new CustomerFileError('File not found.',404)
      const base = customerFileStorageBase(record)
      if (req.method === 'PATCH' && op === 'details') {
        const input = await readJson()
        if (!input || Object.keys(input).some(k => !['revision','metadata'].includes(k)) || !Number.isInteger(input.revision)) throw new CustomerFileError('Invalid file details.',400)
        metadata(input.metadata, customer, record)
        return json({file:customerFileView(await repo.update(cid,id,input,uid))})
      }
      const index = Number(params.get('chunk')), count = Math.ceil(record.byte_size / CHUNK)
      const validChunk = params.has('chunk') && /^\d+$/.test(params.get('chunk')) && Number.isInteger(index) && index >= 0 && index < count
      if (req.method === 'POST' && op === 'chunk') {
        if (record.status === 'ready') return json({complete:true})
        if (record.status !== 'uploading' || !validChunk) throw new CustomerFileError('Invalid upload chunk.',400)
        const bytes = Buffer.from(await req.arrayBuffer()), expected = Math.min(CHUNK, record.byte_size - index * CHUNK)
        if (bytes.length !== expected) throw new CustomerFileError('Upload chunk has the wrong size.',400)
        if (index === 0 && !customerFileMatchesType(bytes,record.content_type)) throw new CustomerFileError('The original bytes do not match the selected file type.',400)
        await objects.put(`${base}/parts/${index}`,bytes,'application/octet-stream')
        return json({chunk:index})
      }
      if (req.method === 'POST' && op === 'complete') {
        if (record.status === 'ready') return json({file:customerFileView(record)})
        if (record.status !== 'uploading') throw new CustomerFileError('This upload cannot be completed.')
        const parts = await Promise.all(Array.from({length:count},async (_, i) => {
          const bytes = await objects.read(`${base}/parts/${i}`)
          if (bytes.length !== Math.min(CHUNK, record.byte_size - i * CHUNK)) throw new CustomerFileError('An upload chunk is missing or incomplete.')
          return bytes
        }))
        const bytes = Buffer.concat(parts)
        if (bytes.length !== record.byte_size || hash(bytes) !== record.sha256 || !customerFileMatchesType(bytes,record.content_type)) throw new CustomerFileError('The original checksum did not match. Reselect the original file to retry.',400)
        await objects.put(`${base}/original`,bytes,record.content_type)
        const saved = await repo.complete(cid,id,uid)
        // Ready originals do not depend on temporary chunks. Cleanup failures
        // leave private staging data, never a falsely failed/duplicated upload.
        await objects.removePrefix(`${base}/parts/`).catch(() => {})
        return json({file:customerFileView(saved)})
      }
      if (req.method === 'POST' && op === 'thumbnail') {
        if (record.status !== 'ready') throw new CustomerFileError('Finish the original upload first.')
        const bytes = Buffer.from(await req.arrayBuffer())
        if (!bytes.length || bytes.length > THUMB_MAX || !customerFileMatchesType(bytes,'image/jpeg')) throw new CustomerFileError('Invalid viewing thumbnail.',400)
        const checksum = hash(bytes)
        await objects.put(`${base}/thumbnails/${checksum}.jpg`,bytes,'image/jpeg')
        await repo.thumbnail(cid,id,{sha256:checksum,byte_size:bytes.length})
        return json({thumbnail_sha256:checksum})
      }
      if (req.method === 'GET' && op === 'content') {
        if (record.status !== 'ready') throw new CustomerFileError('The original upload is not complete.')
        const thumbnail = params.get('kind') === 'thumbnail'
        if (params.has('kind') && !['original','thumbnail'].includes(params.get('kind'))) throw new CustomerFileError('Invalid file selection.',400)
        if (!thumbnail && !validChunk) throw new CustomerFileError('Choose a valid file chunk.',400)
        if (thumbnail && !/^[a-f0-9]{64}$/.test(record.thumbnail_sha256 || '')) throw new CustomerFileError('Thumbnail not available.',404)
        const path = thumbnail ? `${base}/thumbnails/${record.thumbnail_sha256}.jpg` : `${base}/original`
        const bytes = await objects.read(path, thumbnail ? {} : {start:index * CHUNK,end:Math.min(record.byte_size,(index+1)*CHUNK)-1})
        const expected = thumbnail ? record.thumbnail_size : Math.min(CHUNK,record.byte_size-index*CHUNK)
        if (!bytes.length || bytes.length !== expected || thumbnail && (bytes.length > THUMB_MAX || hash(bytes) !== record.thumbnail_sha256)) throw new CustomerFileError('Stored file integrity check failed.',502)
        return new Response(bytes,{headers:{...headers,'Content-Type':thumbnail?'image/jpeg':record.content_type,
          'Content-Length':String(bytes.length),'Content-Disposition':customerFileAttachmentHeader(record.filename),
          'Content-Security-Policy':"default-src 'none'; sandbox"}})
      }
      throw new CustomerFileError('Invalid file operation.',400)
    } catch (e) {
      return json({error:e instanceof CustomerFileError ? e.message : 'Customer files are temporarily unavailable. Please retry.'},e instanceof CustomerFileError ? e.status : e?.code === 404 ? 404 : 502)
    }
  }
}

// Admin SDK mutations are narrow transactions. No customer/contact document is
// written; fresh parent checks also freeze uploads/edits during customer merges.
export function createCustomerFilesRepository(db, stamp, documentId) {
  const parent = cid => db.doc(`customers/${cid}`), files = cid => parent(cid).collection('files')
  const value = snap => snap.exists ? {...snap.data(),id:snap.id} : null
  const writable = async (tx,cid) => { const snap = await tx.get(parent(cid)); assertCustomerFilesWritable(snap.data()); return snap.data() }
  return {
    getCustomer: async cid => (await parent(cid).get()).data(),
    get: async (cid,id) => value(await files(cid).doc(id).get()),
    list: async (cid,cursor) => {
      let q = files(cid).orderBy('created_at','desc').orderBy(documentId(),'desc')
      if (cursor) {const snap = await files(cid).doc(cursor).get();if(!snap.exists)throw new CustomerFileError('File list changed. Reload the section.');q=q.startAfter(snap)}
      const docs = (await q.limit(51).get()).docs
      return {files:docs.slice(0,50).map(value),next:docs.length>50?docs[49].id:null}
    },
    begin: (cid,input,uid) => db.runTransaction(async tx => {
      const customer = await writable(tx,cid)
      const existing = await tx.get(files(cid).where('sha256','==',input.sha256).limit(1))
      if (!existing.empty) return value(existing.docs[0])
      const details = metadata(input.metadata,customer)
      const ref = files(cid).doc(input.sha256), record = {
        schema_version:1, customer_id:cid, storage_customer_id:cid, filename:input.filename,
        content_type:input.content_type, byte_size:input.byte_size, sha256:input.sha256,
        ...details, status:'uploading',revision:1,created_at:stamp(),created_by:uid,
        uploaded_at:null,updated_at:stamp(),updated_by:uid,
      }
      tx.create(ref,record)
      return {...record,id:ref.id}
    }),
    update: (cid,id,input,uid) => db.runTransaction(async tx => {
      const customer = await writable(tx,cid), ref = files(cid).doc(id), snap = await tx.get(ref)
      if (!snap.exists) throw new CustomerFileError('File not found.',404)
      const current = snap.data()
      if (input.revision !== current.revision) throw new CustomerFileError('File details changed in another window. Reload before saving.')
      const patch = {...metadata(input.metadata,customer,current),revision:current.revision+1,updated_at:stamp(),updated_by:uid}
      tx.update(ref,patch);return {...current,...patch,id}
    }),
    complete: (cid,id,uid) => db.runTransaction(async tx => {
      await writable(tx,cid);const ref = files(cid).doc(id),snap = await tx.get(ref)
      if (!snap.exists) throw new CustomerFileError('File not found.',404)
      const current = snap.data()
      if (current.status === 'ready') return {...current,id}
      if (current.status !== 'uploading') throw new CustomerFileError('Upload state changed. Reload before retrying.')
      const patch = {status:'ready',uploaded_at:stamp(),revision:current.revision+1,updated_at:stamp(),updated_by:uid}
      tx.update(ref,patch);return {...current,...patch,id}
    }),
    thumbnail: (cid,id,thumb) => db.runTransaction(async tx => {
      await writable(tx,cid);const ref = files(cid).doc(id),snap = await tx.get(ref)
      if (snap.data()?.status !== 'ready') throw new CustomerFileError('File no longer available.')
      tx.update(ref,{thumbnail_sha256:thumb.sha256,thumbnail_size:thumb.byte_size})
    }),
  }
}
