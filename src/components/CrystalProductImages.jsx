import {useEffect,useRef,useState} from 'react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import {saveCrystalImage,downloadCrystalImage,crystalImageDownloadName} from '../crystalProducts'
import {readSwatchPhoto} from '../crystalSwatches'
import {getCroppedCanvas} from '../imageCrop'
import SwatchPhoto from './SwatchPhoto'

function PhotoCard({image,coverId,publishedCoverId,productPublished,disabled,onPreview,onSaveDescription,onChooseCover,onArchive}) {
 const [description,setDescription]=useState(image.alt||'')
 useEffect(()=>setDescription(image.alt||''),[image.alt])
 const protectedCover=productPublished&&publishedCoverId===image.id
 return <article className="border border-ivory-dark p-3 space-y-3 min-w-0">
  <button type="button" className="block aspect-square bg-white w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600" disabled={disabled} onClick={()=>onPreview(image)} aria-label={'Preview '+(image.alt||'photograph')}><SwatchPhoto path={image.media.thumbnail} alt={image.alt}/></button>
  <div className="flex flex-wrap gap-2 items-center text-xs"><span className="bg-ivory px-2 py-1 capitalize">{image.publication}</span>{coverId===image.id&&<span className="text-brand-700">Selected cover</span>}</div>
  <label className="block"><span className="label block mb-1">Photograph description</span><input className="input w-full min-w-0" maxLength={200} value={description} disabled={disabled} onChange={e=>setDescription(e.target.value)}/></label>
  <button type="button" className="btn-ghost min-h-11 text-xs w-full" disabled={disabled||description===(image.alt||'')} onClick={()=>onSaveDescription(image,description)}>Save description</button>
  <div className="grid grid-cols-2 gap-2"><button type="button" className="btn-secondary min-h-11 text-xs px-2" disabled={disabled} onClick={()=>onPreview(image)}>View / download</button><button type="button" className="btn-secondary min-h-11 text-xs px-2" disabled={disabled} onClick={()=>onPreview(image,true)}>Crop / rotate</button></div>
  <button type="button" className="btn-secondary min-h-11 text-xs w-full" disabled={disabled||image.publication!=='published'||coverId===image.id} onClick={()=>onChooseCover(image.id)}>Use as cover</button>
  {image.publication==='draft'&&<button type="button" className="btn-secondary min-h-11 text-xs w-full" disabled={disabled} onClick={()=>onArchive(image,'published')}>Publish photograph</button>}
  <button type="button" className="btn-ghost min-h-11 text-xs w-full" disabled={disabled||protectedCover} onClick={()=>onArchive(image)}>{image.publication==='archived'?'Restore photograph':'Archive photograph'}</button>
  {protectedCover&&<p className="text-xs text-ink-60">To archive this published cover, choose another cover and save the component first.</p>}
 </article>
}

function PhotoDialog({image,name,edit,onClose,onSaved,onBusyChange}) {
 const dialog=useRef(null),[attempt,setAttempt]=useState(0),[source,setSource]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [editing,setEditing]=useState(edit),[crop,setCrop]=useState({x:0,y:0}),[zoom,setZoom]=useState(1),[rotation,setRotation]=useState(0),[aspect,setAspect]=useState('original'),[pixels,setPixels]=useState(null)
 const [description,setDescription]=useState(image.alt||''),[copyId]=useState(()=>'im_'+crypto.randomUUID()),revision=useRef(0),lock=useRef(false),closeButton=useRef(null)
 useEffect(()=>{const el=dialog.current;el.showModal();closeButton.current?.focus();return()=>el.close()},[])
 useEffect(()=>{
  const controller=new AbortController();let objectUrl
  setLoading(true);setError('')
  readSwatchPhoto(image.media.original,false,controller.signal).then(blob=>{
   if(controller.signal.aborted)return
   objectUrl=URL.createObjectURL(blob);setSource({blob,url:objectUrl})
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
 },[image.media.original,attempt])
 async function perform(action) {
  if(lock.current)return
  lock.current=true;setBusy(true);setError('');onBusyChange(true)
  try{await action()}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false);onBusyChange(false)}
 }
 async function saveCopy() {
  await perform(async()=>{
   if(!source||!pixels)throw Error('Wait for the photograph and select the crop first.')
   const original=new Image();original.src=source.url;await original.decode()
   const canvas=getCroppedCanvas(original,pixels,rotation)
   const croppedBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95))
   if(!croppedBlob)throw Error('The edited photograph could not be prepared.')
   // Only display/thumbnail are edited. The copy retains the exact original bytes.
   const file=new File([source.blob],crystalImageDownloadName(name,image),{type:image.media.mime||source.blob.type})
   const next=await saveCrystalImage({productId:image.productId,id:copyId,file,croppedBlob,alt:description,publication:'draft',expectedRevision:revision.current,onPrepared:r=>{revision.current=r}})
   revision.current=next
   await onSaved();onClose()
  })
 }
 const originalAspect=(image.media.width||1)/(image.media.height||1),cropAspect=aspect==='square'?1:aspect==='portrait'?3/4:aspect==='landscape'?4/3:rotation%180?1/originalAspect:originalAspect
 return <dialog ref={dialog} className="m-auto p-0 w-[calc(100%_-_1.5rem)] max-w-4xl max-h-[92vh] bg-white text-ink backdrop:bg-black/50" aria-labelledby="crystal-photo-title" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
  <div className="p-4 md:p-6 space-y-4">
   <div className="flex justify-between items-start gap-3"><div className="min-w-0"><h2 id="crystal-photo-title" className="text-xl">{editing?'Crop / rotate photograph':'Photograph preview'}</h2><p className="text-sm text-ink-60 break-words">{image.alt||name}</p></div><button ref={closeButton} type="button" aria-label="Close photograph" className="btn-ghost min-h-11 min-w-11 px-2" disabled={busy} onClick={onClose}>✕</button></div>
   {loading?<p role="status" className="text-sm py-8">Loading original photograph…</p>:source&&<>
    {editing?<><div className="relative w-full h-[45vh] min-h-64 bg-ink overflow-hidden"><Cropper image={source.url} crop={crop} zoom={zoom} rotation={rotation} aspect={cropAspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_,value)=>setPixels(value)}/></div>
     <div className="grid sm:grid-cols-2 gap-4"><label><span className="label block mb-1">Crop shape</span><select aria-label="Crop shape" className="input" disabled={busy} value={aspect} onChange={e=>{setAspect(e.target.value);setPixels(null)}}><option value="original">Original proportions</option><option value="square">Square</option><option value="portrait">Portrait · 3:4</option><option value="landscape">Landscape · 4:3</option></select></label><label><span className="label block mb-1">Zoom</span><input aria-label="Photograph crop zoom" className="w-full h-11" type="range" min="1" max="4" step="0.1" value={zoom} disabled={busy} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
     <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={()=>{setRotation(r=>(r+270)%360);setPixels(null)}}>Rotate left</button><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={()=>{setRotation(r=>(r+90)%360);setPixels(null)}}>Rotate right</button></div>
     <label className="block"><span className="label block mb-1">Edited copy description</span><input className="input" maxLength={200} disabled={busy} value={description} onChange={e=>setDescription(e.target.value)}/></label><p className="text-xs text-ink-60">Save a separate draft photograph with this crop. The original bytes and existing photograph are preserved. Review and publish the copy before choosing it as the cover.</p>
    </>:<div className="h-[60vh] bg-ivory"><SwatchPhoto path={image.media.display} alt={image.alt||name}/></div>}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={()=>perform(()=>downloadCrystalImage(image,name))}>Download original</button>{editing?<><button type="button" className="btn-primary min-h-11" disabled={busy||!pixels} onClick={saveCopy}>{busy?'Saving and verifying…':'Save edited copy'}</button><button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={()=>setEditing(false)}>View full original</button></>:<button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={()=>setEditing(true)}>Crop / rotate</button>}</div>
   </>}
   {error&&<div role="alert" className="text-sm text-brand-700 break-words"><p>{error}</p>{!source&&!loading&&<button type="button" className="btn-secondary min-h-11 mt-2" onClick={()=>setAttempt(a=>a+1)}>Retry photograph</button>}</div>}
  </div>
 </dialog>
}

export default function CrystalProductImages({product,coverId,name,disabled,onChooseCover,onRefresh,onBusyChange}) {
 const [queue,setQueue]=useState([]),[processing,setProcessing]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState(null),[dragging,setDragging]=useState(false),lock=useRef(false),input=useRef(null)
 const blocked=disabled||processing
 const update=(id,patch)=>setQueue(rows=>rows.map(row=>row.id===id?{...row,...patch}:row))
 function choose(files) {
  if(blocked||lock.current)return
  const rows=Array.from(files||[]).map(file=>({id:'im_'+crypto.randomUUID(),file,alt:file.name.replace(/\.[^.]+$/,'').slice(0,200)||name,revision:0,status:'pending',error:''}))
  setQueue(current=>[...current,...rows]);setError('');setMessage('');if(input.current)input.current.value=''
 }
 async function perform(action) {
  if(blocked||lock.current)return
  lock.current=true;setProcessing(true);onBusyChange(true);setError('');setMessage('')
  try{await action()}catch(e){setError(e.message)}finally{lock.current=false;setProcessing(false);onBusyChange(false)}
 }
 async function refresh() {
  try{await onRefresh()}catch{setError('The photograph was saved, but the list could not refresh. Refresh photographs before continuing.');return false}
  return true
 }
 async function upload(ids) {
  const attempts=queue.filter(row=>(!ids||ids.includes(row.id))&&['pending','error'].includes(row.status))
  await perform(async()=>{
   let saved=0
   for(const row of attempts){
    update(row.id,{status:'uploading',error:''})
    try{
     const revision=await saveCrystalImage({productId:product.id,id:row.id,file:row.file,alt:row.alt,expectedRevision:row.revision,onPrepared:r=>update(row.id,{revision:r})})
     update(row.id,{status:'success',revision});saved++
    }catch(e){update(row.id,{status:'error',error:e.message})}
   }
   if(saved){await refresh();setMessage(saved+' photograph'+(saved===1?'':'s')+' uploaded and verified.')}
  })
 }
 async function saveDescription(image,alt) {
  await perform(async()=>{await saveCrystalImage({productId:product.id,id:image.id,alt,publication:image.publication,expectedRevision:image.revision});await refresh();setMessage('Photograph description saved.')})
 }
 async function archive(image,publication) {
  if(product.publication==='published'&&product.hero_id===image.id)return
  const next=publication||(image.publication==='archived'?'published':'archived')
  await perform(async()=>{await saveCrystalImage({productId:product.id,id:image.id,alt:image.alt,publication:next,expectedRevision:image.revision});await refresh();setMessage(next==='published'?'Photograph published for approved customers.':'Photograph archived. The original file is preserved.')})
 }
 const pending=queue.filter(row=>row.status==='pending'||row.status==='error').length
 return <section className="card p-4 space-y-4" aria-labelledby="crystal-images-title">
  <div className="flex flex-wrap gap-3 items-center justify-between"><h2 id="crystal-images-title" className="eyebrow">Product photographs</h2><button type="button" className="btn-ghost min-h-11 text-xs" disabled={blocked} onClick={()=>perform(onRefresh)}>Refresh photographs</button></div>
  <p className="text-sm text-ink-60">Upload JPEG, PNG or WebP photographs up to 20 MB each. Original files are preserved in Firebase. Published photographs are available only to approved customers when the component is published.</p>
  <div className={'border border-dashed p-4 space-y-3 '+(dragging?'border-brand-600 bg-ivory':'border-warm-grey')} onDragOver={e=>{e.preventDefault();if(!blocked)setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);choose(e.dataTransfer.files)}}>
   <label className="block"><span className="label block mb-2">Add photographs</span><input ref={input} className="input w-full min-w-0 text-sm" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={blocked} onChange={e=>choose(e.target.files)}/></label><p className="text-xs text-ink-60">Select several files or drag them here. Review their descriptions, then upload. Failed files can be retried individually.</p>
  </div>
  {queue.length>0&&<div className="space-y-3"><ul className="divide-y divide-ivory-dark">{queue.map(row=><li key={row.id} className="py-3 space-y-2 min-w-0"><p className="text-sm break-words">{row.file.name}</p><div className="flex flex-wrap items-center gap-2"><span className={'text-xs '+(row.status==='error'?'text-brand-700':'text-ink-60')}>{({pending:'Ready to upload',uploading:'Uploading and verifying…',success:'Uploaded and verified',error:'Upload failed'})[row.status]}</span>{row.status==='error'&&<button type="button" className="btn-secondary min-h-11 text-xs" disabled={blocked} onClick={()=>upload([row.id])}>Retry this file</button>}{row.status!=='uploading'&&row.status!=='success'&&<button type="button" className="btn-ghost min-h-11 text-xs" disabled={blocked} onClick={()=>setQueue(rows=>rows.filter(r=>r.id!==row.id))}>Remove from queue</button>}</div>{row.status!=='success'&&<label className="block"><span className="label block mb-1">Upload description</span><input className="input" maxLength={200} value={row.alt} disabled={blocked} onChange={e=>update(row.id,{alt:e.target.value})}/></label>}{row.error&&<p className="text-xs text-brand-700 break-words">{row.error}</p>}</li>)}</ul><div className="flex flex-wrap gap-2"><button type="button" className="btn-primary min-h-11" disabled={blocked||!pending} onClick={()=>upload()}>{processing?'Uploading and verifying…':'Upload / retry '+pending+' photograph'+(pending===1?'':'s')}</button>{queue.some(row=>row.status==='success')&&<button type="button" className="btn-ghost min-h-11" disabled={blocked} onClick={()=>setQueue(rows=>rows.filter(row=>row.status!=='success'))}>Clear completed uploads</button>}</div></div>}
  {error&&<p role="alert" className="text-sm text-brand-700 break-words">{error}</p>}{message&&<p role="status" className="text-sm text-ink-70">{message}</p>}
  {!product.images.some(image=>image.media)&&<p className="text-sm text-ink-60">No photographs yet. Add the real product photographs above.</p>}
  <div className="grid min-[560px]:grid-cols-2 lg:grid-cols-3 gap-4">{product.images.filter(image=>image.media).map(image=><PhotoCard key={image.id} image={image} coverId={coverId} publishedCoverId={product.hero_id} productPublished={product.publication==='published'} disabled={blocked} onPreview={(image,edit=false)=>setPreview({image:{...image,productId:product.id},edit})} onSaveDescription={saveDescription} onChooseCover={onChooseCover} onArchive={archive}/>)}</div>
  <p className="text-xs text-ink-60">Choose “Use as cover”, then “Save component” above to publish that cover selection. Archive hides a photograph without deleting its original.</p>
  {preview&&<PhotoDialog image={preview.image} name={name} edit={preview.edit} onClose={()=>setPreview(null)} onBusyChange={onBusyChange} onSaved={async()=>{await refresh();setMessage('Edited copy saved. The existing photograph and original bytes are preserved.')}}/>}
 </section>
}
