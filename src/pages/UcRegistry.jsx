import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Search, Hash, Plus, X, AlertCircle, FileText } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { useUcList, listUc, createUcInvoice, updateUcInvoice, listAppInvoices, UC_SOURCES, UC_CURRENCIES, ucSource } from '../ucRegistry'
import { useCustomers } from '../domain/customer'
import ExportFilterBar from '../components/ExportFilterBar'
import { downloadCsv, exportStem } from '../exportCsv'
import { erpLines, erpLookup } from '../erpApi'

const money = (v) => (v === '' || v == null || Number.isNaN(Number(v)))
  ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_STYLE = {
  open: { cls: 'bg-green-100 text-green-700', label: 'Open' },
  closed: { cls: 'bg-gray-100 text-gray-500', label: 'Closed' },
  void: { cls: 'bg-red-100 text-red-700', label: 'Void' },
}

const SOURCE_STYLE = {
  Wholesale: 'bg-gray-100 text-gray-600', Alibaba: 'bg-orange-100 text-orange-700',
  Amazon: 'bg-yellow-100 text-yellow-800', 'Online Shop': 'bg-blue-100 text-blue-700',
  Retail: 'bg-purple-100 text-purple-700',
  Other: 'bg-gray-100 text-gray-500',
}

// Where the invoice lives — derived on uc_registry_dated, never typed. Since
// 2026-07-31 the view also checks app_sales_invoice, so an app-issued invoice
// (findable in the picker above, "app" tag) now shows its own state instead
// of being lumped in with "not in sync" — that badge used to fire for both
// "raised in the app" and "raised in JES, sync hasn't run yet", which read as
// a problem for an invoice that was never going to be in JES at all.
const LOCATION_LABEL = { jes: 'JES', app: 'App', not_in_mirror: 'not in sync' }
const LOCATION_TITLE = {
  jes: 'This invoice is in the JES mirror.',
  app: 'This invoice was raised in the app. It may also reach JES later, but does not need to — this is not a sync problem.',
  not_in_mirror: 'This invoice number is not in the JES mirror or the app’s own ledger — either it was raised in JES and the LAN sync has not run since, or the number needs checking.',
}

// No source: the channel is chosen when the invoice is filled in, not when the
// number is allocated.
const BLANK = { source: '', currency: 'HKD', status: 'open', confirmed: false }

// ── ERP invoice picker ────────────────────────────────────────────────────────
// Type part of an SI# or customer name to search and link one. Searches BOTH
// the JES mirror and the app's own invoice ledger (app_sales_invoice, written
// whenever an order is saved with an erp_si_no — see ShipmentForm's handleSave)
// — an invoice raised directly in the app never reaches JES on its own, so a
// JES-only search could never find it (Cindy: "SI260095 doesn't show up in the
// pulldown" — it's an app-native invoice, not a JES one). Left blank when the
// UC is created first; linked later once the SI exists.
function SiPicker({ value, onChange }) {
  const [q, setQ] = useState(value || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [appInvoices, setAppInvoices] = useState(null)   // fetched once, filtered client-side

  useEffect(() => { setQ(value || '') }, [value])

  useEffect(() => {
    if (!open || appInvoices !== null) return
    listAppInvoices(1000).then(setAppInvoices)
  }, [open, appInvoices])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      const termLower = term.toLowerCase()
      const appMatches = (appInvoices || [])
        .filter(r => r.si_no?.toLowerCase().includes(termLower) || r.customer?.toLowerCase().includes(termLower))
        .slice(0, 8)
        .map(r => ({ code: r.si_no, customer: r.customer, amount: r.total, currency: r.currency, src: 'app' }))
      erpLookup('sales_invoice', { q: term, limit: 8 })
        .then((r) => {
          if (!alive) return
          const jes = (r || []).map(x => ({ ...x, src: 'jes' }))
          // App-native first (it's the one a JES-only search would otherwise
          // miss entirely) and de-duplicated — once JES syncs an app-raised
          // invoice, don't show it twice.
          const seen = new Set()
          const merged = [...appMatches, ...jes].filter(x => {
            const key = (x.code || '').toUpperCase()
            if (seen.has(key)) return false
            seen.add(key); return true
          })
          setResults(merged.slice(0, 8))
        })
        .catch(() => { if (alive) setResults(appMatches) })
        .finally(() => { if (alive) setLoading(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open, appInvoices])

  const pick = (r) => { setQ(r.code); onChange(r.code); setOpen(false) }

  return (
    <label className="flex flex-col gap-1 relative">
      <span className="text-xs font-medium text-gray-500">Invoice (SI#) — search to link, JES or app</span>
      <div className="relative">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="e.g. SI250087 or customer…"
          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
        {q && (
          <button type="button" onMouseDown={() => { setQ(''); onChange(''); setResults([]) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500" title="Clear">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (loading || results.length > 0) && (
        <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {loading && <li className="px-3 py-2 text-xs text-gray-400">Searching…</li>}
          {results.map((r) => (
            <li key={r.code}>
              <button type="button" onMouseDown={() => pick(r)}
                className="w-full text-left px-3 py-1.5 hover:bg-teal-50 flex items-baseline gap-2">
                <span className="font-mono text-xs text-teal-700">{r.code}</span>
                <span className={`text-[10px] px-1 rounded ${r.src === 'app' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  {r.src === 'app' ? 'app' : 'JES'}
                </span>
                <span className="text-xs text-gray-600 truncate flex-1">{r.customer}</span>
                <span className="text-xs tabular-nums text-gray-400">{money(r.amount)} {r.currency}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}

// ── New / Edit form modal ─────────────────────────────────────────────────────
// ── Cindy's rules for recent & future records (2026-07-21) ──────────────────
//
// Both apply from /24 onward only. The older record legitimately breaks them:
// before /24 a UC could combine two or more invoices into one production order,
// which is why 91 registry rows carry a compound uc_no ("UC3965/ UC3992") and
// why some share an SI. Those are history and must not be flagged.
const RECENT_YEARS = /^\/(2[4-9]|[3-9][0-9])$/

// "each UC number should be match with a unique SI" — one invoice, one UC.
// The recent record already nearly holds: across /24../26 the only genuine
// breach is SI240201, which sits on both UC4623 and UC4629.
//
// Deliberately a warning, not a block. JES itself contains UC refs carrying two
// confirmed invoices that cannot be corrected there (see UC4657 below), so a
// hard block would make the true state of the books unrecordable.
async function duplicateSiWarning(jesSi, selfId, year) {
  if (!RECENT_YEARS.test(String(year || '')) || !/^SI[0-9]/.test(String(jesSi || ''))) return ''
  const rows = await listUc({ q: jesSi, limit: 20 }).catch(() => [])
  const clash = rows.filter((r) => r.jes_si === jesSi && r.id !== selfId)
  if (!clash.length) return ''
  return `${jesSi} is already on ${clash.map((r) => r.uc_no + (r.year || '')).join(', ')}. `
       + 'Since /24 each invoice should sit on exactly one UC — check this is not the same sale entered twice.'
}

// "UC with suffix should appear as UC1234(A)/26" — the letter in parentheses on
// the number, the year in its own column. Recent rows already follow it; the
// deviations are all /23 and older (UC4406/A, UC4240/(A), UC4544(寄賣單)).
const UC_SHAPE = /^UC[0-9]+(\([A-Z]\))?$/
function ucShapeWarning(ucNo, year) {
  if (!RECENT_YEARS.test(String(year || '')) || !ucNo) return ''
  if (UC_SHAPE.test(ucNo)) return ''
  return `"${ucNo}" is not the expected shape. Since /24 a UC reads UC1234, or `
       + 'UC1234(A) when a second invoice splits off it — the year stays in its own column.'
}

function UcForm({ record, onClose, onSaved }) {
  const isNew = !record?.id
  const [f, setF] = useState(record || BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  // Warnings, not errors: shown once, and saving again goes through. The
  // registry has to be able to record what actually happened, including the
  // things JES got wrong and cannot fix.
  const [warning, setWarning] = useState('')

  async function save() {
    if (!f.customer?.trim()) { setError('Customer is required.'); return }
    setSaving(true); setError('')
    try {
      if (!warning) {
        const w = [ucShapeWarning(f.uc_no, f.year),
                   await duplicateSiWarning(f.jes_si, record?.id, f.year)].filter(Boolean).join(' ')
        if (w) { setWarning(w); setSaving(false); return }
      }
      if (isNew) await createUcInvoice(f)
      else await updateUcInvoice(record.id, f)
      onSaved()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  // A plain function (not a nested component) so inputs don't remount/lose focus.
  const field = (label, k, type = 'text', wide = false) => (
    <label key={k} className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input type={type} value={f[k] ?? ''} onChange={set(k)}
        className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Hash size={18} className="text-teal-600" />
            {isNew ? 'New UC# Invoice' : `Edit ${record.uc_no}`}
            {isNew && <span className="text-xs font-normal text-gray-400">— number assigned on save</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Source</span>
            <select value={ucSource(f.source)} onChange={set('source')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              <option value="">— not set —</option>
              {UC_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          {/* Date. Once an invoice is issued against this UC, the invoice's own
              date is the document date and typing a second one here could only
              disagree with the books — so the field shows the joined value and
              stops being editable. Rows with no invoice keep the manual entry.
              (Cindy, 2026-07-21.) */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Date</span>
            {record?.si_date ? (
              <span className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                    title={`Taken from invoice ${record.jes_si}`}>
                {String(record.si_date).slice(0, 10)}
                <span className="ml-1.5 text-xs text-gray-400">from {record.jes_si}</span>
              </span>
            ) : (
              <input type="date" value={f.doc_date ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  // keep the sheet's /YY year in sync automatically
                  setF({ ...f, doc_date: v, year: v ? `/${v.slice(2, 4)}` : f.year })
                }}
                className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
            )}
          </label>
          {field('Customer', 'customer', 'text', true)}
          <SiPicker value={f.jes_si} onChange={(v) => setF({ ...f, jes_si: v })} />
          {field('Order no.', 'order_no')}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Currency</span>
            <select value={f.currency} onChange={set('currency')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              {UC_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {field('PIC', 'pic')}
          {field('Total', 'total', 'number')}
          {field('Deposit', 'deposit', 'number')}
          {field('Balance (blank = total − deposit)', 'balance', 'number')}
          {field('Balance payment date', 'bal_pay_date')}
          {field('Shipment', 'shipment')}
          {field('Customs (報關)', 'customs')}
          {/* Shipping cost and Delivery date removed 2026-07-21 (Cindy: "not
              needed"). Both had been abandoned years ago and the data left
              behind is not trustworthy: delivery_date holds 36 values of which
              half are 'X' or '-', and shipping_cost was last used in /20 — its
              221 values include 366,720.00 repeated across a dozen unrelated
              /20 rows (a constant pasted down a spreadsheet column) and one
              row where it simply duplicates the invoice total (UC3502,
              35,013,502). The COLUMNS are kept; only the fields are gone. */}
          <label className="flex items-center gap-2 text-sm text-gray-600 mt-1">
            <input type="checkbox" checked={!!f.confirmed} onChange={set('confirmed')}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /> Confirmed
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Status</span>
            <select value={f.status || 'open'} onChange={set('status')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              <option value="open">Open</option>
              <option value="closed">Closed (paid)</option>
              <option value="void">Void (cancelled / mistake)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-gray-500">Remarks</span>
            <textarea value={f.remarks ?? ''} onChange={set('remarks')} rows={2}
              className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" />
          </label>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border-t border-red-200 px-5 py-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {warning && (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border-t border-amber-200 px-5 py-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{warning} <strong className="whitespace-nowrap">Save again to keep it.</strong></span>
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Saving…' : warning ? 'Save anyway' : isNew ? 'Create UC#' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Read-only ERP invoice detail (from the Supabase ERP mirror) for a UC row's SI#.
function ErpInvoiceModal({ si, data, loading, error, onClose }) {
  const rows = data?.rows || []
  const surcharges = data?.surcharges || []
  const header = data?.header || null
  const n = (v) => Number(v) || 0
  const subtotal = rows.reduce((s, r) => s + n(r.amount), 0)
  const discount = n(header?.discount)
  const surchargeTotal = surcharges.reduce((s, r) => s + n(r.amount), 0)
  const tax = n(header?.tax)
  const grand = header?.amount != null ? n(header.amount) : subtotal - discount + surchargeTotal + tax
  const deposit = n(header?.deposit)
  const curr = header?.currency ? ` ${header.currency}` : ''
  const Row = ({ label, value, strong, sign }) => (
    <div className={`flex justify-between gap-8 py-0.5 ${strong ? 'font-semibold text-gray-900 border-t border-gray-200 mt-1 pt-1.5' : 'text-gray-600'}`}>
      <span>{label}</span><span className="tabular-nums">{sign === '-' && value ? '−' : ''}{money(value)}{curr}</span>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText size={18} className="text-teal-600" />
            <h2 className="font-semibold text-gray-900">ERP Invoice</h2>
            <span className="font-mono text-xs text-gray-500">{si}</span>
            {header?.customer && <span className="text-sm text-gray-500">· {header.customer}</span>}
            {header?.date && <span className="text-xs text-gray-400">· {String(header.date).slice(0, 10)}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading ERP invoice…</p>}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {/* App-raised invoices never reach this modal (openInvoice routes
              them to the app's own document), so landing here means the
              number genuinely isn't in the mirror — almost always a JES
              invoice issued since the last office-LAN sync. Say that, rather
              than a bare "not found" that reads like a bad number. */}
          {!loading && !error && rows.length === 0 && surcharges.length === 0 && (
            <div className="text-sm text-gray-400 py-6 text-center">
              <p>{si} is not in the JES mirror.</p>
              <p className="text-xs mt-1">If it was raised in JES recently, the ERP sync has not run since — it is not necessarily missing.</p>
            </div>
          )}
          {!loading && (rows.length > 0 || surcharges.length > 0) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Item</th>
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2 py-1.5 font-medium text-right">Unit Price</th>
                  <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-2 py-1.5 text-gray-400 tabular-nums">{r.seq}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{r.item_code}</td>
                    <td className="px-2 py-1.5">{r.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.qty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(r.unit_price)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                  </tr>
                ))}
                {surcharges.map((s, i) => (
                  <tr key={`s${i}`} className="border-b border-gray-50 bg-amber-50/40">
                    <td className="px-2 py-1.5"></td>
                    <td className="px-2 py-1.5 text-xs text-amber-700">{s.code || 'CHARGE'}</td>
                    <td className="px-2 py-1.5 text-gray-600" colSpan={3}>{s.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && !error && (rows.length > 0 || surcharges.length > 0) && (
            <div className="mt-4 ml-auto w-full max-w-xs text-sm">
              <Row label="Subtotal" value={subtotal} />
              {discount > 0 && <Row label="Discount" value={discount} sign="-" />}
              {surchargeTotal > 0 && <Row label="Surcharges" value={surchargeTotal} />}
              {tax > 0 && <Row label="Tax / GST" value={tax} />}
              <Row label="Grand total" value={grand} strong />
              {deposit > 0 && <Row label="Deposit" value={deposit} sign="-" />}
              {deposit > 0 && <Row label="Balance" value={grand - deposit} strong />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Sortable column header. The arrow only shows on the active column — an
// indicator on every column tells you nothing about which one is in effect.
function SortTh({ label, col, sort, onSort, align = 'left' }) {
  const on = sort.col === col
  return (
    <th className={`px-3 py-2 font-medium whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
      <button type="button" onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 transition-colors ${on ? 'text-gray-900' : ''}`}
        title={`Sort by ${label}`}>
        {label}
        <span className={`text-[9px] leading-none ${on ? 'opacity-100' : 'opacity-0'}`}>
          {sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

export default function UcRegistry() {
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')   // '' = all
  const [confirmedFilter, setConfirmedFilter] = useState('') // '' = any | 'yes' | 'no'
  const [editing, setEditing] = useState(null)   // record | 'new' | null
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Inline Source editing — 103 rows landed as 'Other' from the original
  // registry migration (see erp-sync's uc_registry backfill), 63 were fixed
  // by matching each customer's other rows; the rest need a human glance, and
  // opening the full Edit modal for each one is slow. A one-click dropdown
  // right in the row is the fast path Cindy asked for (2026-07-31).
  const [savingSourceId, setSavingSourceId] = useState(null)
  // Column sort, Excel-style. Default id.desc = newest first, which is what the
  // registry showed before sorting existed.
  const [sort, setSort] = useState({ col: 'id', dir: 'desc' })
  // Text columns open A→Z; numbers and dates open with the largest first, which
  // is what you want the moment you click "Total" or "Date".
  const TEXT_COLS = new Set(['uc_no', 'customer', 'jes_si', 'source', 'status', 'currency'])
  const toggleSort = (col) => setSort((s) => (
    s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: TEXT_COLS.has(col) ? 'asc' : 'desc' }
  ))

  // undefined = don't filter; true/false = filter on the confirmed flag
  const confirmed = confirmedFilter === 'yes' ? true : confirmedFilter === 'no' ? false : undefined

  // 1000 is the edge function's ceiling. Worth raising from 500 once a date
  // range is in play: a full audit year is more than 500 rows, and a silently
  // truncated export is the one failure mode that would matter most to Cindy.
  const list = useUcList({
    q, source, status: statusFilter, confirmed, from, to,
    sort: sort.col, dir: sort.dir, limit: 1000,
  })
  // Outstanding summary: always open, but respects the confirmed filter so you
  // can read off the "confirmed + open" outstanding total.
  const arList = useUcList({ status: 'open', confirmed, limit: 1000 })
  const rows = list.rows
  const refreshAll = () => { list.refresh(); arList.refresh() }

  // Customer code next to the name — Cindy keys this into PBIS alongside the
  // invoice (2026-08-06). Two sources, because a UC row's `customer` is
  // free text with no link of its own:
  //   - a JES-side row already carries jes_customer_code (uc_registry_dated,
  //     JES's own sicustomer — added for this).
  //   - an app-native row (invoice_location === 'app') has no JES code, but
  //     carries app_order_id; resolve that order's customer_id, then this
  //     customer's own erp_code.
  const { customers } = useCustomers()
  const erpCodeByCustomerId = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c.erp_code]).filter(([, code]) => code)),
    [customers],
  )
  const [orderCustomerId, setOrderCustomerId] = useState({})   // order_id -> customer_id
  useEffect(() => {
    const ids = [...new Set(rows.map(r => r.app_order_id).filter(Boolean))]
      .filter(id => !(id in orderCustomerId))
    if (!ids.length) return
    let alive = true
    Promise.all(ids.map(id =>
      getDoc(doc(db, 'orders', id)).then(s => [id, s.exists() ? (s.data().customer_id || null) : null])
    )).then(pairs => { if (alive) setOrderCustomerId(prev => ({ ...prev, ...Object.fromEntries(pairs) })) })
    return () => { alive = false }
  }, [rows, orderCustomerId])

  function customerCodeFor(r) {
    if (r.jes_customer_code) return r.jes_customer_code
    if (r.app_order_id) {
      const cid = orderCustomerId[r.app_order_id]
      if (cid) return erpCodeByCustomerId[cid] || null
    }
    return null
  }

  async function setSourceInline(r, value) {
    setSavingSourceId(r.id)
    try {
      await updateUcInvoice(r.id, { source: value })
      refreshAll()
    } catch (e) {
      alert(e.message || 'Could not update source.')
    } finally {
      setSavingSourceId(null)
    }
  }

  // The registry as Cindy reads it, plus invoice_location so an app-raised or
  // not-yet-synced invoice is visible in the sheet rather than only on screen.
  const UC_COLUMNS = [
    { label: 'UC#',        value: (r) => `${r.uc_no || ''}${r.year || ''}`, text: true },
    { label: 'Date',       value: (r) => r.effective_date },
    { label: 'SI #',       value: (r) => r.jes_si, text: true },
    { label: 'Invoice in', value: (r) => LOCATION_LABEL[r.invoice_location] || '' },
    { label: 'Source',     value: (r) => ucSource(r.source) },
    { label: 'Customer',   value: (r) => r.customer },
    { label: 'Customer code', value: (r) => customerCodeFor(r), text: true },
    { label: 'Order no.',  value: (r) => r.order_no, text: true },
    { label: 'Currency',   value: (r) => r.currency },
    { label: 'Total',      value: (r) => r.total },
    { label: 'Deposit',    value: (r) => r.deposit },
    { label: 'Balance',    value: (r) => r.balance },
    { label: 'Bal. pay date', value: (r) => r.bal_pay_date },
    { label: 'Shipment',   value: (r) => r.shipment },
    { label: 'Customs',    value: (r) => r.customs },
    { label: 'Status',     value: (r) => r.status },
    { label: 'Confirmed',  value: (r) => (r.confirmed ? 'Yes' : 'No') },
    { label: 'PIC',        value: (r) => r.pic },
    { label: 'Remarks',    value: (r) => r.remarks },
  ]

  const exportUc = () => downloadCsv(
    exportStem('uc-registry', { from, to, type: source || statusFilter }),
    UC_COLUMNS, rows,
  )

  // Invoice drill-down. An SI# in this registry can live in EITHER system, so
  // the click has to route on invoice_location rather than assuming JES:
  // an app-raised invoice has no ERP document to fetch, and running the JES
  // lookup on one dead-ended at "No ERP invoice found for SI260095" even
  // though the invoice exists and the app can print it (owner, 2026-08-04).
  function openInvoice(r) {
    if (r.invoice_location === 'app') {
      if (r.app_order_id) { window.open(`/shipments/${r.app_order_id}/invoice`, '_blank', 'noopener'); return }
      // Allocated in the app but never attached to an order — nothing to open.
      // Say so plainly instead of showing an ERP "not found" that implies the
      // number is wrong.
      alert(`${r.jes_si} was raised in the app but is not linked to an order, so there is no document to open.`)
      return
    }
    openErpInvoice(r.jes_si)
  }

  // ERP invoice drill-down (for rows whose SI# is a JES invoice).
  const [erpSi, setErpSi] = useState(null)
  const [erpData, setErpData] = useState(null)
  const [erpLoading, setErpLoading] = useState(false)
  const [erpError, setErpError] = useState('')
  async function openErpInvoice(si) {
    setErpSi(si); setErpData(null); setErpError(''); setErpLoading(true)
    try {
      const [detail, headers] = await Promise.all([
        erpLines('sales_invoice', si),
        erpLookup('sales_invoice', { q: si, limit: 5 }),
      ])
      const header = headers.find((h) => h.code === si) || null
      setErpData({ header, rows: detail.rows, surcharges: detail.surcharges })
    } catch (e) { setErpError(e.message) } finally { setErpLoading(false) }
  }

  // Outstanding totals by currency (from the open set).
  const ar = useMemo(() => {
    const by = {}
    for (const r of arList.rows) {
      const c = r.currency || '?'
      by[c] = (by[c] || 0) + (Number(r.balance) || 0)
    }
    return Object.entries(by).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1])
  }, [arList.rows])

  return (
    <div className="p-4 md:p-6">
      {list.loading && <LoadingBar />}

      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Hash size={22} className="text-teal-600" /> UC Invoice Registry
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Every order gets a unique UC# — across ERP, Alibaba, Amazon, online shop, and retail.
          </p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary text-sm inline-flex items-center gap-1">
          <Plus size={15} /> New UC#
        </button>
      </div>

      {/* AR summary */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ar.length === 0 ? (
          <span className="text-sm text-gray-400">No outstanding balances.</span>
        ) : (
          <>
            <span className="text-sm text-gray-500 self-center mr-1">
              Outstanding{confirmedFilter === 'yes' ? ' (confirmed)' : confirmedFilter === 'no' ? ' (not confirmed)' : ''}:
            </span>
            {ar.map(([c, v]) => (
              <span key={c} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                <b className="tabular-nums">{money(v)}</b> <span className="text-gray-500">{c}</span>
              </span>
            ))}
          </>
        )}
      </div>

      {list.error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={16} /> {list.error}
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search UC#, customer, SI#, order…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
          <option value="">All sources</option>
          {UC_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="void">Void</option>
          <option value="">All statuses</option>
        </select>
        <select value={confirmedFilter} onChange={(e) => setConfirmedFilter(e.target.value)} className="px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
          <option value="">Confirmed: any</option>
          <option value="yes">Confirmed only</option>
          <option value="no">Not confirmed</option>
        </select>
      </div>

      <ExportFilterBar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        count={rows.length} total={rows.length} noun="rows"
        onExport={exportUc} disabled={list.loading}
      />

      {/* table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                {[
                  ['UC #', 'uc_no'], ['Date', 'effective_date'], ['Source', 'source'],
                  ['Customer', 'customer'], ['SI #', 'jes_si'], ['Cur', 'currency'],
                ].map(([h, col]) => <SortTh key={h} label={h} col={col} sort={sort} onSort={toggleSort} />)}
                <SortTh label="Total"   col="total"   sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Balance" col="balance" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Status"  col="status"  sort={sort} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${r.status === 'void' ? 'opacity-55' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">{r.uc_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                    {r.effective_date
                      ? <span title={r.si_date ? `From invoice ${r.jes_si}` : 'Entered by hand'}>
                          {String(r.effective_date).slice(0, 10)}
                        </span>
                      : r.year}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={ucSource(r.source)}
                      disabled={savingSourceId === r.id}
                      onChange={(e) => setSourceInline(r, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      title="Click to reclassify this UC's sales channel"
                      className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer disabled:opacity-50 ${
                        ucSource(r.source) ? (SOURCE_STYLE[ucSource(r.source)] || SOURCE_STYLE.Other) : 'bg-gray-50 text-gray-300'
                      }`}>
                      <option value="">—</option>
                      {UC_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {r.invoice_location && (
                      <span className="ml-1.5 text-[10px] text-gray-400" title={LOCATION_TITLE[r.invoice_location]}>
                        {LOCATION_LABEL[r.invoice_location]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.customer}
                    {customerCodeFor(r) && <span className="ml-1.5 text-xs text-gray-400 font-mono">· {customerCodeFor(r)}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.jes_si
                      ? <button onClick={() => openInvoice(r)} className="text-teal-600 hover:underline"
                          title={r.invoice_location === 'app'
                            ? 'Raised in the app — opens the app’s own invoice'
                            : 'Opens the JES invoice from the ERP mirror'}>{r.jes_si}</button>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Number(r.balance) > 0.005 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{money(r.balance)}</td>
                  <td className="px-3 py-2">
                    {(() => { const st = STATUS_STYLE[r.status] || STATUS_STYLE.open
                      return <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span> })()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(r)} className="text-teal-600 hover:underline text-xs font-medium">Edit</button>
                  </td>
                </tr>
              ))}
              {!list.loading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">No matching UC# records.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <UcForm
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll() }}
        />
      )}
      {erpSi && (
        <ErpInvoiceModal si={erpSi} data={erpData} loading={erpLoading} error={erpError}
                         onClose={() => setErpSi(null)} />
      )}
    </div>
  )
}
