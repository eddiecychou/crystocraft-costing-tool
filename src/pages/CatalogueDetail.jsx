import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, updateDoc, collection, onSnapshot,
  query, orderBy, addDoc, deleteDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import { Star, X, Camera } from 'lucide-react'
import { loadBlogProducts, loadBlogImages, PRODUCT_SOURCES } from '../productSource'
import { MARKETING_DESC_MAXLEN } from '../constants'

// ── Auto layout label ─────────────────────────────────────────────────────────
function layoutLabel(count) {
  if (count === 0) return { text: 'No images', style: 'bg-ivory-dark text-ink-60' }
  if (count >= 5)  return { text: `Full page · ${count} images`, style: 'bg-brand-50 text-brand-600' }
  if (count <= 3)  return { text: `Quarter page · ${count} image${count > 1 ? 's' : ''}`, style: 'bg-purple-50 text-purple-600' }
  return { text: `Half page · ${count} images`, style: 'bg-amber-50 text-amber-600' }
}

// ── Single draggable image in the selected strip ──────────────────────────────
function SortableImage({ id, url, isHero, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="relative w-16 h-16 shrink-0 group/img">
      {isHero && (
        <div className="absolute top-0.5 left-0.5 z-10 bg-amber-400 text-white px-1 py-0.5 rounded-none leading-none pointer-events-none">
          <Star size={10} className="fill-current" />
        </div>
      )}
      <img
        src={url}
        className="w-full h-full rounded-none object-cover cursor-grab active:cursor-grabbing select-none"
        draggable={false}
        {...attributes}
        {...listeners}
      />
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 bg-white/90 hover:bg-white rounded-none text-red-400 leading-none p-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity"
      ><X size={12} /></button>
    </div>
  )
}

// ── Image sequencer — drag to reorder selected, click to add/remove ───────────
function ImageSequencer({ itemId, selectedImages, allImages, onUpdate }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const unselected = allImages.filter(url => !selectedImages.includes(url))
  const { text: layoutText, style: layoutStyle } = layoutLabel(selectedImages.length)

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = selectedImages.indexOf(active.id)
    const newIdx = selectedImages.indexOf(over.id)
    onUpdate(itemId, { selected_images: arrayMove(selectedImages, oldIdx, newIdx) })
  }

  return (
    <div className="space-y-2">
      {/* Layout badge */}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${layoutStyle}`}>{layoutText}</span>
        {selectedImages.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-ink-60"><Star size={11} className="fill-current text-amber-400" />first image is hero · drag to reorder</span>
        )}
      </div>

      {/* Selected images — sortable strip */}
      {selectedImages.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={selectedImages} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-2 flex-wrap">
              {selectedImages.map((url, idx) => (
                <SortableImage
                  key={url}
                  id={url}
                  url={url}
                  isHero={idx === 0}
                  onRemove={() => {
                    const next = selectedImages.filter(u => u !== url)
                    onUpdate(itemId, { selected_images: next })
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Unselected images — click to add (max 6) */}
      {unselected.length > 0 && selectedImages.length < 6 && (
        <div>
          <p className="text-xs text-ink-60 mb-1.5">
            {selectedImages.length === 0 ? 'Select images to include:' : `Add more (${6 - selectedImages.length} remaining):`}
          </p>
          <div className="flex gap-2 flex-wrap">
            {unselected.map(url => (
              <button
                key={url}
                onClick={() => onUpdate(itemId, { selected_images: [...selectedImages, url] })}
                className="relative w-16 h-16 rounded-none border-2 border-dashed border-warm-grey hover:border-brand-300 overflow-hidden group/add transition-colors"
              >
                <img src={url} alt="" className="w-full h-full object-cover opacity-40 group-hover/add:opacity-60 transition-opacity" />
                <span className="absolute inset-0 flex items-center justify-center text-ink-60 group-hover/add:text-brand-500 text-xl font-light">+</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {selectedImages.length >= 6 && (
        <p className="text-xs text-amber-500">Maximum 6 images reached.</p>
      )}

      {allImages.length === 0 && (
        <p className="text-xs text-platinum italic">No images uploaded for this product yet.</p>
      )}
    </div>
  )
}

// ── Sortable catalogue item row ───────────────────────────────────────────────
function CatalogueItem({ item, onUpdate, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const allImages = [item.hero_image, ...(item.product_images || [])].filter(Boolean)
  const selectedImages = item.selected_images || (item.hero_image ? [item.hero_image] : [])

  return (
    <div ref={setNodeRef} style={style} className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button {...attributes} {...listeners} className="mt-1 text-platinum hover:text-ink-60 cursor-grab active:cursor-grabbing shrink-0">
          ⠿
        </button>

        {/* Hero image preview */}
        <div className="w-16 h-16 rounded-none bg-ivory-dark shrink-0 overflow-hidden">
          {selectedImages[0]
            ? <img src={selectedImages[0]} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-platinum"><Camera size={24} /></div>
          }
        </div>

        {/* Product info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink text-sm truncate">{item.product_name}</p>
          <p className="text-xs text-ink-60">{item.product_category}</p>
        </div>

        {/* Delete */}
        <button onClick={() => onDelete(item.id)} className="text-platinum hover:text-red-400 shrink-0"><X size={15} /></button>
      </div>

      {/* Image sequencer */}
      <ImageSequencer
        itemId={item.id}
        selectedImages={selectedImages}
        allImages={allImages}
        onUpdate={onUpdate}
      />

      {/* Marketing description */}
      <div>
        <label className="text-xs text-ink-60 block mb-1">Marketing Description</label>
        <textarea
          className="input text-sm resize-none"
          rows={2}
          maxLength={MARKETING_DESC_MAXLEN}
          defaultValue={item.marketing_description || item.product_marketing_description || ''}
          key={`md-${item.id}`}
          placeholder="Evocative sell-copy for this product in the catalogue…"
          onBlur={e => {
            if (e.target.value !== (item.marketing_description || '')) {
              onUpdate(item.id, { marketing_description: e.target.value })
            }
          }}
        />
      </div>
    </div>
  )
}

// ── Product picker modal ──────────────────────────────────────────────────────
function ProductPicker({ existingIds, onAdd, onClose }) {
  const [products, setProducts] = useState([])
  const [search, setSearch]     = useState('')
  const [source, setSource]     = useState('corporate')

  useEffect(() => {
    let active = true
    setProducts([])
    loadBlogProducts(source).then(list => { if (active) setProducts(list) })
    return () => { active = false }
  }, [source])

  const filtered = products.filter(p =>
    !existingIds.includes(p.id) &&
    (p.name?.toLowerCase().includes(search.toLowerCase()) ||
     p.category?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-none shadow-xl w-full max-w-md flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-warm-grey">
          <h3 className=" text-ink">Add Product to Catalogue</h3>
          <div className="flex gap-1 mt-2 p-0.5 bg-ivory-dark rounded-none">
            {PRODUCT_SOURCES.map(s => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                className={`flex-1 text-xs py-1.5 rounded-none transition-colors ${
 source === s.value ? 'bg-white text-ink font-medium shadow-sm' : 'text-ink-60 hover:text-ink-80'
                }`}
              >{s.label}</button>
            ))}
          </div>
          <input
            className="input mt-2 text-sm"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.length === 0 && (
            <p className="text-sm text-ink-60 text-center py-8">No products found</p>
          )}
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => { onAdd(p); onClose() }}
              className="w-full flex items-center gap-3 p-3 rounded-none hover:bg-ivory text-left"
            >
              <div className="w-10 h-10 rounded-none bg-ivory-dark shrink-0 overflow-hidden">
                {p.heroImage
                  ? <img src={p.heroImage} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-platinum"><Camera size={20} /></div>
                }
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{p.name}</p>
                <p className="text-xs text-ink-60">{p.category}</p>
              </div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-warm-grey">
          <button className="btn-secondary w-full text-center" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CatalogueDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [catalogue, setCatalogue]     = useState(null)
  const [items, setItems]             = useState([])
  const [showPicker, setShowPicker]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    getDoc(doc(db, 'catalogues', id))
      .then(snap => { if (snap.exists()) setCatalogue({ id: snap.id, ...snap.data() }) })
      .catch(err => console.error('Catalogue load error:', err))
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'catalogues', id, 'items'), orderBy('sort_order'))
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
    })
  }, [id])

  async function handleAddProduct(product) {
    const source = product.source || 'corporate'
    // Corporate images live in a sub-collection; range images are already on the
    // normalized object. loadBlogImages handles both and returns {file_url,...}.
    const imgs = await loadBlogImages(source, product)
    const productImages = imgs.map(i => i.file_url).filter(Boolean)
    const heroImage = product.heroImage || productImages[0] || null

    await addDoc(collection(db, 'catalogues', id, 'items'), {
      product_id:                     product.id,
      product_source:                 source,
      product_name:                   product.name,
      product_category:               product.category,
      product_marketing_description:  product.marketing_description || '',
      product_description:            product.description || '',
      hero_image:                     heroImage,
      product_images:                 productImages.filter(u => u !== heroImage),
      selected_images:                heroImage ? [heroImage] : [],
      marketing_description:          product.marketing_description || '',
      sort_order:                     items.length,
      createdAt:                      serverTimestamp(),
    })
  }

  async function handleUpdate(itemId, changes) {
    await updateDoc(doc(db, 'catalogues', id, 'items', itemId), changes)
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, ...changes } : it))
  }

  async function handleDelete(itemId) {
    await deleteDoc(doc(db, 'catalogues', id, 'items', itemId))
    setConfirmDelete(null)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = items.findIndex(i => i.id === active.id)
    const newIdx = items.findIndex(i => i.id === over.id)
    const reordered = arrayMove(items, oldIdx, newIdx)
    setItems(reordered)
    await Promise.all(reordered.map((item, idx) =>
      updateDoc(doc(db, 'catalogues', id, 'items', item.id), { sort_order: idx })
    ))
  }

  if (!catalogue) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <Link to="/catalogues" className="text-sm text-brand-600 hover:underline">← Catalogues</Link>
          <h1 className="text-xl text-ink mt-1">{catalogue.name}</h1>
          {catalogue.season && <p className="text-xs text-ink-60">{catalogue.season}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to={`/catalogues/${id}/edit`} className="btn-secondary text-sm">Edit Info</Link>
          <Link to={`/catalogues/${id}/preview`} className="btn-primary text-sm">Preview & Print</Link>
        </div>
      </div>

      <p className="text-xs text-ink-60 mb-5">
        Add products, select and reorder images (first = hero), write marketing copy.
        Layout (half/full page) is set automatically by image count. Drag items to reorder.
      </p>

      {/* Items */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {items.map(item => (
              <CatalogueItem
                key={item.id}
                item={item}
                onUpdate={handleUpdate}
                onDelete={(itemId) => setConfirmDelete(itemId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <div className="card p-10 text-center text-ink-60 text-sm">
          No products yet — add some below.
        </div>
      )}

      <button
        onClick={() => setShowPicker(true)}
        className="btn-secondary w-full mt-4 text-center"
      >
        + Add Product
      </button>

      {/* Page slot summary */}
      {items.length > 0 && (() => {
        const imageCount = item => (item.selected_images?.length || (item.hero_image ? 1 : 0))
        const quarterItems = items.filter(i => imageCount(i) <= 3).length
        const halfItems    = items.filter(i => imageCount(i) === 4).length
        const fullItems    = items.filter(i => imageCount(i) >= 5).length

        const quarterPages      = Math.ceil(quarterItems / 4)
        const quarterBlanks     = quarterItems === 0 ? 0 : (4 - (quarterItems % 4)) % 4
        const halfPages         = Math.ceil(halfItems / 2)
        const halfBlanks        = halfItems % 2
        const totalPages        = quarterPages + halfPages + fullItems

        return (
          <div className="mt-4 card p-4 space-y-2">
            <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Page Summary</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {quarterItems > 0 && (
                <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-600">
                  {quarterPages} quarter-page{quarterPages > 1 ? 's' : ''} · {quarterItems} product{quarterItems > 1 ? 's' : ''}
                  {quarterBlanks > 0 && <span className="ml-1 text-purple-400">({quarterBlanks} blank slot{quarterBlanks > 1 ? 's' : ''})</span>}
                </span>
              )}
              {halfItems > 0 && (
                <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-600">
                  {halfPages} half-page{halfPages > 1 ? 's' : ''} · {halfItems} product{halfItems > 1 ? 's' : ''}
                  {halfBlanks > 0 && <span className="ml-1 text-amber-400">(1 blank slot)</span>}
                </span>
              )}
              {fullItems > 0 && (
                <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-600">
                  {fullItems} full-page{fullItems > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-ink-60">
              {totalPages + 1} pages total (including cover)
              {(quarterBlanks > 0 || halfBlanks > 0) && (
                <span className="text-amber-500 ml-2">
                  · {quarterBlanks + halfBlanks} blank slot{(quarterBlanks + halfBlanks) > 1 ? 's' : ''} — add products or adjust images to fill
                </span>
              )}
            </p>
          </div>
        )
      })()}

      {showPicker && (
        <ProductPicker
          existingIds={items.map(i => i.product_id)}
          onAdd={handleAddProduct}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove Product"
          message="Remove this product from the catalogue?"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
