import {lazy,Suspense,useCallback,useEffect,useId,useRef,useState} from 'react'
import {FileText,Image as ImageIcon,Lock,Upload,Download,Eye,Pencil,X} from 'lucide-react'
import {useCan,useRole} from '../../access'
import FileDialog from './CustomerFileDialog'
import {formatOcDateTime} from '../../ocTime'
import {CUSTOMER_FILE_ACCEPT,CUSTOMER_FILE_CATEGORIES,emptyCustomerFileMetadata,customerFileType} from '../../customerFilesModel'
import {listCustomerFiles,uploadCustomerFile,updateCustomerFile,readCustomerFile,downloadCustomerFile,saveCustomerFileThumbnail} from '../../customerFiles'

const Preview=lazy(()=>import('./CustomerFilePreview'))
const size = n => n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`
const detailsOf = file => Object.fromEntries(Object.keys(emptyCustomerFileMetadata()).map(k=>[k,file[k]??emptyCustomerFileMetadata()[k]]))

export function CustomerFileMetadataForm({value,onChange,contacts,disabled=false}) {
  const uid=useId(),set=(key,next)=>onChange({...value,[key]:next})
  const label=(key,text,control)=><div className="min-w-0"><label className="label mb-1 block" htmlFor={uid+key}>{text}</label>{control}</div>
  return <fieldset disabled={disabled} className="space-y-3 min-w-0">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {label('category','Category',<select id={uid+'category'} className="input w-full" value={value.category} onChange={e=>onChange({...value,category:e.target.value,...(e.target.value!=='business_card'?{card_side:'',card_set:''}:{})})}>{Object.entries(CUSTOMER_FILE_CATEGORIES).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select>)}
      {label('title','Title',<input id={uid+'title'} className="input w-full" value={value.title} maxLength={240} onChange={e=>set('title',e.target.value)}/>)}
      {value.category==='business_card' && <>
        {label('side','Card side',<select id={uid+'side'} className="input w-full" value={value.card_side} onChange={e=>set('card_side',e.target.value)}><option value="">Not specified</option><option value="front">Front</option><option value="back">Back</option></select>)}
        {label('set','Card set (links front/back)',<input id={uid+'set'} className="input w-full" value={value.card_set} maxLength={160} placeholder="e.g. Cindy’s card" onChange={e=>set('card_set',e.target.value)}/>)}
      </>}
      {label('source','Source',<input id={uid+'source'} className="input w-full" value={value.source} maxLength={400} placeholder="e.g. trade show or email" onChange={e=>set('source',e.target.value)}/>)}
      {label('referrer','Referrer',<input id={uid+'referrer'} className="input w-full" value={value.referrer} maxLength={240} onChange={e=>set('referrer',e.target.value)}/>)}
    </div>
    <fieldset className="border border-warm-grey p-3">
      <legend className="text-xs text-ink-60 px-1">Link existing contacts (optional)</legend>
      <p className="text-xs text-ink-60 mb-2">The file belongs to this company. Contact links do not change contact details.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {contacts.map(c=><label key={c.id} className="text-sm flex items-center gap-2 min-w-0"><input type="checkbox" checked={value.contact_ids.includes(c.id)} onChange={e=>set('contact_ids',e.target.checked?[...value.contact_ids,c.id]:value.contact_ids.filter(id=>id!==c.id))}/><span className="break-words">{c.name}{c.title?` · ${c.title}`:''}</span></label>)}
        {!contacts.length&&<span className="text-xs text-ink-60">Company only. No saved individual contact IDs are available.</span>}
        {value.contact_ids.filter(id=>!contacts.some(c=>c.id===id)).map(id=><label key={id} className="text-sm flex items-center gap-2"><input type="checkbox" checked onChange={()=>set('contact_ids',value.contact_ids.filter(v=>v!==id))}/>Previously linked contact (no longer on file)</label>)}
      </div>
    </fieldset>
    {label('notes','Notes',<textarea id={uid+'notes'} rows={3} className="input w-full" value={value.notes} maxLength={8000} onChange={e=>set('notes',e.target.value)}/>)}
  </fieldset>
}

function Thumbnail({customerId,file}) {
  const [url,setUrl]=useState(''),[failed,setFailed]=useState(false)
  useEffect(()=>{
    let active=true,url;const controller=new AbortController()
    setUrl('');setFailed(false)
    if(file.thumbnail_sha256)readCustomerFile(customerId,file,{thumbnail:true,signal:controller.signal}).then(blob=>{if(active){url=URL.createObjectURL(blob);setUrl(url)}}).catch(()=>{if(active)setFailed(true)})
    return()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url)}
  },[customerId,file.id,file.thumbnail_sha256,file.thumbnail_size])
  return url?<img src={url} alt={file.title||file.filename} className="w-full h-full object-contain"/>:
    <span className="flex flex-col gap-1 items-center justify-center h-full text-ink-60 text-xs">{file.content_type==='application/pdf'?<FileText size={28}/>:<ImageIcon size={28}/>}<span>{failed?'Preview unavailable':file.content_type==='application/pdf'?'PDF':'Image'}</span></span>
}

export default function CustomerFiles({customerId}) {
  const can=useCan(),role=useRole()
  return (role==='admin'||role==='staff'&&can('customers'))?<CustomerFilesPanel key={customerId} customerId={customerId}/>:null
}

function CustomerFilesPanel({customerId}) {
  const [files,setFiles]=useState([]),[contacts,setContacts]=useState([]),[next,setNext]=useState(null)
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[filter,setFilter]=useState('')
  const [queue,setQueue]=useState([]),[uploadOpen,setUploadOpen]=useState(false),[uploading,setUploading]=useState(false),[batchError,setBatchError]=useState('')
  const [editing,setEditing]=useState(null),[editMeta,setEditMeta]=useState(null),[editBusy,setEditBusy]=useState(false),[editError,setEditError]=useState('')
  const [busyFile,setBusyFile]=useState(''),[errors,setErrors]=useState({}),[preview,setPreview]=useState(null)
  const input=useRef(null),alive=useRef(true),uploadController=useRef(null),actionController=useRef(null),listController=useRef(null),uploadGuard=useRef(false),editGuard=useRef(false),actionGuard=useRef(false)
  const reload=useCallback(async(cursor=null)=>{
    listController.current?.abort();const controller=new AbortController();listController.current=controller
    setLoading(true);setLoadError('')
    try {
      const data=await listCustomerFiles(customerId,cursor,controller.signal)
      if(alive.current&&!controller.signal.aborted){setFiles(previous=>cursor?[...previous,...data.files.filter(f=>!previous.some(p=>p.id===f.id))]:data.files);setContacts(data.contacts);setNext(data.next)}
    }catch(e){if(alive.current&&!controller.signal.aborted)setLoadError(e.message)}
    finally{if(alive.current&&!controller.signal.aborted)setLoading(false)}
  },[customerId])
  useEffect(()=>{alive.current=true;reload();return()=>{alive.current=false;listController.current?.abort();uploadController.current?.abort();actionController.current?.abort()}},[reload])
  const addFiles=list=>{
    const added=Array.from(list||[]);if(!added.length)return
    if(added.length+queue.length>20){setBatchError('Choose up to 20 files per batch. Upload these first, then add more.');return}
    const invalid=added.find(file=>!customerFileType(file)||!file.size||file.size>20*1048576)
    if(invalid){setBatchError(`“${invalid.name}” must be a JPEG, PNG, WebP, GIF or PDF up to 20 MB. No files were added.`);return}
    setQueue(previous=>[...previous,...added.map(file=>({key:crypto.randomUUID(),file,meta:emptyCustomerFileMetadata(),progress:0,status:'queued',error:''}))]);setBatchError('');setUploadOpen(true)
  }
  const changeQueued=(key,patch)=>setQueue(previous=>previous.map(item=>item.key===key?{...item,...patch}:item))
  async function uploadBatch(){
    if(uploadGuard.current)return
    uploadGuard.current=true;setUploading(true);setBatchError('')
    const controller=new AbortController();uploadController.current=controller
    try {
      for(const item of queue.filter(item=>item.status!=='saved')){
        controller.signal.throwIfAborted();changeQueued(item.key,{status:'uploading',error:''})
        try {
          const result=await uploadCustomerFile(customerId,item.file,item.meta,{signal:controller.signal,onProgress:progress=>{if(alive.current)changeQueued(item.key,{progress})}})
          if(alive.current)changeQueued(item.key,{status:'saved',progress:100,error:[result.thumbnailWarning,result.alreadyStored?`Already saved as “${result.file.filename}”; existing details preserved.`:result.detailsPreserved?'Original saved with its previously reserved details. Use Edit details to review changes.':''].filter(Boolean).join(' ')})
        }catch(e){if(controller.signal.aborted)throw e;if(alive.current)changeQueued(item.key,{status:'error',error:e.message})}
      }
    }catch(e){
      if(alive.current){
        setBatchError(controller.signal.aborted?'Upload stopped. Reselect the same originals to resume safely.':e.message)
        setQueue(previous=>previous.map(item=>item.status==='uploading'
          ? {...item,status:'error',error:'Upload stopped. Retry the same original to recover its saved state.'}
          : item))
      }
    }
    finally{uploadGuard.current=false;if(alive.current){setUploading(false);await reload()}}
  }
  const closeUpload=()=>{uploadController.current?.abort();setUploadOpen(false)}
  async function saveDetails(e){
    e.preventDefault();if(editGuard.current)return
    editGuard.current=true;setEditBusy(true);setEditError('')
    const controller=new AbortController();actionController.current=controller
    try{await updateCustomerFile(customerId,editing,editMeta,controller.signal);if(alive.current){setEditing(null);await reload()}}
    catch(e){if(alive.current&&!controller.signal.aborted)setEditError(e.message)}
    finally{editGuard.current=false;if(alive.current)setEditBusy(false)}
  }
  async function actOnFile(file,action){
    if(actionGuard.current)return
    actionGuard.current=true
    const controller=new AbortController();actionController.current=controller;setBusyFile(file.id);setErrors(previous=>({...previous,[file.id]:''}))
    try{
      if(action==='download')await downloadCustomerFile(customerId,file,controller.signal)
      else {
        const blob=await readCustomerFile(customerId,file,{signal:controller.signal})
        if(action==='thumbnail'){await saveCustomerFileThumbnail(customerId,file,blob,controller.signal);if(alive.current)await reload()}
        else if(alive.current)setPreview({file,blob})
      }
    }catch(e){if(alive.current&&!controller.signal.aborted)setErrors(previous=>({...previous,[file.id]:e.message}))}
    finally{actionGuard.current=false;if(alive.current)setBusyFile('')}
  }
  const visible=files.filter(file=>!filter||file.category===filter)
  return <div className="space-y-4" data-customer-files>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-ink-60 max-w-xl"><Lock size={14} className="inline mr-1"/>Internal only. Cards and customer documents stay separate from Brand Assets and Product Gallery. Uploads do not change contacts or marketing preferences.</p>
      <button className="btn-secondary text-xs shrink-0" type="button" onClick={()=>{setUploadOpen(true);if(!queue.length)input.current.click()}} disabled={loading||!!loadError}><Upload size={14}/> Upload files</button>
      <input ref={input} type="file" multiple accept={CUSTOMER_FILE_ACCEPT} className="hidden" aria-label="Choose customer files" onChange={e=>{addFiles(e.target.files);e.target.value=''}}/>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="text-xs text-ink-60 flex items-center gap-2">Category <select className="input text-sm" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All files</option>{Object.entries(CUSTOMER_FILE_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" onClick={()=>reload()} disabled={loading} className="text-xs text-brand-600 hover:underline">Reload files</button>
    </div>
    {batchError&&!uploadOpen&&<p role="alert" className="text-sm text-brand-600">{batchError}</p>}
    {loadError?<div role="alert" className="text-sm text-brand-600">{loadError} <button className="underline" onClick={()=>reload()}>Retry</button></div>:loading&&!files.length?<p className="text-sm text-ink-60" role="status">Loading customer files…</p>:!visible.length?<p className="text-sm text-ink-60 py-4">{files.length?'No files in this category.':'No business cards or customer files yet. Upload images or PDFs up to 20 MB each.'}</p>:null}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {visible.map(file=><article key={file.id} className="border border-warm-grey p-3 min-w-0 space-y-3">
        <div className="flex gap-3 min-w-0">
          <button type="button" className="w-24 h-28 shrink-0 bg-ivory border border-warm-grey p-1" onClick={()=>actOnFile(file,'preview')} disabled={!!busyFile||file.status!=='ready'} aria-label={`Preview ${file.filename}`}><Thumbnail customerId={customerId} file={file}/></button>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink break-words">{file.title||file.filename}</p>
            {file.title&&<p className="text-xs text-ink-60 mt-1 break-all">{file.filename}</p>}
            <p className="text-xs text-ink-60 mt-1">{CUSTOMER_FILE_CATEGORIES[file.category]}{file.card_side?` · ${file.card_side==='front'?'Front':'Back'}`:''} · {size(file.byte_size)}</p>
            {file.card_set&&<p className="text-xs text-ink-60 mt-1 break-words">Card set: {file.card_set}</p>}
            <p className="text-xs text-ink-60 mt-1">{file.uploaded_at?`Uploaded ${formatOcDateTime(file.uploaded_at)}`:'Incomplete upload — reselect the original to resume.'}</p>
            {file.contact_ids?.length>0&&<p className="text-xs text-ink-60 mt-1 break-words">Contacts: {file.contact_ids.map(id=>contacts.find(c=>c.id===id)?.name||'Previously linked contact').join(', ')}</p>}
          </div>
        </div>
        {(file.source||file.referrer)&&<p className="text-xs text-ink-60 break-words">{file.source&&`Source: ${file.source}`}{file.source&&file.referrer?' · ':''}{file.referrer&&`Referrer: ${file.referrer}`}</p>}
        {file.notes&&<p className="text-sm text-ink-70 whitespace-pre-wrap break-words">{file.notes}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-brand-600">
          <button type="button" className="inline-flex items-center gap-1 hover:underline disabled:opacity-50" onClick={()=>actOnFile(file,'preview')} disabled={!!busyFile||file.status!=='ready'}><Eye size={14}/> Preview</button>
          <button type="button" className="inline-flex items-center gap-1 hover:underline disabled:opacity-50" onClick={()=>actOnFile(file,'download')} disabled={!!busyFile||file.status!=='ready'}><Download size={14}/> Download original</button>
          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={()=>{setEditing(file);setEditMeta(detailsOf(file));setEditError('')}}><Pencil size={14}/> Edit details</button>
          {!file.thumbnail_sha256&&file.status==='ready'&&<button type="button" className="hover:underline disabled:opacity-50" onClick={()=>actOnFile(file,'thumbnail')} disabled={!!busyFile}>Make thumbnail</button>}
        </div>
        {busyFile===file.id&&<p role="status" className="text-xs text-ink-60">Loading original file…</p>}
        {errors[file.id]&&<p role="alert" className="text-xs text-brand-600">{errors[file.id]}</p>}
      </article>)}
    </div>
    {next&&<div className="space-y-2"><p className="text-xs text-ink-60">Showing {files.length} files. Load more to include older files in category filtering.</p><button type="button" className="btn-secondary text-xs" disabled={loading} onClick={()=>reload(next)}>Load more files</button></div>}
    {uploadOpen&&<FileDialog title="Upload business cards & customer files" onClose={closeUpload} busy={uploading}>
      <div className="p-4 space-y-4">
        <div className="border border-dashed border-warm-grey p-4 text-center text-sm text-ink-60" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!uploading)addFiles(e.dataTransfer.files)}}>
          <button type="button" className="text-brand-600 underline" disabled={uploading} onClick={()=>input.current.click()}>Choose files</button> or drop images and PDFs here.<p className="text-xs mt-1">Up to 20 files per batch, 20 MB each. Original filenames and bytes stay unchanged.</p>
        </div>
        {queue.map(item=><div key={item.key} className="border border-warm-grey p-3 space-y-3">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm break-all">{item.file.name}</p><p className="text-xs text-ink-60">{size(item.file.size)} · {item.status==='saved'?'Saved':item.status==='uploading'?`${item.progress}%`:item.status==='error'?'Needs retry':'Ready to upload'}</p></div>{!uploading&&<button className="btn-ghost p-1" type="button" aria-label={`Remove ${item.file.name} from batch`} onClick={()=>setQueue(previous=>previous.filter(p=>p.key!==item.key))}><X size={16}/></button>}</div>
          {item.status==='uploading'&&<progress className="w-full accent-brand-600" aria-label={`Uploading ${item.file.name}`} value={item.progress} max={100}/>}
          {item.status!=='saved'&&<details open={queue.length<=2}><summary className="text-xs text-brand-600 cursor-pointer mb-3">Category, contacts and file details</summary><CustomerFileMetadataForm value={item.meta} contacts={contacts} disabled={uploading} onChange={meta=>changeQueued(item.key,{meta})}/></details>}
          {item.error&&<p className="text-xs text-brand-600 break-words" role={item.status==='error'?'alert':'status'}>{item.error}</p>}
        </div>)}
        {batchError&&<p role="alert" className="text-sm text-brand-600">{batchError}</p>}
        <div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary text-xs" onClick={closeUpload}>{uploading?'Stop upload':'Close'}</button><button type="button" className="btn-primary text-xs" disabled={uploading||!queue.some(item=>item.status!=='saved')} onClick={uploadBatch}>{uploading?'Uploading…':'Upload files'}</button></div>
      </div>
    </FileDialog>}
    {editing&&<FileDialog title="Edit customer file details" busy={editBusy} closeDisabled={editBusy} onClose={()=>{if(!editBusy)setEditing(null)}}>
      <form className="p-4 space-y-4" onSubmit={saveDetails}><p className="text-xs text-ink-60 break-all">Original: {editing.filename}</p><CustomerFileMetadataForm value={editMeta} contacts={contacts} disabled={editBusy} onChange={setEditMeta}/>{editError&&<p role="alert" className="text-sm text-brand-600">{editError}</p>}<div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary text-xs" disabled={editBusy} onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="btn-primary text-xs" disabled={editBusy}>{editBusy?'Saving…':'Save details'}</button></div></form>
    </FileDialog>}
    {preview&&<Suspense fallback={<p role="status" className="text-sm text-ink-60">Opening preview…</p>}><Preview key={preview.file.id} {...preview} onClose={()=>setPreview(null)}/></Suspense>}
  </div>
}
