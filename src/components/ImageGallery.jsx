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
import { Star, X, Download, Paperclip, FolderOpen, Sparkles, Check, AlertTriangle } from 'lucide-react'
import { IMAGE_ORIENTATIONS, IMAGE_VISIBILITY, imageVisibility } from '../constants'

// Sample both images at 150×150 and count pixels that were clearly coloured in
// the original but became near-white in the enhanced version — that's colour loss.
// Returns true when >4% of originally-coloured pixels turned white.
async function detectColorLoss(originalSrc, enhancedDataUrl) {
  try {
    const loadImg = src => new Promise((res, rej) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => res(img)
      img.onerror = rej
      img.src = src
    })
    const [origImg, enhImg] = await Promise.all([loadImg(originalSrc), loadImg(enhancedDataUrl)])
    const W = 150, H = 150
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.drawImage(origImg, 0, 0, W, H)
    const origPx = ctx.getImageData(0, 0, W, H).data
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(enhImg, 0, 0, W, H)
    const enhPx = ctx.getImageData(0, 0, W, H).data
    let coloured = 0, lost = 0
    for (let i = 0; i < origPx.length; i += 4) {
      const [or, og, ob] = [origPx[i], origPx[i+1], origPx[i+2]]
      const [er, eg, eb] = [enhPx[i], enhPx[i+1], enhPx[i+2]]
      // "Coloured" = not near-white and not near-black in the original
      const wasColoured = !(or > 225 && og > 225 && ob > 225) && !(or < 35 && og < 35 && ob < 35)
      if (wasColoured) {
        coloured++
        if (er > 225 && eg > 225 && eb > 225) lost++
      }
    }
    return coloured > 0 && (lost / coloured) > 0.04
  } catch {
    return false
  }
}

const PLATING_OPTIONS = [
  { value: '',          label: '— select —' },
  { value: 'gold',      label: 'Gold' },
  { value: 'silver / chrome',  label: 'Silver / Chrome' },
  { value: 'rose gold',        label: 'Rose Gold' },
  { value: 'black / gunmetal', label: 'Black / Gunmetal' },
  { value: 'copper / bronze',  label: 'Copper / Bronze' },
]

const CRYSTAL_COLOR_OPTIONS = [
  { value: '',        label: '— select —' },
  { value: 'clear / crystal',  label: 'Clear / Crystal' },
  { value: 'red / ruby',       label: 'Red / Ruby' },
  { value: 'blue / sapphire',  label: 'Blue / Sapphire' },
  { value: 'green / emerald',  label: 'Green / Emerald' },
  { value: 'purple / amethyst',label: 'Purple / Amethyst' },
  { value: 'pink / rose',      label: 'Pink / Rose' },
  { value: 'amber / yellow',   label: 'Amber / Yellow' },
  { value: 'black / jet',      label: 'Black / Jet' },
  { value: 'aurora borealis (iridescent)', label: 'Aurora Borealis' },
]

function buildRecolorInstructions(platFrom, platTo, crystalFrom, crystalTo) {
  const parts = []
  if (platFrom && platTo) parts.push(`Change the metal plating from ${platFrom} to ${platTo}.`)
  if (crystalFrom && crystalTo) parts.push(`Change the crystal/stone colour from ${crystalFrom} to ${crystalTo}.`)
  const kept = []
  if (!platFrom || !platTo) kept.push('metal plating colour')
  if (!crystalFrom || !crystalTo) kept.push('crystal/stone colours')
  if (kept.length && parts.length) parts.push(`Keep the ${kept.join(' and ')} exactly as they are.`)
  return parts.join('\n')
}

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

function SortableImageCard({ img, idx, typeOptions, captionable, showVisibility, onHeroChange, onDelete, onLightbox, downloadPrefix, firestorePath, onEnhance }) {
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

  async function handleVisibilityChange(visibility) {
    await updateDoc(doc(db, ...firestorePath.split('/'), img.id), { visibility })
  }

  const vis = imageVisibility(img)
  const visMeta = IMAGE_VISIBILITY.find(v => v.value === vis)

  return (
    <div ref={setNodeRef} style={style} className="group relative flex flex-col gap-1">
      <div className="relative">
        {img.is_hero && (
          <div className="absolute top-1 left-1 z-10 bg-yellow-400 px-1 py-0.5 rounded text-white leading-none"><Star size={11} className="fill-current" /></div>
        )}
        {showVisibility && (
          <div className={`absolute z-10 bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${visMeta?.cls || 'bg-gray-200 text-gray-600'}`}>
            {visMeta?.short || vis}
          </div>
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

        {/* Darken + click-to-zoom layer */}
        <div
          className="absolute inset-0 rounded-lg transition-all pointer-events-none group-hover:pointer-events-auto group-hover:bg-black/30 cursor-pointer"
          onClick={() => onLightbox(img)}
        />

        {/* Action buttons — anchored bottom-right, clear of the hero star (top-left),
            drag handle (top-right) and visibility badge (bottom-left). */}
        <div className="absolute bottom-1 right-1 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
          {onHeroChange && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onHeroChange(img) }}
              className="bg-white/90 text-xs p-1 rounded text-yellow-600 hover:bg-white shadow-sm"
              title="Set as hero image"
            ><Star size={13} /></button>
          )}
          {onEnhance && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onEnhance(img) }}
              className="bg-white/90 text-xs p-1 rounded text-brand-600 hover:bg-white shadow-sm"
              title="Enhance image — white background + lighting (AI, review before replacing)"
            ><Sparkles size={13} /></button>
          )}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); downloadImage(img, makeDownloadName(downloadPrefix, idx)) }}
            className="bg-white/90 text-xs p-1 rounded text-blue-600 hover:bg-white shadow-sm"
            title="Download image"
          ><Download size={13} /></button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(img) }}
            className="bg-white/90 text-xs p-1 rounded text-red-600 hover:bg-white shadow-sm"
            title="Delete image"
          ><X size={13} /></button>
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
      {showVisibility && (
        <select
          className={`text-xs border rounded px-1.5 py-1 w-full font-medium ${visMeta?.cls || 'bg-white text-gray-600 border-gray-200'}`}
          value={vis}
          onChange={e => handleVisibilityChange(e.target.value)}
          title="Where this image is allowed to appear"
        >
          {IMAGE_VISIBILITY.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
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

export default function ImageGallery({ images, firestorePath, storagePath, typeOptions, captionable, showVisibility, onHeroChange, downloadPrefix, enhanceable }) {
  const fileIdRef = useRef(0)
  const [uploading, setUploading]         = useState(false)
  const [lightbox, setLightbox]           = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [dragOver, setDragOver]           = useState(false)
  const [enh, setEnh]                     = useState(null)  // { img, before, after, mode, busy, error, colorWarning }
  const [colorHint, setColorHint]         = useState('')
  const [recolorOpen, setRecolorOpen]     = useState(false)
  const [platFrom, setPlatFrom]           = useState('')
  const [platTo, setPlatTo]               = useState('')
  const [crystalFrom, setCrystalFrom]     = useState('')
  const [crystalTo, setCrystalTo]         = useState('')

  async function runEnhance(img, mode, recolorInstructions = '') {
    setEnh({ img, before: img.file_url, after: null, mode, busy: true, error: '', colorWarning: false })
    try {
      const res = await fetch('/api/enhance-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: img.file_url, mode, colorHint, recolorInstructions }),
      })
      const data = await res.json()
      if (!res.ok || !data.image) throw new Error(data.error || 'Enhancement failed')
      const afterUrl = `data:${data.mimeType || 'image/png'};base64,${data.image}`
      const colorWarning = await detectColorLoss(img.file_url, afterUrl)
      setEnh(e => (e && e.img.id === img.id ? { ...e, after: afterUrl, busy: false, colorWarning } : e))
    } catch (err) {
      setEnh(e => (e && e.img.id === img.id ? { ...e, busy: false, error: err.message } : e))
    }
  }
  async function keepEnhanced() {
    if (!enh?.after) return
    setEnh(e => ({ ...e, busy: true }))
    try {
      const blob = await (await fetch(enh.after)).blob()
      const file = new File([blob], `enhanced-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const { blob: outBlob, orientation } = await resizeToJpeg(file)
      const path = `${storagePath}/${Date.now()}_${++fileIdRef.current}.jpg`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, outBlob, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(sRef)
      const old = enh.img
      await updateDoc(doc(db, ...firestorePath.split('/'), old.id), { file_url: url, storage_path: path, orientation })
      try { if (old.storage_path) await deleteObject(storageRef(storage, old.storage_path)) } catch {}
      if (onHeroChange && old.is_hero) onHeroChange(url)
      setEnh(null)
    } catch (err) {
      setEnh(e => ({ ...e, busy: false, error: err.message }))
    }
  }

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
          // New corporate uploads start hidden from customers until reviewed.
          ...(showVisibility ? { visibility: 'internal' } : {}),
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
                    showVisibility={showVisibility}
                    onHeroChange={onHeroChange ? setAsHero : null}
                    onDelete={setConfirmDelete}
                    onLightbox={setLightbox}
                    downloadPrefix={downloadPrefix}
                    firestorePath={firestorePath}
                    onEnhance={enhanceable ? (img => setEnh({ img, before: img.file_url, after: null, mode: null, busy: false, error: '', colorWarning: false })) : null}
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

      {enh && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !enh.busy && setEnh(null)}>
          <div className="bg-white rounded-xl max-w-3xl w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Sparkles size={15} /> Enhance image — review before replacing</h3>
              <button type="button" onClick={() => !enh.busy && setEnh(null)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Original</p>
                <div className="aspect-square bg-gray-100 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
                  <img src={enh.before} alt="" className="w-full h-full object-contain" />
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Enhanced {enh.after && `· ${enh.mode}`}</p>
                <div className="aspect-square bg-gray-100 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
                  {enh.busy ? <span className="text-xs text-gray-500">Working… (AI, ~10–20s)</span>
                    : enh.after ? <img src={enh.after} alt="" className="w-full h-full object-contain" />
                    : <span className="text-xs text-gray-400">Describe colours below, then pick Clean or Enhance</span>}
                </div>
              </div>
            </div>
            {/* Colour hint — shown before first enhancement and persists */}
            <div className="mt-3">
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Describe product colours <span className="normal-case font-normal text-gray-400">(optional — helps AI preserve them)</span>
              </label>
              <input
                className="input mt-1 text-sm"
                placeholder="e.g. red body with gold trim, blue inner heart, clear crystal base"
                value={colorHint}
                onChange={e => setColorHint(e.target.value)}
                disabled={enh.busy}
              />
            </div>
            {/* Recolor panel */}
            <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
              <button type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
                onClick={() => setRecolorOpen(o => !o)}>
                <span className="flex items-center gap-1.5"><Sparkles size={12} /> Change plating or crystal colour</span>
                <span className="text-gray-400">{recolorOpen ? '▲' : '▼'}</span>
              </button>
              {recolorOpen && (
                <div className="px-3 pb-3 pt-1 bg-gray-50 space-y-2">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">Plating — from</p>
                      <select className="input text-xs py-1" value={platFrom} onChange={e => setPlatFrom(e.target.value)} disabled={enh.busy}>
                        {PLATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <span className="text-gray-400 mt-4">→</span>
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">to</p>
                      <select className="input text-xs py-1" value={platTo} onChange={e => setPlatTo(e.target.value)} disabled={enh.busy}>
                        {PLATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">Crystal colour — from</p>
                      <select className="input text-xs py-1" value={crystalFrom} onChange={e => setCrystalFrom(e.target.value)} disabled={enh.busy}>
                        {CRYSTAL_COLOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <span className="text-gray-400 mt-4">→</span>
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">to</p>
                      <select className="input text-xs py-1" value={crystalTo} onChange={e => setCrystalTo(e.target.value)} disabled={enh.busy}>
                        {CRYSTAL_COLOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <button type="button"
                    disabled={enh.busy || (!platTo && !crystalTo)}
                    onClick={() => {
                      const instructions = buildRecolorInstructions(platFrom, platTo, crystalFrom, crystalTo)
                      if (instructions) runEnhance(enh.img, 'recolor', instructions)
                    }}
                    className="btn-primary text-xs py-1.5 disabled:opacity-40">
                    {enh.busy ? 'Working…' : 'Apply recolor'}
                  </button>
                  <p className="text-[10px] text-gray-400 leading-snug">AI changes only the selected colours — shape, background, and unselected colours stay the same. Always review before keeping.</p>
                </div>
              )}
            </div>
            {enh.error && <p className="text-xs text-red-500 mt-2">{enh.error}</p>}
            {enh.colorWarning && (
              <div className="flex items-start gap-2 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 leading-snug">
                  <span className="font-semibold">Possible colour change detected.</span>{' '}
                  Parts of the product that were coloured in the original appear white or transparent in the enhanced version
                  (e.g. a red body became white, or a blue crystal detail became clear).
                  This is a known AI limitation with certain product colours.
                  Check carefully — if colours are wrong, discard and try again or use the original.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <button type="button" disabled={enh.busy} onClick={() => runEnhance(enh.img, 'clean')} className="btn-secondary text-sm">Clean (white bg, faithful)</button>
              <button type="button" disabled={enh.busy} onClick={() => runEnhance(enh.img, 'enhance')} className="btn-secondary text-sm">Enhance (lighting + colour)</button>
              <div className="flex-1" />
              <button type="button" disabled={enh.busy} onClick={() => setEnh(null)} className="text-sm text-gray-500 hover:text-gray-800 px-2">Discard</button>
              <button type="button" disabled={enh.busy || !enh.after} onClick={keepEnhanced} className="btn-primary text-sm inline-flex items-center gap-1">
                <Check size={14} /> {enh.busy ? 'Saving…' : 'Keep & replace'}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">AI re-renders the image — check the shape and colours match the real product before keeping. The original isn’t changed until you Keep.</p>
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
