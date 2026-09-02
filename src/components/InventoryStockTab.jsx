import { useState, useMemo } from 'react'
import { parseStockPaste } from '../inventoryClass'
import StockEditor from './StockEditor'
import StockLedger from './StockLedger'
import { Gem, Box, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useT } from '../i18n'

// Generic stock tab for a simple inventory class (crystals, packaging). Driven
// entirely by an `inv` config (see crystals.js / packaging.js): list + search,
// inline stock editor, expandable per-SKU ledger, add-new, and a paste importer.

const ICONS = { gem: Gem, box: Box }

// Reorder when available is at/below the reorder point (or, if none set, only
// when over-committed). Matches the Inventory Status page.
const needsReorder = (available, reorderPoint) => {
  const rp = Number(reorderPoint) || 0
  return rp > 0 ? available <= rp : available < 0
}

export default function InventoryStockTab({ inv }) {
  const t = useT()
  const { items, loading } = inv.useItems()
  const [search, setSearch] = useState('')
  const [attrFilter, setAttrFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const Icon = ICONS[inv.iconKey] || Box

  // Distinct values of the categorising attribute (colour / type / category),
  // for the filter dropdown. Only worth showing once there are a few.
  const attrValues = useMemo(() => {
    const s = new Set()
    for (const c of items) { const v = (c[inv.attrField] || '').trim(); if (v) s.add(v) }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [items, inv.attrField])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(c => {
      if (attrFilter && (c[inv.attrField] || '').trim() !== attrFilter) return false
      if (!q) return true
      return [c.code, c.name, c[inv.attrField], c.size].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [items, search, attrFilter, inv.attrField])

  const totals = useMemo(() => items.reduce((t, c) => {
    const onHand = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    const reserved = Number.isFinite(c.reserved_qty) ? c.reserved_qty : 0
    t.onHand += onHand
    t.reserved += reserved
    if (needsReorder(onHand - reserved, c.reorder_point)) t.oversold += 1
    return t
  }, { onHand: 0, reserved: 0, oversold: 0 }), [items])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder={t('Search code, name, {attr}…', { attr: inv.attrLabel.toLowerCase() })}
               value={search} onChange={e => setSearch(e.target.value)} />
        {attrValues.length > 1 && (
          <select className="input text-sm w-auto" value={attrFilter} onChange={e => setAttrFilter(e.target.value)}>
            <option value="">{t('All {attr}', { attr: inv.attrLabel.toLowerCase() })}</option>
            {attrValues.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <button onClick={() => setImporting(true)} className="btn-secondary text-sm">{t('Import stock')}</button>
        <button onClick={() => setAdding(a => !a)} className="btn-primary text-sm">{t('+ New')}</button>
      </div>

      {adding && <AddRow inv={inv} onDone={() => setAdding(false)} />}

      <p className="text-xs text-ink-60 mb-2">
        {loading ? t('Loading…') : (
          <>
            {t('{a} of {b} items', { a: filtered.length, b: items.length })} · {t('{n} on hand', { n: totals.onHand.toLocaleString() })}
            {totals.reserved > 0 && <> · <span className="text-amber-600">{t('{n} reserved', { n: totals.reserved.toLocaleString() })}</span> · <span className="text-green-700">{t('{n} available', { n: (totals.onHand - totals.reserved).toLocaleString() })}</span></>}
            {totals.oversold > 0 && <> · <span className="text-red-600 font-medium">{t('{n} to reorder', { n: totals.oversold })}</span></>}
          </>
        )}
      </p>

      {!loading && items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">
          {t('Nothing here yet. Import a stock list to seed the master, or add one.')}
        </div>
      ) : (
        <div className="card divide-y divide-ivory-dark overflow-hidden">
          {filtered.map(c => (
            <div key={c.id}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-ivory/50 transition-colors">
                <button onClick={() => setExpanded(e => e === c.id ? null : c.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {expanded === c.id ? <ChevronDown size={15} className="text-ink-60 shrink-0" /> : <ChevronRight size={15} className="text-ink-60 shrink-0" />}
                  <Icon size={16} className="text-brand-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-ink truncate">{c.code}</span>
                      {c[inv.attrField] && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 shrink-0">{c[inv.attrField]}</span>}
                      {c.size && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 shrink-0">{c.size}</span>}
                    </div>
                    <p className="text-xs text-ink-60 truncate">
                      {c.name || '—'}
                      {inv.retailField && Number.isFinite(Number(c[inv.retailField])) && c[inv.retailField] !== '' && c[inv.retailField] != null &&
                        <span className="text-ink-60"> · ¥{Number(c[inv.retailField]).toLocaleString()}</span>}
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
                </button>
                <div className="flex justify-end shrink-0 pl-14 sm:pl-0">
                  <StockEditor component={c} collectionPath={inv.collectionPath} />
                </div>
              </div>
              {expanded === c.id && (
                <div className="px-3 pb-3 bg-ivory/30">
                  <EditRow inv={inv} item={c} />
                  <StockLedger componentId={c.id} currentStock={c.stock_qty || 0} currentReserved={c.reserved_qty || 0} collectionPath={inv.collectionPath} />
                  <button onClick={() => { if (window.confirm(t('Delete {code}? Its ledger history stays but the SKU is removed.', { code: c.code }))) inv.remove(c.id) }}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                    <Trash2 size={12} /> {t('Delete')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {importing && <ImportModal inv={inv} onClose={() => setImporting(false)} />}
    </div>
  )
}

// Correct an existing SKU's descriptive fields.
//
// The list showed the attribute as a read-only badge, so a wrong colour on a
// crystal could not be fixed from the app at all — only by a script. That
// became a real problem once colours were populated in bulk: 10 of them are
// proposals needing a human, and nobody could confirm or change them.
//
// Stock is deliberately not here. `save` writes descriptive fields only;
// quantity belongs to the ledger, via StockEditor and StockLedger below.
function EditRow({ inv, item }) {
  const t = useT()
  const rf = inv.retailField   // e.g. 'retail_price' for Finished Goods; undefined otherwise
  const retailOf = it => (rf && it[rf] != null && it[rf] !== '' ? String(it[rf]) : '')
  const initial = () => ({
    code: item.code || '', name: item.name || '',
    attr: item[inv.attrField] || '', size: item.size || '', notes: item.notes || '',
    retail: retailOf(item),
  })
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = k => e => { setF(x => ({ ...x, [k]: e.target.value })); setSaved(false) }

  const dirty = f.code !== (item.code || '') || f.name !== (item.name || '') ||
    f.attr !== (item[inv.attrField] || '') || f.size !== (item.size || '') ||
    f.notes !== (item.notes || '') || (!!rf && f.retail !== retailOf(item))

  async function save() {
    if (!f.code.trim() || !dirty) return
    setSaving(true)
    try {
      const payload = { code: f.code, name: f.name, [inv.attrField]: f.attr, size: f.size, notes: f.notes }
      if (rf) payload[rf] = f.retail
      await inv.save(item.id, payload)
      setSaved(true)
    } finally { setSaving(false) }
  }

  return (
    <div className="pt-3 pb-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-2xs uppercase tracking-wide text-ink-60">{t('Details')}</label>
        {/* Shown on a successful write, not on `!dirty`. `dirty` compares
            against the subscribed item, which only refreshes when the snapshot
            comes back — so gating on it left the user with no feedback at all
            between clicking Save and the round trip completing. */}
        {saved && <span className="text-2xs text-green-600">{t('saved')}</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div>
          <label className="label text-xs">{t('Code')}</label>
          <input className="input text-sm font-mono uppercase" value={f.code}
                 onChange={e => { setF(x => ({ ...x, code: e.target.value.toUpperCase() })); setSaved(false) }} />
        </div>
        <div className="sm:col-span-2">
          <label className="label text-xs">{t('Name')}</label>
          <input className="input text-sm" value={f.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label text-xs">{inv.attrLabel}</label>
          <input className="input text-sm" value={f.attr} onChange={set('attr')}
                 placeholder={inv.attrPlaceholder} />
        </div>
        {rf && (
          <div>
            <label className="label text-xs">{t('Retail (¥)')}</label>
            <input className="input text-sm" inputMode="decimal" value={f.retail} onChange={set('retail')} placeholder={t('China ref.')} />
          </div>
        )}
        <div className="flex gap-2">
          <input className="input text-sm flex-1" value={f.size} onChange={set('size')} placeholder={t('Size')} />
          <button onClick={save} disabled={saving || !dirty || !f.code.trim()}
                  className="btn-secondary text-sm shrink-0">{saving ? '…' : t('Save')}</button>
        </div>
      </div>
    </div>
  )
}

function AddRow({ inv, onDone }) {
  const t = useT()
  const [f, setF] = useState({ code: '', name: '', attr: '', size: '' })
  const [saving, setSaving] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    if (!f.code.trim()) return
    setSaving(true)
    try { await inv.save(null, { code: f.code, name: f.name, [inv.attrField]: f.attr, size: f.size }); onDone() }
    finally { setSaving(false) }
  }
  return (
    <div className="card p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
      <div><label className="label text-xs">{t('Code *')}</label><input className="input text-sm font-mono uppercase" value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder={inv.codePlaceholder} /></div>
      <div><label className="label text-xs">{t('Name')}</label><input className="input text-sm" value={f.name} onChange={set('name')} placeholder={inv.namePlaceholder} /></div>
      <div><label className="label text-xs">{inv.attrLabel}</label><input className="input text-sm" value={f.attr} onChange={set('attr')} placeholder={inv.attrPlaceholder} /></div>
      <div className="flex gap-2">
        <input className="input text-sm flex-1" value={f.size} onChange={set('size')} placeholder={t('Size')} />
        <button onClick={save} disabled={saving || !f.code.trim()} className="btn-primary text-sm shrink-0">{saving ? '…' : t('Add')}</button>
      </div>
    </div>
  )
}

function ImportModal({ inv, onClose }) {
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const parse = inv.parsePaste || parseStockPaste
  const rows = useMemo(() => parse(text), [text, parse])

  async function run() {
    setBusy(true)
    try { setResult(await inv.importStock(rows)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-none max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
        <h3 className="text-base mb-1">{t('Import stock')}</h3>
        <p className="text-xs text-ink-60 mb-3">
          {inv.parsePaste
            ? t('Paste the full stock export including its header row — columns are matched by name. Each row is an absolute count and posts a stock-take; re-run any time.')
            : t('Paste rows as code · name · qty (tab or comma separated). Each row is an absolute count and posts a stock-take to the ledger; re-run any time.')}
        </p>
        <textarea className="input font-mono text-xs h-40" value={text} onChange={e => setText(e.target.value)}
                  placeholder={inv.importExample} />
        {rows.length > 0 && <p className="text-xs text-ink-60 mt-2">{t('{n} rows parsed.', { n: rows.length })}</p>}
        {result && <p className="text-sm text-green-700 mt-2">{t('Imported — {a} new, {b} updated.', { a: result.created, b: result.updated })}</p>}
        <div className="flex justify-end gap-2 mt-4">
          {!result && <button onClick={run} disabled={busy || rows.length === 0} className="btn-primary text-sm">{busy ? t('Importing…') : t('Import {n}', { n: rows.length || '' })}</button>}
          <button onClick={onClose} className="btn-secondary text-sm">{result ? t('Done') : t('Cancel')}</button>
        </div>
      </div>
    </div>
  )
}
