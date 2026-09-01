import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, auth, authHeader } from '../firebase'
import { useRole } from '../access'
import {
  RANGE_DESIGN_TYPES, RANGE_PRODUCT_TYPES, RANGE_FORMAT_CODES,
  RANGE_PLATINGS, RANGE_CRYSTAL_COLORS, RANGE_STATUSES, RANGE_CRYSTAL_BRANDS,
  RANGE_BODY_TYPES, designNumber, brandLetter, bodyLetter,
  normGallery, normVideos, MARKETING_DESC_MAXLEN,
} from '../constants'
import { resizeToJpeg } from '../imageResize'
import { enhanceProductImage } from '../enhanceImage'
import ManualAdjust from '../components/ManualAdjust'
import VideoUrlsEditor from '../components/VideoUrlsEditor'
import CrystalBomEditor from '../components/CrystalBomEditor'

const BODY_NAME = Object.fromEntries(RANGE_BODY_TYPES.map(b => [b.code, b.name]))

// Stable ephemeral id for critical-component form rows (React key + mutation
// target). Form-only — never persisted.
const refUid = () => 'r' + Math.random().toString(36).slice(2, 10)

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))
import LoadingBar from '../components/LoadingBar'
import { useCrystalColors, colorMap, ensureColors } from '../crystalColors'
import { generateColourPreview, useColourPreviews, setReviewStatus, deletePreview, uploadColourPreview, pickGalleryColourPreview, markUsable, promoteColourImage } from '../colourPreviewApi'
import { buildRangeSku, rangePrice } from '../rangeSku'
import { useComponents, resolveRef, productAvailability } from '../criticalComponents'
import { useCrystals } from '../crystals'
import { normaliseCrystalBom, emptyCrystalBom } from '../crystalBom'
import { useProductDefaults } from '../useProductDefaults'
import { Puzzle, Gem, Check, Download, Plus, X, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react'

// Detect whether the AI has bleached product colours (see ImageGallery.jsx for
// the same function used in the corp-gift flow).
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
      const wasColoured = !(or > 225 && og > 225 && ob > 225) && !(or < 35 && og < 35 && ob < 35)
      if (wasColoured) { coloured++; if (er > 225 && eg > 225 && eb > 225) lost++ }
    }
    return coloured > 0 && (lost / coloured) > 0.04
  } catch { return false }
}

// A "mix" code is an assorted/multi-crystal bucket (MX, M1–M9, AX, A1–A9,
// GX, G1–G9). These live in the Crystal Colour Library like any other code so
// they can be ticked per variation; the per-product recipe (which crystals each
// contains) is defined in the Crystal Mixtures editor.
const isMixCode = code => /^(MX|AX|GX|[MAG][1-9])$/.test((code || '').trim().toUpperCase())


const emptyVariant = () => ({
  brand_code: 'D', brand_name: 'Bohemia',
  plating_code: '', plating_name: '', crystal_code: '', crystal_name: '', description: '',
  running_no: '', ws_price_usd: '', stock_finished: '', packaging: '', engraving: '', image: '',
  crystal_colors: [],   // selectable colour attribute, per variation (plating)
  colour_images: {},    // { crystalCode: url } — "usable" tier, NOT gallery[] (V8.8 Phase 2)
})

// Auto description = brand + plating + crystal colour (falls back to raw codes)
const autoVariantDesc = v =>
  [v.brand_name || '', v.plating_name || v.plating_code, v.crystal_name || v.crystal_code]
    .filter(Boolean).join(', ')
const emptyPacking = () => ({
  carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
  cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
})
const blankForm = (prefill = {}) => {
  const variant = emptyVariant()
  if (prefill.brand_code) {
    variant.brand_code = prefill.brand_code.toUpperCase()
    variant.brand_name = BRAND_NAME[variant.brand_code] || variant.brand_name
  }
  return {
    design_no: prefill.design_no || '', body_code: '', design_name: '',
    description: prefill.description || '', marketing_description: '', category: '',
    design_type: '', product_type: 'Figurine', format_code: prefill.format_code || '001',
    size: '', crystal_type: 'Bohemia', active: true, status: 'active', is_new: false,
    moq: '', lead_time_weeks: '', delivery_note: '', critical_components: [],
    packing: emptyPacking(), gallery: [], variants: [variant], plating_stock: {},
    crystal_components: emptyCrystalBom(), videos: [],
  }
}


// V8.8 Phase 1 — one-SKU AI colour-preview experiment for a single variation.
// A separate component (not inlined in the variants .map) so useColourPreviews
// keeps a stable hook order across variant add/remove. See Range_Colour_Preview_Spec.md.
function VariantColourPreview({ docId, index, variant, libColors, onPromote, onAddToGallery, galleryUrls, gallery }) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [zoomUrl, setZoomUrl] = useState(null)
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false)
  const previews = useColourPreviews(docId, index)
  const image = variant.image
  const targetInfo = libColors.find(c => c.code === target)

  async function runGenerate(code) {
    const info = libColors.find(c => c.code === code)
    setBusy(true); setError('')
    try {
      await generateColourPreview({
        docId, variantIndex: index, sourceImageUrl: image,
        sourcePlatingCode: variant.plating_code, sourceCrystalCode: variant.crystal_code,
        sourceCrystalName: variant.crystal_name,
        targetCrystalCode: code, targetCrystalName: info?.name || code,
        targetSwatchHex: info?.swatch, createdBy: auth.currentUser?.email || '',
      })
    } catch (err) {
      setError(err.message || 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(e, code) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !code || busy) return
    setBusy(true); setError('')
    try {
      await uploadColourPreview({
        docId, variantIndex: index, sourcePlatingCode: variant.plating_code,
        targetCrystalCode: code, file, createdBy: auth.currentUser?.email || '',
      })
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onPickGallery(code, url) {
    setGalleryPickerOpen(false)
    if (!code || !url || busy) return
    setBusy(true); setError('')
    try {
      await pickGalleryColourPreview({
        docId, variantIndex: index, sourcePlatingCode: variant.plating_code,
        targetCrystalCode: code, galleryUrl: url, createdBy: auth.currentUser?.email || '',
      })
    } catch (err) {
      setError(err.message || 'Could not use that gallery photo.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(p) {
    // A 'superseded' preview's file may still be referenced by line_image on
    // an already-created invoice/PI/quote — that field is a frozen URL
    // snapshot, not a live reference, so deleting the file here would leave
    // a broken image on any document that already picked it. 'used' previews
    // can't reach this point at all (deletePreview refuses them).
    const msg = p.reviewStatus === 'superseded'
      ? `Remove this ${p.targetCrystalCode} preview? This was replaced by a newer "Usable" photo, but if any existing invoice, PI, or quote already picked THIS one, its image will break there. This can't be undone.`
      : `Remove this ${p.targetCrystalCode} preview? This can't be undone.`
    if (!confirm(msg)) return
    try { await deletePreview(p) } catch (err) { setError(err.message || 'Remove failed.') }
  }

  async function onMarkUsable(p) {
    setBusy(true); setError('')
    try {
      const url = await markUsable(p)
      // Write straight to Firestore (bug fixed 2026-08-23) — onPromote below
      // only patches the local form, same as every other image edit on this
      // page, which is fine for fields that belong in the Save Changes
      // review gate. colour_images doesn't: it silently did nothing durable
      // if the admin approved a colour here and then navigated away without
      // separately remembering to click Save Changes for the whole form —
      // found live when AB/GT showed "Usable" in the UI but colour_images
      // was empty in the actual saved document.
      await promoteColourImage(docId, index, p.targetCrystalCode, url)
      onPromote(p.targetCrystalCode, url)
    } catch (err) {
      setError(err.message || 'Could not mark usable.')
    } finally {
      setBusy(false)
    }
  }

  const badge = {
    draft: 'bg-amber-50 text-amber-700 border-amber-300',
    approved: 'bg-green-50 text-green-700 border-green-300',
    rejected: 'bg-red-50 text-red-700 border-red-300',
    used: 'bg-blue-50 text-blue-700 border-blue-300',
    superseded: 'bg-ink-60/10 text-ink-60 border-ivory-dark',
  }
  const badgeLabel = {
    draft: 'Draft — not visible',
    used: 'Usable (invoice/quote/PI + portal)',
    superseded: 'Superseded — replaced by a newer usable photo',
  }

  return (
    <div className="border-t border-ivory-dark pt-2 mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-2xs uppercase tracking-wide text-ink-60">Colour preview (experiment)</label>
      </div>
      {!image ? (
        <p className="text-2xs text-ink-60">Add an image to this variation first.</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-xs py-1 flex-1 min-w-[9rem]" value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">Target crystal colour…</option>
            {libColors.map(c => <option key={c.code} value={c.code}>{c.name || c.code} ({c.code})</option>)}
          </select>
          <button type="button" onClick={() => runGenerate(target)} disabled={!target || busy}
                  className="btn-secondary text-xs py-1 px-2 shrink-0 disabled:opacity-40 inline-flex items-center gap-1">
            <Sparkles size={12} /> {busy ? 'Working…' : 'Generate (AI)'}
          </button>
          <label className={`btn-secondary text-xs py-1 px-2 shrink-0 inline-flex items-center gap-1 cursor-pointer ${!target || busy ? 'opacity-40 pointer-events-none' : ''}`}>
            <Plus size={12} /> Upload photo
            <input type="file" accept="image/*" className="hidden" disabled={!target || busy}
                   onChange={e => onUpload(e, target)} />
          </label>
          <div className="relative">
            <button type="button" onClick={() => setGalleryPickerOpen(o => !o)} disabled={!target || busy || !gallery?.length}
                    className="btn-secondary text-xs py-1 px-2 shrink-0 disabled:opacity-40">
              From gallery…
            </button>
            {galleryPickerOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setGalleryPickerOpen(false)} />
                <div className="absolute z-40 top-8 left-0 w-56 bg-white border border-ivory-dark rounded-none shadow-lg p-2 space-y-1">
                  <p className="text-2xs text-ink-60 mb-1">Use an existing gallery photo</p>
                  <div className="grid grid-cols-4 gap-1">
                    {(gallery || []).map((g, gi) => g.url && (
                      <button key={gi} type="button" onClick={() => onPickGallery(target, g.url)}
                              className="relative aspect-square bg-white border border-ivory-dark rounded-none overflow-hidden hover:border-brand-400"
                              title={g.caption || 'Use this image'}>
                        <img src={g.url} alt="" className="w-full h-full object-contain p-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <p className="text-2xs text-ink-60 mt-1">
        For a mixture recipe or a colour you already have a real photo of, use “Upload photo” or “From gallery” instead of AI — both skip generation entirely.
      </p>
      {error && <p className="text-2xs text-red-600 mt-1">{error}</p>}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {previews.map(p => (
            <div key={p.id} className="w-20">
              <div className="w-20 h-20 bg-white border border-ivory-dark flex items-center justify-center overflow-hidden">
                {p.status === 'generating' && <span className="text-2xs text-ink-60">…</span>}
                {p.status === 'failed' && <AlertTriangle size={16} className="text-red-500" />}
                {p.status === 'success' && p.generatedImageUrl && (
                  <img src={p.generatedImageUrl} alt="" onClick={() => setZoomUrl(p.generatedImageUrl)}
                       className="w-full h-full object-contain p-1 cursor-zoom-in" title="Click to enlarge" />
                )}
              </div>
              <p className="text-2xs font-mono text-ink-70 mt-0.5 truncate" title={p.targetCrystalCode}>
                {p.targetCrystalCode}{p.source === 'upload' ? ' ·  uploaded' : p.source === 'gallery' ? ' · from gallery' : ''}
              </p>
              <span className={`inline-block text-2xs px-1.5 py-0.5 rounded-full border ${badge[p.reviewStatus] || badge.draft}`}>
                {badgeLabel[p.reviewStatus] || p.reviewStatus}
              </span>
              {p.status === 'failed' && p.errorMessage && (
                <p className="text-2xs text-red-600 mt-0.5">{p.errorMessage}</p>
              )}
              <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                {p.status === 'success' && p.reviewStatus === 'draft' && (
                  <>
                    <button type="button" onClick={() => onMarkUsable(p)} disabled={busy}
                            className="text-2xs text-green-700 hover:underline disabled:opacity-40">Approve → usable</button>
                    <button type="button" onClick={() => setReviewStatus(p.id, 'rejected')} className="text-2xs text-red-600 hover:underline">Reject</button>
                  </>
                )}
                {/* Legacy: previews approved before this was one step still need this. */}
                {p.status === 'success' && p.reviewStatus === 'approved' && (
                  <button type="button" onClick={() => onMarkUsable(p)} disabled={busy}
                          className="text-2xs text-blue-700 hover:underline disabled:opacity-40">Mark usable →</button>
                )}
                {/* p.source is undefined on previews generated before this
                    field existed (first-ever test doc) — treat missing as
                    legacy-AI rather than hiding Regenerate for them. */}
                {p.source !== 'upload' && p.source !== 'gallery' && (
                  <button type="button" onClick={() => runGenerate(p.targetCrystalCode)} disabled={busy}
                          className="text-2xs text-brand-600 hover:underline disabled:opacity-40">Regenerate</button>
                )}
                {p.status === 'success' && p.generatedImageUrl && (
                  <button type="button"
                          onClick={() => downloadRangeImage(p.generatedImageUrl, `${variant.plating_code || ''}${p.targetCrystalCode}-retouch`)}
                          title="Download to retouch, then Upload the corrected version for this colour"
                          className="text-2xs text-ink-60 hover:underline">Download</button>
                )}
                {/* Gallery is the highest-quality-bar tier (§P2.1) — only ever
                    offered from an already-usable photo, one deliberate click
                    at a time, never automatic. Same optimistic local-state +
                    Save Changes gate every other gallery edit on this page
                    already uses — unlike colour_images, nothing else writes
                    to gallery[] from outside this form, so that pattern is
                    safe here (see §P2.3g/h for why it wasn't for colour_images). */}
                {p.reviewStatus === 'used' && (
                  galleryUrls?.includes(p.generatedImageUrl)
                    ? <span className="text-2xs text-ink-60">✓ In gallery</span>
                    : <button type="button" onClick={() => onAddToGallery(p.targetCrystalCode, p.generatedImageUrl)}
                              className="text-2xs text-purple-700 hover:underline">Add to Gallery →</button>
                )}
                {p.reviewStatus !== 'used' && (
                  <button type="button" onClick={() => onRemove(p)} className="text-2xs text-ink-60 hover:text-red-600 hover:underline">Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {zoomUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80" onClick={() => setZoomUrl(null)}>
          <img src={zoomUrl} alt="" className="rounded-none object-contain" style={{ width: 'min(85vw, 720px)', height: 'min(85vh, 720px)' }}
               onClick={e => e.stopPropagation()} />
          <button type="button" onClick={() => setZoomUrl(null)}
                  className="absolute top-4 right-4 text-white bg-white/15 hover:bg-white/25 rounded-none p-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

const PLATING_NAME = Object.fromEntries(RANGE_PLATINGS.map(p => [p.code, p.name]))
const platingKey = v => (v.plating_code || '').trim().toUpperCase()
// Distinct *plated* groups used by the variants, in first-seen order.
// Unplated variants ('') are excluded — they track stock per SKU instead.
const platingsUsed = variants => {
  const seen = []
  for (const v of variants) { const k = platingKey(v); if (k && !seen.includes(k)) seen.push(k) }
  return seen
}
// Seed a plating→stock pool from legacy per-variant stock (sum per plating).
// Only plated variants feed the pool; unplated stay per-SKU.
const derivePlatingStock = variants => {
  const m = {}
  for (const v of variants) {
    const k = platingKey(v); if (!k) continue
    const n = Number(v.stock_finished)
    if (Number.isFinite(n) && n > 0) m[k] = (m[k] || 0) + n
  }
  return m
}

const PACKING_FIELDS = [
  { key: 'carton_dims', label: 'Carton Size', placeholder: 'L x W x H cm' },
  { key: 'pcs_per_carton', label: 'Pcs / Carton', placeholder: '48' },
  { key: 'cbm_per_carton', label: 'CBM / Carton', placeholder: '0.0164' },
  { key: 'weight_per_carton_kg', label: 'Weight / Carton (kg)', placeholder: '13.3' },
  { key: 'weight_per_pcs_kg', label: 'Weight / Pc (kg)', placeholder: '0.131' },
  { key: 'pack_box_ref', label: 'Pack / Box Ref', placeholder: 'P-…' },
]

// Full SKU = {prefix}{design_no}-{format}-{plating}{crystal}{running}
//   prefix = 1-2 letters: brand (1st) + optional body/type (2nd)
//   e.g. D0002-001-GC1 (metal) or UA061-231-CC1 (crystal-body, prefix UA)
function buildSku(designNo, format, v) {
  const head = `${v.brand_code || ''}${designNo || ''}`
  const suffix = `${v.plating_code || ''}${v.crystal_code || ''}${v.running_no || ''}`
  return [head, format || '', suffix].filter(Boolean).join('-')
}

// Download a range image through the proxy edge function, naming the file after
// the variant SKU (matches the corporate-gift image-download behaviour).
function downloadRangeImage(url, baseName) {
  if (!url) return
  const safe = (baseName || 'image').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'image'
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase()
  const filename = `${safe}.${ext}`
  const proxyUrl = `/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a')
  a.href = proxyUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// Read a stored doc (new `variants` shape, or legacy `finishes`) into the form.
// `fallbackBrand` = the brand letter from the doc's old design_code, used to
// migrate variants that pre-date the per-variant brand field.
function variantsFromDoc(d, fallbackBrand) {
  // Back-compat: an earlier build stored colours product-level. Seed each
  // variant from that list when the variant itself has none.
  const docColors = Array.isArray(d.crystal_colors)
    ? d.crystal_colors.map(c => (c || '').toString().trim().toUpperCase()).filter(Boolean) : []
  if (Array.isArray(d.variants) && d.variants.length) {
    return d.variants.map(v => {
      const code = v.brand_code || fallbackBrand || 'D'
      const vColors = Array.isArray(v.crystal_colors) && v.crystal_colors.length
        ? v.crystal_colors.map(c => (c || '').toString().trim().toUpperCase()).filter(Boolean)
        : docColors
      return {
        brand_code: code, brand_name: v.brand_name || BRAND_NAME[code] || '',
        plating_code: v.plating_code || '', plating_name: v.plating_name || '',
        crystal_code: v.crystal_code || '', crystal_name: v.crystal_name || '',
        description: v.description || '',
        running_no: v.running_no || '',
        ws_price_usd: v.ws_price_usd ?? '', stock_finished: v.stock_finished ?? '',
        packaging: v.packaging || '', engraving: v.engraving || '', image: v.image || '',
        crystal_colors: vColors,
      }
    })
  }
  // Legacy: finishes[] carried only a single plating dimension
  const code = fallbackBrand || 'D'
  return (d.finishes || []).map(f => ({
    brand_code: code, brand_name: BRAND_NAME[code] || '',
    plating_code: f.finish_code || '', plating_name: f.finish_name || '',
    crystal_code: '', crystal_name: '', description: f.finish_name || '', running_no: '',
    ws_price_usd: f.ws_price_usd ?? '', stock_finished: f.stock_finished ?? '',
    packaging: '', engraving: '', image: f.image || '', crystal_colors: [],
  }))
}

export default function RangeForm() {
  const { id: routeId } = useParams()
  const isNew = routeId === 'new'
  const role = useRole()   // sales edits figurine catalogue but not its costing
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Stable doc id (needed for storage paths) — generated up-front for new docs
  const docIdRef = useRef(isNew ? doc(collection(db, 'range_products')).id : routeId)
  const docId = docIdRef.current

  // Prefill from a Schema Audit "Add to Range from this PI" link (design_no/
  // body_code/format_code/description query params). New-product form only.
  const [form, setForm] = useState(isNew ? blankForm({
    design_no: searchParams.get('design_no') || '',
    brand_code: searchParams.get('brand_code') || '',
    format_code: searchParams.get('format_code') || '',
    description: searchParams.get('description') || '',
  }) : null)
  const [fetching, setFetching] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [pickerFor, setPickerFor] = useState(null)
  const [pickerUrl, setPickerUrl] = useState('')
  const [catOptions, setCatOptions] = useState({ design: [], product: [] })
  // AI marketing-copy writer (mirrors the corporate-gift product form)
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState('')
  const [aiGuide, setAiGuide]       = useState('')
  const [guideOpen, setGuideOpen]   = useState(false)
  const [rewriteOpen, setRewriteOpen]       = useState(false)
  const [rewriteGuide, setRewriteGuide]     = useState('')
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [rewriteError, setRewriteError]     = useState('')
  const { colors: libColors, setColors: setLibColors } = useCrystalColors()
  const colorLookup = colorMap(libColors)
  const { components: libComponents } = useComponents()
  // Crystal stock list — the BOM editor resolves each line's code against it so
  // a stone the inventory does not carry is visible rather than silent.
  const { items: libCrystals } = useCrystals()
  const prodDefaults = useProductDefaults()

  // Toggle a critical component on/off for this product. We store the stable
  // doc id (so renaming the component's code never breaks the link) plus the
  // code for display / legacy fallback. qty defaults to 1, plating_code '' = all variants.
  // Toggling off removes ALL refs for that component (regardless of plating_code);
  // fine-grained per-plating control is done via the selected list below.
  const sameRef = (r, comp) => (comp.id && r.id === comp.id) || (!r.id && r.code === comp.code)
  const toggleComponent = comp => setForm(f => {
    const list = Array.isArray(f.critical_components) ? f.critical_components : []
    const has = list.some(r => sameRef(r, comp))
    return {
      ...f,
      critical_components: has
        ? list.filter(r => !sameRef(r, comp))
        : [...list, { _uid: refUid(), id: comp.id || '', code: comp.code, qty_per_unit: 1, plating_code: '' }],
    }
  })
  // Each form row carries a stable ephemeral _uid used as its React key and the
  // mutation target, so two refs to the same component (different — or even the
  // same — plating) never collide. _uid is form-only and stripped on save.
  const setComponentQty = (uid, val) => setForm(f => ({
    ...f,
    critical_components: (f.critical_components || []).map(r =>
      r._uid === uid ? { ...r, qty_per_unit: val.replace(/[^\d]/g, '') } : r),
  }))
  // Scope select: '__ALL__' = always needed (overrides the component's own
  // plating), a plating code = that variant only, '' = auto (infer from component).
  const setComponentPlating = (uid, val) => setForm(f => ({
    ...f,
    critical_components: (f.critical_components || []).map(r =>
      r._uid === uid
        ? (val === '__ALL__'
            ? { ...r, all_variants: true, plating_code: '' }
            : { ...r, all_variants: false, plating_code: val.toUpperCase() })
        : r),
  }))
  // Duplicate a ref so the user can assign it to another plating without re-
  // searching. Default the copy to the first plating not already used by this
  // component's refs (falls back to '' = all variants) to avoid a useless dupe.
  const cloneComponentRef = src => setForm(f => {
    const list = f.critical_components || []
    const used = new Set(list.filter(r => sameRef(r, src)).map(r => (r.plating_code || '').toUpperCase()))
    const next = formPlatings.find(p => !used.has(p.code))?.code || ''
    return { ...f, critical_components: [...list, { ...src, _uid: refUid(), plating_code: next }] }
  })
  // Remove a reference directly from the selected list (covers orphans that
  // have no matching library chip to un-tick).
  const removeComponentRef = uid => setForm(f => ({
    ...f,
    critical_components: (f.critical_components || []).filter(r => r._uid !== uid),
  }))

  // Distinct plating codes from the current product variants — used to populate
  // the plating_code select in the selected components list.
  const formPlatings = useMemo(() => {
    const seen = new Map()
    // `form` is null until an existing product finishes loading; this hook runs
    // before the `if (!form) return` guard below, so it must tolerate null.
    for (const v of (form?.variants || [])) {
      const code = (v.plating_code || '').trim().toUpperCase()
      if (code && !seen.has(code)) seen.set(code, v.plating_name || code)
    }
    return [...seen.entries()].map(([code, name]) => ({ code, name }))
  }, [form?.variants])

  // Per-variant crystal-colour search (keyed by variant index).
  const [colorSearch, setColorSearch] = useState({})
  const setColorTerm = (i, val) => setColorSearch(s => ({ ...s, [i]: val }))

  // Search-driven component picker (scales to hundreds of parts).
  const [compSearch, setCompSearch] = useState('')
  const [compCat, setCompCat] = useState('')
  const compCats = useMemo(() =>
    [...new Set(libComponents.map(c => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  [libComponents])
  const compResults = useMemo(() => {
    const q = compSearch.trim().toLowerCase()
    if (!q && !compCat) return []
    return libComponents.filter(c => {
      if (compCat && c.category !== compCat) return false
      if (!q) return true
      return [c.code, c.name, c.category, c.supplierName].some(v => (v || '').toLowerCase().includes(q))
    }).slice(0, 50)
  }, [libComponents, compSearch, compCat])

  const toggleColor = (i, code) => setForm(f => ({
    ...f,
    variants: f.variants.map((v, j) => {
      if (j !== i) return v
      const list = Array.isArray(v.crystal_colors) ? v.crystal_colors : []
      const has = list.includes(code)
      return { ...v, crystal_colors: has ? list.filter(c => c !== code) : [...list, code] }
    }),
  }))
  // Set a variant's colours outright (used by Select all / Clear).
  const setVariantColors = (i, codes) => setForm(f => ({
    ...f,
    variants: f.variants.map((v, j) => (j === i ? { ...v, crystal_colors: codes } : v)),
  }))
  // Copy one variant's colour selection onto every variant (most products share
  // the same colour set across platings).
  const applyColorsToAll = i => setForm(f => {
    const src = Array.isArray(f.variants[i]?.crystal_colors) ? f.variants[i].crystal_colors : []
    return { ...f, variants: f.variants.map(v => ({ ...v, crystal_colors: [...src] })) }
  })

  // ── Crystal mixtures (model-level recipes: mixcode -> [crystal codes]) ──
  // Toggle a crystal code in/out of a mixcode's recipe.
  // The product's identifying code (body letter + design no), e.g. "M0004".
  const designCodeNow = () => {
    const body = ((form.variants.find(v => (v.brand_code || '').length > 1)?.brand_code || '').slice(1)
      || form.body_code || '').toUpperCase()
    return body + (form.design_no || '').trim()
  }
  // Pull the legacy decoded recipes for this product (shared across platings).
  // Recipes are keyed by full code (e.g. "M0014"). The body letter isn't always
  // filled on a product, so fall back: try the full code, then "M"+design_no
  // (legacy U#### -> M####), then any recipe whose trailing digits match.
  // Brand carries crystal colours only for Bohemia (D), Swarovski (U) and Mixed
  // (M). Asfour/Chinese (A) variants are plain — never auto-tick colours on them.
  const brandTakesColours = v => {
    const b = (v.brand_code || '').trim().toUpperCase()[0]
    return !b || ['D', 'U', 'M'].includes(b)   // unknown/empty defaults to allowed
  }

  // Pull the distinct categories already used in the system so the
  // datalists suggest existing names (avoids near-duplicate / plural drift).
  useEffect(() => {
    getDocs(collection(db, 'range_products')).then(snap => {
      const design = new Set(RANGE_DESIGN_TYPES)
      const product = new Set(RANGE_PRODUCT_TYPES)
      snap.forEach(s => {
        const d = s.data()
        const dt = (d.design_type || d.category || '').trim()
        const pt = (d.product_type || '').trim()
        if (dt) design.add(dt)
        if (pt) product.add(pt)
      })
      const sort = set => [...set].sort((a, b) => a.localeCompare(b))
      setCatOptions({ design: sort(design), product: sort(product) })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (isNew) return
    getDoc(doc(db, 'range_products', routeId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        const fallbackBrand = brandLetter(d.design_code) || 'D'
        const vs = variantsFromDoc(d, fallbackBrand)
        setForm({
          design_no: d.design_no || designNumber(d.design_code),
          body_code: d.body_code || bodyLetter(d.design_code),
          design_name: d.design_name || '',
          description: d.description || '',
          marketing_description: d.marketing_description || '',
          videos: normVideos(d.videos, d.video_url),
          category: d.category || '',
          design_type: d.design_type || d.category || '',
          product_type: d.product_type || 'Figurine',
          format_code: d.format_code || '001',
          size: d.size || '',
          crystal_type: d.crystal_type || 'Bohemia',
          active: d.active !== false,
          status: d.status || 'active',
          is_new: !!d.is_new,
          moq: d.moq ?? '',
          lead_time_weeks: d.lead_time_weeks ?? '',
          delivery_note: d.delivery_note || '',
          critical_components: Array.isArray(d.critical_components)
            ? d.critical_components.map(r => ({ _uid: refUid(), id: r.id || '', code: (r.code || '').toUpperCase(), qty_per_unit: r.qty_per_unit || 1, plating_code: (r.plating_code || '').toUpperCase(), all_variants: !!r.all_variants }))
            : [],
          packing: { ...emptyPacking(), ...(d.packing || {}) },
          gallery: normGallery(d.gallery),
          variants: vs,
          crystal_components: normaliseCrystalBom(d.crystal_components),
          // Plating pool: stored map wins; else seed from legacy per-variant stock.
          plating_stock: d.plating_stock && Object.keys(d.plating_stock).length
            ? { ...d.plating_stock } : derivePlatingStock(vs),
        })
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [routeId, isNew])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  // Build the normalized "product" shape the AI writer expects from range fields.
  function aiProductPayload() {
    const heroImage = form.gallery?.[0]?.url || form.variants?.find(v => v.image)?.image || null
    // Distinct finish/colour names across variants give the model real material detail.
    const finishes = [...new Set(form.variants
      .map(v => [v.plating_name, v.crystal_name].filter(Boolean).join(' / '))
      .filter(Boolean))].join('; ')
    return {
      name: form.design_name || form.description,
      category: form.design_type || form.category || form.product_type || 'Crystocraft Range',
      description: form.description,
      size: form.size,
      crystal_type: form.crystal_type,
      finishes,
      heroImage,
    }
  }

  // The visible "name" of a range product is entered in the Description field
  // (there is no separate design-name input), so AI writing keys off either.
  // `form` is null while an existing product is still loading (before the
  // `if (!form) return` guard below) — this line runs on every render, so it
  // must tolerate null (V7.7.1 lesson: hooks/top-level consts run before guards).
  const aiName = (form?.design_name || form?.description || '').trim()

  async function handleGenerateCopy() {
    if (!aiName) return
    setAiLoading(true); setAiError('')
    try {
      const res = await fetch('/api/generate-marketing-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ product: aiProductPayload(), source: 'range', instructions: aiGuide.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const desc = (data.marketing_description || '').slice(0, MARKETING_DESC_MAXLEN)
      setForm(f => ({ ...f, marketing_description: desc }))
    } catch (err) {
      setAiError(err.message || 'Generation failed — please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleRewrite() {
    if (!rewriteGuide.trim()) return
    setRewriteLoading(true); setRewriteError('')
    try {
      const res = await fetch('/api/rewrite-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          section_type: 'marketing_description',
          body: form.marketing_description,
          guidance: rewriteGuide,
          context: `Crystocraft range design: ${form.design_name || form.description}\nType: ${form.design_type || form.product_type}\nSpec: ${form.description}`,
          max_chars: MARKETING_DESC_MAXLEN,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Slice as a safety net — same as handleGenerateCopy. The textarea's
      // maxLength only limits typing, not a programmatic set.
      setForm(f => ({ ...f, marketing_description: (data.body || '').slice(0, MARKETING_DESC_MAXLEN) }))
      setRewriteOpen(false); setRewriteGuide('')
    } catch (err) {
      setRewriteError(err.message || 'Rewrite failed — please try again.')
    } finally {
      setRewriteLoading(false)
    }
  }

  const setPlatingStock = code => e => {
    const val = e.target.value.replace(/[^\d]/g, '')
    setForm(f => ({ ...f, plating_stock: { ...f.plating_stock, [code]: val } }))
  }
  const setPacking = key => e => setForm(f => ({ ...f, packing: { ...f.packing, [key]: e.target.value } }))

  function patchVariant(i, patch) {
    setForm(f => {
      const variants = [...f.variants]; variants[i] = { ...variants[i], ...patch }
      return { ...f, variants }
    })
  }
  const setVariant = (i, field) => e => patchVariant(i, { [field]: e.target.value })
  // Picking a plating/crystal code auto-fills its name AND the auto description,
  // unless the user has already customised the description.
  function applyCode(i, kind, code) {
    setForm(f => {
      const variants = [...f.variants]
      const prev = variants[i]
      const v = { ...prev }
      if (kind === 'brand') {
        v.brand_code = code; v.brand_name = BRAND_NAME[(code || '')[0]] || ''
      } else if (kind === 'plating') {
        const m = RANGE_PLATINGS.find(p => p.code === code)
        v.plating_code = code; v.plating_name = m ? m.name : ''
      } else {
        const m = RANGE_CRYSTAL_COLORS.find(c => c.code === code)
        v.crystal_code = code; v.crystal_name = m ? m.name : ''
      }
      // Keep description in sync only while it still matches the auto value
      if (!v.description || v.description === autoVariantDesc(prev)) {
        v.description = autoVariantDesc(v)
      }
      variants[i] = v
      return { ...f, variants }
    })
  }
  const setBrand = i => e => applyCode(i, 'brand', e.target.value)
  const setPlating = i => e => applyCode(i, 'plating', e.target.value)
  const setCrystal = i => e => applyCode(i, 'crystal', e.target.value)
  const addVariant = () => setForm(f => ({ ...f, variants: [...f.variants, emptyVariant()] }))
  const removeVariant = i => setForm(f => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }))

  async function uploadFile(file) {
    // Downscale + compress before upload — raw phone photos (multi-MB, 4000px+)
    // otherwise make the customer storefront crawl. Non-images pass through.
    const isImage = (file.type || '').startsWith('image/')
    const { blob, type } = isImage ? await resizeToJpeg(file) : { blob: file, type: file.type }
    const baseName = file.name.replace(/[^\w.\-]/g, '_').replace(/\.[^.]+$/, '')
    const ext = type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'bin')
    const path = `range_products/${docId}/${Date.now()}-${baseName}.${ext}`
    await uploadBytes(storageRef(storage, path), blob, { contentType: type })
    return getDownloadURL(storageRef(storage, path))
  }

  async function handleVariantUpload(i, file) {
    if (!file) return
    setUploading(`variant-${i}`); setError('')
    try {
      const url = await uploadFile(file)
      // Assign to the variant AND add it to the shared Images gallery (deduped) so the
      // same upload can be reused on other variants without uploading it again.
      patchVariant(i, { image: url })
      setForm(f => f.gallery.some(g => g.url === url)
        ? f
        : { ...f, gallery: [...f.gallery, { url, caption: '' }] })
      setPickerFor(null)
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }

  function applyVariantUrl(i, raw) {
    const url = (raw || '').trim()
    if (!url) return
    patchVariant(i, { image: url })
    setForm(f => f.gallery.some(g => g.url === url)
      ? f
      : { ...f, gallery: [...f.gallery, { url, caption: '' }] })
    setPickerUrl(''); setPickerFor(null)
  }

  async function handleGalleryUpload(files) {
    if (!files || !files.length) return
    setUploading('gallery'); setError('')
    try {
      const items = []
      for (const file of files) items.push({ url: await uploadFile(file), caption: '' })
      setForm(f => ({ ...f, gallery: [...f.gallery, ...items] }))
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }
  const addGalleryUrl = () => {
    const url = prompt('Paste image URL:')
    if (url && url.trim()) setForm(f => ({ ...f, gallery: [...f.gallery, { url: url.trim(), caption: '' }] }))
  }
  const removeGallery = i => setForm(f => ({ ...f, gallery: f.gallery.filter((_, j) => j !== i) }))
  const setGalleryCaption = (i, caption) =>
    setForm(f => ({ ...f, gallery: f.gallery.map((g, j) => (j === i ? { ...g, caption } : g)) }))
  const moveGallery = (i, dir) => setForm(f => {
    const j = i + dir
    if (j < 0 || j >= f.gallery.length) return f
    const next = [...f.gallery]
    ;[next[i], next[j]] = [next[j], next[i]]
    return { ...f, gallery: next }
  })
  // Promote an image to position 0 — that first image is the card hero.
  const setGalleryMain = i => setForm(f => {
    if (i <= 0 || i >= f.gallery.length) return f
    const next = [...f.gallery]
    const [picked] = next.splice(i, 1)
    next.unshift(picked)
    return { ...f, gallery: next }
  })

  // ── AI image enhancement (Gemini image model) ──────────────────────────────
  // enh: { i, before, after, mode, busy, error, colorWarning }. Result is reviewed
  // before it ever replaces the original (Keep/Discard); output is solid-white.
  const [enh, setEnh] = useState(null)
  const [colorHint, setColorHint] = useState('')
  const [recolorOpen, setRecolorOpen] = useState(false)
  const [editTab, setEditTab] = useState('ai')  // 'ai' | 'adjust'
  const [recolorPrompt, setRecolorPrompt] = useState('')

  async function runEnhance(i, mode, recolorInstructions = '') {
    const g = form.gallery[i]
    if (!g?.url) return
    setEnh({ i, before: g.url, after: null, mode, busy: true, error: '', colorWarning: false })
    try {
      const data = await enhanceProductImage(g.url, { mode, colorHint, recolorInstructions })
      const afterUrl = `data:${data.mimeType || 'image/png'};base64,${data.image}`
      const colorWarning = await detectColorLoss(g.url, afterUrl)
      setEnh(e => (e && e.i === i ? { ...e, after: afterUrl, busy: false, colorWarning, reframed: !!data.reframed } : e))
    } catch (err) {
      setEnh(e => (e && e.i === i ? { ...e, busy: false, error: err.message } : e))
    }
  }
  async function keepEnhanced() {
    if (!enh?.after) return
    setEnh(e => ({ ...e, busy: true }))
    try {
      const blob = await (await fetch(enh.after)).blob()
      const file = new File([blob], `enhanced-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadFile(file)
      setForm(f => ({ ...f, gallery: f.gallery.map((g, j) => (j === enh.i ? { ...g, url } : g)) }))
      setEnh(null)
    } catch (err) {
      setEnh(e => ({ ...e, busy: false, error: err.message }))
    }
  }

  async function saveEnhancedAsNew() {
    if (!enh?.after) return
    setEnh(e => ({ ...e, busy: true }))
    try {
      const blob = await (await fetch(enh.after)).blob()
      const file = new File([blob], `enhanced-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadFile(file)
      // Append as a new gallery entry after the original
      setForm(f => {
        const next = [...f.gallery]
        next.splice(enh.i + 1, 0, { url, caption: '' })
        return { ...f, gallery: next }
      })
      setEnh(null)
    } catch (err) {
      setEnh(e => ({ ...e, busy: false, error: err.message }))
    }
  }

  const num = v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
  const intNum = v => { const n = num(v); return n == null ? null : Math.round(n) }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.design_no.trim()) { setError('Design no. (e.g. 0002) is required.'); return }
    if (!form.format_code.trim()) { setError('Product type code (e.g. 001) is required.'); return }
    setSaving(true); setError('')
    // colour_images can be written directly to Firestore from OUTSIDE this
    // form — by "Approve → usable" itself (promoteColourImage, since bug fix
    // 2026-08-23) and by the inline invoice/PI/quote picker. This form's own
    // local state was only a snapshot from page load, so saving straight
    // from it could silently wipe out anything approved elsewhere in the
    // meantime — confirmed live: a Save Changes here wiped EVERY colour on
    // D0002-001, not just the ones just approved. Re-fetch colour_images
    // fresh right before building the payload so Save Changes can never
    // regress it, regardless of how stale the rest of this form's state is.
    let serverColourImages = []
    if (!isNew) {
      try {
        const snap = await getDoc(doc(db, 'range_products', docId))
        serverColourImages = snap.exists() ? (snap.data().variants || []) : []
      } catch { /* best effort — falls back to local state below */ }
    }
    const designNo = form.design_no.trim()
    const format = form.format_code.trim()
    // Body/type = the optional 2nd prefix letter, taken from the variants' prefix.
    const body = ((form.variants.find(v => (v.brand_code || '').length > 1)?.brand_code || '').slice(1)).toUpperCase()
    const payload = {
      design_no: designNo,
      body_code: body,
      body_name: BODY_NAME[body] || '',
      design_code: body + designNo,   // kept for list ordering / back-compat
      design_name: form.design_name.trim(),
      description: form.description.trim(),
      marketing_description: (form.marketing_description || '').trim(),
      videos: normVideos(form.videos),
      video_url: normVideos(form.videos)[0] || '',
      category: form.category.trim(),
      design_type: form.design_type.trim(),
      product_type: form.product_type.trim(),
      format_code: format,
      size: form.size.trim(),
      crystal_type: form.crystal_type.trim(),
      active: form.active,
      status: form.status,
      is_new: !!form.is_new,
      // Production / availability — drives the customer promise alongside stock.
      moq: intNum(form.moq),
      lead_time_weeks: num(form.lead_time_weeks),
      delivery_note: (form.delivery_note || '').trim(),
      critical_components: (form.critical_components || [])
        .map(r => {
          const c = resolveRef(r, libComponents)   // refresh code from the live library
          return {
            id: r.id || c?.id || '',
            code: (c?.code || r.code || '').trim().toUpperCase(),
            qty_per_unit: Math.max(1, intNum(r.qty_per_unit) || 1),
            plating_code: (r.plating_code || '').trim().toUpperCase(),
            all_variants: !!r.all_variants,
          }
        })
        .filter(r => r.id || r.code),
      packing: Object.fromEntries(PACKING_FIELDS.map(pf => [pf.key, (form.packing[pf.key] ?? '').toString().trim()])),
      gallery: form.gallery.map(g => ({ url: (g.url || '').trim(), caption: (g.caption || '').trim() })).filter(g => g.url),
      // Plating-level stock pool — keep only platings still present, as integers.
      plating_stock: Object.fromEntries(
        platingsUsed(form.variants)
          .map(code => [code, intNum(form.plating_stock[code])])
          .filter(([, n]) => n != null)
      ),
      variants: form.variants.map((v, i) => ({
        brand_code: v.brand_code.trim(), brand_name: v.brand_name.trim(),
        plating_code: v.plating_code.trim(), plating_name: v.plating_name.trim(),
        crystal_code: v.crystal_code.trim(), crystal_name: v.crystal_name.trim(),
        description: v.description.trim(), running_no: v.running_no.trim(),
        sku: buildSku(designNo, format, {
          brand_code: v.brand_code.trim(), plating_code: v.plating_code.trim(),
          crystal_code: v.crystal_code.trim(), running_no: v.running_no.trim(),
        }),
        ws_price_usd: num(v.ws_price_usd), stock_finished: intNum(v.stock_finished),
        packaging: v.packaging.trim(), engraving: v.engraving.trim(), image: v.image.trim(),
        // Selectable crystal colours for this plating — not a SKU/stock dimension.
        crystal_colors: [...new Set((v.crystal_colors || []).map(c => (c || '').trim().toUpperCase()).filter(Boolean))],
        // "Usable" colour photos — invoice/quote/PI + customer colour picker only,
        // deliberately never gallery[] (V8.8 Phase 2, see Range_Colour_Preview_Spec.md §P2.1).
        // Sourced from the server fetch above, NOT local state — see comment
        // at the top of handleSave for why.
        colour_images: Object.fromEntries(
          Object.entries(serverColourImages[i]?.colour_images || v.colour_images || {}).filter(([code, url]) => code && url)
        ),
      })),
      // Per-model crystal mixture recipes (shared across platings):
      // mixcode -> [crystal short-codes]. Drives the catalogue swatch table.
      crystal_components: normaliseCrystalBom(form.crystal_components),
      updatedAt: serverTimestamp(),
    }
    try {
      if (isNew) {
        await setDoc(doc(db, 'range_products', docId), { ...payload, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'range_products', docId), payload)
      }
      navigate('/range')
    } catch (err) { setError(err.message || 'Save failed.'); setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${form.design_name || form.design_no}" permanently? (Tip: untick "Visible" to just hide it.)`)) return
    setSaving(true)
    try { await deleteDoc(doc(db, 'range_products', docId)); navigate('/range') }
    catch (err) { setError(err.message || 'Delete failed.'); setSaving(false) }
  }

  if (fetching) return <LoadingBar />
  if (!form) return <div className="p-6 text-ink-60">Product not found. <Link to="/range" className="text-brand-600">Back to Figurine Gifts</Link></div>

  // 3-digit designs allow a 2-letter prefix (brand + body); 4-digit allow 1 letter.
  const brandMax = form.design_no.replace(/\D/g, '').length <= 3 ? 2 : 1
  const platingStockTotal = platingsUsed(form.variants)
    .reduce((s, code) => s + (parseInt(form.plating_stock[code], 10) || 0), 0)
  const productCode = [form.design_no, form.format_code].filter(Boolean).join('-')

  // Live customer-promise preview from current form state + components library.
  const availability = productAvailability({
    status: form.status, moq: form.moq, lead_time_weeks: form.lead_time_weeks,
    delivery_note: form.delivery_note, critical_components: form.critical_components,
    plating_stock: form.plating_stock, variants: form.variants,
  }, libComponents, prodDefaults)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="eyebrow mb-1">Figurine Gifts {productCode && `· ${productCode}`}</p>
          <h1 className="text-xl md:text-2xl">{isNew ? 'New Product' : 'Edit Product'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && role !== 'sales' && <Link to={`/range/${routeId}/costing`} className="btn-secondary text-sm">Costing</Link>}
          <Link to="/range" className="btn-secondary text-sm">← Back</Link>
        </div>
      </div>

      {error && <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">{error}</div>}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Core fields */}
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Design No.</label>
              <input className="input font-mono" value={form.design_no} inputMode="numeric" maxLength={4}
                     onChange={e => setForm(f => ({ ...f, design_no: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                     placeholder="0002" required />
              <p className="text-2xs text-ink-60 mt-0.5">3 or 4 digits (3 = 2-letter prefix allowed)</p>
            </div>
            <div>
              <label className="label">Product Type</label>
              <input className="input font-mono" list="format-codes" value={form.format_code} inputMode="numeric" maxLength={3}
                     onChange={e => setForm(f => ({ ...f, format_code: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                     placeholder="001" required />
              <datalist id="format-codes">
                {RANGE_FORMAT_CODES.map(fc => <option key={fc.code} value={fc.code}>{fc.label}</option>)}
              </datalist>
            </div>
            <div>
              <label className="label">Size</label>
              <input className="input" value={form.size} onChange={set('size')} placeholder="7.5 x 5.5 cm" />
            </div>
          </div>
          <p className="text-2xs text-ink-60 -mt-2">
            Product <span className="font-mono text-ink-80">{productCode || '…'}</span>.
            Each variant's full SKU = crystal brand + this + plating / crystal colour
            (e.g. <span className="font-mono">D{form.design_no || '0002'}-{form.format_code || '001'}-GC1</span>).
            Prefix per variant: 1st letter = brand (D/U/A/M), optional 2nd letter
            (3-digit designs) = body — A Crystal body · C Glassware · D Display unit.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Design Cat</label>
              <input className="input" list="design-types" value={form.design_type}
                     onChange={set('design_type')} placeholder="Butterfly, Bird…" />
              <datalist id="design-types">
                {catOptions.design.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Product Cat</label>
              <input className="input" list="product-types" value={form.product_type}
                     onChange={set('product_type')} placeholder="Figurine, Music Box…" />
              <datalist id="product-types">
                {catOptions.product.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={set('status')}>
                {RANGE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
            <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!form.is_new}
                   onChange={e => setForm(f => ({ ...f, is_new: e.target.checked }))} />
            <span className="text-sm text-ink-80">New arrival <span className="text-ink-60 font-normal">— shows a green “New” badge in the shop and floats this product to the top. Untick when it's no longer new.</span></span>
          </label>

          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={form.description} onChange={set('description')} />
          </div>

          {/* Marketing description with AI writer (mirrors corporate-gift form) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Marketing Description</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setGuideOpen(o => !o)}
                  className="text-xs text-ink-60 hover:text-brand-600 transition-colors">
                  {guideOpen ? 'Hide instructions' : '+ Instructions'}
                </button>
                <button type="button" onClick={handleGenerateCopy} disabled={!aiName || aiLoading}
                  className="text-xs px-2.5 py-1 rounded-none bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                  {aiLoading ? 'Writing…' : <span className="inline-flex items-center gap-1"><Sparkles size={13} />AI Write</span>}
                </button>
              </div>
            </div>
            {guideOpen && (
              <div className="mb-2">
                <textarea className="input text-sm" rows={2}
                  placeholder="Optional: tell the AI what to emphasise — e.g. highlight the Bohemia crystal, target collectors, keep it under 60 words…"
                  value={aiGuide} onChange={e => setAiGuide(e.target.value)} />
                <p className="text-xs text-ink-60 mt-1">
                  {(form.gallery?.[0]?.url || form.variants?.find(v => v.image)?.image)
                    ? 'A product image will be sent to the AI so it can describe what it sees.'
                    : 'No image yet — add a gallery or variant image so the AI can also see the design.'}
                </p>
              </div>
            )}
            <textarea className="input min-h-[96px]" value={form.marketing_description} onChange={set('marketing_description')}
              maxLength={MARKETING_DESC_MAXLEN}
              placeholder="Customer-facing sell-copy for catalogues and the storefront… or click AI Write to generate" />
            <p className="text-2xs text-ink-60 mt-0.5 text-right">{(form.marketing_description || '').length}/{MARKETING_DESC_MAXLEN}</p>
            {aiError && <p className="text-xs text-red-500 mt-1">{aiError}</p>}
            {!aiName && <p className="text-xs text-ink-60 mt-1">Enter a description (product name) first to enable AI writing</p>}
            {form.marketing_description && !rewriteOpen && (
              <button type="button" onClick={() => setRewriteOpen(true)}
                className="text-xs text-ink-60 hover:text-brand-600 transition-colors mt-1 flex items-center gap-1">
                <RotateCcw size={13} />Rewrite with guidance
              </button>
            )}
            {rewriteOpen && (
              <div className="border border-brand-100 rounded-none p-3 bg-brand-50 space-y-2 mt-1">
                <p className="text-xs font-medium text-brand-700">What should be different?</p>
                <textarea className="input text-sm w-full" rows={2}
                  placeholder="e.g. More focused on collectors, shorter, emphasise the crystal sparkle…"
                  value={rewriteGuide} onChange={e => setRewriteGuide(e.target.value)} autoFocus />
                {rewriteError && <p className="text-xs text-red-500">{rewriteError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={handleRewrite} disabled={rewriteLoading || !rewriteGuide.trim()}
                    className="text-xs px-3 py-1.5 rounded-none bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors">
                    {rewriteLoading ? 'Rewriting…' : <span className="inline-flex items-center gap-1"><RotateCcw size={13} />Rewrite</span>}
                  </button>
                  <button type="button" onClick={() => { setRewriteOpen(false); setRewriteGuide('') }}
                    className="text-xs px-3 py-1.5 rounded-none border border-warm-grey text-ink-60 hover:bg-ivory transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <VideoUrlsEditor videos={form.videos} onChange={v => setForm(f => ({ ...f, videos: v }))} />

          <label className="flex items-center gap-2 text-sm text-ink-80 cursor-pointer select-none">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Visible in catalogue (untick to hide without deleting)
          </label>
        </div>

        {/* Production & Availability */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Production & Availability</h2>
            <Link to="/components" className="text-xs text-brand-600 hover:underline">Manage components →</Link>
          </div>
          {form.status === 'stock' ? (
            <p className="text-xs text-ink-60 mb-3">
              <strong>Retired Stock</strong> — retired design, no re-runs. Availability is driven by
              how many units can still be built from remaining component stock. Tick the critical
              components below and keep their stock counts up to date — that's the single source
              of truth for this item.
            </p>
          ) : (
            <p className="text-xs text-ink-60 mb-3">
              Tick the <strong>critical</strong> parts this product needs (long-lead, tooling, MOQ, or
              supply-risk items only — not plating/crystal/boxes). Stock &amp; lead time live on each
              component and are shared across products. The customer promise below is computed from
              status + component stock.
            </p>
          )}

          <>
          {form.status !== 'stock' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 [&_label.label]:min-h-[2.2rem] [&_label.label]:flex [&_label.label]:items-end">
            <div>
              <label className="label">MOQ <span className="text-ink-60 font-normal">(made-to-order)</span></label>
              <input className="input text-sm" inputMode="numeric" value={form.moq}
                     onChange={e => setForm(f => ({ ...f, moq: e.target.value.replace(/[^\d]/g, '') }))}
                     placeholder="e.g. 100" />
            </div>
            <div>
              <label className="label">Assembly lead <span className="text-ink-60 font-normal">(weeks)</span></label>
              <input className="input text-sm" inputMode="numeric" value={form.lead_time_weeks}
                     onChange={e => setForm(f => ({ ...f, lead_time_weeks: e.target.value.replace(/[^\d.]/g, '') }))}
                     placeholder="2" />
            </div>
          </div>
          )}

          {/* Critical components multi-select */}
          {libComponents.length === 0 ? (
            <p className="text-sm text-ink-60">
              No components in the library yet — add your long-lead / tooling parts in{' '}
              <Link to="/components" className="text-brand-600 hover:underline">Components → Critical Components</Link>.
            </p>
          ) : (
            <>
              <label className="text-2xs uppercase tracking-wide text-ink-60">Add critical components</label>
              <div className="flex gap-2 mt-1.5">
                <input className="input text-sm flex-1 min-w-0" placeholder="Search code, name, supplier…"
                       value={compSearch} onChange={e => setCompSearch(e.target.value)} />
                <select className="input text-sm w-auto shrink-0" value={compCat} onChange={e => setCompCat(e.target.value)}>
                  <option value="">All categories</option>
                  {compCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {(compSearch.trim() || compCat) && (
                <div className="mt-1.5 border border-ivory-dark rounded-none max-h-60 overflow-auto divide-y divide-ivory-dark">
                  {compResults.length === 0 ? (
                    <p className="text-xs text-ink-60 px-3 py-2.5">No matching components.</p>
                  ) : compResults.map(c => {
                    const on = (form.critical_components || []).some(r => sameRef(r, c))
                    return (
                      <button key={c.id || c.code} type="button" onClick={() => toggleComponent(c)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${on ? 'bg-brand-50' : 'hover:bg-ivory/60'}`}>
                        <div className="w-8 h-8 shrink-0 bg-white border border-ivory-dark rounded-none flex items-center justify-center overflow-hidden">
                          {c.images?.[0] ? <img src={c.images[0]} alt="" className="w-full h-full object-contain p-0.5" /> : <Puzzle size={16} className="text-platinum" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-ink truncate">{c.code}</span>
                            {c.category && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 shrink-0">{c.category}</span>}
                          </div>
                          <p className="text-2xs text-ink-60 truncate">{c.name || '—'}</p>
                        </div>
                        <span className="text-2xs text-ink-60 shrink-0 tabular-nums">{c.stock_qty ?? 0} pcs · {c.lead_time_weeks ?? '?'}wk</span>
                        <span className={`shrink-0 ${on ? 'text-brand-600' : 'text-ink-60'}`}>{on ? <Check size={14} /> : '+'}</span>
                      </button>
                    )
                  })}
                  {compResults.length === 50 && (
                    <p className="text-2xs text-ink-60 px-3 py-2">Showing first 50 — refine your search.</p>
                  )}
                </div>
              )}

              {/* Selected components — qty per unit + live stock / lead */}
              {(form.critical_components || []).length > 0 && (
                <div className="mt-3 border-t border-ivory-dark pt-3 space-y-2">
                  <label className="text-2xs uppercase tracking-wide text-ink-60">
                    Selected ({(form.critical_components || []).length})
                  </label>
                  {(form.critical_components || []).map(r => {
                    const c = resolveRef(r, libComponents)
                    const key = r._uid
                    // If the ref has no plating override, plating is inferred from the
                    // component record at compute time. Show it so the user understands why
                    // Chrome/Gold bodies aren't treated as shared parts.
                    const inferredPlating = !r.plating_code && c?.plating_code ? c.plating_code : ''
                    return (
                      <div key={key} className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-mono text-ink-80 shrink-0 max-w-[7rem] truncate cursor-help select-all"
                              title={c?.code || r.code}
                              onClick={e => { e.currentTarget.style.maxWidth = e.currentTarget.style.maxWidth === 'none' ? '7rem' : 'none'; e.currentTarget.classList.toggle('truncate') }}>
                          {c?.code || r.code}
                        </span>
                        {c?.id && !isNew ? (
                          <Link to={`/components/critical/${c.id}?back=${encodeURIComponent(`/range/${routeId}`)}`}
                                className="flex-1 min-w-0 truncate text-brand-600 hover:underline" title="Open component — edit details or add a supplier quote">
                            {c.name || c.code}
                          </Link>
                        ) : (
                          <span className="flex-1 min-w-0 truncate text-ink-70">{c?.name || <span className="text-amber-600">not in library</span>}</span>
                        )}
                        {/* Plating scope. Always needed = counts for every variant even
                            when the part has a fixed finish (e.g. a gun-colour base). */}
                        <select
                          className="input text-xs py-1 w-40 shrink-0"
                          value={r.all_variants ? '__ALL__' : (r.plating_code || '')}
                          onChange={e => setComponentPlating(key, e.target.value)}
                          title="Which variant this part applies to. 'Always needed' = every variant (overrides the part's own plating)."
                        >
                          <option value="__ALL__">Always needed</option>
                          <option value="">{inferredPlating ? `Auto (${inferredPlating})` : 'All variants'}</option>
                          {formPlatings.map(p => (
                            <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 shrink-0">
                          <span className="text-ink-60">×</span>
                          <input className="input text-xs w-12 text-right tabular-nums py-1" inputMode="numeric"
                                 value={r.qty_per_unit} onChange={e => setComponentQty(key, e.target.value)} placeholder="1" />
                          <span className="text-ink-60">/unit</span>
                        </label>
                        <span className="w-20 shrink-0 text-right text-ink-60 tabular-nums">
                          {c ? `${c.stock_qty ?? 0} pcs · ${c.lead_time_weeks ?? '?'}wk` : '—'}
                        </span>
                        <button type="button" onClick={() => cloneComponentRef(r)}
                                className="shrink-0 text-brand-400 hover:text-brand-600 px-1 text-base leading-none"
                                title="Duplicate for another plating">+</button>
                        <button type="button" onClick={() => removeComponentRef(key)}
                                className="shrink-0 text-red-400 hover:text-red-600 px-1 text-base leading-none"
                                title="Remove component">×</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
          </>

          {/* Optional override + computed customer promise */}
          <div className="mt-4">
            <label className="label">Delivery note <span className="text-ink-60 font-normal">(optional — overrides the computed promise)</span></label>
            <input className="input text-sm" value={form.delivery_note} onChange={set('delivery_note')}
                   placeholder="Leave blank to auto-generate from status + stock + components" />
          </div>

          <div className="mt-3 rounded-none bg-ivory/60 border border-ivory-dark p-3">
            <p className="text-2xs uppercase tracking-wide text-ink-60 mb-1">What the customer sees</p>
            <p className="text-sm text-ink-80">{availability.promise}</p>
            {availability.buildable != null && (
              <p className="text-2xs text-ink-60 mt-1">
                {availability.byPlating && Object.keys(availability.byPlating).length ? (
                  <>
                    Buildable:{' '}
                    {Object.entries(availability.byPlating).map(([p, n], i) => (
                      <span key={p}>
                        {i > 0 && ' · '}
                        <b>{p}: {n}</b>
                        {availability.bottleneckByPlating?.[p] ? ` (ltd by ${availability.bottleneckByPlating[p]})` : ''}
                      </span>
                    ))}
                  </>
                ) : (
                  <>Buildable: <b>{availability.buildable}</b>{availability.bottleneck ? ` (ltd by ${availability.bottleneck})` : ''}</>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Gallery */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Images</h2>
            <button type="button" onClick={addGalleryUrl} className="btn-secondary text-xs">+ URL</button>
          </div>
          <p className="text-xs text-ink-60 mb-3">
            Reference photos shown to customers. Add a caption to each (e.g. “Packaging” or a full
            SKU like <span className="font-mono">U0002-001-CMX</span> so customers know which colour
            mix it is). Use ↑ ↓ to set the display order — the first image is the main one.
          </p>

          {form.gallery.length > 0 && (
            <div className="space-y-2 mb-3">
              {form.gallery.map((g, i) => (
                <div key={i} className="flex items-center gap-3 border border-ivory-dark rounded-none p-2 bg-white">
                  <div className="relative w-14 h-14 shrink-0 bg-white border border-ivory-dark rounded-none overflow-hidden flex items-center justify-center">
                    {g.url ? <img src={g.url} alt="" onClick={() => setLightbox(g)} className="w-full h-full object-contain p-0.5 cursor-zoom-in" title="Click to enlarge" /> : <span className="text-2xs text-ink-60">no image</span>}
                    {i === 0 && (
                      <span className="absolute top-0 left-0 bg-brand-600 text-white text-2xs font-medium px-1 leading-tight rounded-br" title="Main image shown on the product card">MAIN</span>
                    )}
                  </div>
                  <input
                    className="input text-sm flex-1 min-w-0"
                    value={g.caption || ''}
                    placeholder="Caption — e.g. Packaging, or U0002-001-CMX"
                    onChange={e => setGalleryCaption(i, e.target.value)} />
                  <div className="flex items-center gap-0.5 shrink-0">
                    {i !== 0 && (
                      <button type="button" onClick={() => setGalleryMain(i)}
                              className="text-ink-60 hover:text-brand-600 px-1" title="Set as main (card) image">★</button>
                    )}
                    {g.url && (
                      <button type="button"
                              onClick={() => { setEditTab('ai'); setEnh({ i, before: g.url, after: null, mode: null, busy: false, error: '', colorWarning: false }) }}
                              className="text-ink-60 hover:text-brand-600 px-1" title="Enhance image — describe colours, then pick Clean or Enhance (AI, review before replacing)">
                        <Sparkles size={14} />
                      </button>
                    )}
                    {g.url && (
                      <button type="button" onClick={() => downloadRangeImage(g.url, g.caption || form.design_name)}
                              className="text-ink-60 hover:text-brand-600 px-1" title={`Download image as ${g.caption || 'image'}`}>
                        <Download size={14} />
                      </button>
                    )}
                    <button type="button" onClick={() => moveGallery(i, -1)} disabled={i === 0}
                            className="text-ink-60 hover:text-ink-70 disabled:opacity-30 px-1" title="Move up">↑</button>
                    <button type="button" onClick={() => moveGallery(i, 1)} disabled={i === form.gallery.length - 1}
                            className="text-ink-60 hover:text-ink-70 disabled:opacity-30 px-1" title="Move down">↓</button>
                    <button type="button" onClick={() => removeGallery(i)}
                            className="text-red-400 hover:text-red-600 px-1 leading-none" title="Remove image">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="border border-dashed border-ivory-dark rounded-none flex items-center justify-center gap-2 cursor-pointer text-ink-60 hover:border-brand-400 hover:text-brand-600 transition-colors py-3"
                 title="Click to upload images">
            <span className="text-xl leading-none">＋</span>
            <span className="text-xs">{uploading === 'gallery' ? 'Uploading…' : 'Upload images'}</span>
            <input type="file" accept="image/*" multiple className="hidden"
                   onChange={e => handleGalleryUpload(Array.from(e.target.files))} />
          </label>

          {lightbox && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setLightbox(null)}>
              <img src={lightbox.url} alt={lightbox.caption || ''} className="max-w-full max-h-full rounded-none object-contain" onClick={e => e.stopPropagation()} />
              <button type="button" className="absolute top-4 right-4 text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-none text-sm inline-flex items-center"
                      onClick={() => setLightbox(null)}>✕</button>
            </div>
          )}

          {enh && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !enh.busy && setEnh(null)}>
              <div className="bg-white rounded-none max-w-3xl w-full p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm text-ink-80 inline-flex items-center gap-1.5"><Sparkles size={15} /> Edit image — review before replacing</h3>
                  <button type="button" onClick={() => !enh.busy && setEnh(null)} className="text-ink-60 hover:text-ink"><X size={16} /></button>
                </div>

                {/* Tabs: AI enhance vs manual adjust */}
                <div className="flex gap-1 mb-3 border-b border-warm-grey">
                  {[
                    { key: 'ai',     label: 'AI enhance' },
                    { key: 'adjust', label: 'Adjust (manual)' },
                  ].map(t => (
                    <button
                      key={t.key}
                      type="button"
                      disabled={enh.busy}
                      onClick={() => { setEditTab(t.key); setEnh(e => e ? { ...e, after: null, mode: null, colorWarning: false, error: '' } : e) }}
                      className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
 editTab === t.key
                          ? 'border-brand-600 text-brand-700'
                          : 'border-transparent text-ink-60 hover:text-ink-60'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {editTab === 'adjust' ? (
                  <ManualAdjust
                    src={enh.before}
                    disabled={enh.busy}
                    onResult={dataUrl => setEnh(e => e ? { ...e, after: dataUrl, mode: 'adjust' } : e)}
                  />
                ) : (
                <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-2xs uppercase tracking-wide text-ink-60 mb-1">Original</p>
                    <div className="aspect-square bg-ivory-dark border border-ivory-dark rounded-none flex items-center justify-center overflow-hidden">
                      <img src={enh.before} alt="" className="w-full h-full object-contain" />
                    </div>
                  </div>
                  <div>
                    <p className="text-2xs uppercase tracking-wide text-ink-60 mb-1">Enhanced {enh.after && `· ${enh.mode}`}</p>
                    <div className="aspect-square bg-ivory-dark border border-ivory-dark rounded-none flex items-center justify-center overflow-hidden">
                      {enh.busy ? <span className="text-xs text-ink-60">Working… (AI, ~10–20s)</span>
                        : enh.after ? <img src={enh.after} alt="" className="w-full h-full object-contain" />
                        : <span className="text-xs text-ink-60">Describe colours below, then pick Clean or Enhance</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-2xs font-medium text-ink-60 uppercase tracking-wide">
                    Describe product colours <span className="normal-case font-normal text-ink-60">(optional — helps AI preserve them)</span>
                  </label>
                  <input
                    className="input mt-1 text-sm"
                    placeholder="e.g. gold chrome body, clear crystal stones, red enamel base"
                    value={colorHint}
                    onChange={e => setColorHint(e.target.value)}
                    disabled={enh.busy}
                  />
                </div>
                {/* Recolor panel */}
                <div className="mt-3 border border-warm-grey rounded-none overflow-hidden">
                  <button type="button"
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-ink-60 hover:bg-ivory"
                    onClick={() => setRecolorOpen(o => !o)}>
                    <span className="flex items-center gap-1.5"><Sparkles size={12} /> Change colours</span>
                    <span className="text-ink-60">{recolorOpen ? '▲' : '▼'}</span>
                  </button>
                  {recolorOpen && (
                    <div className="px-3 pb-3 pt-2 bg-ivory space-y-2">
                      <input
                        className="input text-sm"
                        placeholder="e.g. change gold plating to silver chrome, change clear crystals to red"
                        value={recolorPrompt}
                        onChange={e => setRecolorPrompt(e.target.value)}
                        disabled={enh.busy}
                      />
                      <button type="button"
                        disabled={enh.busy || !recolorPrompt.trim()}
                        onClick={() => runEnhance(enh.i, 'recolor', recolorPrompt.trim())}
                        className="btn-primary text-xs py-1.5 disabled:opacity-40">
                        {enh.busy ? 'Working…' : 'Apply recolor'}
                      </button>
                      <p className="text-2xs text-ink-60 leading-snug">AI changes only what you describe — shape, background, and unmentioned colours stay the same. Always review before keeping.</p>
                    </div>
                  )}
                </div>
                {enh.error && <p className="text-xs text-red-500 mt-2">{enh.error}</p>}
                {enh.colorWarning && (
                  <div className="flex items-start gap-2 mt-3 rounded-none border border-amber-300 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 leading-snug">
                      <span className="font-semibold">Possible colour change detected.</span>{' '}
                      Parts of the product that were coloured in the original appear white or transparent in the enhanced version.
                      Describe the product colours above and try again, or discard and use the original.
                    </p>
                  </div>
                )}
                {enh.reframed && (
                  <div className="flex items-start gap-2 mt-3 rounded-none border border-amber-300 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 leading-snug">
                      <span className="font-semibold">The AI reframed the shot.</span>{' '}
                      The output aspect ratio differs from the original — the product was cropped, zoomed or re-centred.
                      Check the framing before keeping.
                    </p>
                  </div>
                )}
                </>
                )}

                {/* Shared footer — actions apply to whatever the active tab produced */}
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {editTab === 'ai' && <>
                    <button type="button" disabled={enh.busy} onClick={() => runEnhance(enh.i, 'clean')}
                            className="btn-secondary text-sm">Clean (white bg, faithful)</button>
                    <button type="button" disabled={enh.busy} onClick={() => runEnhance(enh.i, 'enhance')}
                            className="btn-secondary text-sm">Enhance (lighting + colour)</button>
                  </>}
                  <div className="flex-1" />
                  <button type="button" disabled={enh.busy} onClick={() => setEnh(null)} className="text-sm text-ink-60 hover:text-ink px-2">Discard</button>
                  <button type="button" disabled={enh.busy || !enh.after} onClick={saveEnhancedAsNew} className="btn-secondary text-sm inline-flex items-center gap-1">
                    <Plus size={14} /> {enh.busy ? 'Saving…' : 'Save as new'}
                  </button>
                  <button type="button" disabled={enh.busy || !enh.after} onClick={keepEnhanced} className="btn-primary text-sm inline-flex items-center gap-1">
                    <Check size={14} /> {enh.busy ? 'Saving…' : 'Replace original'}
                  </button>
                </div>
                <p className="text-2xs text-ink-60 mt-2">
                  {editTab === 'ai'
                    ? "AI re-renders the image — check the shape, plating colour and stone colours match the real product before keeping. The original isn't changed until you Keep."
                    : "Adjustments are applied exactly as shown. The original isn't changed until you Keep."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Packing */}
        <div className="card p-5">
          <h2 className="text-base mb-1">Packing</h2>
          <p className="text-xs text-ink-60 mb-3">Default carton & weight info for shipping quotes (per-variant packaging notes go below).</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 [&_label.label]:min-h-[2.2rem] [&_label.label]:flex [&_label.label]:items-end">
            {PACKING_FIELDS.map(pf => (
              <div key={pf.key}>
                <label className="label">{pf.label}</label>
                <input className="input text-sm" value={form.packing[pf.key] ?? ''}
                       onChange={setPacking(pf.key)} placeholder={pf.placeholder} />
              </div>
            ))}
          </div>
        </div>

        {/* Variants / SKUs */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Variations & Stock</h2>
            <button type="button" onClick={addVariant} className="btn-secondary text-xs">+ Add variation</button>
          </div>
          <p className="text-xs text-ink-60 mb-3">One row per plating. Tick the crystal colours each plating can be made in — colours don't create separate SKUs, stock, or price changes; the SKU is built at quote time. For a colour that costs more, add a separate variation with its own price.</p>


          <div className="space-y-4">
            {form.variants.map((v, i) => {
              const sku = buildSku(form.design_no, form.format_code, v)
              return (
                <div key={i} className="border border-ivory-dark p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      <div className="relative w-16 h-16">
                        <button type="button" onClick={() => { setPickerUrl(''); setPickerFor(pickerFor === i ? null : i) }}
                                className="w-16 h-16 bg-white border border-ivory-dark flex items-center justify-center overflow-hidden cursor-pointer hover:border-brand-400 transition-colors"
                                title="Choose an image">
                          {uploading === `variant-${i}`
                            ? <span className="text-2xs text-ink-60">…</span>
                            : v.image
                              ? <img src={v.image} alt="" className="w-full h-full object-contain p-1" />
                              : <Gem size={20} className="text-platinum" />}
                        </button>
                        {v.image && (
                          <button type="button" onClick={() => patchVariant(i, { image: '' })}
                                  className="absolute -top-1.5 -right-1.5 bg-white border border-ivory-dark text-red-600 rounded-full w-5 h-5 text-xs leading-none shadow-sm hover:bg-red-50"
                                  title="Remove image">×</button>
                        )}

                        {pickerFor === i && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setPickerFor(null)} />
                            <div className="absolute z-40 top-[4.5rem] left-0 w-64 bg-white border border-ivory-dark rounded-none shadow-lg p-2.5 space-y-2">
                              {form.gallery.length > 0 ? (
                                <>
                                  <p className="text-2xs text-ink-60">Use a product image</p>
                                  <div className="grid grid-cols-4 gap-1">
                                    {form.gallery.map((g, gi) => g.url && (
                                      <button key={gi} type="button"
                                              onClick={() => { patchVariant(i, { image: g.url }); setPickerFor(null) }}
                                              className={`relative aspect-square bg-white border rounded-none overflow-hidden hover:border-brand-400 ${g.url === v.image ? 'border-brand-500 ring-1 ring-brand-400' : 'border-ivory-dark'}`}
                                              title={g.caption || 'Use this image'}>
                                        <img src={g.url} alt="" className="w-full h-full object-contain p-0.5" />
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <p className="text-2xs text-ink-60">No images yet — upload one below or in the Images section.</p>
                              )}
                              <div className="flex items-center gap-2 pt-1 border-t border-ivory-dark">
                                <label className="text-xs text-brand-600 hover:text-brand-700 cursor-pointer inline-flex items-center gap-1">
                                  ＋ Upload new
                                  <input type="file" accept="image/*" className="hidden"
                                         onChange={e => handleVariantUpload(i, e.target.files[0])} />
                                </label>
                                {v.image && (
                                  <button type="button" onClick={() => { setLightbox({ url: v.image }); setPickerFor(null) }}
                                          className="text-xs text-ink-60 hover:text-ink ml-auto">Enlarge</button>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <input type="url" value={pickerUrl} onChange={e => setPickerUrl(e.target.value)}
                                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyVariantUrl(i, pickerUrl) } }}
                                       placeholder="…or paste an image URL"
                                       className="input text-xs flex-1 min-w-0 py-1" />
                                <button type="button" onClick={() => applyVariantUrl(i, pickerUrl)} disabled={!pickerUrl.trim()}
                                        className="btn-secondary text-xs py-1 px-2 shrink-0 disabled:opacity-40">Use</button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-ink-80 bg-ivory px-2 py-0.5 rounded-none">{sku || '—'}</span>
                          {v.image && (
                            <button type="button" onClick={() => downloadRangeImage(v.image, sku || form.design_name)}
                                    className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                                    title={`Download image as ${sku || 'image'}`}>
                              <Download size={13} /> Download
                            </button>
                          )}
                        </div>
                        <button type="button" onClick={() => removeVariant(i)} className="text-red-500 hover:text-red-700 text-lg leading-none px-1" title="Remove variation">×</button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 [&_label.label]:min-h-[2.2rem] [&_label.label]:flex [&_label.label]:items-end">
                        <div>
                          <label className="label">Prefix</label>
                          <input className="input text-xs font-mono uppercase" value={v.brand_code}
                                 maxLength={brandMax} placeholder={brandMax === 2 ? 'UA' : 'D'}
                                 onChange={e => applyCode(i, 'brand', e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, brandMax))} />
                          <p className="text-2xs text-ink-60 mt-0.5 leading-tight">
                            1st: D=Bohemia U=Swarovski A=Asfour M=Mixed{brandMax === 2 ? ' · 2nd: A=Crystal body C=Glassware D=Display unit' : ''}
                          </p>
                        </div>
                        <div>
                          <label className="label">Plating</label>
                          <input className="input text-xs font-mono" list="platings" value={v.plating_code} onChange={setPlating(i)} placeholder="G" />
                          <datalist id="platings">
                            {RANGE_PLATINGS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                          </datalist>
                          <p className="text-2xs text-ink-60 mt-0.5 leading-tight">G = Gold · C = Chrome · R = Rose Gold · A = Gun Metal</p>
                        </div>
                        <div>
                          <label className="label">Running No.</label>
                          <input className="input text-xs font-mono" value={v.running_no} onChange={setVariant(i, 'running_no')} placeholder="(opt.)" />
                        </div>
                        <div>
                          <label className="label">WS Price USD</label>
                          <input className="input text-xs" type="number" step="0.01" value={v.ws_price_usd} onChange={setVariant(i, 'ws_price_usd')} />
                        </div>
                        <div>
                          <label className="label">Packaging</label>
                          <input className="input text-xs" value={v.packaging} onChange={setVariant(i, 'packaging')} placeholder="Gift box…" />
                        </div>
                        <div>
                          <label className="label">Engraving</label>
                          <input className="input text-xs" value={v.engraving} onChange={setVariant(i, 'engraving')} placeholder="Logo / text…" />
                        </div>
                        <div className="col-span-2 sm:col-span-4">
                          <label className="label">Description <span className="text-ink-60 font-normal">(auto from plating + crystal, editable)</span></label>
                          <input className="input text-xs" value={v.description} onChange={setVariant(i, 'description')} placeholder="Gold, Crystal AB" />
                        </div>
                      </div>

                      {/* Crystal colours for this plating — selectable attribute, not a SKU/stock dimension */}
                      <div className="border-t border-ivory-dark pt-2 mt-1">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-2xs uppercase tracking-wide text-ink-60">Crystal colours</label>
                          <Link to="/components" className="text-2xs text-brand-600 hover:underline">Manage library →</Link>
                        </div>
                        {libColors.length === 0 ? (
                          <p className="text-2xs text-ink-60">
                            No colours in the library yet — add them in <Link to="/components" className="text-brand-600 hover:underline">Components</Link>,
                            or run “Collapse colours” on the Figurine Gifts list.
                          </p>
                        ) : (() => {
                          const sel = Array.isArray(v.crystal_colors) ? v.crystal_colors : []
                          const missing = sel.filter(code => !colorLookup[code])
                          const term = (colorSearch[i] || '').trim().toLowerCase()
                          const shown = term
                            ? libColors.filter(c => `${c.code} ${c.name}`.toLowerCase().includes(term))
                            : libColors
                          return (
                            <>
                              {/* Action bar */}
                              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-2 text-2xs">
                                <span className="text-ink-60">{sel.length} selected</span>
                                <button type="button" onClick={() => setVariantColors(i, libColors.map(c => c.code))}
                                  className="text-brand-600 hover:underline">Select all</button>
                                <button type="button" onClick={() => setVariantColors(i, [])}
                                  className="text-ink-60 hover:underline" disabled={sel.length === 0}>Clear</button>
                                {form.variants.length > 1 && (
                                  <button type="button" onClick={() => applyColorsToAll(i)}
                                    className="text-brand-600 hover:underline ml-auto" title="Apply this variation's colours to every variation">
                                    Copy to all variations →
                                  </button>
                                )}
                              </div>
                              {/* Filter */}
                              <input className="input text-xs mb-2" placeholder="Filter colours…"
                                     value={colorSearch[i] || ''} onChange={e => setColorTerm(i, e.target.value)} />
                              {/* All colours as rapid toggle chips */}
                              <div className="flex flex-wrap gap-1.5">
                                {shown.length === 0 ? (
                                  <p className="text-2xs text-ink-60">No matching colours.</p>
                                ) : shown.map(c => {
                                  const on = sel.includes(c.code)
                                  return (
                                    <button key={c.code} type="button" onClick={() => toggleColor(i, c.code)}
                                      title={c.name || c.code}
                                      className={`text-2xs font-mono px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-ink text-white border-ink' : 'bg-white text-ink-70 border-ivory-dark hover:border-brand-400 hover:text-brand-600'}`}>
                                      {c.code}
                                    </button>
                                  )
                                })}
                              </div>
                              {/* Orphan colours not in library */}
                              {missing.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {missing.map(code => (
                                    <span key={code}
                                      className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-300">
                                      {code} (not in library)
                                      <button type="button" onClick={() => toggleColor(i, code)}
                                        className="leading-none hover:opacity-70" title="Remove">×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {sel.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                                  {sel.slice(0, 8).map(code => {
                                    const exSku = buildRangeSku({
                                      brand_code: v.brand_code, design_no: form.design_no, format: form.format_code,
                                      plating_code: v.plating_code, crystal_code: code, running_no: v.running_no,
                                    })
                                    const price = rangePrice(v, colorLookup[code])
                                    return (
                                      <span key={code} className="text-2xs font-mono text-ink-70">
                                        {exSku}{price ? <span className="text-ink-60"> ${price.toFixed(2)}</span> : null}
                                      </span>
                                    )
                                  })}
                                  {sel.length > 8 && <span className="text-2xs text-ink-60">+{sel.length - 8} more</span>}
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>

                      <VariantColourPreview docId={docId} index={i} variant={v} libColors={libColors} gallery={form.gallery}
                        onPromote={(code, url) => patchVariant(i, { colour_images: { ...(v.colour_images || {}), [code]: url } })}
                        galleryUrls={form.gallery.map(g => g.url)}
                        onAddToGallery={(code, url) => {
                          const caption = buildRangeSku({
                            brand_code: v.brand_code, design_no: form.design_no, format: form.format_code,
                            plating_code: v.plating_code, crystal_code: code, running_no: v.running_no,
                          })
                          setForm(f => f.gallery.some(g => g.url === url)
                            ? f
                            : { ...f, gallery: [...f.gallery, { url, caption }] })
                        }} />
                    </div>
                  </div>
                </div>
              )
            })}
            {form.variants.length === 0 && <p className="text-sm text-ink-60">No variations — add one.</p>}
          </div>
        </div>

        {/* Crystal BOM — the positions this model takes, and how a mix splits
            them across colours. Replaces the old Crystal Mixtures editor, which
            held a colour list with no quantities and was populated from a
            marketing CSV that the job-order BOM contradicts. */}
        <CrystalBomEditor
          bom={form.crystal_components}
          onChange={next => setForm(f => ({ ...f, crystal_components: next }))}
          crystals={libCrystals}
          mixCodes={libColors.map(c => c.code).filter(isMixCode)}
        />

        {/* Actions */}
        <div className="flex items-center justify-between">
          {!isNew
            ? <button type="button" onClick={handleDelete} disabled={saving} className="btn-danger text-sm">Delete</button>
            : <span />}
          <div className="flex gap-2">
            <Link to="/range" className="btn-secondary text-sm">Cancel</Link>
            <button type="submit" disabled={saving || uploading} className="btn-primary text-sm">
              {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
