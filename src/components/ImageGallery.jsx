import { useState, useRef, useEffect } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { collection, addDoc, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { storage, db } from '../firebase'
import ConfirmDialog from './ConfirmDialog'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Star, X, Download, Paperclip, FolderOpen } from 'lucide-react'
import { IMAGE_ORIENTATIONS } from '../constants'

const ORIENTATION_STYLES = {
  landscape: 'bg-blue-100 text-blue-700',
  square:    'bg-purple-100 text-purple-700',
  portrait:  'bg-green-100 text-green-700',
}

function makeDownloadName(prefix, index) {
  const safe = (prefix || 'image').replace(/[/\\?%*:|"<>]/g, '-').trim()
  return `${safe} - ${index + 1}.jpg`
}

function downloadImage(img, filename) {
  const proxyUrl = `/api/download-image?url=${encodeURIComponent(img.file_url)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a')
  a.href = proxyUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function SortableImageCard({ img, idx, typeOptions, captionable, onHeroChange, onDelete, onLightbox, downloadPrefix, firestorePath }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: img.id })

  const [caption, setCaption] = useState(img.caption || '')
  useEffect(() => { setCaption(img.caption || '') }, [img.caption])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  async function handleTypeChange(type) {
    await updateDoc(doc(db, ...firestorePath.split('/'), img.id), { type })
  }

  async function handleOrientationChange(orientation) {
    await updateDoc(doc(db, ...firestorePath.split('/'), img.id), { orientation })
  }

  async function saveCaption() {
    if ((img.caption || '') === caption) return
    await updateDoc(doc(db, ...firestorePath.split('/'), img.id), { caption })
  }

  return (
    <div ref={setNodeRef} style={style} className="group relative flex flex-col gap-1">
      <div className="relative">
        {img.is_hero && (
          <div className="absolute top-1 left-1 z-10 bg-yellow-400 px-1 py-0.5 rounded text-white leading-none"><Star size={11} className="fill-current" /></div>
        )}
        {/* Drag handle — top-left grip icon, separate from lightbox click */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1 right-1 z-10 bg-white/80 rounded p-0.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}
          title="Drag to reorder"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="4" cy="3" r="1" fill="#888"/>
            <circle cx="8" cy="3" r="1" fill="#888"/>
            <circle cx="4" cy="6" r="1" fill="#888"/>
            <circle cx="8" cy="6" r="1" fill="#888"/>
            <circle cx="4" cy="9" r="1" fill="#888"/>
            <circle cx="8" cy="9" r="1" fill="#888"/>
          </svg>
        </div>

        <img
          src={img.file_url}
          alt={img.caption || img.file_name}
          className="w-full aspect-square object-cover rounded-lg cursor-pointer"
          onClick={() => onLightbox(img)}
        />

        <div
          className="absolute inset-0 rounded-lg transition-all pointer-events-none group-hover:pointer-events-auto group-hover:bg-black/30 cursor-pointer"
          onClick={() => onLightbox(img)}
        >
          <div className="flex justify-end gap-1 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity pr-7">
            {onHeroChange && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onHeroChange(img) }}
                className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-yellow-600 hover:bg-white"
                title="Set as hero image"
              ><Star size={13} /></button>
            )}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); downloadImage(img, makeDownloadName(downloadPrefix, idx)) }}
              className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-blue-600 hover:bg-white"
              title="Download image"
            ><Download size={13} /></button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(img) }}
              className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-red-600 hover:bg-white"
            ><X size={13} /></button>
          </div>
        </div>
      </div>

      {typeOptions && (
        <select
          className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white w-full"
          value={img.type || typeOptions[0].value}
          onChange={e => handleTypeChange(e.target.value)}
        >
          {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      )}
      {captionable && (
        <input
          type="text"
          value={caption}
          onChange={e => setCaption(e.target.value)}
          onBlur={saveCaption}
          placeholder="Caption (optional)"
          className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white w-full"
        />
      )}
      <div className="flex gap-1">
        {IMAGE_ORIENTATIONS.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => handleOrientationChange(o.value)}
            className={`flex-1 text-xs py-0.5 rounded font-medium transition-colors ${
              (img.orientation || 'square') === o.value
                ? ORIENTATION_STYLES[o.value]
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }`}
            title={o.label}
          >
            {o.short}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ImageGallery({ images, firestorePath, storagePath, typeOptions, captionable, onHeroChange, downloadPrefix }) {
  const fileIdRef = useRef(0)
  const [uploading, setUploading]         = useState(false)
  const [lightbox, setLightbox]           = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [dragOver, setDragOver]           = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function uploadFiles(files) {
    if (!files.length) return
    setUploading(true)
    try {
      await Promise.all(files.map(async (file, i) => {
        const { blob, orientation } = await resizeToJpeg(file)
        const path = `${storagePath}/${Date.now()}_${++fileIdRef.current}.jpg`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, blob, { contentType: 'image/jpeg' })
        const url = await getDownloadURL(sRef)
        await addDoc(collection(db, ...firestorePath.split('/')), {
          file_url: url,
          storage_path: path,
          file_name: file.name,
          type: typeOptions?.[0]?.value || 'hero',
          orientation,
          caption: '',
          sort_order: images.length + i,
          uploaded_at: serverTimestamp(),
        })
      }))
    } finally {
      setUploading(false)
    }
  }

  function handleFiles(e) {
    uploadFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    uploadFiles(files)
  }

  async function handleDelete(image) {
    try {
      if (image.storage_path) await deleteObject(storageRef(storage, image.storage_path))
    } catch {}
    await deleteDoc(doc(db, ...firestorePath.split('/'), image.id))
    if (onHeroChange && image.is_hero) onHeroChange(images.find(i => i.id !== image.id)?.file_url || null)
    setConfirmDelete(null)
  }

  async function setAsHero(image) {
    await Promise.all(
      images.map(img =>
        updateDoc(doc(db, ...firestorePath.split('/'), img.id), { is_hero: img.id === image.id })
      )
    )
    if (onHeroChange) onHeroChange(image.file_url)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = images.findIndex(i => i.id === active.id)
    const newIdx = images.findIndex(i => i.id === over.id)
    const reordered = arrayMove(images, oldIdx, newIdx)
    // Write new sort_order values to Firestore
    await Promise.all(
      reordered.map((img, idx) =>
        updateDoc(doc(db, ...firestorePath.split('/'), img.id), { sort_order: idx })
      )
    )
  }

  return (
    <div>
      {/* Upload */}
      <label
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors
          ${uploading   ? 'border-brand-300 bg-brand-50 cursor-wait' :
            dragOver    ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
                          'border-gray-200 hover:border-brand-300 hover:bg-brand-50'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="text-gray-500">{dragOver ? <FolderOpen size={20} /> : <Paperclip size={20} />}</span>
        <span className="text-sm text-gray-600">
          {uploading ? 'Uploading…' : dragOver ? 'Drop to upload' : 'Upload images or drag & drop'}
        </span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
      </label>

      {/* Sortable grid */}
      {images.length > 0 && (
        <>
          <p className="text-xs text-gray-400 mt-2 mb-1">Drag images to reorder</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={images.map(i => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-2">
                {images.map((img, idx) => (
                  <SortableImageCard
                    key={img.id}
                    img={img}
                    idx={idx}
                    typeOptions={typeOptions}
                    captionable={captionable}
                    onHeroChange={onHeroChange ? setAsHero : null}
                    onDelete={setConfirmDelete}
                    onLightbox={setLightbox}
                    downloadPrefix={downloadPrefix}
                    firestorePath={firestorePath}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setLightbox(null)}>
          <img src={lightbox.file_url} alt="" className="max-w-full max-h-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); downloadImage(lightbox, makeDownloadName(downloadPrefix, images.findIndex(i => i.id === lightbox.id))) }}
              className="text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm"
            ><span className="inline-flex items-center gap-1"><Download size={14} />Download</span></button>
            <button className="text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm inline-flex items-center" onClick={() => setLightbox(null)}><X size={16} /></button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message="Delete this image? This cannot be undone."
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function detectOrientation(width, height) {
  const ratio = width / height
  if (ratio >= 0.85 && ratio <= 1.18) return 'square'
  return ratio > 1 ? 'landscape' : 'portrait'
}

async function resizeToJpeg(file, maxPx = 1800) {
  const bitmap = await createImageBitmap(file)
  const orientation = detectOrientation(bitmap.width, bitmap.height)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  // Compress until under 600KB so Firebase images are manageable for WP edge function
  const MAX = 600 * 1024
  for (const q of [0.90, 0.82, 0.72, 0.60, 0.48]) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q })
    if (blob.size <= MAX) return { blob, orientation }
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.38 })
  return { blob, orientation }
}
