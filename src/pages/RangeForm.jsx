import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import {
  RANGE_DESIGN_TYPES, RANGE_PRODUCT_TYPES, RANGE_FORMAT_CODES,
  RANGE_PLATINGS, RANGE_CRYSTAL_COLORS, RANGE_STATUSES, RANGE_CRYSTAL_BRANDS,
  RANGE_BODY_TYPES, designNumber, brandLetter, bodyLetter,
} from '../constants'

const BODY_NAME = Object.fromEntries(RANGE_BODY_TYPES.map(b => [b.code, b.name]))

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))
import LoadingBar from '../components/LoadingBar'
import { useCrystalColors, colorMap } from '../crystalColors'
import { buildRangeSku, rangePrice } from '../rangeSku'
import { useComponents, componentMap, productAvailability } from '../criticalComponents'

const emptyVariant = () => ({
  brand_code: 'D', brand_name: 'Bohemia',
  plating_code: '', plating_name: '', crystal_code: '', crystal_name: '', description: '',
  running_no: '', ws_price_usd: '', stock_finished: '', packaging: '', engraving: '', image: '',
  crystal_colors: [],   // selectable colour attribute, per variation (plating)
})

// Auto description = brand + plating + crystal colour (falls back to raw codes)
const autoVariantDesc = v =>
  [v.brand_name || '', v.plating_name || v.plating_code, v.crystal_name || v.crystal_code]
    .filter(Boolean).join(', ')
const emptyPacking = () => ({
  carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
  cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
})
const blankForm = () => ({
  design_no: '', body_code: '', design_name: '', description: '', category: '',
  design_type: '', product_type: 'Figurine', format_code: '001',
  size: '', crystal_type: 'Bohemia', active: true, status: 'active',
  moq: '', lead_time_weeks: '', delivery_note: '', critical_components: [],
  packing: emptyPacking(), gallery: [], variants: [emptyVariant()], plating_stock: {},
})

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
  const navigate = useNavigate()

  // Stable doc id (needed for storage paths) — generated up-front for new docs
  const docIdRef = useRef(isNew ? doc(collection(db, 'range_products')).id : routeId)
  const docId = docIdRef.current

  const [form, setForm] = useState(isNew ? blankForm() : null)
  const [fetching, setFetching] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [catOptions, setCatOptions] = useState({ design: [], product: [] })
  const { colors: libColors } = useCrystalColors()
  const colorLookup = colorMap(libColors)
  const { components: libComponents } = useComponents()
  const componentLookup = componentMap(libComponents)

  // Toggle a critical component on/off for this product (qty defaults to 1).
  const toggleComponent = code => setForm(f => {
    const list = Array.isArray(f.critical_components) ? f.critical_components : []
    const has = list.some(r => r.code === code)
    return { ...f, critical_components: has ? list.filter(r => r.code !== code) : [...list, { code, qty_per_unit: 1 }] }
  })
  const setComponentQty = (code, val) => setForm(f => ({
    ...f,
    critical_components: (f.critical_components || []).map(r =>
      r.code === code ? { ...r, qty_per_unit: val.replace(/[^\d]/g, '') } : r),
  }))

  const toggleColor = (i, code) => setForm(f => ({
    ...f,
    variants: f.variants.map((v, j) => {
      if (j !== i) return v
      const list = Array.isArray(v.crystal_colors) ? v.crystal_colors : []
      const has = list.includes(code)
      return { ...v, crystal_colors: has ? list.filter(c => c !== code) : [...list, code] }
    }),
  }))

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
          category: d.category || '',
          design_type: d.design_type || d.category || '',
          product_type: d.product_type || 'Figurine',
          format_code: d.format_code || '001',
          size: d.size || '',
          crystal_type: d.crystal_type || 'Bohemia',
          active: d.active !== false,
          status: d.status || 'active',
          moq: d.moq ?? '',
          lead_time_weeks: d.lead_time_weeks ?? '',
          delivery_note: d.delivery_note || '',
          critical_components: Array.isArray(d.critical_components)
            ? d.critical_components.map(r => ({ code: (r.code || '').toUpperCase(), qty_per_unit: r.qty_per_unit || 1 }))
            : [],
          packing: { ...emptyPacking(), ...(d.packing || {}) },
          gallery: Array.isArray(d.gallery) ? d.gallery : [],
          variants: vs,
          // Plating pool: stored map wins; else seed from legacy per-variant stock.
          plating_stock: d.plating_stock && Object.keys(d.plating_stock).length
            ? { ...d.plating_stock } : derivePlatingStock(vs),
        })
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [routeId, isNew])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))
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
    const safe = file.name.replace(/[^\w.\-]/g, '_')
    const path = `range_products/${docId}/${Date.now()}-${safe}`
    await uploadBytes(storageRef(storage, path), file)
    return getDownloadURL(storageRef(storage, path))
  }

  async function handleVariantUpload(i, file) {
    if (!file) return
    setUploading(`variant-${i}`); setError('')
    try {
      const url = await uploadFile(file)
      patchVariant(i, { image: url })
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }

  async function handleGalleryUpload(files) {
    if (!files || !files.length) return
    setUploading('gallery'); setError('')
    try {
      const urls = []
      for (const file of files) urls.push(await uploadFile(file))
      setForm(f => ({ ...f, gallery: [...f.gallery, ...urls] }))
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }
  const addGalleryUrl = () => {
    const url = prompt('Paste image URL:')
    if (url && url.trim()) setForm(f => ({ ...f, gallery: [...f.gallery, url.trim()] }))
  }
  const removeGallery = i => setForm(f => ({ ...f, gallery: f.gallery.filter((_, j) => j !== i) }))

  const num = v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
  const intNum = v => { const n = num(v); return n == null ? null : Math.round(n) }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.design_no.trim()) { setError('Design no. (e.g. 0002) is required.'); return }
    if (!form.format_code.trim()) { setError('Product type code (e.g. 001) is required.'); return }
    setSaving(true); setError('')
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
      category: form.category.trim(),
      design_type: form.design_type.trim(),
      product_type: form.product_type.trim(),
      format_code: format,
      size: form.size.trim(),
      crystal_type: form.crystal_type.trim(),
      active: form.active,
      status: form.status,
      // Production / availability — drives the customer promise alongside stock.
      moq: intNum(form.moq),
      lead_time_weeks: num(form.lead_time_weeks),
      delivery_note: (form.delivery_note || '').trim(),
      critical_components: (form.critical_components || [])
        .map(r => ({ code: (r.code || '').trim().toUpperCase(), qty_per_unit: Math.max(1, intNum(r.qty_per_unit) || 1) }))
        .filter(r => r.code),
      packing: Object.fromEntries(PACKING_FIELDS.map(pf => [pf.key, (form.packing[pf.key] ?? '').toString().trim()])),
      gallery: form.gallery,
      // Plating-level stock pool — keep only platings still present, as integers.
      plating_stock: Object.fromEntries(
        platingsUsed(form.variants)
          .map(code => [code, intNum(form.plating_stock[code])])
          .filter(([, n]) => n != null)
      ),
      variants: form.variants.map(v => ({
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
      })),
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
  }, libComponents)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="eyebrow mb-1">Figurine Gifts {productCode && `· ${productCode}`}</p>
          <h1 className="text-xl md:text-2xl">{isNew ? 'New Product' : 'Edit Product'}</h1>
        </div>
        <Link to="/range" className="btn-secondary text-sm">← Back</Link>
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
              <p className="text-[10px] text-ink-50 mt-0.5">3 or 4 digits (3 = 2-letter prefix allowed)</p>
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
          <p className="text-[11px] text-ink-60 -mt-2">
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

          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={form.description} onChange={set('description')} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-80 cursor-pointer select-none">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Visible in catalogue (untick to hide without deleting)
          </label>
        </div>

        {/* Production & Availability */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Production & Availability</h2>
            <Link to="/settings" className="text-xs text-brand-600 hover:underline">Manage components →</Link>
          </div>
          {form.status === 'stock' ? (
            <p className="text-xs text-ink-60 mb-3">
              <strong>Last Stock</strong> — retired design, no re-runs. Critical components and MOQ
              don't apply; the only thing that matters is how many finished units are left. Enter the
              remaining units in <strong>Variations &amp; Stock → Stock by plating</strong> below —
              that's the single source of truth for this item.
            </p>
          ) : (
            <p className="text-xs text-ink-60 mb-3">
              Tick the <strong>critical</strong> parts this product needs (long-lead, tooling, MOQ, or
              supply-risk items only — not plating/crystal/boxes). Stock &amp; lead time live on each
              component and are shared across products. Any units entered under <strong>Stock by
              plating</strong> count as finished surplus that ships first. The customer promise below
              is computed from status + ready stock + component availability.
            </p>
          )}

          {form.status !== 'stock' && (
          <>
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

          {/* Critical components multi-select */}
          {libComponents.length === 0 ? (
            <p className="text-sm text-ink-60">
              No components in the library yet — add your long-lead / tooling parts in{' '}
              <Link to="/settings" className="text-brand-600 hover:underline">Settings → Critical Components</Link>.
            </p>
          ) : (
            <>
              <label className="text-[11px] uppercase tracking-wide text-ink-50">Critical components</label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {libComponents.map(c => {
                  const on = (form.critical_components || []).some(r => r.code === c.code)
                  return (
                    <button key={c.code} type="button" onClick={() => toggleComponent(c.code)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                        on ? 'bg-ink text-white border-ink' : 'bg-white text-ink-70 border-ivory-dark hover:bg-ivory'}`}
                      title={`${c.stock_qty ?? 0} in stock · ${c.lead_time_weeks ?? '?'} wk lead`}>
                      {c.name || c.code}
                    </button>
                  )
                })}
              </div>

              {/* Selected components — qty per unit + live stock / lead */}
              {(form.critical_components || []).length > 0 && (
                <div className="mt-3 border-t border-ivory-dark pt-3 space-y-2">
                  {(form.critical_components || []).map(r => {
                    const c = componentLookup[r.code]
                    return (
                      <div key={r.code} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-ink-80 w-28 shrink-0 truncate" title={r.code}>{r.code}</span>
                        <span className="flex-1 min-w-0 truncate text-ink-70">{c?.name || <span className="text-amber-600">not in library</span>}</span>
                        <label className="flex items-center gap-1 shrink-0">
                          <span className="text-ink-50">×</span>
                          <input className="input text-xs w-12 text-right tabular-nums py-1" inputMode="numeric"
                                 value={r.qty_per_unit} onChange={e => setComponentQty(r.code, e.target.value)} placeholder="1" />
                          <span className="text-ink-50">/unit</span>
                        </label>
                        <span className="w-24 shrink-0 text-right text-ink-50 tabular-nums">
                          {c ? `${c.stock_qty ?? 0} pcs · ${c.lead_time_weeks ?? '?'}wk` : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
          </>
          )}

          {/* Optional override + computed customer promise */}
          <div className="mt-4">
            <label className="label">Delivery note <span className="text-ink-60 font-normal">(optional — overrides the computed promise)</span></label>
            <input className="input text-sm" value={form.delivery_note} onChange={set('delivery_note')}
                   placeholder="Leave blank to auto-generate from status + stock + components" />
          </div>

          <div className="mt-3 rounded-md bg-ivory/60 border border-ivory-dark p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-50 mb-1">What the customer sees</p>
            <p className="text-sm text-ink-80">{availability.promise}</p>
            {form.status !== 'stock' && availability.buildable != null && (
              <p className="text-[11px] text-ink-50 mt-1">
                Buildable now from component stock: <b>{availability.buildable}</b>
                {availability.bottleneck ? ` (limited by ${availability.bottleneck})` : ''} ·
                {' '}Ready stock: <b>{availability.finished}</b>
              </p>
            )}
          </div>
        </div>

        {/* Gallery */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Images</h2>
            <div className="flex gap-2">
              <button type="button" onClick={addGalleryUrl} className="btn-secondary text-xs">+ URL</button>
              <label className="btn-secondary text-xs cursor-pointer">
                {uploading === 'gallery' ? 'Uploading…' : '+ Upload'}
                <input type="file" accept="image/*" multiple className="hidden"
                       onChange={e => handleGalleryUpload(Array.from(e.target.files))} />
              </label>
            </div>
          </div>
          <p className="text-xs text-ink-60 mb-3">Extra product photos (upload files or paste links).</p>
          {form.gallery.length === 0 ? (
            <p className="text-sm text-ink-60">No extra images yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {form.gallery.map((url, i) => (
                <div key={i} className="relative group aspect-square bg-white border border-ivory-dark">
                  <img src={url} alt="" className="w-full h-full object-contain p-1" />
                  <button type="button" onClick={() => removeGallery(i)}
                          className="absolute top-1 right-1 bg-white/90 text-red-600 rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100">×</button>
                </div>
              ))}
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

          {/* Stock pool, held per plating (the binding constraint), shared across
              that plating's crystal-colour / running-no variants. */}
          <div className="border border-ivory-dark rounded-md p-3 mb-4 bg-ivory/40">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Stock by plating</h3>
              <span className="text-xs text-ink-60">Total {platingStockTotal} pcs</span>
            </div>
            <p className="text-[11px] text-ink-60 mb-2 leading-tight">
              Stock is counted per plating and shared by all crystal-colour / running-no
              variants of that plating. A variant can still set its own count below to
              override the pool for that specific SKU. Variants with <b>no plating</b>
              {' '}(e.g. crystal-body items) track stock per SKU in the rows below instead.
            </p>
            {platingsUsed(form.variants).length === 0 ? (
              <p className="text-xs text-ink-60">No plated variants — stock is entered per SKU in the rows below.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {platingsUsed(form.variants).map(code => (
                  <div key={code || '_none'}>
                    <label className="label">
                      {code ? `${code}${PLATING_NAME[code] ? ' · ' + PLATING_NAME[code] : ''}` : '(no plating)'}
                    </label>
                    <input className="input text-xs" inputMode="numeric"
                           value={form.plating_stock[code] ?? ''} onChange={setPlatingStock(code)}
                           placeholder="0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {form.variants.map((v, i) => {
              const sku = buildSku(form.design_no, form.format_code, v)
              return (
                <div key={i} className="border border-ivory-dark p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 flex flex-col items-center gap-1">
                      <div className="w-16 h-16 bg-white border border-ivory-dark flex items-center justify-center overflow-hidden">
                        {v.image ? <img src={v.image} alt="" className="w-full h-full object-contain p-1" /> : <span className="text-xl opacity-30">💎</span>}
                      </div>
                      <label className="text-[11px] text-brand-600 cursor-pointer hover:underline">
                        {uploading === `variant-${i}` ? '…' : 'Upload'}
                        <input type="file" accept="image/*" className="hidden"
                               onChange={e => handleVariantUpload(i, e.target.files[0])} />
                      </label>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-ink-80 bg-ivory px-2 py-0.5 rounded">{sku || '—'}</span>
                        <button type="button" onClick={() => removeVariant(i)} className="text-red-500 hover:text-red-700 text-lg leading-none px-1" title="Remove variation">×</button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 [&_label.label]:min-h-[2.2rem] [&_label.label]:flex [&_label.label]:items-end">
                        <div>
                          <label className="label">Prefix</label>
                          <input className="input text-xs font-mono uppercase" value={v.brand_code}
                                 maxLength={brandMax} placeholder={brandMax === 2 ? 'UA' : 'D'}
                                 onChange={e => applyCode(i, 'brand', e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, brandMax))} />
                          <p className="text-[10px] text-ink-60 mt-0.5 leading-tight">
                            1st: D=Bohemia U=Swarovski A=Asfour M=Mixed{brandMax === 2 ? ' · 2nd: A=Crystal body C=Glassware D=Display unit' : ''}
                          </p>
                        </div>
                        <div>
                          <label className="label">Plating</label>
                          <input className="input text-xs font-mono" list="platings" value={v.plating_code} onChange={setPlating(i)} placeholder="G" />
                          <datalist id="platings">
                            {RANGE_PLATINGS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                          </datalist>
                          <p className="text-[10px] text-ink-60 mt-0.5 leading-tight">G = Gold · C = Chrome · R = Rose Gold · A = Gun Metal</p>
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
                          <label className="label">
                            {platingKey(v)
                              ? <>Stock <span className="text-ink-60 font-normal">(opt.)</span></>
                              : 'Stock (pcs)'}
                          </label>
                          <input className="input text-xs" inputMode="numeric"
                                 value={v.stock_finished}
                                 placeholder={platingKey(v) ? 'pool' : '0'}
                                 onChange={e => patchVariant(i, { stock_finished: e.target.value.replace(/[^\d]/g, '') })} />
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
                        <div className="col-span-2 sm:col-span-4">
                          <label className="label">Image URL</label>
                          <input className="input text-xs" value={v.image} onChange={setVariant(i, 'image')} placeholder="/range-img/… or https://… or Upload" />
                        </div>
                      </div>

                      {/* Crystal colours for this plating — selectable attribute, not a SKU/stock dimension */}
                      <div className="border-t border-ivory-dark pt-2 mt-1">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[11px] uppercase tracking-wide text-ink-50">Crystal colours</label>
                          <Link to="/settings" className="text-[11px] text-brand-600 hover:underline">Manage library →</Link>
                        </div>
                        {libColors.length === 0 ? (
                          <p className="text-[11px] text-ink-60">
                            No colours in the library yet — add them in <Link to="/settings" className="text-brand-600 hover:underline">Settings</Link>,
                            or run “Collapse colours” on the Figurine Gifts list.
                          </p>
                        ) : (() => {
                          const sel = Array.isArray(v.crystal_colors) ? v.crystal_colors : []
                          const missing = sel.filter(code => !colorLookup[code])
                          return (
                            <>
                              <div className="flex flex-wrap gap-1.5">
                                {libColors.map(c => {
                                  const on = sel.includes(c.code)
                                  return (
                                    <button key={c.code} type="button" onClick={() => toggleColor(i, c.code)}
                                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                        on ? 'bg-ink text-white border-ink' : 'bg-white text-ink-70 border-ivory-dark hover:bg-ivory'}`}>
                                      {c.name || c.code}
                                    </button>
                                  )
                                })}
                              </div>
                              {missing.length > 0 && (
                                <p className="text-[11px] text-amber-600 mt-1.5">
                                  Not in library: {missing.join(', ')} — add them in Settings or untick.
                                </p>
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
                                      <span key={code} className="text-[11px] font-mono text-ink-70">
                                        {exSku}{price ? <span className="text-ink-50"> ${price.toFixed(2)}</span> : null}
                                      </span>
                                    )
                                  })}
                                  {sel.length > 8 && <span className="text-[11px] text-ink-50">+{sel.length - 8} more</span>}
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {form.variants.length === 0 && <p className="text-sm text-ink-60">No variations — add one.</p>}
          </div>
        </div>

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
