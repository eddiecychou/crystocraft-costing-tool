import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { useCustomerAssets, loadBrandedProductImages, uploadCustomerAsset, updateCustomerAsset, deleteCustomerAsset, cannotRenderAsImage, ASSET_UPLOAD_ACCEPT } from '../customerAssets'
import { loadProposal, saveProposal, publishProposal, unpublishProposal, loadProductImageChoices, CAPTION_MAX_LEN } from '../customerProposal'
import { normGallery, productStatusOf } from '../constants'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Plus, X, Presentation, Search, ImageOff, Upload, Download, FileJson, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { buildBrandProposalPdf } from '../brandProposalExport'

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

// Which specific photo to show for a corporate product (owner feedback,
// post-launch: the default was showing a generic shot instead of this
// customer's own branded photo, and some products have more than one
// branded photo to choose from). Only renders once there's an actual choice
// to make — a product with 0 or 1 storefront-safe photo has nothing to pick.
// Uses the SAME loader (loadProductImageChoices) resolveProductRefs uses at
// render time, so what the admin sees here is exactly what's selectable.
function ProductPhotoPicker({ productId, customerId, imageId, onPick }) {
  const [choices, setChoices] = useState(null)   // null = loading
  useEffect(() => {
    let alive = true
    loadProductImageChoices(productId, { customer_id: customerId }).then(imgs => { if (alive) setChoices(imgs) })
    return () => { alive = false }
  }, [productId, customerId])

  if (!choices || choices.length < 2) return null
  const brandedId = choices.find(im => im.branded_for_customer_id === customerId)?.id || null
  const activeId = imageId || brandedId

  return (
    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
      <span className="text-[10px] text-gray-400 mr-0.5">Photo:</span>
      {choices.map(im => (
        <button key={im.id} type="button" onClick={() => onPick(im.id)}
                title={im.branded_for_customer_id === customerId ? 'This customer’s branded photo' : ''}
                className={`w-7 h-7 rounded overflow-hidden border-2 shrink-0 ${activeId === im.id ? 'border-brand-500' : 'border-transparent hover:border-gray-200'}`}>
          <img src={im.file_url} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  )
}

function SortableSection({ section, index, assets, products, customerId, onChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section._key })
  const [pickingProducts, setPickingProducts] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const set = (k, v) => onChange({ ...section, [k]: v })
  const isAssetSelected = id => section.asset_ids.some(a => a.id === id)
  const toggleAsset = id => set('asset_ids',
    isAssetSelected(id) ? section.asset_ids.filter(a => a.id !== id) : [...section.asset_ids, { id, caption: '' }])
  const setAssetCaption = (id, caption) => set('asset_ids', section.asset_ids.map(a => a.id === id ? { ...a, caption } : a))

  const isProductSelected = p => section.product_refs.some(r => r.collection === p.collection && r.id === p.id)
  const toggleProduct = p => set('product_refs',
    isProductSelected(p)
      ? section.product_refs.filter(r => !(r.collection === p.collection && r.id === p.id))
      : [...section.product_refs, { collection: p.collection, id: p.id, caption: '' }])
  const setProductCaption = (p, caption) => set('product_refs',
    section.product_refs.map(r => (r.collection === p.collection && r.id === p.id) ? { ...r, caption } : r))
  const setProductImage = (p, image_id) => set('product_refs',
    section.product_refs.map(r => (r.collection === p.collection && r.id === p.id) ? { ...r, image_id } : r))

  const assetById = id => assets.find(a => a.id === id) || null
  const productName = ref => products.find(p => p.collection === ref.collection && p.id === ref.id)?.name || ref.id
  const productImage = ref => products.find(p => p.collection === ref.collection && p.id === ref.id)?.image || ''

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
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 mb-2">
          {assets.map(a => (
            <button key={a.id} type="button" onClick={() => toggleAsset(a.id)}
                    className={`aspect-square rounded overflow-hidden border-2 transition-colors ${isAssetSelected(a.id) ? 'border-brand-500' : 'border-transparent hover:border-gray-200'}`}>
              <AssetThumb asset={a} className="w-full h-full" />
            </button>
          ))}
          {assets.length === 0 && <p className="text-xs text-gray-400 col-span-full py-2">No assets on file for this customer yet.</p>}
        </div>
        {section.asset_ids.length > 0 && (
          <div className="space-y-2">
            {section.asset_ids.map(ref => (
              <div key={ref.id} className="flex items-start gap-2">
                <div className="w-9 h-9 rounded overflow-hidden shrink-0 border border-gray-100">
                  <AssetThumb asset={assetById(ref.id)} className="w-full h-full" />
                </div>
                <div className="flex-1">
                  <textarea className="input text-xs min-h-[44px] resize-y w-full" maxLength={CAPTION_MAX_LEN}
                            placeholder="Why this image fits (shown to the customer)"
                            value={ref.caption} onChange={e => setAssetCaption(ref.id, e.target.value)} />
                  <p className="text-[10px] text-gray-300 text-right mt-0.5">{ref.caption.length}/{CAPTION_MAX_LEN}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="label text-xs">Related products ({section.product_refs.length})</p>
          <button type="button" onClick={() => setPickingProducts(true)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
            <Plus size={12} /> Add
          </button>
        </div>
        {section.product_refs.length > 0 && (
          <div className="space-y-2">
            {section.product_refs.map(r => (
              <div key={`${r.collection}-${r.id}`} className="flex items-start gap-2">
                <div className="w-9 h-9 rounded bg-gray-100 shrink-0 overflow-hidden">
                  {productImage(r) && <img src={productImage(r)} alt="" className="w-full h-full object-cover" />}
                </div>
                <p className="text-xs text-gray-700 w-24 shrink-0 truncate mt-1.5" title={productName(r)}>{productName(r)}</p>
                <div className="flex-1">
                  <textarea className="input text-xs min-h-[44px] resize-y w-full" maxLength={CAPTION_MAX_LEN}
                            placeholder="Why this product fits / a short intro (shown to the customer)"
                            value={r.caption} onChange={e => setProductCaption(r, e.target.value)} />
                  <p className="text-[10px] text-gray-300 text-right mt-0.5">{r.caption.length}/{CAPTION_MAX_LEN}</p>
                  {r.collection === 'products' && (
                    <ProductPhotoPicker productId={r.id} customerId={customerId} imageId={r.image_id}
                                        onPick={id => setProductImage(r, id)} />
                  )}
                </div>
                <button type="button" onClick={() => toggleProduct(r)} className="text-gray-400 hover:text-red-500 shrink-0 mt-1.5"><X size={13} /></button>
              </div>
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

// Self-serve AI-mapping round trip (owner, post-launch: repeatedly asking
// Claude to write one-off scripts to export/validate/import Manus's output
// was slow and depended on Claude being available). "Export" hands Manus
// exactly the schema + content it needs; "Import" validates the result the
// same way the manual scripts did — ids resolve, active/non-retired, no
// duplicate refs — before ever touching Firestore, and always lands as a
// draft so nothing goes live unreviewed.
function ImportProposalModal({ customerId, currentStatus, onClose, onApplied }) {
  const [stage, setStage] = useState('pick')   // 'pick' | 'checking' | 'preview' | 'applying'
  const [parsed, setParsed] = useState(null)
  const [problems, setProblems] = useState([])
  const [fileError, setFileError] = useState('')
  const fileRef = useRef(null)

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    setStage('checking')
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      // exportForMapping() (this file's own "Export for AI mapping" button)
      // nests the actual proposal content under current_proposal — the
      // schema Manus is given to follow — but this parser was still reading
      // top-level json.sections/hero_asset_id/tagline/briefing, which is
      // NEVER populated by that export shape. Any correctly-exported file
      // silently showed 0 sections/0 product refs and "resolved cleanly"
      // (found live, 2026-08-21 — a real Sun Life v2 import with 46 mapped
      // products showed 0 of everything). Unwrap current_proposal when
      // present; fall back to the raw object for a flatter, older-style file.
      const json = raw.current_proposal && typeof raw.current_proposal === 'object' ? raw.current_proposal : raw
      const sections = Array.isArray(json.sections) ? json.sections : []

      const found = []
      const seen = new Set()
      for (const s of sections) {
        for (const r of (s.product_refs || [])) {
          const coll = r.collection === 'range_products' ? 'range_products' : 'products'
          const k = `${coll}:${r.id}`
          if (seen.has(k)) { found.push(`Duplicate reference: ${coll}/${r.id} (appears in more than one section)`); continue }
          seen.add(k)
          if ((r.caption || '').length > CAPTION_MAX_LEN) found.push(`${s.heading || '(untitled)'}: ${coll}/${r.id} caption is over ${CAPTION_MAX_LEN} characters — will be cut off`)
          const snap = await getDoc(doc(db, coll, r.id))
          if (!snap.exists()) { found.push(`${s.heading || '(untitled)'}: ${coll}/${r.id} does not exist`); continue }
          const p = snap.data()
          const retired = p.status === 'retired'
          if (p.active === false || retired) found.push(`${s.heading || '(untitled)'}: ${coll}/${r.id} (${p.name || p.design_name || ''}) is inactive/retired — will be dropped when shown to the customer`)
        }
      }
      setParsed(json)
      setProblems(found)
      setStage('preview')
    } catch (err) {
      setFileError(err.message?.includes('JSON') ? 'That file isn’t valid JSON.' : `Couldn't read the file: ${err.message || err}`)
      setStage('pick')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function apply() {
    setStage('applying')
    try {
      await saveProposal(customerId, {
        hero_asset_id: parsed.hero_asset_id || null,
        tagline: parsed.tagline || '',
        briefing: parsed.briefing || '',
        sections: parsed.sections || [],
      })
      // Never let an import silently go live — if this was already published,
      // move it back to draft so the new content gets reviewed first, same
      // posture as every manual import done before this tool existed.
      if (currentStatus === 'published') await unpublishProposal(customerId)
      onApplied()
    } finally {
      setStage('preview')
    }
  }

  const sectionCount = parsed?.sections?.length || 0
  const productRefCount = (parsed?.sections || []).reduce((n, s) => n + (s.product_refs?.length || 0), 0)
  const assetRefCount = (parsed?.sections || []).reduce((n, s) => n + (s.asset_ids?.length || 0), 0)
  const blocking = problems.filter(p => p.includes('does not exist') || p.startsWith('Duplicate'))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={stage === 'applying' ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5"><FileJson size={15} /> Import mapped JSON</h3>
          <button onClick={onClose} disabled={stage === 'applying'} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {stage === 'pick' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Pick the JSON file from Manus (or anyone following the schema). Every product/figurine reference is checked
                against the live catalogue before anything is saved — nothing is written yet.
              </p>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1">
                <Upload size={12} /> Choose file…
              </button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
              {fileError && <p className="text-xs text-red-600 mt-2">{fileError}</p>}
            </div>
          )}
          {stage === 'checking' && <p className="text-sm text-gray-400 text-center py-8">Checking every reference against the catalogue…</p>}
          {(stage === 'preview' || stage === 'applying') && parsed && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <span>{sectionCount} section{sectionCount === 1 ? '' : 's'}</span>
                <span>{productRefCount} product ref{productRefCount === 1 ? '' : 's'}</span>
                <span>{assetRefCount} image ref{assetRefCount === 1 ? '' : 's'}</span>
              </div>
              {problems.length === 0 ? (
                <p className="text-xs text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> Every reference resolved cleanly.</p>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800 font-medium mb-1.5 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> {problems.length} thing{problems.length === 1 ? '' : 's'} to check</p>
                  <ul className="text-[11px] text-amber-700 space-y-1 list-disc list-inside">
                    {problems.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
              {blocking.length > 0 && (
                <p className="text-[11px] text-red-600">Fix duplicates/missing references in the source file and re-import — those refs would be silently dropped otherwise.</p>
              )}
              <p className="text-[11px] text-gray-400">
                {currentStatus === 'published'
                  ? 'This proposal is currently published — importing will move it back to draft for review, not publish the new content automatically.'
                  : 'Will be saved as a draft — nothing changes for the customer until you publish.'}
              </p>
            </div>
          )}
        </div>

        {(stage === 'preview' || stage === 'applying') && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <button onClick={onClose} disabled={stage === 'applying'} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={apply} disabled={stage === 'applying' || blocking.length > 0} className="btn-primary text-xs py-1.5 px-3">
              {stage === 'applying' ? 'Applying…' : 'Apply as draft'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

let keySeq = 0
const withKey = s => ({ ...s, _key: s._key || `s${++keySeq}` })

export default function ProposalEditor({ customerId, customerName }) {
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
  const [uploadingHero, setUploadingHero] = useState(false)
  const heroFileRef = useRef(null)
  // Collapsible (owner, post-launch: Customer Detail had grown too many
  // always-expanded sections) — per customer, survives a reload within the
  // same visit via sessionStorage.
  const [collapsed, setCollapsed] = useState(() => {
    try { return sessionStorage.getItem(`cd-collapse:${customerId}:proposal`) === '1' } catch { return false }
  })
  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { sessionStorage.setItem(`cd-collapse:${customerId}:proposal`, next ? '1' : '0') } catch {}
      return next
    })
  }
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  // V8.10 — landscape Brand Proposal PDF preview, straight from the editor,
  // regardless of published/draft status (allowDraft:true) — so this can be
  // QA'd here rather than needing to log in as the customer, matching the
  // brief's "render every page and run a visual QA check before exporting".
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  async function handleDownloadPdfPreview() {
    setPdfBusy(true); setPdfError('')
    try {
      await buildBrandProposalPdf(customerId, { customer_id: customerId, name: customerName }, { allowDraft: true })
    } catch (e) {
      setPdfError(e.message || 'Could not build the PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function reloadProposal() {
    return loadProposal(customerId).then(p => {
      const base = p || { status: 'draft', hero_asset_id: null, tagline: '', briefing: '', sections: [] }
      setProposal({ ...base, sections: base.sections.map(withKey) })
    })
  }
  useEffect(() => { reloadProposal() }, [customerId])

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

  // "Export for AI mapping" — everything an external mapper (Manus, or
  // anyone else) needs to fill in sections against, in the shape
  // customerProposal.js's normSection already expects back. One card per
  // PRODUCT (branded photos grouped by product_id), same dedup as
  // BrandPortalPage's own gallery — an external mapper shouldn't have to
  // re-derive that grouping itself.
  //
  // corporate_gift_catalogue (V8.6) — added ON TOP of the original
  // branded_corporate_products/current_proposal shape, which stays exactly
  // as it was so nothing that already consumes this export breaks. Covers
  // the FULL products/ catalogue (every Corporate Gift product, not only
  // ones already photographed/branded for this customer), each cross-
  // referenced against the current proposal's product_refs and against the
  // SAME branded_for_customer_id signal loadBrandedProductImages already
  // uses — no new Firestore fields, no new schema, purely a read-side
  // extension of data that's already there. Kept deliberately close to the
  // real field names (marketing_description, pricing_tiers/price_hkd,
  // qty_per_product) rather than the richer structured shape (dimensions,
  // sustainability, unit_cost…) a generic catalogue export might imply —
  // this app doesn't store any of that, and a schema full of permanent
  // nulls would read as missing data rather than "doesn't exist here."
  async function exportForMapping() {
    setExporting(true)
    try {
      const raw = await loadBrandedProductImages(customerId)
      const byProduct = new Map()
      for (const img of raw) {
        if (!byProduct.has(img.product_id)) byProduct.set(img.product_id, { product_id: img.product_id, product_name: img.product_name || '', images: [] })
        byProduct.get(img.product_id).images.push({ id: img.id, file_url: img.file_url, caption: img.caption || '' })
      }
      await Promise.all([...byProduct.values()].map(async p => {
        const snap = await getDoc(doc(db, 'products', p.product_id))
        const d = snap.exists() ? snap.data() : {}
        p.status = d.status || ''
        p.active = d.active !== false
      }))
      const brandedProductIds = new Set(byProduct.keys())

      // product_refs already cited in the current proposal, for the
      // included_in_current_proposal / proposal_section cross-reference.
      const proposedRefs = new Map() // product_id -> section heading
      for (const s of proposal.sections) {
        for (const r of (s.product_refs || [])) {
          if (r.collection === 'products' && r.id && !proposedRefs.has(r.id)) proposedRefs.set(r.id, s.heading || '')
        }
      }

      const productsSnap = await getDocs(collection(db, 'products'))
      const catalogueProducts = await Promise.all(productsSnap.docs.map(async d => {
        const p = d.data()
        const [imagesSnap, tiersSnap] = await Promise.all([
          getDocs(query(collection(db, 'products', d.id, 'images'), orderBy('sort_order'))),
          getDocs(query(collection(db, 'products', d.id, 'pricing_tiers'), orderBy('quantity'))),
        ])
        const images = imagesSnap.docs.map(im => ({
          id: im.id, file_url: im.data().file_url || '', caption: im.data().caption || '',
          type: im.data().type || '', visibility: im.data().visibility || 'internal_only',
          branded_for_customer_id: im.data().branded_for_customer_id || null,
        }))
        const brandedImages = images.filter(im => im.branded_for_customer_id === customerId)
        const isBranded = brandedProductIds.has(d.id) || brandedImages.length > 0
        return {
          product_id: d.id,
          product_name: p.name || '',
          category: p.category || '',
          product_status: productStatusOf(p.status).value,
          active: p.active !== false,
          is_new: !!p.is_new,
          description: p.description || '',
          marketing_description: p.marketing_description || '',
          assembly_notes: p.assembly_notes || '',
          hero_image_url: p.heroImage || null,
          images,
          pricing_tiers: tiersSnap.docs.map(t => ({ quantity: t.data().quantity, price_hkd: t.data().price_hkd })),
          customer_branding: {
            customer_id: customerId,
            is_branded_for_customer: isBranded,
            branded_image_count: brandedImages.length,
          },
          mapping_status: isBranded ? 'already_branded' : 'not_yet_branded',
          proposal_usage: {
            included_in_current_proposal: proposedRefs.has(d.id),
            proposal_section: proposedRefs.get(d.id) || null,
          },
        }
      }))

      const brandedCount = catalogueProducts.filter(p => p.mapping_status === 'already_branded').length

      const payload = {
        schema_version: 2,
        customer_id: customerId,
        brand_gallery_assets: ownAssets.map(a => ({ id: a.id, category: a.category, type: a.type, title: a.title, filename: a.filename, file_url: a.file_url })),
        branded_corporate_products: [...byProduct.values()],
        current_proposal: {
          status: proposal.status,
          hero_asset_id: proposal.hero_asset_id,
          tagline: proposal.tagline,
          briefing: proposal.briefing,
          sections: proposal.sections.map(({ _key, ...s }) => s),
        },
        corporate_gift_catalogue: {
          total_count: catalogueProducts.length,
          branded_for_customer_count: brandedCount,
          not_branded_for_customer_count: catalogueProducts.length - brandedCount,
          products: catalogueProducts,
        },
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${customerId}-proposal-content.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  // Direct hero upload — separate from the Brand Gallery's own upload flow
  // because that one deliberately defaults every upload to internal_only
  // (an admin must open it up on purpose, spec posture). A hero uploaded
  // HERE only exists to go into the customer-facing proposal, so it's
  // opened to customer_private right after upload as the one deliberate
  // step, rather than leaving the admin to remember it in Brand Gallery.
  async function uploadHero(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingHero(true)
    try {
      const assetId = await uploadCustomerAsset(customerId, file, { category: 'product_gallery', type: 'photo', title: 'Proposal hero' })
      await updateCustomerAsset(customerId, assetId, { visibility: 'customer_private' })
      // A hero being REPLACED by a fresh upload leaves the old one behind
      // with no purpose — same "a hero photo that's not the hero of
      // anything else has no other use" reasoning removeHero() below
      // already applies, just triggered by an upload instead of a manual
      // clear. Left unhandled, the old hero silently reappeared as ordinary
      // leftover gallery content on the customer's own portal (found live,
      // 2026-08-22 — Sun Life's retired hero, still titled "Proposal hero",
      // showed up captioned as a regular product photo under "More
      // products for your brand"). Only a real uploaded asset, never a
      // `branded:` catalogue photo reference (nothing to delete there).
      const oldHero = heroAsset
      if (oldHero && oldHero.id !== assetId && !oldHero.id.startsWith('branded:')) {
        try { await deleteCustomerAsset(customerId, oldHero) } catch { /* best-effort — the new hero is already live either way */ }
      }
      set('hero_asset_id', assetId)
    } catch (err) {
      alert(`Upload failed: ${err.message || err}`)
    } finally {
      setUploadingHero(false)
      e.target.value = ''
    }
  }

  // Clears the hero picture — a branded catalogue photo (id prefixed
  // "branded:") isn't a real asset doc, just unpick it; an asset actually
  // uploaded through THIS editor (or Brand Gallery) can be deleted outright,
  // since a hero photo that's not the hero of anything else has no other use.
  async function removeHero() {
    if (!heroAsset) return
    const isCatalogPhoto = heroAsset.id.startsWith('branded:')
    if (!isCatalogPhoto && !confirm(`Delete "${heroAsset.title || heroAsset.filename}" from this customer's assets? This can't be undone.`)) return
    set('hero_asset_id', null)
    if (!isCatalogPhoto) {
      try { await deleteCustomerAsset(customerId, heroAsset) }
      catch (err) { alert(`Couldn't delete the file: ${err.message || err}`) }
    }
  }

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
      <div className="flex flex-col gap-3 mb-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onClick={toggleCollapsed} className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5 text-left">
            {collapsed ? <ChevronRight size={15} className="text-gray-400 shrink-0" /> : <ChevronDown size={15} className="text-gray-400 shrink-0" />}
            <Presentation size={15} className="text-brand-500" /> Proposal
          </button>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${proposal.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {proposal.status === 'published' ? 'Published — customer can see this' : 'Draft — admin preview only'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={handleDownloadPdfPreview} disabled={pdfBusy} title="Landscape client Brand Proposal PDF — works on a draft, for QA before publishing"
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-60">
            {pdfBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {pdfBusy ? 'Building…' : 'Download PDF preview'}
          </button>
          <button onClick={exportForMapping} disabled={exporting} title="Download the current content + catalogue as JSON, for an AI mapper (e.g. Manus) to fill in"
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 whitespace-nowrap">
            <Download size={12} /> {exporting ? 'Exporting…' : 'Export for AI mapping'}
          </button>
          {pdfError && <span className="text-[11px] text-red-600 whitespace-nowrap">{pdfError}</span>}
          <button onClick={() => setImporting(true)} title="Import a mapped JSON file back in, as a draft, after validating every reference"
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 whitespace-nowrap">
            <FileJson size={12} /> Import mapped JSON
          </button>
          <button onClick={save} disabled={saving} className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap">{saving ? 'Saving…' : 'Save draft'}</button>
          <button onClick={togglePublish} disabled={saving} className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap">
            {proposal.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>
      {savedAt && <p className="text-[11px] text-gray-400 mb-2">Saved {savedAt.toLocaleTimeString()}</p>}
      {importing && (
        <ImportProposalModal customerId={customerId} currentStatus={proposal.status}
                              onClose={() => setImporting(false)}
                              onApplied={async () => { await reloadProposal(); setImporting(false); setSavedAt(new Date()) }} />
      )}

      {!collapsed && <>
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
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => heroFileRef.current?.click()} disabled={uploadingHero}
                    className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1">
              <Upload size={12} /> {uploadingHero ? 'Uploading…' : 'Upload new hero image'}
            </button>
            <input ref={heroFileRef} type="file" accept={ASSET_UPLOAD_ACCEPT} className="hidden" onChange={uploadHero} />
            {heroAsset && (
              <button type="button" onClick={removeHero} title="Remove this hero image"
                      className="text-xs text-red-500 hover:text-red-700 inline-flex items-center gap-1">
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          {heroAsset && (
            <p className="text-[11px] text-gray-400 -mt-1">
              Stored under <strong>Product Gallery</strong> in this customer's Brand Gallery (Customer Detail page) — not Brand Assets.
            </p>
          )}
          <p className="text-[11px] text-gray-400 -mt-1">
            Recommended: a wide landscape photo, at least 2000×840px (roughly 2.4:1) — it fills the full-width banner and
            crops from the sides on ultra-wide screens, so keep the main subject centred. JPG or PNG.
          </p>
          <input className="input text-sm" placeholder="Tagline" value={proposal.tagline} onChange={e => set('tagline', e.target.value)} />
          <textarea className="input text-sm min-h-[70px]" placeholder="Briefing — brand direction" value={proposal.briefing} onChange={e => set('briefing', e.target.value)} />
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
                <SortableSection key={s._key} section={s} index={i} assets={assets} products={products} customerId={customerId}
                                  onChange={next => updateSection(s._key, next)} onRemove={() => removeSection(s._key)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      </>}
    </div>
  )
}
