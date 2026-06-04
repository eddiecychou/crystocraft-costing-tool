import { useState, useRef } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { collection, addDoc, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { storage, db } from '../firebase'
import ConfirmDialog from './ConfirmDialog'

function makeDownloadName(prefix, index) {
  const safe = (prefix || 'image').replace(/[/\\?%*:|"<>]/g, '-').trim()
  return `${safe} - ${index + 1}.jpg`
}

function downloadImage(img, filename) {
  // Route through our server-side proxy — avoids CORS, forces correct filename
  const proxyUrl = `/api/download-image?url=${encodeURIComponent(img.file_url)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a')
  a.href = proxyUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default function ImageGallery({ images, firestorePath, storagePath, typeOptions, onHeroChange, downloadPrefix }) {
  const fileIdRef = useRef(0)
  const [uploading, setUploading]       = useState(false)
  const [lightbox, setLightbox]         = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function handleFiles(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try {
      await Promise.all(files.map(async file => {
        const resized = await resizeToJpeg(file)
        const path = `${storagePath}/${Date.now()}_${++fileIdRef.current}.jpg`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, resized, { contentType: 'image/jpeg' })
        const url = await getDownloadURL(sRef)
        await addDoc(collection(db, ...firestorePath.split('/')), {
          file_url: url,
          storage_path: path,
          file_name: file.name,
          type: typeOptions?.[0]?.value || 'reference',
          caption: '',
          sort_order: images.length,
          uploaded_at: serverTimestamp(),
        })
      }))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDelete(image) {
    try {
      if (image.storage_path) {
        await deleteObject(storageRef(storage, image.storage_path))
      }
    } catch {}
    await deleteDoc(doc(db, ...firestorePath.split('/'), image.id))
    if (onHeroChange && image.file_url) onHeroChange(images.find(i => i.id !== image.id)?.file_url || null)
    setConfirmDelete(null)
  }

  async function handleTypeChange(image, type) {
    await updateDoc(doc(db, ...firestorePath.split('/'), image.id), { type })
  }

  async function setAsHero(image) {
    // Clear is_hero on all images, set on the selected one
    await Promise.all(
      images.map(img =>
        updateDoc(doc(db, ...firestorePath.split('/'), img.id), { is_hero: img.id === image.id })
      )
    )
    if (onHeroChange) onHeroChange(image.file_url)
  }

  return (
    <div>
      {/* Upload */}
      <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${uploading ? 'border-brand-300 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50'}`}>
        <span className="text-lg">📎</span>
        <span className="text-sm text-gray-600">{uploading ? 'Uploading…' : 'Upload images'}</span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
      </label>

      {/* Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {images.map((img, idx) => (
            <div key={img.id} className="group relative flex flex-col gap-1">
              {/* Image with overlay */}
              <div className="relative">
                {img.is_hero && (
                  <div className="absolute top-1 left-1 z-10 bg-yellow-400 text-xs px-1 rounded font-bold text-white leading-4">★</div>
                )}
                <img
                  src={img.file_url}
                  alt={img.caption || img.file_name}
                  className="w-full aspect-square object-cover rounded-lg cursor-pointer"
                  onClick={() => setLightbox(img)}
                />
                {/* Overlay — click background to open lightbox, buttons handle their own actions */}
                <div className="absolute inset-0 rounded-lg transition-all pointer-events-none group-hover:pointer-events-auto group-hover:bg-black/30 cursor-pointer"
                     onClick={() => setLightbox(img)}>
                  <div className="flex justify-end gap-1 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onHeroChange && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setAsHero(img) }}
                        className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-yellow-600 hover:bg-white"
                        title="Set as hero image"
                      >⭐</button>
                    )}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); downloadImage(img, makeDownloadName(downloadPrefix, idx)) }}
                      className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-blue-600 hover:bg-white"
                      title="Download image"
                    >↓</button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setConfirmDelete(img) }}
                      className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-red-600 hover:bg-white"
                    >✕</button>
                  </div>
                </div>
              </div>

              {/* Type selector — below image, always visible */}
              {typeOptions && (
                <select
                  className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white w-full"
                  value={img.type || typeOptions[0].value}
                  onChange={e => handleTypeChange(img, e.target.value)}
                >
                  {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
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
            >↓ Download</button>
            <button className="text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm" onClick={() => setLightbox(null)}>✕</button>
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

async function resizeToJpeg(file, maxPx = 2400, quality = 0.93) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}
