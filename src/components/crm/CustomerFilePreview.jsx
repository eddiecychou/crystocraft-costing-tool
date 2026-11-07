import {useEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import {openCustomerPdf} from '../../customerFilePreview'
import FileDialog from './CustomerFileDialog'

export default function CustomerFilePreview({file,blob,onClose}) {
  const canvas=useRef(null),[pdf,setPdf]=useState(null),[page,setPage]=useState(1),[error,setError]=useState(''),[image,setImage]=useState(''),[busy,setBusy]=useState(true)
  useEffect(()=>{
    let active=true,document,url
    if(blob.type==='application/pdf')openCustomerPdf(blob).then(value=>{document=value;if(active)setPdf(value);else value.destroy()}).catch(()=>{if(active){setError('This PDF cannot be previewed. Download the original to open it.');setBusy(false)}})
    else {url=URL.createObjectURL(blob);setImage(url);setBusy(false)}
    return()=>{active=false;document?.destroy();if(url)URL.revokeObjectURL(url)}
  },[blob])
  useEffect(()=>{
    if(!pdf)return
    let active=true,task
    setBusy(true);setError('')
    pdf.getPage(page).then(async value=>{
      if(!active)return
      const initial=value.getViewport({scale:1}),viewport=value.getViewport({scale:Math.min(2,1400/initial.width,1800/initial.height)})
      canvas.current.width=Math.ceil(viewport.width);canvas.current.height=Math.ceil(viewport.height)
      task=value.render({canvasContext:canvas.current.getContext('2d'),viewport,background:'white'});await task.promise
      if(active)setBusy(false)
    }).catch(e=>{if(active && e.name!=='RenderingCancelledException'){setError('This page cannot be previewed. Download the original to open it.');setBusy(false)}})
    return()=>{active=false;task?.cancel()}
  },[pdf,page])
  return <FileDialog title="Customer file preview" onClose={onClose}>
      <p className="p-4 text-sm text-ink break-all">{file.title||file.filename}{file.title?` · ${file.filename}`:''}</p>
      {pdf && <div className="flex items-center justify-center gap-4 p-3 border-b border-warm-grey">
        <button className="btn-secondary p-2" onClick={()=>setPage(p=>p-1)} disabled={page<=1||busy} aria-label="Previous page"><ChevronLeft size={16}/></button>
        <span className="text-sm">Page {page} of {pdf.numPages}</span>
        <button className="btn-secondary p-2" onClick={()=>setPage(p=>p+1)} disabled={page>=pdf.numPages||busy} aria-label="Next page"><ChevronRight size={16}/></button>
      </div>}
      <div className="p-4 bg-ivory min-h-48 text-center">
        {busy && <p className="text-sm text-ink-60" role="status">Loading preview…</p>}
        {error && <p className="text-sm text-brand-600" role="alert">{error}</p>}
        {blob.type==='application/pdf'?<canvas ref={canvas} className="max-w-full h-auto mx-auto" aria-label={`PDF page ${page}`}/>:image&&<img src={image} alt={file.title||file.filename} className="max-w-full max-h-screen object-contain mx-auto"/>}
      </div>
  </FileDialog>
}
