import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import ConfirmDialog from './ConfirmDialog'
import { Video as VideoIcon, X } from 'lucide-react'

// Short clips filmed at a supplier's exhibition booth. Sits under the supplier
// "Photos & Videos" card next to the ImageGallery. Raw upload — no transcode —
// straight to suppliers/{id}/videos/… in Storage (already isStaff via the
// suppliers/{id}/** storage rule) and a suppliers/{id}/videos/{id} Firestore
// doc for the caption + ordering.
const MAX_MB = 500

function fmtBytes(b) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// forwardRef so SupplierDetail's single Photos-&-Videos drop zone (which is
// ImageGallery's, via its onExtraFiles hook) can hand video files straight to
// this component's ingest().
const SupplierVideos = forwardRef(function SupplierVideos({ supplierId }, ref) {
  const idRef = useRef(0)
  const [videos, setVideos] = useState([])
  const [uploads, setUploads] = useState([])
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'suppliers', supplierId, 'videos'), orderBy('sort_order'))
    return onSnapshot(q,
      snap => setVideos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setVideos([]),
    )
  }, [supplierId])

  useImperativeHandle(ref, () => ({ ingest }))

  function handleFiles(e) {
    ingest(Array.from(e.target.files))
    e.target.value = ''
  }

  function ingest(files) {
    setErr('')
    for (const file of files) {
      // MIME first, then the extension — a drag can arrive with a blank type.
      const looksVideo = file.type.startsWith('video/') ||
        /\.(mov|mp4|m4v|webm|avi|mkv|mpe?g|hevc|3gp)$/i.test(file.name || '')
      if (!looksVideo) {
        setErr(`"${file.name}" isn't a video file. Dragging a clip straight out of the macOS Photos app hands over a still frame instead — export it, or drag it from Finder.`)
        continue
      }
      if (file.size > MAX_MB * 1024 * 1024) { setErr(`"${file.name}" is ${fmtBytes(file.size)} — over the ${MAX_MB} MB limit.`); continue }
      const uid = ++idRef.current
      const path = `suppliers/${supplierId}/videos/${Date.now()}_${uid}_${file.name}`
      const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type || 'video/mp4' })
      setUploads(prev => [...prev, { uid, name: file.name, progress: 0 }])
      task.on('state_changed',
        s => setUploads(prev => prev.map(u => (u.uid === uid ? { ...u, progress: Math.round(s.bytesTransferred / s.totalBytes * 100) } : u))),
        () => { setUploads(prev => prev.filter(u => u.uid !== uid)); setErr(`Upload of "${file.name}" failed.`) },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref)
          await addDoc(collection(db, 'suppliers', supplierId, 'videos'), {
            file_url: url, storage_path: path, file_name: file.name,
            content_type: file.type, size: file.size, caption: '',
            sort_order: videos.length, uploaded_at: serverTimestamp(),
          })
          setUploads(prev => prev.filter(u => u.uid !== uid))
        },
      )
    }
  }

  async function saveCaption(v, caption) {
    if (caption === (v.caption || '')) return
    await updateDoc(doc(db, 'suppliers', supplierId, 'videos', v.id), { caption })
  }

  async function doDelete(v) {
    setConfirmDelete(null)
    try { if (v.storage_path) await deleteObject(storageRef(storage, v.storage_path)) } catch { /* already gone */ }
    await deleteDoc(doc(db, 'suppliers', supplierId, 'videos', v.id))
  }

  return (
    <div className="mt-5 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <VideoIcon size={13} /> Videos {videos.length > 0 && <span className="text-gray-400 font-normal">{videos.length}</span>}
        </p>
        {/* Photos AND videos share the one drop zone above (ImageGallery's,
            routed here via onExtraFiles) — this is just a manual fallback. */}
        <label className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer">
          + Add video
          <input type="file" accept="video/*" multiple className="hidden" onChange={handleFiles} />
        </label>
      </div>

      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}

      {uploads.map(u => (
        <div key={u.uid} className="text-xs text-gray-500 mb-1">
          Uploading {u.name}… {u.progress}%
          <div className="h-1 bg-gray-100 rounded mt-0.5"><div className="h-1 bg-brand-500 rounded" style={{ width: `${u.progress}%` }} /></div>
        </div>
      ))}

      {videos.length === 0 && uploads.length === 0 ? (
        <p className="text-xs text-gray-400">No videos yet — booth walk-throughs, product demos, etc. Up to {MAX_MB} MB each.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {videos.map(v => (
            <div key={v.id} className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="relative bg-black">
                <video src={v.file_url} controls preload="metadata" className="w-full max-h-64 bg-black" />
                <button type="button" onClick={() => setConfirmDelete(v)}
                  title="Delete video"
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-red-600">
                  <X size={12} />
                </button>
              </div>
              <input
                className="w-full text-xs px-2 py-1.5 border-t border-gray-100 focus:outline-none"
                defaultValue={v.caption || ''}
                placeholder="Caption — e.g. Canton Fair 2026 booth walk-through"
                onBlur={e => saveCaption(v, e.target.value.trim())}
              />
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.file_name || 'this video'}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => doDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
})

export default SupplierVideos
