import { createHash, randomUUID } from 'node:crypto'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { customerMergeFields, customerMergeContactMap } from '../../../src/customerMergeFields.js'
export const MERGE_COLLECTIONS = ['work_items','pipeline_history','enquiries','email_threads','whatsapp_threads','alibaba_threads','assets']
const hash = s => createHash('sha256').update(s).digest('hex')
export class MergeError extends Error { constructor(message, status=409) { super(message); this.status=status } }
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value
const fingerprint = value => hash(JSON.stringify(canonical(value)))
const stamp = () => FieldValue.serverTimestamp()
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)

// Restartable server-only transfer. Source history is retained in server-only audit snapshots;
// client rules freeze both workspaces until the complete transfer is verified.
export async function mergeCustomerRecords(db, sourceId, targetId, uid, { budgetMs=18000, now=Date.now, afterCopy } = {}) {
  if (!safeId(sourceId) || !safeId(targetId) || sourceId === targetId) throw new MergeError('Choose two different customer records.',400)
  const started=now(), token=randomUUID(), source=db.doc(`customers/${sourceId}`), target=db.doc(`customers/${targetId}`)
  const job=db.doc(`customer_merges/${sourceId}`)
  const isOwned = data => data?.lease_token === token
  const acquired=await db.runTransaction(async tx => {
    const [s,t,j]=await tx.getAll(source,target,job)
    if (j.exists && j.data().target_id !== targetId) throw new MergeError('This customer is already being merged into another record. Reopen that merge.')
    if (j.data()?.state === 'complete') {if(!t.exists)throw new MergeError('The surviving customer has since moved. Refresh the customer list.',404);return false}
    if (!s.exists || !t.exists) throw new MergeError('One of these customers no longer exists. Refresh the customer list.',404)
    if (j.data()?.lease_until?.toMillis() > now()) throw new MergeError('This merge is still running. Wait a moment and retry.')
    for (const snap of [s,t]) if (snap.data().customer_merge_lock && snap.data().customer_merge_lock !== sourceId) throw new MergeError('A customer is already involved in another merge. Finish that merge first.')
    if (!j.exists) {
      tx.create(job.collection('snapshots').doc('source'),s.data())
      tx.create(job.collection('snapshots').doc('survivor'),t.data())
    }
    tx.set(job,{source_id:sourceId,target_id:targetId,state:'copying',started_by:j.data()?.started_by || uid,lease_token:token,lease_until:Timestamp.fromMillis(now()+90000),updatedAt:stamp()},{merge:true})
    tx.update(source,{customer_merge_lock:sourceId}); tx.update(target,{customer_merge_lock:sourceId})
    return true
  })
  if (!acquired) return {complete:true,sourceId,targetId}
  try {
    async function owned(tx) {
      const j=await tx.get(job)
      if (!isOwned(j.data())) throw new MergeError('Another request is continuing this merge. Refresh before retrying.')
    }
    const snapshots=await job.collection('snapshots').get()
    const originals=Object.fromEntries(snapshots.docs.map(d=>[d.id,d.data()]))
    const contactIds=customerMergeContactMap(originals.survivor,originals.source)
    const carriedData=s => {const data=s.data();return data.contact_id && contactIds[data.contact_id] ? {...data,contact_id:contactIds[data.contact_id]} : data}
    const known = new Map((await job.collection('entries').get()).docs.map(d=>[d.data().source,d.data()]))
    async function copy(sourceDoc, targetCollection, removeSource=true) {
      const sourceRef=sourceDoc.ref
      const seen=known.get(sourceRef.path)
      if(seen?.source_fingerprint === fingerprint(sourceDoc.data()) && !removeSource)return db.doc(seen.destination)
      const receipt=job.collection('entries').doc(hash(sourceRef.path))
      return db.runTransaction(async tx => {
        await owned(tx)
        const [s,r]=await tx.getAll(sourceRef,receipt)
        if (!s.exists) {if(r.exists)return db.doc(r.data().destination);throw new MergeError('Source history changed during the merge. Retry to recheck it.')}
        if (r.exists) {
          const dest=db.doc(r.data().destination), current=await tx.get(dest)
          if(!current.exists || fingerprint(current.data())!==r.data().fingerprint)throw new MergeError('Preserved history changed during the merge. No record was overwritten; contact an administrator.')
          tx.set(dest,carriedData(s));tx.set(job.collection('history').doc(hash(sourceRef.path)),s.data());tx.update(receipt,{fingerprint:fingerprint(carriedData(s)),source_fingerprint:fingerprint(s.data()),copiedAt:stamp()});if(removeSource)tx.delete(sourceRef);return dest
        }
        let dest=targetCollection.doc(sourceRef.id), existing=await tx.get(dest)
        if (existing.exists) {
          dest=targetCollection.doc(`merged_${hash(sourceRef.path)}`)
          if ((await tx.get(dest)).exists) throw new MergeError('A preserved-history destination is occupied. No record was overwritten; contact an administrator.')
        }
        tx.create(job.collection('history').doc(hash(sourceRef.path)),s.data())
        tx.create(dest,carriedData(s)) // Preserve all original data, dates, state and attribution.
        tx.create(receipt,{source:sourceRef.path,destination:dest.path,fingerprint:fingerprint(carriedData(s)),source_fingerprint:fingerprint(s.data()),copied_by:uid,copiedAt:stamp()})
        if(removeSource)tx.delete(sourceRef)
        return dest
      })
    }
    let pending=false
    for (const name of MERGE_COLLECTIONS) {
      const docs=(await source.collection(name).get()).docs
      for (let i=0;i<docs.length;i+=8) {
        if (now()-started > budgetMs) { pending=true; break }
        const results=await Promise.allSettled(docs.slice(i,i+8).map(async d => {
          const dest=await copy(d,target.collection(name),name!=='whatsapp_threads')
          if (name === 'whatsapp_threads') {
            const media=await d.ref.collection('media').get()
            for (const m of media.docs) await copy(m,dest.collection('media'))
            await db.runTransaction(async tx=>{
              await owned(tx)
              const [current,receipt]=await tx.getAll(d.ref,job.collection('entries').doc(hash(d.ref.path)))
              if(!current.exists)return
              if(!receipt.exists || receipt.data().source_fingerprint!==fingerprint(current.data()) || !(await tx.get(d.ref.collection('media'))).empty)throw new MergeError('New WhatsApp history arrived. Retry to include it.')
              tx.delete(d.ref)
            })
          }
          if (afterCopy) await afterCopy(d.ref)
        }))
        const failed=results.find(r=>r.status==='rejected')
        if(failed)throw failed.reason
      }
      if (pending) break
    }
    // Repoint only the customer-id field; roles, approval and pricing never change.
    if (!pending) for (const [collectionName,field] of [['orders','customer_id'],['client_quotes','customer_id'],['users','customer_id']]) {
      const refs=(await db.collection(collectionName).where(field,'==',sourceId).get()).docs
      for (let i=0;i<refs.length;i+=100) {
        if (now()-started > budgetMs) { pending=true; break }
        await db.runTransaction(async tx => {
          await owned(tx)
          const docs=await tx.getAll(...refs.slice(i,i+100).map(d=>d.ref))
          for (const d of docs) if(d.exists && d.data()[field]===sourceId) tx.update(d.ref,{[field]:targetId})
        })
      }
      if(pending) break
    }
    if (!pending) {
      const progress=(await job.get()).data().product_cursor
      let productQuery=db.collection('products').orderBy('__name__')
      if(progress)productQuery=productQuery.startAfter(db.doc(`products/${progress}`))
      const products=await productQuery.get()
      for (const product of products.docs) {
        if (now()-started > budgetMs) {pending=true;break}
        const images=await product.ref.collection('images').where('branded_for_customer_id','==',sourceId).get()
        for (const image of images.docs) await db.runTransaction(async tx=>{
          await owned(tx);const current=await tx.get(image.ref)
          if(current.data()?.branded_for_customer_id===sourceId)tx.update(image.ref,{branded_for_customer_id:targetId})
        })
        await db.runTransaction(async tx=>{await owned(tx);tx.update(job,{product_cursor:product.id})})
      }
    }
    if (!pending) await db.runTransaction(async tx => {
      await owned(tx)
      const [s,t]=await tx.getAll(source,target)
      if (!s.exists || !t.exists) throw new MergeError('Customer changed during the merge. Please retry.')
      if(JSON.stringify(customerMergeContactMap(t.data(),s.data())) !== JSON.stringify(contactIds))throw new MergeError('Customer contacts changed outside this merge. Nothing was lost; contact an administrator.')
      // Transactional collection reads catch late source inserts before finalization.
      const queries=await Promise.all(MERGE_COLLECTIONS.map(c=>tx.get(source.collection(c))))
      if(queries.some(q=>!q.empty))throw new MergeError('New history arrived. Retry this merge to include it.')
      const receipts=(await tx.get(job.collection('entries'))).docs
      for(let i=0;i<receipts.length;i+=100) {
        const rows=receipts.slice(i,i+100)
        const destinations=await tx.getAll(...rows.map(r=>db.doc(r.data().destination)))
        if(destinations.some((d,index)=>!d.exists || fingerprint(d.data())!==rows[index].data().fingerprint))throw new MergeError('Transferred history needs rechecking. Nothing was lost; contact an administrator.')
        const originals=await tx.getAll(...rows.map(r=>job.collection('history').doc(r.id)))
        if(originals.some((d,index)=>!d.exists || fingerprint(d.data())!==rows[index].data().source_fingerprint))throw new MergeError('An audit snapshot needs rechecking. Contact an administrator.')
      }
      for(const name of ['orders','client_quotes','users'])if(!(await tx.get(db.collection(name).where('customer_id','==',sourceId).limit(1))).empty)throw new MergeError('New customer references arrived. Retry to include them.')
      tx.update(target,{...customerMergeFields(t.data(),s.data()),customer_merge_lock:FieldValue.delete(),updatedAt:stamp()})
      tx.delete(source)
      tx.update(job,{state:'complete',completed_by:uid,completedAt:stamp(),lease_until:Timestamp.fromMillis(0)})
    })
    if (pending) await db.runTransaction(async tx=>{await owned(tx);tx.update(job,{lease_until:Timestamp.fromMillis(0),updatedAt:stamp()})})
    return {complete:!pending,sourceId,targetId}
  } catch (error) {
    // Keep data and locks safe, but permit an explicit retry of the same merge.
    await db.runTransaction(async tx=>{const j=await tx.get(job);if(isOwned(j.data()) && j.data().state!=='complete')tx.update(job,{lease_until:Timestamp.fromMillis(0),updatedAt:stamp()})}).catch(()=>{})
    throw error
  }
}

export function createCustomerMergeHandler({verifyToken,getProfile,merge}) {
  const reply=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}})
  return async req=>{
    if(req.method!=='POST')return reply({error:'Method not allowed'},405)
    const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
    if(!token)return reply({error:'Please sign in.'},401)
    let identity
    try{identity=await verifyToken(token)}catch{return reply({error:'Please sign in again.'},401)}
    const profile=await getProfile(identity.uid)
    // This also repoints portal ownership; keep that privileged action admin-only.
    if(profile?.role!=='admin')return reply({error:'An administrator must merge customer records.'},403)
    let data
    try{data=await req.json()}catch{return reply({error:'Invalid request.'},400)}
    if(!data || !safeId(data.sourceId) || !safeId(data.targetId) || data.sourceId===data.targetId)return reply({error:'Choose two different customer records.'},400)
    try{const result=await merge(data.sourceId,data.targetId,identity.uid);return reply(result,result.complete?200:202)}
    catch(e){return reply({error:e instanceof MergeError?e.message:'Merge paused safely. Retry the same merge to continue.'},e instanceof MergeError?e.status:503)}
  }
}
