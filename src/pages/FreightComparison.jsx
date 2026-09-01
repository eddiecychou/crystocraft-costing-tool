import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Star, CheckCircle2 } from 'lucide-react'
import {
  FREIGHT_MODES, FREIGHT_INCOTERMS, QUOTE_SOURCES, modeLabel,
  loadVendors, loadOrderQuotes, saveFreightQuote, deleteFreightQuote,
} from '../logistics'
import { getPackingScenariosByOrder } from '../packing'
import { useRates } from '../currency'

const CURRENCIES = ['HKD', 'USD', 'EUR', 'RMB', 'CNY']

// ── blank quote form ──────────────────────────────────────────────────────────
function blankQuote(orderId, scenario) {
  return {
    vendor_id: '', vendor_name: '',
    order_id: orderId,
    scenario_id: scenario?.id || '',
    scenario_label: scenario?.label || '',
    mode: 'sea_lcl',
    incoterm: 'FOB',
    currency: 'HKD',
    quoted_total: '',
    cargo_basis: {
      cbm: scenario?.totals?.cbm ?? '',
      chargeable_weight_kg: scenario?.totals?.chargeable_weight_kg ?? '',
      cartons: scenario?.totals?.carton_count ?? '',
    },
    breakdown: { freight: '', destination_charges: '', customs: '', duties_included: false },
    transit_days: '',
    quote_date: new Date().toISOString().slice(0, 10),
    source: 'manual',
    decision_notes: '',
    is_chosen: false,
  }
}

// ── Add-quote inline form ─────────────────────────────────────────────────────
function AddQuoteForm({ orderId, scenarios, vendors, rates, onSaved, onCancel }) {
  const selected = scenarios.find(s => s.selected) || scenarios[0] || null
  const [form, setForm] = useState(() => blankQuote(orderId, selected))
  const [saving, setSaving] = useState(false)

  const setF = patch => setForm(f => ({ ...f, ...patch }))
  const setCargo = patch => setForm(f => ({ ...f, cargo_basis: { ...f.cargo_basis, ...patch } }))

  function onScenarioChange(scenarioId) {
    const sc = scenarios.find(s => s.id === scenarioId) || null
    setForm(f => ({
      ...f,
      scenario_id: sc?.id || '',
      scenario_label: sc?.label || '',
      cargo_basis: {
        cbm: sc?.totals?.cbm ?? f.cargo_basis.cbm,
        chargeable_weight_kg: sc?.totals?.chargeable_weight_kg ?? f.cargo_basis.chargeable_weight_kg,
        cartons: sc?.totals?.carton_count ?? f.cargo_basis.cartons,
      },
    }))
  }

  function onVendorChange(vendorId) {
    const v = vendors.find(x => x.id === vendorId)
    setF({ vendor_id: vendorId, vendor_name: v?.name || '' })
  }

  async function handleSave() {
    if (!form.vendor_name.trim() && !form.vendor_id) {
      alert('Enter a vendor name or pick from the list.')
      return
    }
    setSaving(true)
    try {
      // rates: without this, quoted_total_hkd was never computed at all — every
      // quote saved from this page had it stay null, so the comparison matrix
      // (below) had nothing to compare across currencies with even after being
      // fixed to prefer it (bug-fix pack B-05).
      await saveFreightQuote(null, form, rates)
      onSaved()
    } catch (e) {
      // Without this a failed write was silent too — the form just sat there.
      console.error('saveFreightQuote failed', e)
      alert(`Could not save the freight quote: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-brand-200 rounded-none bg-brand-50/30 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-ink">Add freight quote</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Vendor */}
        <div className="col-span-2 sm:col-span-1">
          <label className="label">Vendor</label>
          <select className="input" value={form.vendor_id} onChange={e => onVendorChange(e.target.value)}>
            <option value="">— select or type below —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {!form.vendor_id && (
            <input className="input mt-1 text-sm" placeholder="Or type vendor name"
              value={form.vendor_name}
              onChange={e => setF({ vendor_name: e.target.value })} />
          )}
        </div>

        {/* Scenario */}
        <div>
          <label className="label">Packing scenario</label>
          <select className="input" value={form.scenario_id} onChange={e => onScenarioChange(e.target.value)}>
            <option value="">— no scenario —</option>
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>{s.label}{s.selected ? ' ★' : ''}</option>
            ))}
          </select>
        </div>

        {/* Mode */}
        <div>
          <label className="label">Freight mode</label>
          <select className="input" value={form.mode} onChange={e => setF({ mode: e.target.value })}>
            {FREIGHT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {/* Incoterm */}
        <div>
          <label className="label">Incoterm</label>
          <select className="input" value={form.incoterm} onChange={e => setF({ incoterm: e.target.value })}>
            {FREIGHT_INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        {/* Total */}
        <div>
          <label className="label">Quoted total</label>
          <div className="flex gap-1">
            <select className="input w-20" value={form.currency} onChange={e => setF({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input className="input flex-1" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.quoted_total}
              onChange={e => setF({ quoted_total: e.target.value })} />
          </div>
        </div>

        {/* Transit */}
        <div>
          <label className="label">Transit (days)</label>
          <input className="input" type="number" min="0" placeholder="e.g. 14"
            value={form.transit_days}
            onChange={e => setF({ transit_days: e.target.value })} />
        </div>

        {/* Quote date */}
        <div>
          <label className="label">Quote date</label>
          <input className="input" type="date"
            value={form.quote_date}
            onChange={e => setF({ quote_date: e.target.value })} />
        </div>
      </div>

      {/* Cargo basis */}
      <div>
        <p className="label mb-1">Cargo basis <span className="text-ink-60 font-normal">(prefilled from scenario totals — override if needed)</span></p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-60">CBM</span>
            <input className="input py-1 text-xs w-20" type="number" step="0.0001" placeholder="0.0000"
              value={form.cargo_basis.cbm}
              onChange={e => setCargo({ cbm: e.target.value })} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-60">Charg. wt</span>
            <input className="input py-1 text-xs w-20" type="number" step="0.1" placeholder="kg"
              value={form.cargo_basis.chargeable_weight_kg}
              onChange={e => setCargo({ chargeable_weight_kg: e.target.value })} />
            <span className="text-xs text-ink-60">kg</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-60">Cartons</span>
            <input className="input py-1 text-xs w-16" type="number" min="0" placeholder="0"
              value={form.cargo_basis.cartons}
              onChange={e => setCargo({ cartons: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="label">Notes</label>
        <input className="input text-sm" placeholder="e.g. includes door delivery, excludes duties"
          value={form.decision_notes}
          onChange={e => setF({ decision_notes: e.target.value })} />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-40">
          {saving ? 'Saving…' : 'Save quote'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Comparison matrix ─────────────────────────────────────────────────────────
// Rows = unique vendors (by vendor_name). Columns = scenarios + an "Unlinked" column.
// Cell = cheapest quote for that vendor × scenario.
function ComparisonMatrix({ quotes, scenarios }) {
  // Collect all unique vendors (by name, case-insensitive)
  const vendorNames = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const q of quotes) {
      const n = (q.vendor_name || '').trim()
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
    }
    return out.sort((a, b) => a.localeCompare(b))
  }, [quotes])

  // Columns: each scenario + an "Unlinked" column for quotes with no scenario_id
  const hasUnlinked = quotes.some(q => !q.scenario_id)
  const cols = [...scenarios, ...(hasUnlinked ? [{ id: null, label: 'Unlinked' }] : [])]

  // "Cheapest" comparisons below all use quoted_total_hkd (normalised), never
  // the raw quoted_total — quotes are legitimately in different currencies
  // (RMB freight quote vs a USD one), so comparing the raw numbers picked
  // whichever quote had the smaller NUMBER, not the smaller cost (bug-fix
  // pack B-05: e.g. RMB 3,000 ≈ USD 420 landed as "more expensive" than a
  // literal USD 500 quote under the old raw comparison). A quote with no
  // quoted_total_hkd (saved before this fix, or in a currency missing from
  // the rates table — see logistics.js's toHKD) is excluded from "cheapest"
  // rather than silently treated as free or infinite.
  const hkd = q => Number.isFinite(q?.quoted_total_hkd) ? q.quoted_total_hkd : null

  // Build lookup: vendorKey → scenarioId → cheapest quote (by HKD total)
  const lookup = useMemo(() => {
    const map = {}
    for (const q of quotes) {
      const vk = (q.vendor_name || '').trim().toLowerCase()
      const sk = q.scenario_id || null
      if (!map[vk]) map[vk] = {}
      const existing = map[vk][sk]
      const qTotal = hkd(q) ?? Infinity
      const eTotal = hkd(existing) ?? Infinity
      if (!existing || qTotal < eTotal) map[vk][sk] = q
    }
    return map
  }, [quotes])

  // Find cheapest HKD total per scenario column (for highlighting)
  const colMin = useMemo(() => {
    const out = {}
    for (const col of cols) {
      let min = Infinity
      for (const vk of vendorNames.map(n => n.toLowerCase())) {
        const t = hkd(lookup[vk]?.[col.id]) ?? Infinity
        if (t < min) min = t
      }
      out[col.id] = min
    }
    return out
  }, [cols, vendorNames, lookup])

  if (!vendorNames.length) return null

  const fmt = (n, cur) => n != null ? `${cur || 'HKD'} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 pr-4 text-xs font-semibold text-ink-60 uppercase tracking-wide whitespace-nowrap">Vendor</th>
            {cols.map(col => (
              <th key={col.id ?? '__unlinked'} className="py-2 px-3 text-left text-xs font-semibold text-ink-60 uppercase tracking-wide whitespace-nowrap">
                {col.label}
                {col.selected && <Star size={10} className="inline ml-1 text-yellow-500 fill-current" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vendorNames.map(vendor => {
            const vk = vendor.toLowerCase()
            return (
              <tr key={vendor} className="border-t border-warm-grey">
                <td className="py-2.5 pr-4 font-medium text-ink-80 whitespace-nowrap">{vendor}</td>
                {cols.map(col => {
                  const q = lookup[vk]?.[col.id]
                  const total = hkd(q)
                  const isBest = q && total != null && total === colMin[col.id]
                  const needsRate = q && total == null
                  return (
                    <td key={col.id ?? '__unlinked'} className="py-2.5 px-3">
                      {q ? (
                        <div className={`rounded-none px-3 py-2 ${isBest ? 'bg-green-50 border border-green-200' : 'bg-ivory'}`}>
                          <div className={`font-semibold ${isBest ? 'text-green-700' : 'text-ink'}`}>
                            {fmt(q.quoted_total, q.currency)}
                            {isBest && <span className="ml-1 text-[10px] text-green-600">★ cheapest</span>}
                          </div>
                          {/* Normalised comparison value, shown alongside the
                              original — the number this column is actually
                              ranked by (bug-fix pack B-05). */}
                          {q.currency !== 'HKD' && (
                            total != null
                              ? <div className="text-[10px] text-ink-60">≈ {fmt(total, 'HKD')}</div>
                              : needsRate && <div className="text-[10px] text-amber-600">no HKD rate — excluded from ranking</div>
                          )}
                          <div className="text-[10px] text-ink-60 mt-0.5 space-x-1.5">
                            <span>{modeLabel(q.mode)}</span>
                            {q.transit_days ? <span>· {q.transit_days}d</span> : null}
                            {q.cargo_basis?.cbm ? <span>· {q.cargo_basis.cbm} CBM</span> : null}
                          </div>
                        </div>
                      ) : (
                        <span className="text-platinum text-xs">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Quote list ────────────────────────────────────────────────────────────────
function QuoteRow({ quote, scenarios, onDelete, onToggleChosen }) {
  const [expanded, setExpanded] = useState(false)
  const sc = scenarios.find(s => s.id === quote.scenario_id)
  const total = parseFloat(quote.quoted_total)

  return (
    <div className={`border rounded-none overflow-hidden ${quote.is_chosen ? 'border-green-300' : 'border-warm-grey'}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${quote.is_chosen ? 'bg-green-50/50' : 'bg-white'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-ink">{quote.vendor_name || '—'}</span>
            {quote.is_chosen && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none bg-green-100 text-green-700 font-medium">
                <CheckCircle2 size={10} /> Chosen
              </span>
            )}
            {sc && <span className="text-[10px] px-1.5 py-0.5 rounded-none bg-blue-50 text-blue-600 border border-blue-100">{sc.label}</span>}
            {!quote.scenario_id && <span className="text-[10px] px-1.5 py-0.5 rounded-none bg-ivory-dark text-ink-60">Unlinked</span>}
            <span className="text-xs text-ink-60">{modeLabel(quote.mode)}</span>
            <span className="text-xs text-ink-60">{quote.incoterm}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-sm font-semibold text-ink">
              {!isNaN(total) ? `${quote.currency} ${total.toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}
            </span>
            {quote.currency !== 'HKD' && Number.isFinite(quote.quoted_total_hkd) && (
              <span className="text-xs text-ink-60">≈ HKD {quote.quoted_total_hkd.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
            )}
            {quote.transit_days && <span className="text-xs text-ink-60">{quote.transit_days} days</span>}
            {quote.quote_date && <span className="text-xs text-ink-60">{quote.quote_date}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* is_chosen had a data field and no way to set it (bug-fix pack
              B-05) — this is that missing control. */}
          <button type="button" onClick={() => onToggleChosen(quote)}
                  className={`text-xs px-2 py-1 rounded-none border ${quote.is_chosen ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-warm-grey text-ink-60 hover:border-brand-400'}`}
                  title={quote.is_chosen ? 'Unmark as chosen' : 'Mark as the chosen freight quote'}>
            {quote.is_chosen ? 'Chosen' : 'Choose'}
          </button>
          <button type="button" onClick={() => setExpanded(e => !e)} className="text-ink-60 hover:text-ink-70 p-1">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" onClick={() => onDelete(quote.id)} className="text-platinum hover:text-red-500 p-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-warm-grey bg-ivory text-xs text-ink-70 space-y-1">
          <div className="flex gap-4 flex-wrap pt-2">
            {quote.cargo_basis?.cbm != null && <span>CBM: {quote.cargo_basis.cbm}</span>}
            {quote.cargo_basis?.chargeable_weight_kg != null && <span>Charg. wt: {quote.cargo_basis.chargeable_weight_kg} kg</span>}
            {quote.cargo_basis?.cartons != null && <span>Cartons: {quote.cargo_basis.cartons}</span>}
          </div>
          {(quote.breakdown?.freight || quote.breakdown?.destination_charges || quote.breakdown?.customs) && (
            <div className="flex gap-4 flex-wrap">
              {quote.breakdown.freight != null && <span>Freight: {quote.currency} {quote.breakdown.freight}</span>}
              {quote.breakdown.destination_charges != null && <span>Dest charges: {quote.currency} {quote.breakdown.destination_charges}</span>}
              {quote.breakdown.customs != null && <span>Customs: {quote.currency} {quote.breakdown.customs}</span>}
              {quote.breakdown.duties_included && <span className="text-green-600">duties included</span>}
            </div>
          )}
          {quote.decision_notes && <p className="text-ink-60 italic">{quote.decision_notes}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FreightComparison({ orderId }) {
  const [quotes, setQuotes]       = useState([])
  const [scenarios, setScenarios] = useState([])
  const [vendors, setVendors]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const rates = useRates()

  async function load() {
    const [qs, ss, vs] = await Promise.all([
      loadOrderQuotes(orderId),
      getPackingScenariosByOrder(orderId),
      loadVendors(),
    ])
    setQuotes(qs)
    setScenarios(ss)
    setVendors(vs)
    setLoading(false)
  }

  useEffect(() => { if (orderId) load() }, [orderId])

  async function handleDelete(id) {
    if (!confirm('Delete this freight quote?')) return
    await deleteFreightQuote(id)
    setQuotes(prev => prev.filter(q => q.id !== id))
  }

  async function handleSaved() {
    setShowForm(false)
    const qs = await loadOrderQuotes(orderId)
    setQuotes(qs)
  }

  // "Chosen" is exclusive — one freight decision per order, not a multi-select.
  // Picking a new one un-chooses whatever was chosen before.
  async function handleToggleChosen(quote) {
    const nextChosen = !quote.is_chosen
    setQuotes(prev => prev.map(q => ({ ...q, is_chosen: q.id === quote.id ? nextChosen : false })))
    await Promise.all([
      saveFreightQuote(quote.id, { ...quote, is_chosen: nextChosen }, rates),
      ...(nextChosen ? quotes.filter(q => q.id !== quote.id && q.is_chosen)
        .map(q => saveFreightQuote(q.id, { ...q, is_chosen: false }, rates)) : []),
    ])
  }

  if (loading) return <div className="py-8 text-center text-sm text-ink-60">Loading freight quotes…</div>

  return (
    <div className="space-y-6">
      {/* Matrix */}
      {quotes.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-80 mb-4">Comparison matrix</h3>
          <ComparisonMatrix quotes={quotes} scenarios={scenarios} />
          {scenarios.length === 0 && (
            <p className="text-xs text-ink-60 mt-3">Save a packing scenario to link quotes to a packing method.</p>
          )}
        </div>
      )}

      {/* Quote list */}
      {quotes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-80">All quotes</h3>
          {quotes.map(q => (
            <QuoteRow key={q.id} quote={q} scenarios={scenarios} onDelete={handleDelete} onToggleChosen={handleToggleChosen} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {quotes.length === 0 && !showForm && (
        <div className="rounded-none border border-dashed border-warm-grey p-10 text-center">
          <p className="text-ink-60 text-sm mb-1">No freight quotes yet.</p>
          <p className="text-xs text-ink-60 mb-5">
            Add quotes from multiple vendors to compare costs across packing scenarios.
          </p>
        </div>
      )}

      {/* Add form / button */}
      {showForm ? (
        <AddQuoteForm
          orderId={orderId}
          scenarios={scenarios}
          vendors={vendors}
          rates={rates}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800"
        >
          <Plus size={15} /> Add freight quote
        </button>
      )}
    </div>
  )
}
