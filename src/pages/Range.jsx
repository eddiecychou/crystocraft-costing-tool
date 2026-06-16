import { useState, useMemo } from 'react'
import rangeData from '../data/rangeProducts.json'

// Flatten product cards into one entry per SKU (design+format+finish)
const SKUS = rangeData.products.flatMap(p =>
  p.finishes.map(f => ({
    sku: f.sku,
    design_code: p.design_code,
    name: p.design_name,
    description: p.description,
    category: p.category,
    format_code: p.format_code,
    size: p.size,
    crystal_type: p.crystal_type,
    finish_code: f.finish_code,
    finish_name: f.finish_name,
    ws_price_usd: f.ws_price_usd,
    stock: f.stock_finished,
    image: f.image,
  }))
)

const CATEGORIES = [...new Set(SKUS.map(s => s.category))].sort()
const FINISHES = [...new Set(SKUS.map(s => s.finish_name))].sort()

const FINISH_DOT = { Gold: '#C6A664', Chrome: '#9AA0A6', Gunmetal: '#4A4A47' }

function money(v) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`
}
function stockBadge(n) {
  if (n == null) return { label: 'No data', cls: 'bg-gray-100 text-gray-500' }
  if (n <= 0) return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' }
  if (n < 100) return { label: `Low · ${Math.round(n)}`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${Math.round(n)} in stock`, cls: 'bg-emerald-100 text-emerald-700' }
}

export default function Range() {
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [finish, setFinish] = useState('')
  const [stockOnly, setStockOnly] = useState(false)

  const filtered = useMemo(() => SKUS.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
    const matchCat = !cat || s.category === cat
    const matchFinish = !finish || s.finish_name === finish
    const matchStock = !stockOnly || (s.stock != null && s.stock > 0)
    return matchSearch && matchCat && matchFinish && matchStock
  }), [search, cat, finish, stockOnly])

  const totalValue = filtered.reduce((sum, s) =>
    sum + (s.ws_price_usd && s.stock > 0 ? s.ws_price_usd * s.stock : 0), 0)

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-end justify-between mb-1 flex-wrap gap-2">
        <div>
          <p className="eyebrow mb-1">Ready-to-Ship · Bohemia Crystal</p>
          <h1 className="text-xl md:text-2xl">Crystocraft Range</h1>
        </div>
        <div className="text-right">
          <p className="text-sm text-ink-60">{filtered.length} of {SKUS.length} SKUs</p>
          <p className="text-xs text-ink-60">Stock value ≈ ${Math.round(totalValue).toLocaleString()} USD (WS)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 my-5 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search name or SKU…"
          className="input flex-1 min-w-0"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={finish} onChange={e => setFinish(e.target.value)}>
          <option value="">All finishes</option>
          {FINISHES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-80 px-2 cursor-pointer select-none">
          <input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)} />
          In stock only
        </label>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No SKUs match your filters.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {filtered.map(s => <SkuCard key={s.sku} s={s} />)}
        </div>
      )}
    </div>
  )
}

function SkuCard({ s }) {
  const sb = stockBadge(s.stock)
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark">
        {s.image
          ? <img src={s.image} alt={s.name} className="w-full h-full object-contain p-2" loading="lazy" />
          : <span className="text-3xl opacity-30">💎</span>}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: FINISH_DOT[s.finish_name] || '#ccc' }} />
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
    </div>
  )
}
