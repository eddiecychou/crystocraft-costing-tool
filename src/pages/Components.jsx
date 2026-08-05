import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents, importStockList, buildProductIndex, matchProductCode } from '../criticalComponents'
import { crystalInventory } from '../crystals'
import { packagingInventory } from '../packaging'
import { b2cInventory } from '../b2cStock'
import InventoryStockTab from '../components/InventoryStockTab'
import StockEditor from '../components/StockEditor'
import { loadRangeProductsWithPacking } from '../packing'
import { loadCrystalColors, saveCrystalColors } from '../crystalColors'
import { CURRENCIES, RANGE_FORMAT_CODES } from '../constants'
import { useComponentCategories, saveComponentCategories } from '../componentCategories'
import { useCrystalUnitCosts, saveCrystalUnitCosts } from '../crystalCosting'
import { Puzzle, ArrowUp, ArrowDown, X } from 'lucide-react'

export default function Components() {
  const [tab, setTab] = useState('critical')
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-semibold mb-1">Components</h1>
      <p className="text-sm text-ink-60 mb-4">
        Shared libraries for the Figurine range — the critical parts that drive the production
        promise, crystal colours (a display attribute), and crystal unit costs by size &amp; brand.
      </p>

      <div className="flex gap-1 border-b border-ivory-dark mb-5 overflow-x-auto overflow-y-hidden whitespace-nowrap">
        {[['critical', 'Critical Components'], ['crystalstock', 'Crystal Stock'], ['packagingstock', 'Packaging Stock'], ['b2cstock', 'B2C Finished Goods'], ['colours', 'Crystal Colours'], ['crystalcosts', 'Crystal Costs'], ['formatmoq', 'Format MOQs'], ['categories', 'Categories']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 shrink-0 transition-colors ${
              tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'critical' ? <CriticalComponents />
        : tab === 'crystalstock' ? <InventoryStockTab key="crystals" inv={crystalInventory} />
        : tab === 'packagingstock' ? <InventoryStockTab key="packaging" inv={packagingInventory} />
        : tab === 'b2cstock' ? <InventoryStockTab key="b2c" inv={b2cInventory} />
        : tab === 'colours' ? <CrystalColours />
        : tab === 'crystalcosts' ? <CrystalCosts />
        : tab === 'formatmoq' ? <FormatMoqs />
        : <ComponentCategories />}
    </div>
  )
}

// ── Categories tab ───────────────────────────────────────────────────────────

function ComponentCategories() {
  const { categories, loading } = useComponentCategories()
  const [list, setList] = useState(null)   // null until hydrated from the store
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!loading && list === null) setList(categories) }, [loading, categories, list])
  const rows = list ?? []
  const update = (i, v) => setList(rows.map((c, j) => (j === i ? v : c)))
  const add = () => setList([...rows, ''])
  const remove = i => setList(rows.filter((_, j) => j !== i))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; setList(next)
  }
  async function save() {
    setSaving(true); setMsg('')
    try { await saveComponentCategories(rows); setMsg('Categories saved.'); setTimeout(() => setMsg(''), 3000) }
    catch (e) { setMsg('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  if (loading && list === null) return <p className="text-sm text-ink-50">Loading…</p>

  return (
    <div className="max-w-lg">
      <p className="text-sm text-ink-60 mb-3">
        Categories offered when tagging a component. Existing components keep their saved
        category even if you rename or remove one here — re-tag them to move them across.
      </p>
      <div className="space-y-2">
        {rows.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input text-sm flex-1" value={c} onChange={e => update(i, e.target.value)} placeholder="Category name" />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-40 hover:text-ink disabled:opacity-30" title="Move up"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-ink-40 hover:text-ink disabled:opacity-30" title="Move down"><ArrowDown size={15} /></button>
            <button type="button" onClick={() => remove(i)} className="text-red-300 hover:text-red-500" title="Remove"><X size={15} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 text-xs text-brand-600 hover:underline">+ Add category</button>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save Categories'}</button>
        {msg && <span className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
      </div>
    </div>
  )
}

// ── Crystal Costs tab ────────────────────────────────────────────────────────
// A flat, freely editable price list (size, brand, cost, currency) — NOT a
// fixed size×brand grid, because the brand set differs by stone type: facet
// stones (Octagon/Heart) are Bohemia/Asfour/Swarovski, small pavé stones
// (PP18/26/32) are Swarovski/Preciosa. Read by rangeCosting.js's crystal BOM.

const newCcId = () => 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function CrystalCosts() {
  const { items, loading } = useCrystalUnitCosts()
  const [rows, setRows] = useState(null)   // null until hydrated
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!loading && rows === null) setRows(items) }, [loading, items, rows])
  const list = rows ?? []
  const update = (i, patch) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => setRows([...list, { id: newCcId(), size: '', brand: '', cost: '', currency: 'RMB' }])
  const remove = i => setRows(list.filter((_, j) => j !== i))
  async function save() {
    setSaving(true); setMsg('')
    try { await saveCrystalUnitCosts(list); setMsg('Crystal costs saved.'); setTimeout(() => setMsg(''), 3000) }
    catch (e) { setMsg('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  if (loading && rows === null) return <p className="text-sm text-ink-50">Loading…</p>

  // Grouped by size purely for readability — still one flat list underneath.
  const bySize = new Map()
  list.forEach((r, i) => { const k = r.size || '—'; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(i) })

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-ink-60 mb-3">
        Unit price per stone, by size and brand. Add a row for any new size or brand — this list
        drives the Crystal cost BOM on each figurine's costing page (qty × unit cost).
      </p>
      <div className="space-y-4">
        {[...bySize.entries()].map(([size, idxs]) => (
          <div key={size}>
            <p className="text-xs font-semibold text-ink-50 uppercase tracking-wide mb-1.5">{size}</p>
            <div className="space-y-2">
              {idxs.map(i => {
                const r = list[i]
                return (
                  <div key={r.id} className="flex items-center gap-2 flex-wrap">
                    <input className="input text-sm flex-1 min-w-[140px]" value={r.size}
                           onChange={e => update(i, { size: e.target.value })} placeholder="Size, e.g. 14mm Octagon" />
                    <input className="input text-sm flex-1 min-w-[140px]" value={r.brand}
                           onChange={e => update(i, { brand: e.target.value })} placeholder="Brand, e.g. Bohemia" />
                    <input className="input text-sm w-24" inputMode="decimal" value={r.cost ?? ''}
                           onChange={e => update(i, { cost: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0.00" />
                    <select className="input text-sm w-20" value={r.currency} onChange={e => update(i, { currency: e.target.value })}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" onClick={() => remove(i)} className="text-red-300 hover:text-red-500" title="Remove"><X size={15} /></button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-3 text-xs text-brand-600 hover:underline">+ Add row</button>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save Crystal Costs'}</button>
        {msg && <span className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
      </div>
    </div>
  )
}

// ── Critical Components tab ──────────────────────────────────────────────────

function CriticalComponents() {
  const { components, loading } = useComponents()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [stockImport, setStockImport] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return components.filter(c => {
      if (cat && c.category !== cat) return false
      if (!q) return true
      return [c.code, c.name, c.category, c.supplierName].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [components, search, cat])

  // Filter shows every category actually present in the data (incl. custom ones).
  const cats = useMemo(() =>
    [...new Set(components.map(c => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  [components])

  const needsReorder = (available, rp) => { const p = Number(rp) || 0; return p > 0 ? available <= p : available < 0 }
  const totals = useMemo(() => components.reduce((t, c) => {
    const onHand = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    const reserved = Number.isFinite(c.reserved_qty) ? c.reserved_qty : 0
    t.onHand += onHand; t.reserved += reserved
    if (needsReorder(onHand - reserved, c.reorder_point)) t.oversold += 1
    return t
  }, { onHand: 0, reserved: 0, oversold: 0 }), [components])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder="Search code, name, supplier…"
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input text-sm w-auto" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setStockImport(true)} className="btn-secondary text-sm">Import stock list</button>
        <Link to="/components/critical/new" className="btn-primary text-sm">+ New</Link>
      </div>

      <p className="text-xs text-ink-50 mb-2">
        {loading ? 'Loading…' : (
          <>
            {filtered.length} of {components.length} component{components.length === 1 ? '' : 's'} · {totals.onHand.toLocaleString()} on hand
            {totals.reserved > 0 && <> · <span className="text-amber-600">{totals.reserved.toLocaleString()} reserved</span> · <span className="text-green-700">{(totals.onHand - totals.reserved).toLocaleString()} available</span></>}
            {totals.oversold > 0 && <> · <span className="text-red-600 font-medium">{totals.oversold} to reorder</span></>}
          </>
        )}
      </p>

      {!loading && components.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">
          No components yet. Add your long-lead / tooling parts, or <button onClick={() => setStockImport(true)} className="text-brand-600 hover:underline">import a stock list</button>.
        </div>
      ) : (
        <div className="card divide-y divide-ivory-dark overflow-hidden">
          {filtered.map(c => (
            <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-ivory/50 transition-colors">
              <Link to={`/components/critical/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 shrink-0 bg-white border border-ivory-dark rounded flex items-center justify-center overflow-hidden">
                  {c.images[0] ? <img src={c.images[0]} alt="" className="w-full h-full object-contain p-0.5" /> : <Puzzle size={18} className="text-gray-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-ink-90 truncate">{c.code}</span>
                    {c.plating_code && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">{c.plating_code}</span>}
                    {c.category && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 shrink-0">{c.category}</span>}
                  </div>
                  <p className="text-xs text-ink-60 truncate">
                    {c.name || '—'}{c.supplierName ? ` · ${c.supplierName}` : ''}
                    {c.used_by?.length > 0 && <span className="text-ink-40"> · used by {c.used_by.slice(0, 2).join(', ')}{c.used_by.length > 2 ? ` +${c.used_by.length - 2}` : ''}</span>}
                    {(() => {
                      const onHand = Number(c.stock_qty) || 0
                      const reserved = Number(c.reserved_qty) || 0
                      const avail = onHand - reserved
                      const reorder = needsReorder(avail, c.reorder_point)
                      if (reserved <= 0 && !reorder) return null
                      return <span className={reorder ? 'text-red-600 font-medium' : 'text-amber-600'}>{reserved > 0 ? ` · ${reserved.toLocaleString()} reserved · ${avail.toLocaleString()} avail` : ` · ${avail.toLocaleString()} avail`}{reorder ? ' — reorder' : ''}</span>
                    })()}
                  </p>
                </div>
              </Link>
              <div className="flex justify-end shrink-0 pl-14 sm:pl-0">
                <StockEditor component={c} />
              </div>
            </div>
          ))}
        </div>
      )}

      {stockImport && <StockListImportModal components={components} onClose={() => setStockImport(false)} />}
    </div>
  )
}

// Parse the staff "Component List with Stock" sheet, pasted from Excel.
// Columns: Product Item Code · Plating · Component Main Item Code · Description · Qty.
// The component master keys on the Component Main Item Code (col 3); plating is the
// (X) letter in col 2; Qty (col 5) is stock. Split on TAB (Excel paste) so commas
// inside CN descriptions (e.g. "彎釘,蜂鳥") survive.
function parseStockList(text) {
  const lines = (text || '').split(/\r?\n/).filter(l => l.trim())
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const cells = (lines[i].includes('\t') ? lines[i].split('\t') : lines[i].split(',')).map(s => s.trim())
    const product = (cells[0] || '').toUpperCase()
    const code = (cells[2] || '').toUpperCase()
    if (i === 0 && /product\s*item|item\s*code/i.test(product)) continue   // header row
    if (!code) continue
    const m = (cells[1] || '').match(/\(([A-Za-z])\)/)
    out.push({
      product_item_code: product,
      plating_code: (m ? m[1] : '').toUpperCase(),
      code,
      name: cells[3] || '',
      stock_qty: cells[4] || '',
      lead_time_weeks: cells[5] || '',
    })
  }
  return out
}

function StockListImportModal({ components, onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [unmatched, setUnmatched] = useState([])
  const [rangeProducts, setRangeProducts] = useState(null)   // null = loading

  useEffect(() => { loadRangeProductsWithPacking().then(setRangeProducts).catch(() => setRangeProducts([])) }, [])

  const rows = useMemo(() => parseStockList(text), [text])
  // Diff against the live library (dedupe by component code) + product matching.
  const diff = useMemo(() => {
    const have = new Set(components.map(c => (c.code || '').toUpperCase()))
    const seen = new Set()
    let created = 0, updated = 0
    for (const r of rows) {
      if (seen.has(r.code)) continue
      seen.add(r.code)
      have.has(r.code) ? updated++ : created++
    }
    // Product matching preview (only once products are loaded).
    let matched = 0, unmatched = 0
    if (rangeProducts) {
      const index = buildProductIndex(rangeProducts)
      const seenP = new Set()
      for (const r of rows) {
        const code = (r.product_item_code || '').toUpperCase()
        if (!code || seenP.has(code)) continue
        seenP.add(code)
        matchProductCode(code, index) ? matched++ : unmatched++
      }
    }
    return { unique: seen.size, created, updated, matched, unmatched }
  }, [rows, components, rangeProducts])

  async function run() {
    setBusy(true)
    try {
      const res = await importStockList(rows, rangeProducts || [])
      setResult(`Done — ${res.created} new / ${res.updated} updated components; linked to ${res.productsMatched} products` +
        (res.productsUnmatched ? `, ${res.productsUnmatched} product code(s) unmatched.` : '.'))
      setUnmatched(res.unmatched || [])
    } catch (e) { setResult('Error: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-md shadow-lg w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-1">Import component stock list</h2>
        <p className="text-xs text-ink-60 mb-3">
          Paste straight from your Excel (select the data, copy). Columns:
          {' '}<code className="text-ink-80">Product Item Code · Plating · Component Main Item Code · Description · Qty · Lead Time (wks)</code>.
          Components key on the <b>main item code</b>; stock, plating, and lead time update in place — safe to
          re-run as a stock-take. Cost is never touched. Lead time &lt; 4 wks = not a buildable bottleneck.
        </p>
        <textarea className="input min-h-[160px] font-mono text-xs" value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={'D0001-001-C | Chrome (C) | FM-KB(1)-ORNT(C) | 蝴蝶 | 44 | 6'} />
        <p className="text-xs text-ink-50 mt-1">
          {rows.length} row{rows.length === 1 ? '' : 's'} · {diff.unique} unique component{diff.unique === 1 ? '' : 's'}
          {diff.unique > 0 && <> — <span className="text-green-600">{diff.created} new</span>, <span className="text-blue-600">{diff.updated} update</span></>}
        </p>
        {diff.unique > 0 && (
          <p className="text-xs text-ink-50">
            {rangeProducts == null ? 'Loading products…'
              : <>Products: <span className="text-green-600">{diff.matched} matched</span>{diff.unmatched > 0 && <>, <span className="text-amber-600">{diff.unmatched} unmatched</span> (skipped)</>}</>}
          </p>
        )}
        {result && <p className={`text-sm mt-2 ${result.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{result}</p>}
        {unmatched.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-amber-700 cursor-pointer">{unmatched.length} unmatched product code{unmatched.length === 1 ? '' : 's'} (not found in Figurine products) — view</summary>
            <div className="mt-1 max-h-32 overflow-auto border border-ivory-dark rounded p-2 font-mono text-[11px] text-ink-60">
              {unmatched.join(', ')}
            </div>
          </details>
        )}
        <div className="flex items-center gap-3 mt-4">
          <button onClick={run} disabled={busy || !diff.unique} className="btn-primary text-sm">
            {busy ? 'Importing…' : `Import ${diff.unique || ''}`}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm">{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Crystal Colours tab ─────────────────────────────────────────────────────

function CrystalColours() {
  const [rows, setRows] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadCrystalColors().then(c => { setRows(c); setSaved(c); setLoading(false) })
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { code: '', name: '', swatch: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const move = (i, dir) => setRows(rs => {
    const j = i + dir
    if (j < 0 || j >= rs.length) return rs
    const out = [...rs]; [out[i], out[j]] = [out[j], out[i]]; return out
  })

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function handleSave() {
    setSaving(true); setMsg(null)
    try {
      const clean = await saveCrystalColors(rows)
      setRows(clean); setSaved(clean)
      setMsg(`Saved ${clean.length} colour${clean.length === 1 ? '' : 's'}.`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg('Error saving: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Crystal Colour Library</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add colour</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Selectable colour attribute on Figurine products. Colours don't create separate SKUs, stock,
        or price changes. For a colour that costs more, add a separate variation with its own price.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No colours yet — add one.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="w-16 shrink-0">Code</span>
            <span className="flex-1">Name</span>
            <span className="w-14 shrink-0">Swatch</span>
            <span className="w-16 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-xs font-mono uppercase w-16 shrink-0" value={r.code}
                     placeholder="BL" maxLength={6}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
              <input className="input text-xs flex-1 min-w-0" value={r.name}
                     placeholder="Sapphire" onChange={e => update(i, 'name', e.target.value)} />
              <div className="w-14 shrink-0 flex items-center gap-1">
                <input type="color" className="h-7 w-7 rounded cursor-pointer border border-ink-10 bg-white p-0.5"
                       value={r.swatch || '#cccccc'} title={r.swatch || 'No colour set'}
                       onChange={e => update(i, 'swatch', e.target.value)} />
                {r.swatch && (
                  <button type="button" onClick={() => update(i, 'swatch', '')}
                          className="text-ink-30 hover:text-ink-60 leading-none" title="Clear swatch"><X size={12} /></button>
                )}
              </div>
              <div className="flex items-center gap-0.5 w-16 shrink-0 justify-end">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        className="text-ink-40 hover:text-ink-70 disabled:opacity-30 px-1" title="Move up"><ArrowUp size={14} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                        className="text-ink-40 hover:text-ink-70 disabled:opacity-30 px-1" title="Move down"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => removeRow(i)}
                        className="text-red-400 hover:text-red-600 px-1 leading-none" title="Remove"><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Colours'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}

// ── Format MOQs tab ─────────────────────────────────────────────────────────

function FormatMoqs() {
  const [rows, setRows] = useState([])     // [{ code, label, moq }]  (all strings)
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'format_moq')).then(snap => {
      const d = snap.exists() ? snap.data() : {}
      let next
      if (Array.isArray(d.formats) && d.formats.length) {
        // Canonical, editable list (lets deletes stick).
        next = d.formats.map(f => ({
          code: String(f.code || ''),
          label: String(f.label || ''),
          moq: f.moq != null && f.moq !== '' ? String(f.moq) : '',
        }))
      } else {
        // First load: seed from legacy moq map + the built-in format codes.
        const legacyMoq = d.moq || {}
        const legacyLabels = d.labels || {}
        const codes = [...new Set([...RANGE_FORMAT_CODES.map(f => f.code), ...Object.keys(legacyMoq)])]
        next = codes.map(c => ({
          code: c,
          label: legacyLabels[c] || RANGE_FORMAT_CODES.find(f => f.code === c)?.label || '',
          moq: legacyMoq[c] != null ? String(legacyMoq[c]) : '',
        }))
      }
      setRows(next); setSaved(next); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { code: '', label: '', moq: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function save() {
    setSaving(true); setMsg(null)
    try {
      // Keep only rows with a code; de-dupe by code (last one wins).
      const byCode = {}
      for (const r of rows) {
        const code = r.code.trim()
        if (!code) continue
        byCode[code] = { code, label: r.label.trim(), moq: r.moq }
      }
      const clean = Object.values(byCode)
      // Storefront-facing maps (only positive minimums / non-empty labels).
      const moq = {}, labels = {}
      const formats = clean.map(r => {
        const n = Number(r.moq)
        const has = r.moq !== '' && n > 0
        if (has) moq[r.code] = n
        if (r.label) labels[r.code] = r.label
        return { code: r.code, label: r.label, moq: has ? n : 0 }
      })
      await setDoc(doc(db, 'settings', 'format_moq'), { formats, moq, labels, updatedAt: serverTimestamp() })
      const asRows = formats.map(f => ({ code: f.code, label: f.label, moq: f.moq > 0 ? String(f.moq) : '' }))
      setRows(asRows); setSaved(asRows)
      setMsg('Format MOQs saved.')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg('Error saving: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Format Minimum Order Quantities</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add format</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Minimum run for each format base component (music box, freestand, bible…). On a customer
        enquiry these pool across every design sharing the format, so the customer is told to combine
        designs to reach the minimum. Leave the MOQ blank for no format minimum.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No formats yet — add one.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="w-20 shrink-0">Code</span>
            <span className="flex-1">Name</span>
            <span className="w-28 shrink-0">MOQ (pcs)</span>
            <span className="w-6 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-sm font-mono w-20 shrink-0" value={r.code}
                     placeholder="236" maxLength={4}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
              <input className="input text-sm flex-1 min-w-0" value={r.label}
                     placeholder="Music Box" onChange={e => update(i, 'label', e.target.value)} />
              <div className="relative w-28 shrink-0">
                <input type="number" min="0" step="1"
                       className="input pr-9 text-right tabular-nums"
                       value={r.moq}
                       onChange={e => update(i, 'moq', e.target.value.replace(/[^\d]/g, ''))} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-40 pointer-events-none">pcs</span>
              </div>
              <button type="button" onClick={() => removeRow(i)}
                      className="text-red-400 hover:text-red-600 px-1 leading-none shrink-0" title="Remove"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Format MOQs'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}

// ── Pricing Groups (retired) ─────────────────────────────────────────────────
// Tab removed from the UI for now to keep things simple; component kept out of
// the render tree. Customer corp pricing uses the per-customer markup override
// on Customer Accounts.

/* eslint-disable no-unused-vars */
const slugify = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function PricingGroups() {
  const [rows, setRows] = useState([])   // [{ id, name, markup }]  (markup string)
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'pricing_groups')).then(snap => {
      const d = snap.exists() ? snap.data() : {}
      const next = (Array.isArray(d.groups) ? d.groups : []).map(g => ({
        id: String(g.id || ''),
        name: String(g.name || ''),
        markup: g.markup != null && g.markup !== '' ? String(g.markup) : '',
      }))
      setRows(next); setSaved(next); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { id: '', name: '', markup: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function save() {
    setSaving(true); setMsg(null)
    try {
      // Keep rows with a name + positive markup; assign a stable id (slug of name,
      // de-duplicated) so customer assignments survive renames of the label.
      const used = new Set()
      const groups = []
      for (const r of rows) {
        const name = r.name.trim()
        const markup = Number(r.markup)
        if (!name || !(markup > 0)) continue
        let id = r.id && r.id.trim() ? r.id.trim() : slugify(name)
        if (!id) id = 'group'
        let unique = id, n = 2
        while (used.has(unique)) unique = `${id}-${n++}`
        used.add(unique)
        groups.push({ id: unique, name, markup })
      }
      await setDoc(doc(db, 'settings', 'pricing_groups'), { groups, updatedAt: serverTimestamp() })
      const asRows = groups.map(g => ({ id: g.id, name: g.name, markup: String(g.markup) }))
      setRows(asRows); setSaved(asRows)
      setMsg(`Saved ${groups.length} group${groups.length === 1 ? '' : 's'}.`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg('Error saving: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Customer Pricing Groups</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add group</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Pricing strategies for corporate gifts. The markup multiplies the product's all-in cost to set
        the customer's price (e.g. 2.0× = cost doubled). Assign each customer a group in Customer
        Accounts; a per-customer override can beat the group. After changing markups, open a product's
        Pricing page and Publish to push new prices.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No groups yet — add one (e.g. Standard 2.0×, Preferred 1.7×, VIP 1.5×).</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="flex-1">Group name</span>
            <span className="w-28 shrink-0">Markup (×)</span>
            <span className="w-6 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-sm flex-1 min-w-0" value={r.name}
                     placeholder="e.g. Preferred" onChange={e => update(i, 'name', e.target.value)} />
              <div className="relative w-28 shrink-0">
                <input type="number" min="1" step="0.05"
                       className="input pr-7 text-right tabular-nums"
                       value={r.markup} placeholder="2.0"
                       onChange={e => update(i, 'markup', e.target.value)} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-40 pointer-events-none">×</span>
              </div>
              <button type="button" onClick={() => removeRow(i)}
                      className="text-red-400 hover:text-red-600 px-1 leading-none shrink-0" title="Remove"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Pricing Groups'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}
