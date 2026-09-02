import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useB2cStock, setWooLink } from '../b2cStock'
import { wooProductsPage } from '../wooSyncApi'
import { downloadCsv } from '../exportCsv'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, Download, Link2, X, AlertTriangle, ShoppingCart } from 'lucide-react'

// WooCommerce ↔ Finished-Goods stock reconciliation (Phase 6 of
// WooCommerce_B2C_Sync_Spec.md). READ-ONLY against WooCommerce — the only
// write this page makes is the one-time manual SKU mapping onto the
// b2c_stock doc (b2cStock.js setWooLink). It does NOT push stock in either
// direction; that is a later phase, blocked until this mapping exists.
//
// Why the mapping is manual: most B2C products are variable products where
// the variation SKU is often blank, and ChunCi's barcode (`code`, e.g.
// D0268-001-GC1) bakes colour/plating into the tail. Auto-match on an exact
// normalised SKU catches the easy ones; everything else is linked by hand
// here, once.

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '')
const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '—')
const attrText = (a) => (a || []).map((x) => x.option).filter(Boolean).join(' / ')

// One Woo catalogue row → a display label for the picker / tables.
const wooLabel = (w) =>
  [w.sku || '(no sku)', w.name, attrText(w.attributes)].filter(Boolean).join('  ·  ')

export default function WooStockReconcile() {
  const { items: b2c, loading: loadingB2c } = useB2cStock()
  const [woo, setWoo] = useState(null) // array of catalogue rows, or null before first load
  const [loadingWoo, setLoadingWoo] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [linkFor, setLinkFor] = useState(null) // b2c item id whose picker is open
  const [showWooOnly, setShowWooOnly] = useState(false)
  const [search, setSearch] = useState('')

  const loadWoo = useCallback(async () => {
    setLoadingWoo(true); setError(''); setProgress('Fetching page 1…')
    const acc = []
    try {
      for (let page = 1; page <= 100; page++) {
        const { rows, has_more } = await wooProductsPage(page)
        acc.push(...(rows || []))
        setProgress(`Fetched ${acc.length} rows (page ${page})…`)
        if (!has_more) break
      }
      setWoo(acc)
    } catch (e) {
      setError(e.message || 'Could not load WooCommerce products.')
    } finally {
      setLoadingWoo(false); setProgress('')
    }
  }, [])

  // ── the join ────────────────────────────────────────────────────────────────
  const model = useMemo(() => {
    if (!woo) return null

    // Woo rows keyed for lookup. A blank SKU can't be a match key.
    const bySku = new Map()
    let blankSku = 0
    const dupSku = new Set()
    for (const w of woo) {
      if (!w.sku) { blankSku++; continue }
      const k = norm(w.sku)
      if (bySku.has(k)) dupSku.add(k)
      else bySku.set(k, w)
    }
    const byVariationId = new Map(woo.filter((w) => w.variation_id).map((w) => [w.variation_id, w]))
    const byProductId = new Map()
    for (const w of woo) if (!byProductId.has(w.product_id)) byProductId.set(w.product_id, w)

    const usedWoo = new Set() // norm(sku) consumed by a b2c row

    const rows = (b2c || []).map((it) => {
      const linked = !!(it.woo_sku || it.woo_variation_id)
      let match = null
      let kind = 'unmatched'
      if (linked) {
        match =
          (it.woo_variation_id && byVariationId.get(it.woo_variation_id)) ||
          (it.woo_sku && bySku.get(norm(it.woo_sku))) ||
          (it.woo_product_id && byProductId.get(it.woo_product_id)) ||
          null
        kind = match ? 'linked' : 'linked-missing'
      } else {
        match = bySku.get(norm(it.code)) || null
        if (match) kind = 'auto'
      }
      if (match?.sku) usedWoo.add(norm(match.sku))

      const b2cQty = Number.isFinite(it.stock_qty) ? it.stock_qty : null
      const wooQty = match && Number.isFinite(match.stock_quantity) ? match.stock_quantity : null
      let state = kind
      if (match) {
        if (!match.manage_stock || wooQty == null) state = 'no-count'
        else if (b2cQty == null) state = 'no-count'
        else state = b2cQty === wooQty ? 'equal' : 'diff'
      }
      return {
        id: it.id,
        code: it.code,
        name: it.name,
        category: it.category,
        linked,
        kind,
        state,
        b2cQty,
        wooQty,
        delta: b2cQty != null && wooQty != null ? b2cQty - wooQty : null,
        match,
      }
    })

    const wooOnly = woo.filter((w) => w.sku && !usedWoo.has(norm(w.sku)))

    const counts = {
      total: rows.length,
      equal: rows.filter((r) => r.state === 'equal').length,
      diff: rows.filter((r) => r.state === 'diff').length,
      noCount: rows.filter((r) => r.state === 'no-count').length,
      unmatched: rows.filter((r) => r.state === 'unmatched').length,
      linkedMissing: rows.filter((r) => r.state === 'linked-missing').length,
      wooOnly: wooOnly.length,
      blankSku,
      dupSku: dupSku.size,
      wooRows: woo.length,
    }
    return { rows, wooOnly, counts }
  }, [woo, b2c])

  async function link(itemId, w) {
    await setWooLink(itemId, w
      ? { woo_sku: w.sku, woo_product_id: w.product_id, woo_variation_id: w.variation_id || null }
      : null)
    setLinkFor(null)
  }

  function exportCsv() {
    if (!model) return
    const cols = [
      { label: 'FG code', value: (r) => r.code, text: true },
      { label: 'FG name', value: (r) => r.name },
      { label: 'Category', value: (r) => r.category },
      { label: 'Match', value: (r) => r.state },
      { label: 'Linked by hand', value: (r) => (r.linked ? 'yes' : '') },
      { label: 'Woo SKU', value: (r) => r.match?.sku || '', text: true },
      { label: 'Woo product', value: (r) => r.match?.name || '' },
      { label: 'Woo variation', value: (r) => attrText(r.match?.attributes) },
      { label: 'FG qty', value: (r) => (r.b2cQty == null ? '' : r.b2cQty) },
      { label: 'Woo qty', value: (r) => (r.wooQty == null ? '' : r.wooQty) },
      { label: 'Delta (FG − Woo)', value: (r) => (r.delta == null ? '' : r.delta) },
    ]
    downloadCsv('woo-stock-reconciliation', cols, model.rows)
  }

  const visibleRows = useMemo(() => {
    if (!model) return []
    const q = search.trim().toUpperCase()
    if (!q) return model.rows
    return model.rows.filter((r) =>
      `${r.code} ${r.name} ${r.match?.sku || ''}`.toUpperCase().includes(q))
  }, [model, search])

  const busy = loadingWoo || loadingB2c

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2">
        <ShoppingCart size={20} className="text-brand-500" /> WooCommerce Stock Reconciliation
      </h1>
      <p className="text-sm text-ink-60 mb-4">
        Compares WooCommerce catalogue stock against B2C Finished Goods (<Link to="/inventory" className="text-brand-600 hover:underline">Inventory</Link>).
        Read-only against Woo — the only thing saved here is a one-time SKU mapping.
        See also <Link to="/woo-sync" className="text-brand-600 hover:underline">WooCommerce Sync</Link> for orders.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={loadWoo} disabled={busy}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCcw size={14} className={loadingWoo ? 'animate-spin' : ''} />
          {woo ? 'Reload WooCommerce products' : 'Load WooCommerce products'}
        </button>
        {model && (
          <button onClick={exportCsv}
                  className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
            <Download size={13} /> CSV
          </button>
        )}
        {progress && <span className="text-xs text-ink-60">{progress}</span>}
      </div>

      {model && (
        <input className="input text-sm w-full max-w-sm mb-4" placeholder="Search FG code, name or Woo SKU…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
      )}

      {loadingWoo && <LoadingBar />}
      {error && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 inline-flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {!woo && !loadingWoo && (
        <div className="card p-6 text-sm text-ink-60">
          Load the WooCommerce catalogue to begin. Most B2C products are variable products, so this
          pulls every product and its per-variation stock — it can take a minute on a large store.
        </div>
      )}

      {model && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
            <Stat label="FG SKUs" value={model.counts.total} />
            <Stat label="In sync" value={model.counts.equal} tone="green" />
            <Stat label="Qty differs" value={model.counts.diff} tone="amber" />
            <Stat label="No Woo count" value={model.counts.noCount} />
            <Stat label="Unmatched FG" value={model.counts.unmatched} tone="red" />
            <Stat label="Woo only" value={model.counts.wooOnly} />
            <Stat label="Blank-SKU variations" value={model.counts.blankSku} />
          </div>
          {model.counts.dupSku > 0 && (
            <p className="text-xs text-amber-700 mb-3 inline-flex items-center gap-1.5">
              <AlertTriangle size={13} /> {model.counts.dupSku} SKU{model.counts.dupSku === 1 ? '' : 's'} appear on more than one Woo variation — first match wins.
            </p>
          )}

          <div className="card overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                    <th className="px-3 py-2 text-left">FG code</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Match</th>
                    <th className="px-3 py-2 text-left">WooCommerce</th>
                    <th className="px-3 py-2 text-right">FG qty</th>
                    <th className="px-3 py-2 text-right">Woo qty</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-grey">
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-xs text-ink-60">No FG SKUs match “{search}”.</td></tr>
                  )}
                  {visibleRows.map((r) => (
                    <RowView key={r.id} r={r} woo={woo}
                             open={linkFor === r.id}
                             onToggle={() => setLinkFor(linkFor === r.id ? null : r.id)}
                             onLink={link} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button onClick={() => setShowWooOnly((v) => !v)}
                  className="text-xs text-brand-600 hover:text-brand-800 mb-2">
            {showWooOnly ? 'Hide' : 'Show'} {model.wooOnly.length} Woo-only row{model.wooOnly.length === 1 ? '' : 's'}
          </button>
          {showWooOnly && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                      <th className="px-3 py-2 text-left">Woo SKU</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Variation</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Woo qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-grey">
                    {model.wooOnly.map((w) => (
                      <tr key={`${w.product_id}:${w.variation_id || 0}`} className="hover:bg-ivory/40">
                        <td className="px-3 py-2 font-mono text-xs">{w.sku}</td>
                        <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[240px]">{w.name}</td>
                        <td className="px-3 py-2 text-xs text-ink-60">{attrText(w.attributes) || '—'}</td>
                        <td className="px-3 py-2 text-xs text-ink-60">{w.type}{w.status !== 'publish' ? ` · ${w.status}` : ''}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {w.manage_stock && Number.isFinite(w.stock_quantity) ? fmt(w.stock_quantity) : (w.stock_status || '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneCls = tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : 'text-ink'
  return (
    <div className="card p-3">
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value.toLocaleString()}</div>
      <div className="text-2xs uppercase tracking-wide text-ink-60">{label}</div>
    </div>
  )
}

const STATE_BADGE = {
  equal: 'bg-green-50 text-green-700',
  diff: 'bg-amber-50 text-amber-700',
  'no-count': 'bg-ivory text-ink-70',
  unmatched: 'bg-red-50 text-red-600',
  'linked-missing': 'bg-red-50 text-red-600',
}
const STATE_LABEL = {
  equal: 'in sync',
  diff: 'qty differs',
  'no-count': 'no Woo count',
  unmatched: 'no match',
  'linked-missing': 'link broken',
}

function RowView({ r, woo, open, onToggle, onLink }) {
  return (
    <>
      <tr className={r.state === 'diff' ? 'bg-amber-50/40' : 'hover:bg-ivory/40'}>
        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
        <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[200px]">
          {r.name || '—'}{r.category ? <span className="text-ink-60"> · {r.category}</span> : ''}
        </td>
        <td className="px-3 py-2">
          <span className={`text-2xs px-1.5 py-0.5 rounded-full ${STATE_BADGE[r.state] || 'bg-ivory text-ink-70'}`}>
            {STATE_LABEL[r.state] || r.state}
          </span>
          {r.linked && <span className="text-2xs text-ink-60 ml-1">·&nbsp;linked</span>}
          {r.kind === 'auto' && <span className="text-2xs text-ink-60 ml-1">·&nbsp;auto</span>}
        </td>
        <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[240px]">
          {r.match ? (
            <>
              <span className="font-mono">{r.match.sku || '(no sku)'}</span>
              {attrText(r.match.attributes) ? ` · ${attrText(r.match.attributes)}` : ''}
            </>
          ) : '—'}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-80">{fmt(r.b2cQty)}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-80">{fmt(r.wooQty)}</td>
        <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${r.delta ? 'text-amber-700' : 'text-ink-60'}`}>
          {r.delta == null ? '—' : (r.delta > 0 ? `+${r.delta}` : r.delta)}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {r.linked && (
            <button onClick={() => onLink(r.id, null)}
                    className="text-2xs text-ink-60 hover:text-red-600 inline-flex items-center gap-0.5 mr-2">
              <X size={11} /> unlink
            </button>
          )}
          <button onClick={onToggle}
                  className="text-2xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-0.5">
            <Link2 size={11} /> {r.linked ? 'change' : 'link'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="px-3 py-2 bg-ivory/50">
            <LinkPicker woo={woo} onPick={(w) => onLink(r.id, w)} />
          </td>
        </tr>
      )}
    </>
  )
}

function LinkPicker({ woo, onPick }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) return woo.slice(0, 30)
    return woo
      .filter((w) => `${w.sku} ${w.name} ${attrText(w.attributes)}`.toUpperCase().includes(t))
      .slice(0, 40)
  }, [q, woo])
  return (
    <div className="max-w-2xl">
      <input autoFocus className="input text-sm w-full mb-2" placeholder="Filter Woo products by SKU, name or colour…"
             value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-56 overflow-y-auto divide-y divide-warm-grey border border-warm-grey bg-white">
        {results.length === 0 && <div className="px-3 py-2 text-xs text-ink-60">No matches.</div>}
        {results.map((w) => (
          <button key={`${w.product_id}:${w.variation_id || 0}`} onClick={() => onPick(w)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-50 flex items-center justify-between gap-3">
            <span className="truncate">{wooLabel(w)}</span>
            <span className="font-mono tabular-nums text-ink-60 shrink-0">
              {w.manage_stock && Number.isFinite(w.stock_quantity) ? fmt(w.stock_quantity) : (w.stock_status || '—')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
