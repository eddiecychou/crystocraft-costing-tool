import { useState, useMemo, useCallback, useEffect, Fragment } from 'react'
import { wooCataloguePage, wooProbeI18nSeo } from '../wooSyncApi'
import { loadWooCatalogueOverviewCache, saveWooCatalogueOverviewCache } from '../wooCache'
import { downloadCsv } from '../exportCsv'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, Download, AlertTriangle, ShoppingCart, ExternalLink, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react'

// WooCommerce catalogue overview + SEO heuristic checklist (Ecommerce, admin).
// Read-only. Cached to woo_cache/catalogue_overview so it loads instantly and
// the WordPress admin (slow) doesn't have to be browsed. Translation status
// (WPML / Polylang) and real Yoast scores need a probe first — the Diagnostics
// tab runs it; nothing here consumes that data yet.

const fmtWhen = (d) => {
  if (!d) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

// Min/max selling price across a product's own price or its variations.
function priceRange(p) {
  const vals = p.variations?.length
    ? p.variations.map(v => num(v.price)).filter(v => v != null)
    : [num(p.sale_price) ?? num(p.price) ?? num(p.regular_price)].filter(v => v != null)
  if (!vals.length) return null
  const lo = Math.min(...vals), hi = Math.max(...vals)
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

// SEO heuristic — flags computed from what the WC REST product carries.
function seoFlags(p) {
  const f = []
  if (p.image_count === 0) f.push('No image')
  else if (p.images_missing_alt > 0) f.push(`${p.images_missing_alt}/${p.image_count} images no alt`)
  if (p.description_words === 0) f.push('No description')
  else if (p.description_words < 50) f.push(`Thin description (${p.description_words}w)`)
  if (p.short_description_words === 0) f.push('No short description')
  if (!p.categories?.length) f.push('No category')
  if (p.name_len > 60) f.push(`Name ${p.name_len} chars`)
  else if (p.name_len < 15) f.push('Name very short')
  if (!p.slug || /^product-?\d+$/i.test(p.slug) || /%|__/.test(p.slug)) f.push('Weak slug')
  if (!p.tag_count) f.push('No tags')
  return f
}

const STATUS_BADGE = {
  publish: 'bg-green-50 text-green-700',
  draft: 'bg-ivory text-ink-70',
  pending: 'bg-amber-50 text-amber-700',
  private: 'bg-purple-50 text-purple-700',
}

export default function WooCatalogue() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState(null)
  const [fromCache, setFromCache] = useState(false)
  const [tab, setTab] = useState('catalogue') // catalogue | seo | diagnostics
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [issuesOnly, setIssuesOnly] = useState(true)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [expanded, setExpanded] = useState(null)
  const [probe, setProbe] = useState(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    let live = true
    loadWooCatalogueOverviewCache().then((c) => {
      if (live && c?.rows?.length) { setRows(c.rows); setFetchedAt(c.fetchedAt); setFromCache(true) }
    })
    return () => { live = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setProgress('Fetching page 1…')
    const acc = []
    try {
      for (let page = 1; page <= 100; page++) {
        const { rows: r, has_more } = await wooCataloguePage(page)
        acc.push(...(r || []))
        setProgress(`Fetched ${acc.length} products (page ${page})…`)
        if (!has_more) break
      }
      setRows(acc); setFetchedAt(new Date()); setFromCache(false)
      const res = await saveWooCatalogueOverviewCache(acc)
      if (res.skipped === 'too_large') setError(`${acc.length} products — too large to cache, will refetch next visit`)
    } catch (e) {
      setError(e.message || 'Could not load the WooCommerce catalogue.')
    } finally {
      setLoading(false); setProgress('')
    }
  }, [])

  async function runProbe() {
    setProbing(true); setProbe(null)
    try { setProbe(await wooProbeI18nSeo()) }
    catch (e) { setProbe([{ label: 'error', status: null, ok: false, sample: e.message || String(e) }]) }
    finally { setProbing(false) }
  }

  const model = useMemo(() => {
    if (!rows) return null
    const withSeo = rows.map(p => ({ ...p, _flags: seoFlags(p), _price: priceRange(p) }))
    const counts = {
      total: rows.length,
      publish: rows.filter(p => p.status === 'publish').length,
      draft: rows.filter(p => p.status === 'draft').length,
      other: rows.filter(p => !['publish', 'draft'].includes(p.status)).length,
      variations: rows.reduce((n, p) => n + (p.variations?.length || 0), 0),
      seoIssues: withSeo.filter(p => p.status === 'publish' && p._flags.length).length,
    }
    return { withSeo, counts }
  }, [rows])

  const SORT_VAL = {
    product: p => (p.name || '').toLowerCase(),
    sku: p => (p.sku || '').toLowerCase(),
    categories: p => (p.categories || []).join(', ').toLowerCase(),
    price: p => { const v = parseFloat(String(p._price).split('–')[0]); return Number.isFinite(v) ? v : -1 },
    sales: p => p.total_sales || 0,
    stock: p => p.stock_status || 'zzz',
    modified: p => p.date_modified || '',
  }

  const catalogueRows = useMemo(() => {
    if (!model) return []
    const q = search.trim().toUpperCase()
    const list = model.withSeo.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (q && !`${p.name} ${p.sku}`.toUpperCase().includes(q)) return false
      return true
    })
    if (sort.key && SORT_VAL[sort.key]) {
      const f = SORT_VAL[sort.key], s = sort.dir === 'asc' ? 1 : -1
      list.sort((a, b) => {
        const av = f(a), bv = f(b)
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
        return (cmp || (a.product_id - b.product_id)) * s
      })
    }
    return list
  }, [model, search, statusFilter, sort])

  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: (key === 'sales' || key === 'modified' || key === 'price') ? 'desc' : 'asc' })

  const seoRows = useMemo(() => {
    if (!model) return []
    const q = search.trim().toUpperCase()
    return model.withSeo
      .filter(p => (statusFilter !== 'all' ? p.status === statusFilter : true))
      .filter(p => (issuesOnly ? p._flags.length > 0 : true))
      .filter(p => (q ? `${p.name} ${p.sku}`.toUpperCase().includes(q) : true))
      .sort((a, b) => b._flags.length - a._flags.length)
  }, [model, search, statusFilter, issuesOnly])

  function exportSeo() {
    const cols = [
      { label: 'Product', value: r => r.name },
      { label: 'SKU', value: r => r.sku, text: true },
      { label: 'Status', value: r => r.status },
      { label: 'Issues', value: r => r._flags.length },
      { label: 'Detail', value: r => r._flags.join('; ') },
      { label: 'URL', value: r => r.permalink || '' },
    ]
    downloadCsv('woo-catalogue-seo', cols, seoRows)
  }

  const Tab = ({ id, label }) => (
    <button onClick={() => setTab(id)}
      className={`text-sm px-3 py-1.5 rounded-none border-b-2 ${tab === id ? 'border-brand-600 text-ink' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
      {label}
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2">
        <ShoppingCart size={20} className="text-brand-500" /> WooCommerce Catalogue
      </h1>
      <p className="text-sm text-ink-60 mb-4">
        Everything you're selling online — active, draft and private — with an SEO heuristic checklist.
        Read-only, cached so it loads without waiting on WordPress admin.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={load} disabled={loading}
          className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          {rows ? 'Refresh from WooCommerce' : 'Load catalogue'}
        </button>
        {fetchedAt && !loading && (
          <span className="text-xs text-ink-60">{fromCache ? 'Saved snapshot' : 'Fetched'} · {fmtWhen(fetchedAt)}</span>
        )}
        {progress && <span className="text-xs text-ink-60">{progress}</span>}
      </div>

      {loading && <LoadingBar />}
      {error && (
        <div className="card p-3 mb-4 text-sm text-amber-700 bg-amber-50 inline-flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {!rows && !loading && (
        <div className="card p-6 text-sm text-ink-60">Load the catalogue to begin.</div>
      )}

      {model && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <Stat label="Products" value={model.counts.total} />
            <Stat label="Published" value={model.counts.publish} tone="green" />
            <Stat label="Draft" value={model.counts.draft} />
            <Stat label="Other" value={model.counts.other} />
            <Stat label="SEO issues" value={model.counts.seoIssues} tone={model.counts.seoIssues ? 'amber' : undefined} />
          </div>

          <div className="flex items-center gap-1 border-b border-warm-grey mb-3">
            <Tab id="catalogue" label="Catalogue" />
            <Tab id="seo" label={`SEO checklist${model.counts.seoIssues ? ` (${model.counts.seoIssues})` : ''}`} />
            <Tab id="diagnostics" label="Diagnostics" />
          </div>

          {tab !== 'diagnostics' && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input className="input text-sm w-full max-w-xs" placeholder="Search name or SKU…"
                value={search} onChange={e => setSearch(e.target.value)} />
              <select className="input text-sm w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="publish">Published</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="private">Private</option>
              </select>
              {tab === 'seo' && (
                <>
                  <label className="text-xs text-ink-60 inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={issuesOnly} onChange={e => setIssuesOnly(e.target.checked)}
                      className="w-3.5 h-3.5 rounded-sm border-warm-grey text-brand-600" />
                    Issues only
                  </label>
                  <button onClick={exportSeo} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                    <Download size={13} /> CSV
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'catalogue' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                      <Sh k="product" label="Product" sort={sort} onSort={toggleSort} />
                      <Sh k="sku" label="SKU" sort={sort} onSort={toggleSort} />
                      <th className="px-3 py-2 text-left">Status</th>
                      <Sh k="categories" label="Categories" sort={sort} onSort={toggleSort} />
                      <Sh k="price" label="Price" align="right" sort={sort} onSort={toggleSort} />
                      <Sh k="sales" label="Sales" align="right" sort={sort} onSort={toggleSort} />
                      <Sh k="stock" label="Stock" sort={sort} onSort={toggleSort} />
                      <Sh k="modified" label="Modified" align="right" sort={sort} onSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-grey">
                    {catalogueRows.map(p => (
                      <Fragment key={p.product_id}>
                        <tr className="hover:bg-ivory/40">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 w-[300px] max-w-[300px]">
                              <button onClick={() => setExpanded(expanded === p.product_id ? null : p.product_id)}
                                className="min-w-0 flex items-center gap-1 text-left text-ink hover:text-brand-600">
                                {p.variations?.length > 0
                                  ? <ChevronRight size={13} className={`shrink-0 transition-transform ${expanded === p.product_id ? 'rotate-90' : ''}`} />
                                  : <span className="w-[13px] shrink-0" />}
                                <span className="truncate">{p.name}</span>
                              </button>
                              {p.permalink && (
                                <a href={p.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-ink-40 hover:text-brand-600">
                                  <ExternalLink size={11} />
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-60 whitespace-nowrap">{p.sku || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full ${STATUS_BADGE[p.status] || 'bg-ivory text-ink-70'}`}>{p.status}</span>
                            {p.catalog_visibility && p.catalog_visibility !== 'visible' && (
                              <span className="text-2xs text-ink-40 ml-1">{p.catalog_visibility}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[160px]">{p.categories?.join(', ') || <span className="text-amber-600">none</span>}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-80">{p._price || '—'}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-60">{p.total_sales || '—'}</td>
                          <td className="px-3 py-2 text-xs text-ink-60">{p.stock_status || '—'}{p.stock_quantity != null ? ` (${p.stock_quantity})` : ''}</td>
                          <td className="px-3 py-2 text-right text-xs text-ink-60">{fmtDate(p.date_modified)}</td>
                        </tr>
                        {expanded === p.product_id && (p.variations || []).map(v => (
                          <tr key={`${p.product_id}:${v.variation_id}`} className="bg-ivory/40 text-xs">
                            <td className="px-3 py-1.5 pl-8 text-ink-60">{v.attributes?.map(a => a.option).filter(Boolean).join(' / ') || '(variation)'}</td>
                            <td className="px-3 py-1.5 font-mono text-ink-60">{v.sku || '—'}</td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-60">{v.price ?? '—'}</td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-ink-60">{v.stock_status || '—'}{v.stock_quantity != null ? ` (${v.stock_quantity})` : ''}</td>
                            <td className="px-3 py-1.5" />
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {catalogueRows.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-4 text-center text-xs text-ink-60">No products match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'seo' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Issues</th>
                      <th className="px-3 py-2 text-left">What to fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-grey">
                    {seoRows.map(p => (
                      <tr key={p.product_id} className={p._flags.length >= 3 ? 'bg-amber-50/40' : 'hover:bg-ivory/40'}>
                        <td className="px-3 py-2 max-w-[240px]">
                          <span className="text-ink truncate inline-block max-w-full align-middle">{p.name}</span>
                          {p.permalink && (
                            <a href={p.permalink} target="_blank" rel="noreferrer" className="ml-1 text-ink-40 hover:text-brand-600 inline-block align-middle">
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-2xs px-1.5 py-0.5 rounded-full ${STATUS_BADGE[p.status] || 'bg-ivory text-ink-70'}`}>{p.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-amber-700">{p._flags.length || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {p._flags.map((fl, i) => (
                              <span key={i} className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{fl}</span>
                            ))}
                            {!p._flags.length && <span className="text-2xs text-green-700">Looks good</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {seoRows.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-ink-60">Nothing flagged.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'diagnostics' && (
            <div className="card p-4">
              <p className="text-sm text-ink-70 mb-1">Translation & SEO capability probe</p>
              <p className="text-xs text-ink-60 mb-3">
                Checks whether the WordPress site exposes translation status (WPML / Polylang) and SEO meta
                (Yoast / RankMath) over REST. Nothing is changed — this only reports what each endpoint returns.
              </p>
              <button onClick={runProbe} disabled={probing}
                className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCcw size={13} className={probing ? 'animate-spin' : ''} /> Run probe
              </button>
              {probe && (
                <div className="mt-4 space-y-3">
                  {probe.map((r, i) => (
                    <div key={i} className="border border-warm-grey">
                      <div className="px-3 py-1.5 bg-ivory text-xs flex items-center justify-between">
                        <span className="text-ink-80">{r.label}</span>
                        <span className={r.ok ? 'text-green-700' : 'text-red-600'}>{r.status ?? 'error'}</span>
                      </div>
                      <pre className="px-3 py-2 text-2xs text-ink-60 overflow-x-auto whitespace-pre-wrap break-all">{r.sample}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Sh({ k, label, align = 'left', sort, onSort }) {
  const active = sort.key === k
  return (
    <th className={`px-3 py-2 cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => onSort(k)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  )
}

function Stat({ label, value, tone }) {
  const toneCls = tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="card p-3">
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{Number(value).toLocaleString()}</div>
      <div className="text-2xs uppercase tracking-wide text-ink-60">{label}</div>
    </div>
  )
}
