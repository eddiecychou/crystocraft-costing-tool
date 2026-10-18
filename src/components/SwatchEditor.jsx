import { useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'
import { X } from 'lucide-react'
import { SWATCH_STYLES, validatePhoto } from '../domain/crystalSwatches'
import { saveCrystalSwatch } from '../crystalSwatches'
import { getCroppedCanvas } from '../imageCrop'
import SwatchPhoto from './SwatchPhoto'

export default function SwatchEditor({ sample, onClose, onSaved }) {
  const [id]=useState(()=>sample?.id || 'sw_'+crypto.randomUUID())
  const [revision,setRevision]=useState(sample?.revision||0)
  const [values,setValues]=useState(()=>sample || {color_name:'',notes_key:'',style:'fabric',backing_label:'',description:'',sort_order:0,publication:'draft'})
  const [file,setFile]=useState(null), [preview,setPreview]=useState(''), [cropped,setCropped]=useState(null)
  const [cropping,setCropping]=useState(false), [crop,setCrop]=useState({x:0,y:0}), [zoom,setZoom]=useState(1), [pixels,setPixels]=useState(null)
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  useEffect(()=>{
    if(!file){setPreview('');return}
    const url=URL.createObjectURL(cropped||file);setPreview(url)
    return()=>URL.revokeObjectURL(url)
  },[file,cropped])
  const patch=(key,value)=>setValues(v=>({...v,[key]:value}))
  async function choose(next) {
    setError('')
    if(!next)return
    try {validatePhoto(await next.arrayBuffer(),next.type);setFile(next);setCropped(null);setCropping(false);setZoom(1);setCrop({x:0,y:0})}
    catch(e){setError(e.message)}
  }
  async function applyCrop() {
    try {
      if(!pixels)throw Error('Select the crop first.')
      const image=new Image();image.src=preview;await image.decode()
      const blob=await new Promise(resolve=>getCroppedCanvas(image,pixels).toBlob(resolve,'image/jpeg',0.95))
      if(!blob)throw Error('Crop could not be prepared.')
      setCropped(blob);setCropping(false)
    }catch(e){setError(e.message)}
  }
  async function submit(e) {
    e.preventDefault();setError('');setBusy(true)
    try {
      const next = await saveCrystalSwatch({id,expectedRevision:revision,values:{...values,notes_key:sample?.notes_key || values.notes_key || values.color_name},file,croppedBlob:cropped,onPrepared:r=>{setRevision(r);setValues(v=>({...v,notes_key:v.notes_key||v.color_name}))}})
      setRevision(next)
      await onSaved();onClose()
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <div className="fixed inset-0 bg-black/40 z-50 p-3 flex items-center justify-center">
    <section role="dialog" aria-modal="true" aria-labelledby="swatch-editor-title" className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-4"><h2 id="swatch-editor-title" className="text-xl">{sample?'Edit swatch':'Upload swatch'}</h2><button aria-label="Close swatch editor" className="btn-ghost min-h-11 min-w-11" disabled={busy} onClick={onClose}><X size={18}/></button></div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="label block mb-1">Photograph</span><input autoFocus type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>choose(e.target.files?.[0])} className="input text-sm"/><span className="text-xs text-ink-60">JPEG, PNG or WebP, up to 20 MB. The original is preserved.</span></label>
        {(preview || sample?.media) && <div className="bg-ivory-dark aspect-video flex items-center justify-center overflow-hidden">
          {cropping ? <div className="relative w-full h-full"><Cropper image={preview} crop={crop} zoom={zoom} aspect={undefined} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_,p)=>setPixels(p)}/></div>
            : preview ? <img src={preview} alt="Swatch upload preview" className="w-full h-full object-contain"/> : <SwatchPhoto path={sample.media.display} alt={sample.color_name}/>}
        </div>}
        {file && <div className="flex flex-wrap gap-2">
          {cropping ? <><button type="button" className="btn-secondary min-h-11" onClick={applyCrop}>Use crop</button><button type="button" className="btn-ghost min-h-11" onClick={()=>setCropping(false)}>Cancel crop</button><label className="text-xs">Zoom<input aria-label="Crop zoom" type="range" min="1" max="4" step="0.1" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></>
            : <><button type="button" disabled={busy} className="btn-secondary min-h-11" onClick={()=>setCropping(true)}>Crop photo (optional)</button>{cropped && <button type="button" disabled={busy} className="btn-ghost min-h-11" onClick={()=>setCropped(null)}>Use full photo</button>}</>}
        </div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label><span className="label block mb-1">Crystal colour / effect</span><input className="input" required maxLength={100} disabled={busy} value={values.color_name} onChange={e=>patch('color_name',e.target.value)}/></label>
          <label><span className="label block mb-1">Material</span><select className="input" disabled={busy} value={values.style} onChange={e=>patch('style',e.target.value)}>{Object.entries(SWATCH_STYLES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label><span className="label block mb-1">Backing colour / label</span><input className="input" required maxLength={100} disabled={busy} value={values.backing_label} onChange={e=>patch('backing_label',e.target.value)} placeholder="e.g. Black, Clear or 01"/></label>
          <label><span className="label block mb-1">Display order</span><input type="number" className="input" min="0" max="100000" step="1" disabled={busy} value={values.sort_order} onChange={e=>patch('sort_order',e.target.value)}/></label>
        </div>
        <label className="block"><span className="label block mb-1">Sample description (customer-visible when published)</span><textarea rows={2} maxLength={1000} className="input" disabled={busy} value={values.description} onChange={e=>patch('description',e.target.value)}/></label>
        <label className="block"><span className="label block mb-1">Visibility</span><select className="input" value={values.publication} disabled={busy || !sample} onChange={e=>patch('publication',e.target.value)}><option value="draft">Draft — OC only</option><option value="published">Published — approved customers</option><option value="archived">Archived — OC only</option></select></label>
        {!sample && <p className="text-xs text-ink-60">New uploads start as drafts. Review the saved photo before publishing.</p>}
        {error && <p role="alert" className="text-sm text-brand-700 break-words">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn-primary min-h-11" disabled={busy||cropping}>{busy?'Saving and verifying…':'Save swatch'}</button></div>
      </form>
    </section>
  </div>
}
