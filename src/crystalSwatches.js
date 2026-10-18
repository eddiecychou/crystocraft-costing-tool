import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { db, storage, authedUser } from './firebase'
import { resizeToJpeg } from './imageResize'
import { SWATCH_COLLECTION, SWATCH_CACHE_CONTROL, cleanSwatch, sha256, validatePhoto, swatchPaths, assertSampleRevision } from './domain/crystalSwatches'

export async function listCrystalSwatches({ includeDrafts = false } = {}) {
  const col = collection(db,SWATCH_COLLECTION)
  const snap = await getDocs(includeDrafts ? col : query(col,where('publication','==','published')))
  return snap.docs.map(d => ({ ...d.data(), id:d.id })).sort((a,b) => a.sort_order-b.sort_order || a.id.localeCompare(b.id))
}

// Same-origin proxy avoids bucket-wide CORS and permanent download-token URLs.
// Firebase Storage rules authorize every media request, including readback.
export async function readSwatchPhoto(path, forceRefresh = false, signal) {
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const res = await fetch(`/api/swatch-library?action=image&file=${encodeURIComponent(path)}`, {
    headers:{Authorization:`Bearer ${await user.getIdToken(forceRefresh)}`}, cache:'no-store', signal,
  })
  if (res.status === 401 && !forceRefresh) return readSwatchPhoto(path,true,signal)
  if (!res.ok) throw Error(`Photo could not be loaded (${res.status}). Please retry.`)
  return res.blob()
}

async function storeVerified(path, blob, expectedHash) {
  try {
    await uploadBytes(ref(storage,path),blob,{contentType:blob.type,cacheControl:SWATCH_CACHE_CONTROL})
  } catch (e) {
    // Rules deny overwriting immutable objects. A retry succeeds only if the
    // existing object has exactly the expected bytes; all other errors surface.
    if (e.code !== 'storage/unauthorized') throw e
  }
  const readback = await readSwatchPhoto(path)
  if (await sha256(await readback.arrayBuffer()) !== expectedHash) throw Error('Uploaded photo failed checksum verification. Nothing was published.')
}

async function photoAssets(id, file, croppedBlob) {
  const bytes = await file.arrayBuffer()
  validatePhoto(bytes,file.type)
  const bitmap = await createImageBitmap(file)
  const width=bitmap.width, height=bitmap.height;bitmap.close()
  if (!width || !height || width > 12000 || height > 12000) throw Error('Photo dimensions must be at most 12,000 pixels per side.')
  const hash = await sha256(bytes)
  const display = (await resizeToJpeg(croppedBlob || file,{maxPx:1600,maxBytes:600*1024})).blob
  const thumbnail = (await resizeToJpeg(croppedBlob || file,{maxPx:420,maxBytes:100*1024})).blob
  if (display.type !== 'image/jpeg' || thumbnail.type !== 'image/jpeg') throw Error('This browser could not prepare the photo. Please retry in a current browser.')
  const displayHash=await sha256(await display.arrayBuffer()), thumbHash=await sha256(await thumbnail.arrayBuffer())
  // Crop bytes also determine immutable revision identity; originals stay intact.
  const revisionHash = await sha256(new TextEncoder().encode(JSON.stringify([hash,displayHash,thumbHash])))
  const paths = swatchPaths(id,revisionHash,file.type)
  const uploads = await Promise.allSettled([['original',file,hash],['display',display,displayHash],['thumbnail',thumbnail,thumbHash]].map(([key,blob,checksum]) => storeVerified(paths[key],blob,checksum)))
  const failed = uploads.find(r => r.status === 'rejected')
  if (failed) throw failed.reason
  return {...paths,sha256:hash,display_sha256:displayHash,thumbnail_sha256:thumbHash,mime:file.type,bytes:file.size,width,height}
}

export async function saveCrystalSwatch({ id, expectedRevision = 0, values, file, croppedBlob, onPrepared }) {
  const clean = cleanSwatch(values), record=doc(db,SWATCH_COLLECTION,id)
  let expected=expectedRevision
  if (!expected) {
    if (!file) throw Error('Choose a photograph.')
    await runTransaction(db,async tx => {
      const before=await tx.get(record);assertSampleRevision(before.exists()?before.data():null,0)
      tx.set(record,{...clean,publication:'draft',schema_version:1,revision:1,media:null,created_at:serverTimestamp(),updated_at:serverTimestamp()})
    })
    expected=1;onPrepared?.(1)
  }
  const media = file ? await photoAssets(id,file,croppedBlob) : null
  await runTransaction(db,async tx => {
    const before=await tx.get(record)
    if (!before.exists()) throw Error('Sample no longer exists.')
    assertSampleRevision(before.data(),expected)
    if (!media && !before.data().media) throw Error('Photo is still pending. Choose the photo and retry.')
    tx.update(record,{...clean,...(media?{media}:{}),revision:expected+1,updated_at:serverTimestamp()})
  })
  return expected+1
}

export async function applySwatchImport(prepared, onProgress = () => {}) {
  const { manifestHash,manifest,samples }=prepared, run=doc(db,'crystal_migration_runs',manifestHash)
  const oldRun=await getDoc(run)
  if (oldRun.exists() && oldRun.data().manifest_hash !== manifestHash) throw Error('Migration manifest conflict.')
  await setDoc(run,{manifest_hash:manifestHash,manifest,
    mappings:samples.map(s=>({sample_id:s.id,colour:s.color_name,style:s.style,backing:s.backing_label,file:s.source_file,slot:s.legacy_slot})),
    state:'running',error:'',updated_at:serverTimestamp()}, {merge:true})
  let done=0
  try {
    const importSample = async sample => {
      const record=doc(db,SWATCH_COLLECTION,sample.id), before=await getDoc(record)
      const imported=before.exists()?before.data():null, expected=cleanSwatch(sample)
      const matches = imported && Object.entries(expected).every(([k,v])=>JSON.stringify(imported[k])===JSON.stringify(v))
      if (imported && imported.media && imported.media.sha256===sample.source.sha256 && matches && imported.revision===2) {
        const checks = await Promise.allSettled([[imported.media.original,imported.media.sha256],[imported.media.display,imported.media.display_sha256],[imported.media.thumbnail,imported.media.thumbnail_sha256]].map(async ([path,hash]) => {
          if (await sha256(await (await readSwatchPhoto(path)).arrayBuffer())!==hash) throw Error(`Existing photo conflict: ${sample.source_file}`)
        }))
        const failed = checks.find(r => r.status === 'rejected')
        if (failed) throw failed.reason
      } else {
        if (imported && (imported.media || imported.publication!=='draft' || imported.revision!==1 ||
          Object.entries(expected).some(([k,v])=>k!=='publication' && JSON.stringify(imported[k])!==JSON.stringify(v)))) throw Error(`Target changed: ${sample.color_name} / ${sample.backing_label}`)
        await saveCrystalSwatch({id:sample.id,expectedRevision:imported?.revision||0,values:expected,
          file:new File([sample.bytes],sample.source_file,{type:sample.type})})
      }
      done++;onProgress({done,total:samples.length,label:`${sample.color_name} / ${sample.backing_label}`})
    }
    // A failed batch settles before recording failure. No workers remain
    // publishing after the run reports that it stopped. IDs/paths are stable.
    for (let start=0;start<samples.length;start+=4) {
      const batch = await Promise.allSettled(samples.slice(start,start+4).map(importSample))
      await setDoc(run,{verified_count:done,updated_at:serverTimestamp()},{merge:true})
      const failed = batch.find(r => r.status === 'rejected')
      if (failed) throw failed.reason
    }
    await setDoc(run,{state:'verified',verified_count:done,updated_at:serverTimestamp()},{merge:true})
  } catch(e) {
    await setDoc(run,{state:'failed',verified_count:done,error:String(e.message).slice(0,1000),updated_at:serverTimestamp()},{merge:true}).catch(()=>{})
    throw e
  }
}
