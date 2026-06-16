import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import rangeData from '../data/rangeProducts.json'
import LoadingBar from '../components/LoadingBar'

const FINISH_DOT = { Gold: '#C6A664', Chrome: '#9AA0A6', Gunmetal: '#4A4A47' }

function money(v) {
  return v == null || v === '' ? '—' : `$${Number(v).toFixed(2)}`
}
function stockBadge(n) {
  if (n == null || n === '') return { label: 'No data', cls: 'bg-gray-100 text-gray-500' }
  if (n <= 0) return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' }
  if (n < 100) return { label: `Low · ${Math.round(n)}`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${Math.round(n)} in stock`, cls: 'bg-emerald-100 text-emerald-700' }
}

export default function Range() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [finish, setFinish] = useState('')
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
    if (!confirm(`Import ${rangeData.products.length} designs from the active sheet into the database?`)) return
    setSeeding(true)
    try {
      let n = 0
      for (const p of rangeData.products) {
        await addDoc(collection(db, 'range_products'), {
          design_code: p.design_code,
          design_name: p.design_name,
          description: p.description || '',
          category: p.category || '',
          format_code: p.format_code || '',
          size: p.size || '',
          crystal_type: p.crystal_type || 'Bohemia',
          packing: p.packing || {
            carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
            cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
          },
          active: true,
          finishes: p.finishes.map(f => ({
            sku: f.sku,
            finish_code: f.finish_code,
            finish_name: f.finish_name,
            ws_price_usd: f.ws_price_usd ?? null,
            stock_finished: f.stock_finished ?? null,
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

  // Flatten to one card per finish (SKU), keep parent product id for editing
  const skus = useMemo(() => products.flatMap(p =>
    (p.finishes || []).map((f, i) => ({
      key: `${p.id}-${i}`,
      productId: p.id,
      name: p.design_name,
      category: p.category,
      size: p.size,
      active: p.active !== false,
      sku: f.sku,
      finish_name: f.finish_name,
      ws_price_usd: f.ws_price_usd,
      stock: f.stock_finished,
      image: f.image,
    }))
  ), [products])

  const categories = useMemo(() => [...new Set(skus.map(s => s.category).filter(Boolean))].sort(), [skus])
  const finishes = useMemo(() => [...new Set(skus.map(s => s.finish_name).filter(Boolean))].sort(), [skus])

  const filtered = useMemo(() => skus.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.sku?.toLowerCase().includes(q)
    const matchCat = !cat || s.category === cat
    const matchFinish = !finish || s.finish_name === finish
    const matchStock = !stockOnly || (s.stock != null && s.stock > 0)
    return matchSearch && matchCat && matchFinish && matchStock
  }), [skus, search, cat, finish, stockOnly])

  const totalValue = filtered.reduce((sum, s) =>
    sum + (s.ws_price_usd && s.stock > 0 ? s.ws_price_usd * s.stock : 0), 0)

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
          <button onClick={handleSeed} disabled={seeding} className="btn-primary">
            {seeding ? 'Importing…' : `Import ${rangeData.products.length} designs`}
          </button>
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
        <div className="text-right">
          <p className="text-sm text-ink-60">{filtered.length} of {skus.length} SKUs</p>
          <p className="text-xs text-ink-60">Stock value ≈ ${Math.round(totalValue).toLocaleString()} USD (WS)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 my-5 flex-wrap items-center">
        <input type="text" placeholder="Search name or SKU…" className="input flex-1 min-w-0"
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-auto" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={finish} onChange={e => setFinish(e.target.value)}>
          <option value="">All finishes</option>
          {finishes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-80 px-2 cursor-pointer select-none">
          <input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)} />
          In stock only
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No SKUs match your filters.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {filtered.map(s => <SkuCard key={s.key} s={s} />)}
        </div>
      )}
    </div>
  )
}

function SkuCard({ s }) {
  const sb = stockBadge(s.stock)
  return (
    <Link to={`/range/${s.productId}`} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow group">
      <div className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark relative">
        {s.image
          ? <img src={s.image} alt={s.name} className="w-full h-full object-contain p-2" loading="lazy" />
          : <span className="text-3xl opacity-30">💎</span>}
        {!s.active && <span className="absolute top-1.5 left-1.5 badge bg-gray-200 text-gray-600">Hidden</span>}
        <span className="absolute bottom-1.5 right-1.5 text-[10px] uppercase tracking-wide bg-ink/70 text-white px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FINISH_DOT[s.finish_name] || '#ccc' }} />
          <span className="text-[11px] text-ink-60 uppercase tracking-wide font-label">{s.finish_name}</span>
        </div>
        <h3 className="text-sm leading-tight text-ink line-clamp-2" title={s.name}>{s.name}</h3>
        <p className="text-[11px] text-ink-60 font-mono">{s.sku}</p>
        <p className="text-[11px] text-ink-60">{s.size}</p>
        <div className="mt-auto pt-1.5 flex items-center justify-between">
          <span className="text-base text-ink">{money(s.ws_price_usd)}</span>
          <span className={`badge ${sb.cls}`}>{sb.label}</span>
        </div>
      </div>
    </Link>
  )
}
