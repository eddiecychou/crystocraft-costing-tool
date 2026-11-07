import {useEffect,useRef} from 'react'
import {X} from 'lucide-react'

// Native modal dialog keeps keyboard focus inside and restores it on close.
export default function CustomerFileDialog({title,onClose,busy,closeDisabled=false,children}) {
  const ref=useRef(null)
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close()},[])
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();if(!closeDisabled)onClose()}} aria-label={title}
    className="card p-0 w-full max-w-3xl max-h-full backdrop:bg-ink/60">
    <div className="p-4 border-b border-warm-grey flex items-start justify-between gap-3">
      <div><h3 className="text-base">{title}</h3><p className="text-xs text-ink-60 mt-1">Internal only · Original files are preserved.</p></div>
      <button type="button" className="btn-ghost p-2" disabled={closeDisabled} onClick={onClose} aria-label={busy&&!closeDisabled?'Stop and close':'Close dialog'}><X size={20}/></button>
    </div>
    {children}
  </dialog>
}
