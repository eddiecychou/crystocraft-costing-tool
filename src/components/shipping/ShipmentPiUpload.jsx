import { FileInput, FolderOpen, FileText } from 'lucide-react'
import { ErpCrossCheck } from './ShipmentReconciliation'

export default function ShipmentPiUpload({
  dragOver, fileName, extracting, error, erpCheck,
  onDragOver, onDragLeave, onDrop, onFileChange, onUseErpLines,
}) {
  return (
    <div className="card p-4">
      <label
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-none p-6 cursor-pointer transition-colors
 ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-warm-grey hover:border-brand-400 hover:bg-brand-50'}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave} onDrop={onDrop}>
        <span className="text-ink-60 mb-1">{dragOver ? <FolderOpen size={22} /> : <FileInput size={22} />}</span>
        <span className="text-sm text-ink-70">{dragOver ? 'Drop to import' : 'Click to upload or drag & drop a PI (PDF or image)'}</span>
        <span className="text-xs text-ink-60 mt-0.5">PDF, JPG, PNG</span>
        <input type="file" accept="image/*,.pdf" className="hidden"
               onChange={onFileChange} />
      </label>
      {fileName != null && (
        <div className="flex items-center gap-2 mt-3 text-xs text-ink-70">
          <FileText size={14} className="text-red-400" /> {fileName}
        </div>
      )}
      {extracting && <div className="mt-2 h-1 bg-brand-100 rounded-none overflow-hidden"><div className="h-full bg-brand-500 animate-pulse w-full" /></div>}
      {error && <p className="text-xs text-amber-600 mt-2">{error}</p>}
      <ErpCrossCheck check={erpCheck} onUse={onUseErpLines} />
    </div>
  )
}
