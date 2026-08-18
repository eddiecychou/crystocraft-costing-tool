import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useCustomerAssets, loadBrandedProductImages, cannotRenderAsImage } from '../customerAssets'
import { loadProposal, saveProposal, publishProposal, unpublishProposal } from '../customerProposal'
import { normGallery } from '../constants'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Plus, X, Presentation, Search, ImageOff } from 'lucide-react'

// Admin editor for the customer proposal doc (Sun-Life-Proposal-Build-Spec.md
// §6). Writes go through src/customerProposal.js only — this component never
// touches Firestore directly, and never writes asset/product docs, only the
// proposal doc's references to them (spec §3.3 — no denormalised file_url).
//
// Minimal on purpose: hero picker + tagline/briefing + a reorderable list of
// sections, each with its own text, an asset multi-select and a product
// multi-select. No upload here — assets/products are curated elsewhere
// (CustomerBrandGallery, the product catalogue); this only references them.

function AssetThumb({ asset, className }) {
  if (!asset) return <div className={`${className} bg-gray-100 flex items-center justify-center`}><ImageOff size={16} className="text-gray-300" /></div>
  if (cannotRenderAsImage(asset.filename)) return <div className={`${className} bg-gray-400 flex items-center justify-center text-[9px] text-white/80`}>FILE</div>
  return <img src={asset.file_url} alt={asset.title || asset.filename} className={`${className} object-contain bg-gray-50`} />
}

function ProductPickerModal({ products, selected, onToggle, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
  const isSelected = p => selected.some(r => r.collection === p.collection && r.id === p.id)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[75vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Related products</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
                   className="input text-sm pl-7 w-full" />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No matching products.</p>
          ) : filtered.map(p => (
            <label key={`${p.collection}-${p.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={isSelected(p)} onChange={() => onToggle(p)}
                     className="w-4 h-4 rounded border-gray-300 text-brand-600" />
              <div className="w-9 h-9 rounded bg-gray-100 shrink-0 overflow-hidden">
                {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 truncate">{p.name}</p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${p.collection === 'range_products' ? 'bg-brand-50 text-brand-700' : 'bg-sapphire/10 text-sapphire'}`}>
                {p.collection === 'range_products' ? 'Figurine' : 'Corporate'}
              </span>
            </label>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-right">
          <button onClick={onClose} className="btn-primary text-xs py-1.5 px-3">Done</button>
        </div>
      </div>
    </div>
  )
}

function SortableSection({ section, index, assets, products, onChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section._key })
  const [pickingProducts, setPickingProducts] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const set = (k, v) => onChange({ ...section, [k]: v })
  const toggleAsset = id => set('asset_ids', section.asset_ids.includes(id) ? section.asset_ids.filter(a => a !== id) : [...section.asset_ids, id])
  const toggleProduct = p => set('product_refs',
    section.product_refs.some(r => r.collection === p.collection && r.id === p.id)
      ? section.product_refs.filter(r => !(r.collection === p.collection && r.id === p.id))
      : [...section.product_refs, { collection: p.collection, id: p.id }])

  const productName = ref => products.find(p => p.collection === ref.collection && p.id === ref.id)?.name || ref.id

  return (
    <div ref={setNodeRef} style={style} className="border border-gray-100 rounded-lg p-4 bg-white">
      <div className="flex items-start gap-2 mb-3">
        <button type="button" {...attributes} {...listeners} className="mt-1.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0" aria-label="Reorder">
          <GripVertical size={16} />
        </button>
        <div className="flex-1 space-y-2">
          <input className="input text-sm font-medium" placeholder="Section heading" value={section.heading} onChange={e => set('heading', e.target.value)} />
          <input className="input text-sm" placeholder="Section tagline" value={section.tagline} onChange={e => set('tagline', e.target.value)} />
          <textarea className="input text-sm min-h-[70px]" placeholder="Section briefing" value={section.briefing} onChange={e => set('briefing', e.target.value)} />
        </div>
        <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Remove section">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mb-3">
        <p className="label text-xs mb-1.5">Images ({section.asset_ids.length})</p>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
          {assets.map(a => (
            <button key={a.id} type="button" onClick={() => toggleAsset(a.id)}
                    className={`aspect-square rounded overflow-hidden border-2 transition-colors ${section.asset_ids.includes(a.id) ? 'border-brand-500' : 'border-transparent hover:border-gray-200'}`}>
              <AssetThumb asset={a} className="w-full h-full" />
            </button>
          ))}
          {assets.length === 0 && <p className="text-xs text-gray-400 col-span-full py-2">No assets on file for this customer yet.</p>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="label text-xs">Related products ({section.product_refs.length})</p>
          <button type="button" onClick={() => setPickingProducts(true)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
            <Plus size={12} /> Add
          </button>
        </div>
        {section.product_refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {section.product_refs.map(r => (
              <span key={`${r.collection}-${r.id}`} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full pl-2 pr-1 py-0.5">
                {productName(r)}
                <button type="button" onClick={() => toggleProduct(r)} className="text-gray-400 hover:text-red-500"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {pickingProducts && (
        <ProductPickerModal products={products} selected={section.product_refs} onToggle={toggleProduct} onClose={() => setPickingProducts(false)} />
      )}
    </div>
  )
}

let keySeq = 0
const withKey = s => ({ ...s, _key: s._key || `s${++keySeq}` })

export default function ProposalEditor({ customerId }) {
  const { assets: ownAssets } = useCustomerAssets(customerId)   // admin sees all, incl. internal — fine, hero/section pick doesn't imply publish
  const [brandedAssets, setBrandedAssets] = useState([])
  // Catalogue photos tagged "branded for" this customer (see customerAssets.js)
  // are a SEPARATE source from the uploaded assets above, but pickable the
  // same way — given a synthetic `branded:{imageId}` id so ProposalPage's
  // resolver (customerProposal.js) can tell the two apart at render time.
  useEffect(() => {
    let alive = true
    loadBrandedProductImages(customerId).then(imgs => {
      if (alive) setBrandedAssets(imgs.map(img => ({
        id: `branded:${img.id}`, file_url: img.file_url, filename: img.caption || img.product_name || 'photo.jpg',
        title: img.caption || img.product_name || 'Product photo',
      })))
    })
    return () => { alive = false }
  }, [customerId])
  const assets = useMemo(() => [...ownAssets, ...brandedAssets], [ownAssets, brandedAssets])
  const [products, setProducts] = useState([])
  const [proposal, setProposal] = useState(null)   // null = loading
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    let alive = true
    loadProposal(customerId).then(p => {
      if (!alive) return
      const base = p || { status: 'draft', hero_asset_id: null, tagline: '', briefing: '', sections: [], cta_label: 'Make an enquiry' }
      setProposal({ ...base, sections: base.sections.map(withKey) })
    })
    return () => { alive = false }
  }, [customerId])

  useEffect(() => {
    Promise.all([getDocs(collection(db, 'range_products')), getDocs(collection(db, 'products'))]).then(([rangeSnap, corpSnap]) => {
      const range = rangeSnap.docs.map(d => {
        const p = d.data()
        return { collection: 'range_products', id: d.id, name: p.design_name || p.description || p.design_code || d.id, image: normGallery(p.gallery)[0]?.url || '' }
      })
      const corp = corpSnap.docs.map(d => {
        const p = d.data()
        return { collection: 'products', id: d.id, name: p.name || d.id, image: p.heroImage || '' }
      })
      setProducts([...range, ...corp])
    })
  }, [])

  const heroAsset = useMemo(() => assets.find(a => a.id === proposal?.hero_asset_id) || null, [assets, proposal])

  function set(k, v) { setProposal(p => ({ ...p, [k]: v })) }
  function addSection() { setProposal(p => ({ ...p, sections: [...p.sections, withKey({ heading: '', tagline: '', briefing: '', asset_ids: [], product_refs: [] })] })) }
  function updateSection(key, next) { setProposal(p => ({ ...p, sections: p.sections.map(s => s._key === key ? next : s) })) }
  function removeSection(key) { setProposal(p => ({ ...p, sections: p.sections.filter(s => s._key !== key) })) }

  function onDragEnd(e) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setProposal(p => {
      const oldIndex = p.sections.findIndex(s => s._key === active.id)
      const newIndex = p.sections.findIndex(s => s._key === over.id)
      return { ...p, sections: arrayMove(p.sections, oldIndex, newIndex) }
    })
  }

  async function save() {
    setSaving(true)
    try {
      await saveProposal(customerId, {
        hero_asset_id: proposal.hero_asset_id,
        tagline: proposal.tagline,
        briefing: proposal.briefing,
        cta_label: proposal.cta_label,
        sections: proposal.sections.map(({ _key, ...s }) => s),
      })
      setSavedAt(new Date())
    } finally { setSaving(false) }
  }

  async function togglePublish() {
    setSaving(true)
    try {
      await save()
      if (proposal.status === 'published') { await unpublishProposal(customerId); set('status', 'draft') }
      else { await publishProposal(customerId); set('status', 'published') }
    } finally { setSaving(false) }
  }

  if (!proposal) return null

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
          <Presentation size={15} className="text-brand-500" /> Proposal
        </h2>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${proposal.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {proposal.status === 'published' ? 'Published — customer can see this' : 'Draft — admin preview only'}
          </span>
          <button onClick={save} disabled={saving} className="btn-secondary text-xs py-1.5 px-3">{saving ? 'Saving…' : 'Save draft'}</button>
          <button onClick={togglePublish} disabled={saving} className="btn-primary text-xs py-1.5 px-3">
            {proposal.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>
      {savedAt && <p className="text-[11px] text-gray-400 mb-2">Saved {savedAt.toLocaleTimeString()}</p>}

      <div className="grid sm:grid-cols-[140px_1fr] gap-3 my-4">
        <div>
          <p className="label text-xs mb-1.5">Hero image</p>
          <div className="w-full aspect-video rounded-lg overflow-hidden border border-gray-100">
            <AssetThumb asset={heroAsset} className="w-full h-full" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <select className="input text-sm" value={proposal.hero_asset_id || ''} onChange={e => set('hero_asset_id', e.target.value || null)}>
            <option value="">No hero image</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.title || a.filename}</option>)}
          </select>
          <input className="input text-sm" placeholder="Tagline" value={proposal.tagline} onChange={e => set('tagline', e.target.value)} />
          <textarea className="input text-sm min-h-[70px]" placeholder="Briefing — brand direction" value={proposal.briefing} onChange={e => set('briefing', e.target.value)} />
          <input className="input text-sm" placeholder="Enquiry button label" value={proposal.cta_label} onChange={e => set('cta_label', e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="label text-xs">Sections ({proposal.sections.length})</p>
        <button type="button" onClick={addSection} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          <Plus size={12} /> Add section
        </button>
      </div>

      {proposal.sections.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No sections yet — add one to start building the proposal.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={proposal.sections.map(s => s._key)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {proposal.sections.map((s, i) => (
                <SortableSection key={s._key} section={s} index={i} assets={assets} products={products}
                                  onChange={next => updateSection(s._key, next)} onRemove={() => removeSection(s._key)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
