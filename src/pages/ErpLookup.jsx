import { useEffect, useState } from 'react'
import { Search, Database, Building2, Factory, Boxes, AlertCircle, ListTree, X, Receipt, ClipboardList, FileText } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { erpLookup, erpBom, erpLines } from '../erpApi'

// Column layout per entity. `key` maps to the curated view's fields.
const ENTITIES = {
  customer: {
    label: 'Customers', Icon: Building2,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
  supplier: {
    label: 'Suppliers', Icon: Factory,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
  item: {
    label: 'Items', Icon: Boxes,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Description', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'a_cost', label: 'A-Cost', num: true },
      { key: 'b_cost', label: 'B-Cost', num: true },
      { key: 'c_cost', label: 'C-Cost', num: true },
      { key: 'srp', label: 'SRP', num: true },
      { key: 'has_bom', label: 'BOM', bool: true },
    ],
  },
  sales_invoice: {
    label: 'Invoices', Icon: Receipt, linesOf: 'sales_invoice',
    cols: [
      { key: 'code', label: 'Invoice #', mono: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'customer', label: 'Customer', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'status', label: 'Status', badge: true },
    ],
  },
  sales_order: {
    label: 'Sales Orders', Icon: ClipboardList, linesOf: 'sales_order',
    cols: [
      { key: 'code', label: 'Order #', mono: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'customer', label: 'Customer', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'status', label: 'Status', badge: true },
    ],
  },
}

// Render a cell value based on its column type.
function cellValue(col, row) {
  const v = row[col.key]
  if (col.bool) {
    return v
      ? <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">Yes</span>
      : <span className="text-gray-300">—</span>
  }
  if (col.num) {
    return (v === null || v === undefined || v === '')
      ? <span className="text-gray-300">—</span>
      : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (col.date) {
    return v ? String(v).slice(0, 10) : <span className="text-gray-300">—</span>
  }
  if (col.badge) {
    if (!v) return <span className="text-gray-300">—</span>
    const green = /confirm|complet|paid|ship|done/i.test(v)
    return <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${green ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{v}</span>
  }
  return (v ?? null) === null ? <span className="text-gray-300">—</span> : v
}

const money = (v) => (v === null || v === undefined || v === '')
  ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Modal showing the line items of one sales invoice / order.
function LinesModal({ title, code, rows, loading, error, onClose }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-teal-600" />
            <h2 className="font-semibold text-gray-900">{title}</h2>
            <span className="font-mono text-xs text-gray-500">{code}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading lines…</p>}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">No line items on this document.</p>
          )}
          {!loading && rows.length > 0 && (
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
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="px-2 py-2" colSpan={5}>Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

const fmtQty = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })

// Modal showing the recursive BOM explosion of one item.
function BomModal({ code, rows, loading, error, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ListTree size={18} className="text-teal-600" />
            <h2 className="font-semibold text-gray-900">Bill of Materials</h2>
            <span className="font-mono text-xs text-gray-500">{code}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {loading && <p className="text-sm text-gray-500 py-6 text-center">Exploding BOM…</p>}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">No components found for this item.</p>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="px-2 py-1.5 font-medium">Component</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2 py-1.5 font-medium text-right">Ext. Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-mono text-xs" style={{ paddingLeft: `${(r.level - 1) * 20 + 8}px` }}>
                      {r.is_assembly && <span className="text-gray-400 mr-1">▸</span>}
                      {r.component_code}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.component_type && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{r.component_type}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{fmtQty(r.qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtQty(r.ext_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-2.5 border-t border-gray-200 text-xs text-gray-400">
          Indented rows are sub-assemblies exploded to their components. Ext. Qty = quantity per one finished unit.
        </div>
      </div>
    </div>
  )
}

export default function ErpLookup() {
  const [entity, setEntity] = useState('customer')
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // BOM modal state
  const [bomCode, setBomCode] = useState(null)
  const [bomRows, setBomRows] = useState([])
  const [bomLoading, setBomLoading] = useState(false)
  const [bomError, setBomError] = useState('')

  const cfg = ENTITIES[entity]

  async function openBom(code) {
    setBomCode(code); setBomRows([]); setBomError(''); setBomLoading(true)
    try {
      setBomRows(await erpBom(code))
    } catch (e) {
      setBomError(e.message)
    } finally {
      setBomLoading(false)
    }
  }

  // Lines (sales invoice / order line items) modal state
  const [lines, setLines] = useState(null)       // { of, code, title } | null
  const [linesRows, setLinesRows] = useState([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [linesError, setLinesError] = useState('')

  async function openLines(of, code) {
    const title = of === 'sales_invoice' ? 'Sales Invoice' : 'Sales Order'
    setLines({ of, code, title }); setLinesRows([]); setLinesError(''); setLinesLoading(true)
    try {
      setLinesRows(await erpLines(of, code))
    } catch (e) {
      setLinesError(e.message)
    } finally {
      setLinesLoading(false)
    }
  }

  // Debounced lookup on any input change.
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(async () => {
      try {
        const r = await erpLookup(entity, { q, activeOnly, limit: 50 })
        if (alive) setRows(r)
      } catch (e) {
        if (alive) { setError(e.message); setRows([]) }
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [entity, q, activeOnly])

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-teal-600" /> ERP Lookup
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Read-only search of the legacy JES ERP archive. Reflects the last data sync — not live.
        </p>
      </div>

      {/* Entity toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 mb-4">
        {Object.entries(ENTITIES).map(([key, e]) => {
          const on = entity === key
          return (
            <button
              key={key}
              onClick={() => { setEntity(key); setRows([]) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                on ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <e.Icon size={15} /> {e.label}
            </button>
          )
        })}
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${cfg.label.toLowerCase()} by code or name…`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}
                 className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
          Active only
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Results */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                {cfg.cols.map((c) => (
                  <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${c.num ? 'text-right' : ''}`}>{c.label}</th>
                ))}
                <th className="px-3 py-2 font-medium">{cfg.linesOf ? 'Lines' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  {cfg.cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-top ${c.mono ? 'font-mono text-xs' : ''} ${c.grow ? '' : 'whitespace-nowrap'} ${c.num ? 'text-right tabular-nums' : ''}`}>
                      {entity === 'item' && c.key === 'has_bom' && r.has_bom
                        ? <button onClick={() => openBom(r.code)}
                            className="inline-flex items-center gap-0.5 text-teal-600 hover:underline text-xs font-medium">
                            <ListTree size={13} /> View
                          </button>
                        : cellValue(c, r)}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {cfg.linesOf
                      ? <button onClick={() => openLines(cfg.linesOf, r.code)}
                          className="inline-flex items-center gap-0.5 text-teal-600 hover:underline text-xs font-medium">
                          <FileText size={13} /> Lines
                        </button>
                      : <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                          r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>{r.active ? 'Active' : 'Expired'}</span>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && !error && (
                <tr><td colSpan={cfg.cols.length + 1} className="px-3 py-10 text-center text-gray-400">
                  {q ? `No ${cfg.label.toLowerCase()} match “${q}”.` : `No ${cfg.label.toLowerCase()} found.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Showing up to 50 results. Source: <span className="font-mono">JES_UnitedArt</span> → Supabase mirror.
      </p>

      {bomCode && (
        <BomModal code={bomCode} rows={bomRows} loading={bomLoading} error={bomError}
                  onClose={() => setBomCode(null)} />
      )}
      {lines && (
        <LinesModal title={lines.title} code={lines.code} rows={linesRows}
                    loading={linesLoading} error={linesError} onClose={() => setLines(null)} />
      )}
    </div>
  )
}
