import { useState, useEffect, useRef } from 'react'
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import ConfirmDialog from './ConfirmDialog'
import { FileText, Image as ImageIcon, File, FileSpreadsheet, Presentation, FileType, X } from 'lucide-react'

const FILE_ICONS = {
  'application/pdf': FileText,
  'image/jpeg': ImageIcon,
  'image/png': ImageIcon,
  'image/webp': ImageIcon,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet, // .xlsx
  'application/vnd.ms-excel': FileSpreadsheet,                                          // .xls
  'text/csv': FileSpreadsheet,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': Presentation, // .pptx
  'application/vnd.ms-powerpoint': Presentation,                                            // .ppt
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileType,       // .docx
  'application/msword': FileType,                                                           // .doc
  default: File,
}
// Some OSes report an empty file.type for Office files — fall back to the
// extension so the right icon still shows.
const EXT_ICONS = {
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  pptx: Presentation, ppt: Presentation,
  docx: FileType, doc: FileType, pdf: FileText,
}
const FileTypeIcon = ({ type, name, size }) => {
  const ext = (name || '').split('.').pop()?.toLowerCase()
  const I = FILE_ICONS[type] || EXT_ICONS[ext] || FILE_ICONS.default
  return <I size={size} />
}

const OFFICE_EXT = new Set(['xlsx', 'xls', 'csv', 'pptx', 'ppt', 'docx', 'doc'])
const extOf = name => (name || '').split('.').pop()?.toLowerCase() || ''

// Some OSes hand a file-input an empty file.type for Office files; store an
// accurate Content-Type anyway so the object isn't saved as octet-stream.
const CONTENT_TYPE_BY_EXT = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
}
const isOffice = (type, name) => OFFICE_EXT.has(extOf(name)) ||
  /officedocument|ms-excel|ms-powerpoint|msword/.test(type || '')
const isPdf = (type, name) => type === 'application/pdf' || extOf(name) === 'pdf'

// Microsoft's public Office Online viewer. It fetches the file from its OWN
// servers, and chokes on a raw Firebase download URL (no trailing extension,
// stored as octet-stream). /api/office-file/<name> re-serves it at a clean,
// extension-terminated URL with the right MIME type. The file transits
// Microsoft's servers to render; supplier catalogs / lookbooks / price lists
// only (owner: nothing sensitive).
const proxiedFileUrl = c =>
  `${window.location.origin}/api/office-file/${encodeURIComponent(c.file_name)}?src=${encodeURIComponent(c.file_url)}`
const officeEmbedUrl = c =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(proxiedFileUrl(c))}`

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SupplierCatalogs({ supplierId }) {
  const fileIdRef = useRef(0)
  const [catalogs, setCatalogs]   = useState([])
  const [uploads, setUploads]     = useState([])   // in-progress uploads
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [lightbox, setLightbox]   = useState(null)
  const [viewer, setViewer]       = useState(null)   // catalog being previewed in a modal

  useEffect(() => {
    const q = query(collection(db, 'suppliers', supplierId, 'catalogs'), orderBy('uploaded_at', 'desc'))
    return onSnapshot(q, snap => setCatalogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [supplierId])

  async function handleFiles(e) {
    const files = Array.from(e.target.files)
    e.target.value = ''

    for (const file of files) {
      const uid = ++fileIdRef.current
      const path = `suppliers/${supplierId}/catalogs/${Date.now()}_${uid}_${file.name}`
      const sRef = storageRef(storage, path)

      setUploads(prev => [...prev, { uid, name: file.name, progress: 0, size: file.size, type: file.type }])

      const contentType = file.type || CONTENT_TYPE_BY_EXT[extOf(file.name)] || 'application/octet-stream'
      const task = uploadBytesResumable(sRef, file, { contentType })

      task.on('state_changed',
        snapshot => {
          const progress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100)
          setUploads(prev => prev.map(u => u.uid === uid ? { ...u, progress } : u))
        },
        () => {
          setUploads(prev => prev.filter(u => u.uid !== uid))
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref)
          await addDoc(collection(db, 'suppliers', supplierId, 'catalogs'), {
            file_url: url,
            storage_path: path,
            file_name: file.name,
            file_type: contentType,
            file_size: file.size,
            uploaded_at: serverTimestamp(),
          })
          setUploads(prev => prev.filter(u => u.uid !== uid))
        }
      )
    }
  }

  async function handleDelete(catalog) {
    try {
      if (catalog.storage_path) await deleteObject(storageRef(storage, catalog.storage_path))
    } catch {}
    await deleteDoc(doc(db, 'suppliers', supplierId, 'catalogs', catalog.id))
    setConfirmDelete(null)
  }

  const isImage = type => type?.startsWith('image/')

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-ink-80">Supplier Catalogs</h2>
        <label className="btn-secondary text-xs py-1.5 px-3 cursor-pointer">
          + Upload Files
          <input
            type="file"
            accept=".pdf,image/*,.xlsx,.xls,.csv,.pptx,.ppt,.docx,.doc,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/csv"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
        </label>
      </div>

      <p className="text-xs text-ink-60 mb-4">Upload supplier product catalogs, lookbooks, or price lists — PDF, images, or Office files (Excel / PowerPoint / Word). Office files preview in-app through Microsoft's viewer.</p>

      {/* In-progress uploads */}
      {uploads.map(u => (
        <div key={u.uid} className="flex items-center gap-3 p-3 bg-brand-50 rounded-none mb-2">
          <span className="text-ink-60"><FileTypeIcon type={u.type} name={u.name} size={20} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ink-80 truncate">{u.name}</p>
            <div className="mt-1 h-1 bg-brand-200 rounded-none overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${u.progress}%` }} />
            </div>
          </div>
          <span className="text-xs text-ink-60">{u.progress}%</span>
        </div>
      ))}

      {/* Catalog list */}
      {catalogs.length === 0 && uploads.length === 0 ? (
        <p className="text-sm text-ink-60 text-center py-6">No catalogs yet — upload PDF, image, or Office files.</p>
      ) : (
        <div className="space-y-2">
          {catalogs.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-none border border-warm-grey hover:border-warm-grey hover:bg-ivory transition-colors group">
              {/* Thumbnail or icon */}
              {isImage(c.file_type) ? (
                <img
                  src={c.file_url}
                  alt={c.file_name}
                  className="w-10 h-10 object-cover rounded-none cursor-pointer shrink-0"
                  onClick={() => setLightbox(c)}
                />
              ) : (
                <span
                  className={`text-ink-60 shrink-0 ${(isOffice(c.file_type, c.file_name) || isPdf(c.file_type, c.file_name)) ? 'cursor-pointer' : ''}`}
                  onClick={() => (isOffice(c.file_type, c.file_name) || isPdf(c.file_type, c.file_name)) && setViewer(c)}
                ><FileTypeIcon type={c.file_type} name={c.file_name} size={24} /></span>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate font-medium">{c.file_name}</p>
                <p className="text-xs text-ink-60 mt-0.5">{formatBytes(c.file_size)}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {(isOffice(c.file_type, c.file_name) || isPdf(c.file_type, c.file_name)) && (
                  <button
                    type="button"
                    onClick={() => setViewer(c)}
                    className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded-none hover:bg-brand-50"
                  >
                    View
                  </button>
                )}
                <a
                  href={c.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded-none hover:bg-brand-50"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(c)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-none hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document viewer — Office files via Microsoft's embed, PDFs direct */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={() => setViewer(null)}>
          <div className="flex items-center justify-between px-4 py-2.5 bg-white shrink-0" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-ink truncate font-medium">{viewer.file_name}</p>
            <div className="flex items-center gap-3 shrink-0">
              <a href={viewer.file_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:text-brand-800">Open in new tab</a>
              <button onClick={() => setViewer(null)} className="text-ink-60 hover:text-ink-80"><X size={20} /></button>
            </div>
          </div>
          <iframe
            title={viewer.file_name}
            src={isPdf(viewer.file_type, viewer.file_name) ? viewer.file_url : officeEmbedUrl(viewer)}
            className="flex-1 w-full bg-white border-0"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Image lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setLightbox(null)}>
          <img src={lightbox.file_url} alt={lightbox.file_name} className="max-w-full max-h-full rounded-none object-contain" onClick={e => e.stopPropagation()} />
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}><X size={24} /></button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.file_name}"? This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
