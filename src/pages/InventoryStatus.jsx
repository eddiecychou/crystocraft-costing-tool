import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents } from '../criticalComponents'
import { useCrystals } from '../crystals'
import { usePackaging } from '../packaging'
import { useB2cStock } from '../b2cStock'
import { Download, Boxes, ArrowUp, ArrowDown } from 'lucide-react'
import { useT } from '../i18n'

// Inventory Status (V7.13a) — one screen across all three inventory classes
// (metal components, crystals, packaging), showing On-hand / Reserved /
// Available. A per-SKU reorder point flags hot items before they run out:
// reorder when Available ≤ reorder point (or, if none set, only when negative).

const CLASSES = ['All', 'Metal', 'Crystal', 'Packaging', 'Finished Goods']
const COL_OF = { Metal: 'range_components', Crystal: 'crystals', Packaging: 'packaging', 'Finished Goods': 'b2c_stock' }
const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')

// Does a row need reordering? With a reorder point set, flag at/below it;
// otherwise only flag when over-committed (available negative).
const needsReorder = r => (r.reorder_point > 0 ? r.available <= r.reorder_point : r.available < 0)

function toCsv(rows) {
  const head = ['Class', 'Code', 'Name', 'Attribute', 'On hand', 'Reserved', 'Available', 'Reorder point', 'Reorder']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const out = [head.map(esc).join(',')]
  for (const r of rows) out.push([r.cls, r.code, r.name, r.attr, r.onHand, r.reserved, r.available, r.reorder_point || '', needsReorder(r) ? 'YES' : ''].map(esc).join(','))
  return out.join('\n')
}

export default function InventoryStatus() {
  const t = useT()
  const { components, loading: lc } = useComponents()
  const { items: crystals, loading: lx } = useCrystals()
  const { items: packaging, loading: lp } = usePackaging()
  const { items: b2c, loading: lb } = useB2cStock()
  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('All')
  const [reorderOnly, setReorderOnly] = useState(false)
  const [sort, setSort] = useState({ key: 'available', dir: 'asc' })

  const loading = lc || lx || lp || lb

  const rows = useMemo(() => {
    const mk = (cls, arr, attrKey) => (arr || []).map(c => {
      const onHand = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
      const reserved = Number.isFinite(c.reserved_qty) ? c.reserved_qty : 0
      return { key: `${cls}:${c.id}`, id: c.id, cls, code: c.code || '', name: c.name || '', attr: c[attrKey] || '', onHand, reserved, available: onHand - reserved, reorder_point: Number.isFinite(Number(c.reorder_point)) ? Number(c.reorder_point) : 0 }
    })
    return [
      ...mk('Metal', components, 'plating_code'),
      ...mk('Crystal', crystals, 'colour'),
      ...mk('Packaging', packaging, 'type'),
      ...mk('Finished Goods', b2c, 'category'),
    ]
  }, [components, crystals, packaging, b2c])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = rows.filter(r => {
      if (cls !== 'All' && r.cls !== cls) return false
      if (reorderOnly && !needsReorder(r)) return false
      if (q && ![r.code, r.name, r.attr].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
    const { key, dir } = sort
    const s = dir === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      const av = a[key], bv = b[key]
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return (cmp || a.code.localeCompare(b.code)) * s
    })
  }, [rows, search, cls, reorderOnly, sort])

  const totals = useMemo(() => filtered.reduce((t, r) => {
    t.onHand += r.onHand; t.reserved += r.reserved
    if (needsReorder(r)) t.reorder += 1
    return t
  }, { onHand: 0, reserved: 0, reorder: 0 }), [filtered])

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'inventory-status.csv'; a.click()
    URL.revokeObjectURL(a.href)
  }

  const toggleSort = key => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'code' || key === 'name' || key === 'cls' ? 'asc' : 'desc' })

  const BADGE = { Metal: 'bg-ivory text-ink-70', Crystal: 'bg-brand-50 text-brand-700', Packaging: 'bg-sky-50 text-sky-700', 'Finished Goods': 'bg-violet-50 text-violet-700' }
  const linkFor = r => r.cls === 'Metal' ? `/components/critical/${r.id}` : '/components'

  const CLS_LABEL = { All: t('All'), Metal: t('Metal'), Crystal: t('Crystal'), Packaging: t('Packaging'), 'Finished Goods': t('Finished Goods') }

  const Th = ({ k, label, align = 'left' }) => (
    <th className={`px-3 py-2 font-medium cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => toggleSort(k)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {sort.key === k && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  )

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2"><Boxes size={20} className="text-brand-500" /> {t('Inventory Status')}</h1>
      <p className="text-sm text-ink-60 mb-4">
        {t('On-hand, reserved and available across metal components, crystals, packaging and B2C finished goods.')}
        <span className="text-ink-60"> {t('Available = On-hand − Reserved.')}</span> {t('Set a reorder point on hot items to flag them before they run out.')}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder={t('Search code, name, colour/type…')}
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input text-sm w-auto" value={cls} onChange={e => setCls(e.target.value)}>
          {CLASSES.map(c => <option key={c} value={c}>{c === 'All' ? t('All classes') : CLS_LABEL[c]}</option>)}
        </select>
        <label className="text-xs text-ink-60 inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={reorderOnly} onChange={e => setReorderOnly(e.target.checked)} className="w-3.5 h-3.5 rounded-sm border-warm-grey text-brand-600" />
          {t('Reorder only')}
        </label>
        <button onClick={exportCsv} disabled={filtered.length === 0} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-40">
          <Download size={13} /> {t('CSV')}
        </button>
      </div>

      <p className="text-xs text-ink-60 mb-2">
        {loading ? t('Loading…') : (
          <>
            {t('{n} SKUs', { n: filtered.length })} · {t('{n} on hand', { n: totals.onHand.toLocaleString() })} · <span className="text-amber-600">{t('{n} reserved', { n: totals.reserved.toLocaleString() })}</span> · <span className="text-green-700">{t('{n} available', { n: (totals.onHand - totals.reserved).toLocaleString() })}</span>
            {totals.reorder > 0 && <> · <span className="text-red-600 font-medium">{t('{n} to reorder', { n: totals.reorder })}</span></>}
          </>
        )}
      </p>

      {!loading && filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">{t('Nothing matches. Seed stock in the Components tabs first.')}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                  <Th k="cls" label={t('Class')} />
                  <Th k="code" label={t('Code')} />
                  <Th k="name" label={t('Name')} />
                  <Th k="onHand" label={t('On hand')} align="right" />
                  <Th k="reserved" label={t('Reserved')} align="right" />
                  <Th k="available" label={t('Available')} align="right" />
                  <Th k="reorder_point" label={t('Reorder pt')} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-grey">
                {filtered.map(r => (
                  <tr key={r.key} className={needsReorder(r) ? 'bg-red-50/40' : 'hover:bg-ivory/40'}>
                    <td className="px-3 py-2"><span className={`text-2xs px-1.5 py-0.5 rounded-full ${BADGE[r.cls]}`}>{CLS_LABEL[r.cls] || r.cls}</span></td>
                    <td className="px-3 py-2"><Link to={linkFor(r)} className="font-mono text-xs text-brand-600 hover:underline">{r.code}</Link></td>
                    <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[220px]">{r.name || '—'}{r.attr ? <span className="text-ink-60"> · {r.attr}</span> : ''}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-80">{fmt(r.onHand)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700">{r.reserved ? fmt(r.reserved) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${needsReorder(r) ? 'text-red-600' : 'text-green-700'}`}>
                      {fmt(r.available)}{needsReorder(r) ? ' ⚠' : ''}
                    </td>
                    <td className="px-3 py-2 text-right"><ReorderInput row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Inline reorder-point editor — saves to the row's own collection on blur.
function ReorderInput({ row }) {
  const cur = Number(row.reorder_point) || 0
  const [val, setVal] = useState(cur ? String(cur) : '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setVal((Number(row.reorder_point) || 0) ? String(Number(row.reorder_point)) : '') }, [row.reorder_point])

  async function save() {
    const n = Math.max(0, Math.round(Number(val) || 0))
    if (n === cur) return
    setSaving(true)
    try { await updateDoc(doc(db, COL_OF[row.cls], row.id), { reorder_point: n }) }
    finally { setSaving(false) }
  }

  return (
    <input
      className={`input text-xs w-16 text-right tabular-nums ${saving ? 'opacity-50' : ''}`}
      inputMode="numeric" value={val} placeholder="—"
      onChange={e => setVal(e.target.value.replace(/[^\d]/g, ''))}
      onFocus={e => e.target.select()}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
    />
  )
}
