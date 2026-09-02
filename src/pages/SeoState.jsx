import { useState, useMemo, useCallback, useEffect } from 'react'
import { seoLanguages, seoContentPage } from '../seoStateApi'
import { wooCataloguePage } from '../wooSyncApi'
import { loadSeoState, saveSeoState, saveSeoSnapshot, listSeoSnapshots } from '../seoCache'
import { downloadCsv } from '../exportCsv'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, Download, AlertTriangle, Database, ExternalLink, Camera, ArrowUp, ArrowDown } from 'lucide-react'

// SEO control plane — Step 1: a structured, snapshottable "what's live now"
// for WordPress blog posts, pages AND WooCommerce products (the SEO batches
// write products too, so reconcile needs them in the same store).
// Read-only against WordPress. The History panel is the rollback reference:
// if a later change goes wrong, the last snapshot says what each post's
// slug / status / SEO meta / layout hash used to be.

const fmtWhen = (d) => {
  if (!d) return ''
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
const fmtTs = (d) => (d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

const STATUS_BADGE = {
  publish: 'bg-green-50 text-green-700',
  draft: 'bg-ivory text-ink-70',
  pending: 'bg-amber-50 text-amber-700',
  private: 'bg-purple-50 text-purple-700',
  future: 'bg-sky-50 text-sky-700',
}

export default function SeoState() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState(null)
  const [fromCache, setFromCache] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [snapping, setSnapping] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [langFilter, setLangFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'modified', dir: 'desc' })

  useEffect(() => {
    let live = true
    loadSeoState().then((c) => {
      if (live && c?.rows?.length) { setRows(c.rows); setFetchedAt(c.fetchedAt); setFromCache(true) }
    })
    listSeoSnapshots().then((s) => { if (live) setSnapshots(s) })
    return () => { live = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setProgress('Reading languages…')
    const acc = []
    try {
      const langs = await seoLanguages()
      for (const l of langs) {
        for (const kind of ['post', 'page']) {
          for (let page = 1; page <= 100; page++) {
            const { rows: r, has_more } = await seoContentPage(kind, l.code, page)
            acc.push(...(r || []))
            setProgress(`${l.code} · ${kind}s · ${acc.length} rows…`)
            if (!has_more) break
          }
        }
      }
      // WooCommerce products too — the SEO batches also write `kind:'product'`
      // (Yoast titles etc.), so reconcile needs them in the same store. Pulled
      // via the woo-sync catalogue op (wc/v3, Yoast read from meta_data by key)
      // and mapped to the seo_state row shape.
      for (let page = 1; page <= 100; page++) {
        const { rows: r, has_more } = await wooCataloguePage(page)
        for (const p of (r || [])) {
          acc.push({
            id: p.product_id,
            kind: 'product',
            lang: p.lang || 'en',
            slug: p.slug || '',
            status: p.status || '',
            link: p.permalink || '',
            modified: p.date_modified || '',
            title: p.name || '',
            seo_title: p.seo_title || '',
            seo_desc: p.seo_desc || '',
            seo_title_set: !!p.seo_title_set,
            seo_desc_set: !!p.seo_desc_set,
            focus_kw: p.seo_focus_kw || '',
            elementor_len: 0,
            elementor_hash: null, // catalogue_page doesn't fetch _elementor_data for products
          })
        }
        setProgress(`products · ${acc.length} rows…`)
        if (!has_more) break
      }
      setRows(acc); setFetchedAt(new Date()); setFromCache(false)
      const res = await saveSeoState(acc)
      if (res.skipped === 'too_large') setError(`${acc.length} rows — too large to cache, will re-read next visit`)
    } catch (e) {
      setError(e.message || 'Could not read WordPress state.')
    } finally {
      setLoading(false); setProgress('')
    }
  }, [])

  async function takeSnapshot() {
    if (!rows?.length) return
    const note = window.prompt('Snapshot note (optional) — e.g. "before FR product batch"') ?? ''
    setSnapping(true)
    try {
      const res = await saveSeoSnapshot(rows, note)
      if (res.skipped) setError('Snapshot too large to store.')
      else setSnapshots(await listSeoSnapshots())
    } catch (e) {
      setError(e.message || 'Could not save snapshot.')
    } finally {
      setSnapping(false)
    }
  }

  const model = useMemo(() => {
    if (!rows) return null
    const langs = [...new Set(rows.map(r => r.lang))].sort()
    const byLang = langs.map(code => ({
      code,
      posts: rows.filter(r => r.lang === code && r.kind === 'post').length,
      pages: rows.filter(r => r.lang === code && r.kind === 'page').length,
      products: rows.filter(r => r.lang === code && r.kind === 'product').length,
    }))
    return {
      langs,
      byLang,
      counts: {
        total: rows.length,
        posts: rows.filter(r => r.kind === 'post').length,
        pages: rows.filter(r => r.kind === 'page').length,
        products: rows.filter(r => r.kind === 'product').length,
        drafts: rows.filter(r => r.status !== 'publish').length,
        noSeoTitle: rows.filter(r => r.status === 'publish' && !r.seo_title_set).length,
        noSeoDesc: rows.filter(r => r.status === 'publish' && !r.seo_desc_set).length,
      },
    }
  }, [rows])

  const SORT_VAL = {
    title: r => (r.title || '').toLowerCase(),
    id: r => r.id || 0,
    kind: r => r.kind,
    lang: r => r.lang,
    status: r => r.status,
    slug: r => (r.slug || '').toLowerCase(),
    modified: r => r.modified || '',
    layout: r => r.elementor_len || 0,
  }

  const visible = useMemo(() => {
    if (!model) return []
    const q = search.trim().toLowerCase()
    const list = rows.filter(r => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (langFilter !== 'all' && r.lang !== langFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q && !`${r.title} ${r.slug} ${r.id}`.toLowerCase().includes(q)) return false
      return true
    })
    const f = SORT_VAL[sort.key] || SORT_VAL.modified
    const s = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      const av = f(a), bv = f(b)
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return (cmp || (a.id - b.id)) * s
    })
    return list
  }, [rows, model, search, kindFilter, langFilter, statusFilter, sort])

  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: (key === 'modified' || key === 'layout' || key === 'id') ? 'desc' : 'asc' })

  function exportCsv() {
    const cols = [
      { label: 'ID', value: r => r.id },
      { label: 'Kind', value: r => r.kind },
      { label: 'Lang', value: r => r.lang },
      { label: 'Title', value: r => r.title },
      { label: 'Status', value: r => r.status },
      { label: 'Slug', value: r => r.slug, text: true },
      { label: 'Modified', value: r => r.modified },
      { label: 'SEO title', value: r => r.seo_title },
      { label: 'SEO title set', value: r => (r.seo_title_set ? 'yes' : '') },
      { label: 'SEO desc', value: r => r.seo_desc },
      { label: 'SEO desc set', value: r => (r.seo_desc_set ? 'yes' : '') },
      { label: 'Layout bytes', value: r => r.elementor_len },
      { label: 'Layout hash', value: r => r.elementor_hash || '', text: true },
      { label: 'URL', value: r => r.link },
    ]
    downloadCsv('seo-state', cols, visible)
  }

  const Sh = ({ k, label, align = 'left' }) => (
    <th className={`px-3 py-2 cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => toggleSort(k)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}{sort.key === k && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2">
        <Database size={20} className="text-brand-500" /> SEO State
      </h1>
      <p className="text-sm text-ink-60 mb-4">
        The live WordPress state for blog posts and pages — slug, status, Yoast meta, layout fingerprint,
        per language. Read-only. Take a <strong>snapshot</strong> before any bulk change so it can be rolled back to.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={load} disabled={loading}
          className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          {rows ? 'Refresh from WordPress' : 'Read WordPress state'}
        </button>
        {rows?.length > 0 && (
          <button onClick={takeSnapshot} disabled={snapping}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Camera size={14} /> {snapping ? 'Saving…' : 'Save snapshot'}
          </button>
        )}
        {rows && (
          <button onClick={exportCsv} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
            <Download size={13} /> CSV
          </button>
        )}
        {fetchedAt && !loading && (
          <span className="text-xs text-ink-60">{fromCache ? 'Saved snapshot' : 'Read'} · {fmtWhen(fetchedAt)}</span>
        )}
        {progress && <span className="text-xs text-ink-60">{progress}</span>}
      </div>

      {loading && <LoadingBar />}
      {error && (
        <div className="card p-3 mb-4 text-sm text-amber-700 bg-amber-50 inline-flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {!rows && !loading && <div className="card p-6 text-sm text-ink-60">Read the WordPress state to begin.</div>}

      {model && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            <Stat label="Content" value={model.counts.total} />
            <Stat label="Posts" value={model.counts.posts} />
            <Stat label="Pages" value={model.counts.pages} />
            <Stat label="Products" value={model.counts.products} />
            <Stat label="No SEO title" value={model.counts.noSeoTitle} tone={model.counts.noSeoTitle ? 'amber' : undefined} />
            <Stat label="No meta desc" value={model.counts.noSeoDesc} tone={model.counts.noSeoDesc ? 'amber' : undefined} />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {model.byLang.map(l => (
              <div key={l.code} className="card px-3 py-2">
                <div className="text-sm font-semibold tabular-nums">{l.posts + l.pages + l.products}</div>
                <div className="text-2xs uppercase tracking-wide text-ink-60">{l.code} · {l.posts}p / {l.pages}pg / {l.products}pr</div>
              </div>
            ))}
          </div>

          {snapshots.length > 0 && (
            <div className="card p-3 mb-4">
              <p className="text-2xs uppercase tracking-wide text-ink-60 mb-2">History — {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {snapshots.map(s => (
                  <div key={s.id} className="text-xs flex items-center gap-3">
                    <span className="text-ink-70 tabular-nums shrink-0">{fmtTs(s.takenAt)}</span>
                    <span className="text-ink-60 tabular-nums shrink-0">{s.rowCount} rows</span>
                    {s.note && <span className="text-ink-60 truncate">{s.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input className="input text-sm w-full max-w-xs" placeholder="Search title, slug or id…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input text-sm w-auto" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="all">All kinds</option><option value="post">Posts</option><option value="page">Pages</option><option value="product">Products</option>
            </select>
            <select className="input text-sm w-auto" value={langFilter} onChange={e => setLangFilter(e.target.value)}>
              <option value="all">All languages</option>
              {model.langs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input text-sm w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="publish">Published</option><option value="draft">Draft</option>
              <option value="pending">Pending</option><option value="private">Private</option>
            </select>
            <span className="text-xs text-ink-60">{visible.length} shown</span>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                    <Sh k="id" label="ID" />
                    <Sh k="kind" label="Kind" />
                    <Sh k="lang" label="Lang" />
                    <Sh k="title" label="Title" />
                    <Sh k="status" label="Status" />
                    <Sh k="slug" label="Slug" />
                    <th className="px-3 py-2 text-center">SEO</th>
                    <Sh k="layout" label="Layout" align="right" />
                    <Sh k="modified" label="Modified" align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-grey">
                  {visible.slice(0, 800).map(r => (
                    <tr key={`${r.kind}:${r.id}`} className="hover:bg-ivory/40">
                      <td className="px-3 py-2 font-mono text-xs text-ink-60">{r.id}</td>
                      <td className="px-3 py-2 text-xs text-ink-60">{r.kind}</td>
                      <td className="px-3 py-2 text-xs text-ink-60">{r.lang}</td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <span className="text-ink truncate inline-block max-w-full align-middle">{r.title || <span className="text-platinum">(untitled)</span>}</span>
                        {r.link && (
                          <a href={r.link} target="_blank" rel="noreferrer" className="ml-1 text-platinum hover:text-brand-600 inline-block align-middle">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-2xs px-1.5 py-0.5 rounded-full ${STATUS_BADGE[r.status] || 'bg-ivory text-ink-70'}`}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-2xs text-ink-60 truncate max-w-[160px]">{r.slug || '—'}</td>
                      <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
                        <span className={r.seo_title_set ? 'text-green-600' : 'text-amber-600'} title="SEO title">T</span>
                        {' '}
                        <span className={r.seo_desc_set ? 'text-green-600' : 'text-amber-600'} title="Meta description">D</span>
                      </td>
                      <td className="px-3 py-2 text-right text-2xs text-ink-60 font-mono">
                        {r.elementor_len ? `${Math.round(r.elementor_len / 1024)}k · ${r.elementor_hash}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-ink-60">{fmtDate(r.modified)}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-4 text-center text-xs text-ink-60">Nothing matches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {visible.length > 800 && (
              <p className="px-3 py-2 text-2xs text-ink-60 border-t border-warm-grey">Showing first 800 of {visible.length} — narrow the filters or export CSV for the full set.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneCls = tone === 'amber' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="card p-3">
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{Number(value).toLocaleString()}</div>
      <div className="text-2xs uppercase tracking-wide text-ink-60">{label}</div>
    </div>
  )
}
