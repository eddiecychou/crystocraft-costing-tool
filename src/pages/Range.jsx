import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, addDoc, getDocs, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import rangeData from '../data/rangeProducts.json'
import { RANGE_PLATINGS, RANGE_STATUSES, RANGE_CRYSTAL_BRANDS, designNumber, brandLetter } from '../constants'

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
  const [plating, setPlating] = useState('')
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
        const brand = brandLetter(p.design_code) || 'D'
        const designNo = designNumber(p.design_code)
        await addDoc(collection(db, 'range_products'), {
          design_no: designNo,
          design_code: designNo,
          design_name: p.design_name,
          description: p.description || '',
          category: p.category || '',
          format_code: p.format_code || '001',
          size: p.size || '',
          crystal_type: p.crystal_type || 'Bohemia',
          design_type: p.design_type || p.category || '',
          product_type: p.product_type || 'Figurine',
          gallery: p.gallery || [],
          packing: p.packing || {
            carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
            cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
          },
          active: true,
          variants: p.finishes.map(f => ({
            brand_code: brand,
            brand_name: BRAND_NAME[brand] || '',
            plating_code: f.finish_code || '',
            plating_name: f.finish_name || '',
            crystal_code: '',
            crystal_name: '',
            running_no: '',
            sku: f.sku,
            ws_price_usd: f.ws_price_usd ?? null,
            stock_finished: f.stock_finished ?? null,
            packaging: '',
            engraving: '',
            image: f.image || '',
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

  // One item per product (design number + format); variations collapsed inside
  const items = useMemo(() => products.map(p => {
    const fallbackBrand = brandLetter(p.design_code) || 'D'
    const designNo = p.design_no || designNumber(p.design_code)
    const variants = docVariants(p)
    const prices = variants.map(v => v.ws_price_usd).filter(x => x != null)
    const totalStock = variants.reduce((s, v) => s + (v.stock_finished > 0 ? v.stock_finished : 0), 0)
    const platings = [...new Set(variants.map(v => v.plating_name).filter(Boolean))]
    const brands = [...new Set(variants.map(v => v.brand_code || fallbackBrand).filter(Boolean))]
    const image = variants.find(v => v.image)?.image || (Array.isArray(p.gallery) && p.gallery[0]) || ''
    const code = [designNo, p.format_code].filter(Boolean).join('-')
    return {
      id: p.id,
      code,
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
  const platingOpts = useMemo(() => [...new Set(items.flatMap(s => s.platings))].sort(), [items])

  const filtered = useMemo(() => items.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q)
      || s.skus.some(sku => sku?.toLowerCase().includes(q))
    const matchCat = !cat || s.design_type === cat
    const matchPtype = !ptype || s.product_type === ptype
    const matchPlating = !plating || s.platings.includes(plating)
    const matchStatus = status === 'all' || s.status === status
    const matchStock = !stockOnly || s.totalStock > 0
    return matchSearch && matchCat && matchPtype && matchPlating && matchStatus && matchStock
  }), [items, search, cat, ptype, plating, status, stockOnly])

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
        <p className="eyebrow mb-1">Ready-to-Ship · Bohemia Crystal</p>
        <h1 className="text-xl md:text-2xl mb-4">Figurine Gifts</h1>
        <div className="card p-6">
          <p className="text-sm text-ink-80 mb-1">No figurine products in the database yet.</p>
          <p className="text-sm text-ink-60 mb-4">
            Import the active catalogue ({rangeData.products.length} designs · {rangeData.products.reduce((n, p) => n + p.finishes.length, 0)} SKUs)
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

      <div className="flex items-end justify-between mb-1 flex-wrap gap-2">
        <div>
          <p className="eyebrow mb-1">Ready-to-Ship · Bohemia Crystal</p>
          <h1 className="text-xl md:text-2xl">Figurine Gifts</h1>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <Link to="/range/new" className="btn-primary text-sm">+ New product</Link>
          <p className="text-sm text-ink-60">{filtered.length} of {items.length} products · {totalSkus} SKUs</p>
          <p className="text-xs text-ink-60">Stock value ≈ ${Math.round(totalValue).toLocaleString()} USD (WS)</p>
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
      <div className="flex gap-2 my-5 flex-wrap items-center">
        <input type="text" placeholder="Search name, code or SKU…" className="input flex-1 min-w-0"
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-auto" value={ptype} onChange={e => setPtype(e.target.value)}>
          <option value="">All product cats</option>
          {productTypes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All design cats</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={plating} onChange={e => setPlating(e.target.value)}>
          <option value="">All platings</option>
          {platingOpts.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-80 px-2 cursor-pointer select-none">
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
          {s.brands.map(b => (
            <span key={b} className="text-[9px] uppercase tracking-wide bg-ivory text-ink-60 border border-ivory-dark rounded px-1 leading-tight"
                  title={BRAND_NAME[b] || b}>{b}</span>
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
