import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, addDoc, getDocs, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import rangeData from '../data/rangeProducts.json'
import packingDb from '../data/packingDb.json'
import { RANGE_PLATINGS, RANGE_STATUSES, RANGE_CRYSTAL_BRANDS, designNumber, brandLetter, bodyLetter } from '../constants'

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))
import LoadingBar from '../components/LoadingBar'

const PLATING_DOT = Object.fromEntries(RANGE_PLATINGS.map(p => [p.name, p.dot]))
const STATUS_META = Object.fromEntries(RANGE_STATUSES.map(s => [s.value, s]))

function money(v) {
  return v == null || v === '' ? '—' : `$${Number(v).toFixed(2)}`
}
function priceRange(min, max) {
  if (min == null) return '—'
  return min === max ? money(min) : `${money(min)}–${money(max)}`
}
function stockBadge(n) {
  if (n == null) return { label: 'No data', cls: 'bg-gray-100 text-gray-500' }
  if (n <= 0) return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' }
  if (n < 100) return { label: `Low · ${Math.round(n)}`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${Math.round(n)} in stock`, cls: 'bg-emerald-100 text-emerald-700' }
}

// Normalise a stored doc (new `variants` shape, or legacy `finishes`) to variants[]
function docVariants(p) {
  if (Array.isArray(p.variants) && p.variants.length) return p.variants
  return (p.finishes || []).map(f => ({
    plating_code: f.finish_code, plating_name: f.finish_name,
    crystal_code: '', crystal_name: '', running_no: '',
    sku: f.sku, ws_price_usd: f.ws_price_usd, stock_finished: f.stock_finished, image: f.image,
  }))
}

export default function Range() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [ptype, setPtype] = useState('')
  const [status, setStatus] = useState('all')
  const [stockOnly, setStockOnly] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedLog, setSeedLog] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'range_products'), orderBy('design_code'))
    return onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  async function handleSeed() {
    const existingCount = products.length
    const msg = existingCount > 0
      ? `This will DELETE the ${existingCount} existing design(s) and re-import ${rangeData.products.length} fresh from the active sheet. Any manual edits will be lost. Continue?`
      : `Import ${rangeData.products.length} designs from the active sheet into the database?`
    if (!confirm(msg)) return
    setSeeding(true)
    try {
      if (existingCount > 0) {
        setSeedLog('Deleting existing designs…')
        const snap = await getDocs(collection(db, 'range_products'))
        await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'range_products', d.id))))
        setSeedLog(`Deleted ${snap.docs.length}. Importing…`)
      }
      let n = 0
      for (const p of rangeData.products) {
        const designNo = p.design_no || designNumber(p.design_code)
        // Seed the plating stock pool = sum of per-variant stock by plating.
        const platingStock = {}
        for (const v of (p.variants || [])) {
          const k = (v.plating_code || '').trim().toUpperCase()
          if (!k) continue   // unplated variants keep stock per SKU
          const q = Number(v.stock_finished)
          if (Number.isFinite(q) && q > 0) platingStock[k] = (platingStock[k] || 0) + q
        }
        await addDoc(collection(db, 'range_products'), {
          design_no: designNo,
          body_code: p.body_code || '',
          body_name: p.body_name || '',
          design_code: p.design_code || designNo,
          design_name: p.design_name || '',
          description: p.description || '',
          category: p.category || '',
          format_code: p.format_code || '001',
          size: p.size || '',
          crystal_type: p.crystal_type || 'Bohemia',
          design_type: p.design_type || p.category || '',
          product_type: p.product_type || 'Figurine',
          status: p.status || 'active',
          plating_stock: platingStock,
          gallery: p.gallery || [],
          packing: p.packing || {
            carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
            cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
          },
          active: (p.status || 'active') === 'active',
          variants: (p.variants || []).map(v => ({
            brand_code: v.brand_code || 'D',
            brand_name: v.brand_name || BRAND_NAME[v.brand_code] || '',
            plating_code: v.plating_code || '',
            plating_name: v.plating_name || '',
            crystal_code: v.crystal_code || '',
            crystal_name: v.crystal_name || '',
            running_no: v.running_no || '',
            description: v.description || '',
            sku: v.sku || '',
            ws_price_usd: v.ws_price_usd ?? null,
            stock_finished: v.stock_finished ?? null,
            packaging: v.packaging || '',
            engraving: v.engraving || '',
            image: v.image || '',
          })),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        n++
        setSeedLog(`Imported ${n}/${rangeData.products.length}…`)
      }
      setSeedLog(`✅ Imported ${n} designs.`)
    } catch (err) {
      setSeedLog(`❌ ${err.message}`)
    } finally {
      setSeeding(false)
    }
  }

  // Non-destructive: patch each product's packing (+ blank size) from packing_db,
  // matched on design_no(4) + format_code. Leaves all other fields untouched.
  async function handleSyncPacking() {
    const keysAvailable = Object.keys(packingDb).length
    if (!confirm(`Update packing info on matching products from packing_db (${keysAvailable} entries)? This only fills carton/CBM/weight/pack-box fields and won't touch prices, stock, or names.`)) return
    setSeeding(true)
    try {
      const snap = await getDocs(collection(db, 'range_products'))
      let updated = 0, skipped = 0
      for (const d of snap.docs) {
        const p = d.data()
        const dn = (p.design_no || designNumber(p.design_code) || '').padStart(4, '0')
        const rec = packingDb[`${dn}-${p.format_code || ''}`]
        if (!rec) { skipped++; continue }
        const packing = {
          ...(p.packing || {}),
          pcs_per_carton: rec.pcs_per_carton || p.packing?.pcs_per_carton || '',
          cbm_per_carton: rec.cbm_per_carton || p.packing?.cbm_per_carton || '',
          weight_per_carton_kg: rec.weight_per_carton_kg || p.packing?.weight_per_carton_kg || '',
          weight_per_pcs_kg: rec.weight_per_pcs_kg || p.packing?.weight_per_pcs_kg || '',
          pack_box_ref: rec.pack_box_ref || p.packing?.pack_box_ref || '',
        }
        const patch = { packing, updatedAt: serverTimestamp() }
        if (!((p.size || '').trim()) && rec._size) patch.size = rec._size
        await updateDoc(doc(db, 'range_products', d.id), patch)
        updated++
        setSeedLog(`Packing: updated ${updated}, skipped ${skipped}…`)
      }
      setSeedLog(`✅ Packing synced — ${updated} updated, ${skipped} had no match.`)
    } catch (err) {
      setSeedLog(`❌ ${err.message}`)
    } finally {
      setSeeding(false)
    }
  }

  // One item per product (design number + format); variations collapsed inside
  const items = useMemo(() => products.map(p => {
    const fallbackBrand = brandLetter(p.design_code) || 'D'
    const designNo = p.design_no || designNumber(p.design_code)
    const body = p.body_code || bodyLetter(p.design_code)
    const variants = docVariants(p)
    const prices = variants.map(v => v.ws_price_usd).filter(x => x != null)
    // Plated variants pool by plating; unplated variants count stock per SKU.
    const pool = p.plating_stock && Object.keys(p.plating_stock).length ? p.plating_stock : null
    const totalStock = pool
      ? Object.values(pool).reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0)
        + variants.reduce((s, v) => s + (!(v.plating_code || '').trim() && v.stock_finished > 0 ? v.stock_finished : 0), 0)
      : variants.reduce((s, v) => s + (v.stock_finished > 0 ? v.stock_finished : 0), 0)
    const platings = [...new Set(variants.map(v => v.plating_name).filter(Boolean))]
    const brands = [...new Set(variants.map(v => v.brand_code || fallbackBrand).filter(Boolean))]
    const image = variants.find(v => v.image)?.image || (Array.isArray(p.gallery) && p.gallery[0]) || ''
    // Show the full SKU prefix in the code when the design has a single brand
    // (e.g. UA061-231, D0002-001). Multi-brand designs show the shared base
    // code + per-brand chips so the prefix letters aren't lost.
    const brandPrefix = brands.length === 1 ? brands[0] : ''
    const code = [`${brandPrefix}${body}${designNo}`, p.format_code].filter(Boolean).join('-')
    return {
      id: p.id,
      code,
      multiBrand: brands.length > 1,
      name: p.description || p.design_name || code,
      design_type: p.design_type || p.category || '',
      product_type: p.product_type || '',
      size: p.size,
      active: p.active !== false,
      status: p.status === 'stock' ? 'stock' : 'active',
      variants, platings, brands, image,
      skus: variants.map(v => v.sku).filter(Boolean),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      totalStock,
      skuCount: variants.length,
    }
  }), [products])

  const categories = useMemo(() => [...new Set(items.map(s => s.design_type).filter(Boolean))].sort(), [items])
  const productTypes = useMemo(() => [...new Set(items.map(s => s.product_type).filter(Boolean))].sort(), [items])

  const filtered = useMemo(() => items.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q)
      || s.skus.some(sku => sku?.toLowerCase().includes(q))
    const matchCat = !cat || s.design_type === cat
    const matchPtype = !ptype || s.product_type === ptype
    const matchPlating = true
    const matchStatus = status === 'all' || s.status === status
    const matchStock = !stockOnly || s.totalStock > 0
    return matchSearch && matchCat && matchPtype && matchPlating && matchStatus && matchStock
  }), [items, search, cat, ptype, status, stockOnly])

  const statusCounts = useMemo(() => ({
    all: items.length,
    active: items.filter(s => s.status === 'active').length,
    stock: items.filter(s => s.status === 'stock').length,
  }), [items])

  const totalSkus = items.reduce((n, s) => n + s.skuCount, 0)
  const totalValue = filtered.reduce((sum, s) =>
    sum + s.variants.reduce((a, v) => a + (v.ws_price_usd && v.stock_finished > 0 ? v.ws_price_usd * v.stock_finished : 0), 0), 0)

  // Empty-state: offer to seed from the bundled active sheet
  if (!loading && products.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-xl">
        <h1 className="text-xl md:text-2xl mb-4">Figurine Gifts</h1>
        <div className="card p-6">
          <p className="text-sm text-ink-80 mb-1">No figurine products in the database yet.</p>
          <p className="text-sm text-ink-60 mb-4">
            Import the active catalogue ({rangeData.products.length} designs · {rangeData.products.reduce((n, p) => n + (p.variants || []).length, 0)} SKUs)
            from your working sheet. You can then edit any of them.
          </p>
          <div className="flex gap-2">
            <button onClick={handleSeed} disabled={seeding} className="btn-primary">
              {seeding ? 'Importing…' : `Import ${rangeData.products.length} designs`}
            </button>
            <Link to="/range/new" className="btn-secondary">+ New product</Link>
          </div>
          {seedLog && <p className="text-xs font-mono text-ink-60 mt-3">{seedLog}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-1">
        <div>
          <h1 className="text-xl md:text-2xl">Figurine Gifts</h1>
          <p className="text-sm text-ink-60 mt-0.5">{filtered.length} of {items.length} products · {totalSkus} SKUs</p>
          <p className="text-xs text-ink-60">Stock value ≈ ${Math.round(totalValue).toLocaleString()} USD (WS)</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleSyncPacking} disabled={seeding} className="btn-secondary text-sm flex-1 md:flex-none">
            {seeding ? 'Working…' : 'Sync packing'}
          </button>
          <Link to="/range/new" className="btn-primary text-sm flex-1 md:flex-none text-center">+ New product</Link>
        </div>
      </div>
      {seedLog && <p className="text-xs font-mono text-ink-60 mb-2">{seedLog}</p>}

      {/* Active / Stock-clearance toggle */}
      <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden mt-3">
        {[
          { v: 'all', label: 'All' },
          { v: 'active', label: 'Active' },
          { v: 'stock', label: 'Stock clearance' },
        ].map(t => (
          <button key={t.v} onClick={() => setStatus(t.v)}
                  className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors
                    ${status === t.v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
            {t.label} <span className="opacity-60">{statusCounts[t.v]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 my-5 sm:flex-wrap sm:items-center">
        <input type="text" placeholder="Search name, code or SKU…" className="input w-full sm:flex-1 sm:min-w-0"
               value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <select className="input flex-1 sm:flex-none sm:w-auto min-w-0" value={ptype} onChange={e => setPtype(e.target.value)}>
            <option value="">All product cats</option>
            {productTypes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input flex-1 sm:flex-none sm:w-auto min-w-0" value={cat} onChange={e => setCat(e.target.value)}>
            <option value="">All design cats</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-80 sm:px-2 cursor-pointer select-none">
          <input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)} />
          In stock only
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No products match your filters.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {filtered.map(s => <ProductCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  )
}

function ProductCard({ s }) {
  const sb = stockBadge(s.variants.length ? s.totalStock : null)
  return (
    <Link to={`/range/${s.id}`} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow group">
      <div className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark relative">
        {s.image
          ? <img src={s.image} alt={s.name} className="w-full h-full object-contain p-2" loading="lazy" />
          : <span className="text-3xl opacity-30">💎</span>}
        <span className={`absolute top-1.5 left-1.5 badge ${STATUS_META[s.status]?.badge || ''}`}>
          {STATUS_META[s.status]?.label || s.status}
        </span>
        {!s.active && <span className="absolute top-7 left-1.5 badge bg-gray-200 text-gray-600">Hidden</span>}
        {s.skuCount > 1 && (
          <span className="absolute top-1.5 right-1.5 text-[10px] bg-ink/70 text-white px-1.5 py-0.5 rounded">{s.skuCount} variations</span>
        )}
        <span className="absolute bottom-1.5 right-1.5 text-[10px] uppercase tracking-wide bg-ink/70 text-white px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-1">
          {s.platings.length > 0
            ? s.platings.map(p => (
                <span key={p} className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: PLATING_DOT[p] || '#ccc' }} title={p} />
              ))
            : <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-gray-200" />}
          <span className="text-[11px] text-ink-60 uppercase tracking-wide font-label ml-1 truncate">
            {s.platings.join(' · ') || '—'}
          </span>
        </div>
        <h3 className="text-sm leading-tight text-ink line-clamp-2" title={s.name}>{s.name}</h3>
        <div className="flex items-center gap-1 flex-wrap">
          <p className="text-[11px] text-ink-60 font-mono">{s.code}</p>
          {s.multiBrand && s.brands.map(b => (
            <span key={b} className="text-[9px] uppercase tracking-wide bg-ivory text-ink-60 border border-ivory-dark rounded px-1 leading-tight"
                  title={`Also available in ${BRAND_NAME[b] || b}`}>{b}</span>
          ))}
        </div>
        <p className="text-[11px] text-ink-60">{s.size}</p>
        <div className="mt-auto pt-1.5 flex items-center justify-between">
          <span className="text-base text-ink">{priceRange(s.minPrice, s.maxPrice)}</span>
          <span className={`badge ${sb.cls}`}>{sb.label}</span>
        </div>
      </div>
    </Link>
  )
}
