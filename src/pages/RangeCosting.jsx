import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { X, AlertTriangle, BadgeCheck } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { CURRENCIES } from '../constants'
import { useComponents, resolveRef } from '../criticalComponents'
import { useCrystalColors, colorMap } from '../crystalColors'
import { DEFAULT_MARKUP } from '../pricing'
import {
  componentCostAtQty, componentsCostHKD, extraLinesHKD, variantAdderHKD,
  toolingHKD, variantAllInCostHKD, variantSellHKD, productMarkup,
} from '../rangeCosting'

const DEFAULT_RATES = { RMB: 1.09, USD: 7.78, EUR: 8.60, HKD: 1 }
const blankCosting = () => ({ extra_lines: [], plating_costs: {}, crystal_costs: {}, markup: '', tiers: [] })

// Build the editable costing state from a stored product, listing every plating
// and crystal the product actually uses so the user only fills relevant adders.
function hydrate(product) {
  const c = product?.costing || {}
  return {
    extra_lines: Array.isArray(c.extra_lines)
      ? c.extra_lines.map(l => ({ label: l.label || '', cost: l.cost ?? '', currency: l.currency || 'RMB' })) : [],
    plating_costs: c.plating_costs && typeof c.plating_costs === 'object' ? { ...c.plating_costs } : {},
    crystal_costs: c.crystal_costs && typeof c.crystal_costs === 'object' ? { ...c.crystal_costs } : {},
    markup: c.markup ?? '',
    tiers: Array.isArray(c.tiers)
      ? c.tiers.map(t => ({ quantity: t.quantity ?? '', lead_time_days: t.lead_time_days ?? '' })) : [],
  }
}

// Strip the editable state to the persisted shape (numbers, no empty rows).
function serialize(state) {
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const cleanMap = m => Object.fromEntries(
    Object.entries(m || {})
      .map(([k, v]) => [k, { cost: num(v?.cost), currency: v?.currency || 'RMB' }])
      .filter(([, v]) => v.cost != null))
  return {
    extra_lines: (state.extra_lines || [])
      .map(l => ({ label: (l.label || '').trim(), cost: num(l.cost), currency: l.currency || 'RMB' }))
      .filter(l => l.cost != null && l.label),
    plating_costs: cleanMap(state.plating_costs),
    crystal_costs: cleanMap(state.crystal_costs),
    markup: num(state.markup),
    tiers: (state.tiers || [])
      .map(t => ({ quantity: num(t.quantity), lead_time_days: num(t.lead_time_days) }))
      .filter(t => t.quantity != null && t.quantity > 0)
      .sort((a, b) => a.quantity - b.quantity),
  }
}

export default function RangeCosting() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [state, setState] = useState(blankCosting())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const { components: lib } = useComponents()
  const { colors: libColors } = useCrystalColors()
  const colorLookup = useMemo(() => colorMap(libColors), [libColors])

  useEffect(() => {
    getDoc(doc(db, 'range_products', id)).then(s => {
      if (s.exists()) { const p = { id: s.id, ...s.data() }; setProduct(p); setState(hydrate(p)) }
      setLoading(false)
    })
    getDoc(doc(db, 'settings', 'exchange_rates')).then(s => {
      if (s.exists()) {
        const picked = Object.fromEntries(Object.entries(s.data()).filter(([, v]) => typeof v === 'number'))
        setRates(r => ({ ...r, ...picked }))
      }
    })
  }, [id])

  const variants = useMemo(() => (Array.isArray(product?.variants) ? product.variants : []), [product])
  const platings = useMemo(() => {
    const seen = new Map()
    for (const v of variants) {
      const code = (v.plating_code || '').trim().toUpperCase()
      if (code && !seen.has(code)) seen.set(code, v.plating_name || code)
    }
    return [...seen.entries()].map(([code, name]) => ({ code, name }))
  }, [variants])
  const crystals = useMemo(() => {
    const set = new Set()
    for (const v of variants) {
      for (const c of (Array.isArray(v.crystal_colors) ? v.crystal_colors : [])) {
        const code = (c || '').trim().toUpperCase()
        if (code) set.add(code)
      }
      const single = (v.crystal_code || '').trim().toUpperCase()
      if (single) set.add(single)
    }
    return [...set]
  }, [variants])

  // A live product clone carrying the current (unsaved) costing edits, so every
  // preview number reflects what the user is typing before they save.
  const draft = useMemo(() => ({ ...product, costing: serialize(state) }), [product, state])
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const compCostHKD = componentsCostHKD(draft, lib, rates, 1)
  const extraHKD = extraLinesHKD(draft, rates)
  const toolHKD = toolingHKD(draft, lib, rates)
  const markup = productMarkup(draft)
  const tiers = serialize(state).tiers
  const qtyCols = tiers.length ? tiers.map(t => t.quantity) : [1]

  // ── editing helpers ─────────────────────────────────────────────────────────
  const setExtra = (i, key) => e => setState(s => ({
    ...s, extra_lines: s.extra_lines.map((l, j) => j === i ? { ...l, [key]: key === 'cost' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value } : l),
  }))
  const addExtra = () => setState(s => ({ ...s, extra_lines: [...s.extra_lines, { label: '', cost: '', currency: 'RMB' }] }))
  const removeExtra = i => setState(s => ({ ...s, extra_lines: s.extra_lines.filter((_, j) => j !== i) }))

  const setAdder = (bucket, code, key) => e => setState(s => ({
    ...s,
    [bucket]: { ...s[bucket], [code]: { ...(s[bucket][code] || { currency: 'RMB' }), [key]: key === 'cost' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value } },
  }))

  const setTier = (i, key) => e => setState(s => ({
    ...s, tiers: s.tiers.map((t, j) => j === i ? { ...t, [key]: e.target.value.replace(/[^\d]/g, '') } : t),
  }))
  const addTier = () => setState(s => ({ ...s, tiers: [...s.tiers, { quantity: '', lead_time_days: '' }] }))
  const removeTier = i => setState(s => ({ ...s, tiers: s.tiers.filter((_, j) => j !== i) }))

  async function save({ publish } = {}) {
    setSaving(true); setMsg(null)
    try {
      const costing = serialize(state)
      if (publish) {
        costing.published_at = serverTimestamp()
        costing.markup_used = markup
      }
      await updateDoc(doc(db, 'range_products', id), { costing })
      setProduct(p => ({ ...p, costing: { ...costing, published_at: publish ? new Date() : p?.costing?.published_at } }))
      setMsg(publish ? 'Costing saved and published.' : 'Costing saved.')
      setTimeout(() => setMsg(null), 3500)
    } catch (e) {
      setMsg('Error: ' + e.message)
    } finally { setSaving(false) }
  }

  if (loading) return <LoadingBar />
  if (!product) return <div className="p-6 text-ink-60">Product not found. <Link to="/range" className="text-brand-600">Back</Link></div>

  const productCode = [product.design_no, product.format_code].filter(Boolean).join('-')
  const colourName = code => colorLookup[code]?.name || code

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="eyebrow mb-1">Figurine Costing {productCode && `· ${productCode}`}</p>
          <h1 className="text-xl md:text-2xl">{product.design_name || product.description || productCode}</h1>
        </div>
        <Link to={`/range/${id}`} className="btn-secondary text-sm">← Back to product</Link>
      </div>

      {/* Component costs */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Critical component costs <span className="font-normal text-ink-60">(at qty 1)</span></h2>
        {refs.length === 0 ? (
          <p className="text-sm text-ink-50">No critical components on this product. Add them in the <Link to={`/range/${id}`} className="text-brand-600 hover:underline">product editor</Link>, then set each part's cost under <Link to="/components" className="text-brand-600 hover:underline">Components</Link>.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {refs.map(r => {
              const c = resolveRef(r, lib)
              const unit = componentCostAtQty(c, 1)
              const qty = Number(r.qty_per_unit) || 1
              const hk = unit != null ? unit * (rates[c.unit_cost_currency] || 1) * qty : null
              return (
                <div key={(r.id || r.code)} className="py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800">{c?.name || r.code}
                      {qty > 1 && <span className="ml-1.5 text-xs font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">×{qty}</span>}</p>
                    {unit != null ? (
                      <p className="text-xs text-gray-500">{c.code} · {unit} {c.unit_cost_currency}{qty > 1 ? ` × ${qty}` : ''}
                        {c.volume_tiers?.length > 0 && <span className="ml-1.5 text-brand-500">· {c.volume_tiers.length} volume tier{c.volume_tiers.length > 1 ? 's' : ''}</span>}</p>
                    ) : (
                      <Link to={`/components/critical/${c?.id || ''}`} className="text-xs text-red-400 hover:underline">
                        <AlertTriangle size={12} className="inline align-[-2px] mr-1" />No cost set — click to add</Link>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-900 shrink-0">{hk != null ? `HKD ${hk.toFixed(2)}` : '—'}</p>
                </div>
              )
            })}
            <div className="py-2.5 flex items-center justify-between border-t border-gray-200">
              <p className="text-sm font-semibold text-gray-700">Component subtotal</p>
              <p className="text-sm font-bold text-gray-900">HKD {compCostHKD.toFixed(2)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Extra cost lines */}
      <div className="card p-5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Extra cost lines <span className="font-normal text-ink-60">(all variants)</span></h2>
          <button type="button" onClick={addExtra} className="text-xs text-brand-600 hover:underline">+ Add line</button>
        </div>
        <p className="text-xs text-ink-60 mb-3">Assembly / labour, gift box, packaging — anything shared across every variant.</p>
        {state.extra_lines.length === 0 ? (
          <p className="text-xs text-ink-50">No extra lines yet.</p>
        ) : (
          <div className="space-y-2">
            {state.extra_lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input py-1.5 text-sm flex-1" value={l.label} onChange={setExtra(i, 'label')} placeholder="e.g. Assembly + packing" />
                <input className="input py-1.5 text-sm w-24" inputMode="decimal" value={l.cost} onChange={setExtra(i, 'cost')} placeholder="0.00" />
                <select className="input py-1.5 text-sm w-20" value={l.currency} onChange={setExtra(i, 'currency')}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" onClick={() => removeExtra(i)} className="text-red-300 hover:text-red-500" title="Remove"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-60 mt-3">Extra subtotal: <span className="font-medium text-gray-800">HKD {extraHKD.toFixed(2)}</span></p>
      </div>

      {/* Plating + crystal adders */}
      <div className="grid sm:grid-cols-2 gap-5 mb-5">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Plating adder</h2>
          {platings.length === 0 ? <p className="text-xs text-ink-50">No platings on this product.</p> : (
            <div className="space-y-2">
              {platings.map(p => (
                <div key={p.code} className="flex items-center gap-2">
                  <span className="text-xs text-ink-70 w-24 truncate" title={p.name}>{p.name} <span className="text-ink-40 font-mono">{p.code}</span></span>
                  <input className="input py-1.5 text-sm w-24" inputMode="decimal"
                         value={state.plating_costs[p.code]?.cost ?? ''} onChange={setAdder('plating_costs', p.code, 'cost')} placeholder="0.00" />
                  <select className="input py-1.5 text-sm w-20" value={state.plating_costs[p.code]?.currency || 'RMB'} onChange={setAdder('plating_costs', p.code, 'currency')}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Crystal adder</h2>
          {crystals.length === 0 ? <p className="text-xs text-ink-50">No crystal colours selected on this product.</p> : (
            <div className="space-y-2">
              {crystals.map(code => (
                <div key={code} className="flex items-center gap-2">
                  <span className="text-xs text-ink-70 w-24 truncate" title={colourName(code)}>{colourName(code)} <span className="text-ink-40 font-mono">{code}</span></span>
                  <input className="input py-1.5 text-sm w-24" inputMode="decimal"
                         value={state.crystal_costs[code]?.cost ?? ''} onChange={setAdder('crystal_costs', code, 'cost')} placeholder="0.00" />
                  <select className="input py-1.5 text-sm w-20" value={state.crystal_costs[code]?.currency || 'RMB'} onChange={setAdder('crystal_costs', code, 'currency')}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
              <p className="text-[11px] text-ink-50 pt-1">A variant with several colours is costed at its dearest colour.</p>
            </div>
          )}
        </div>
      </div>

      {/* Markup + tiers */}
      <div className="card p-5 mb-5">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div>
            <label className="label">Markup</label>
            <input className="input w-28" inputMode="decimal" value={state.markup}
                   onChange={e => setState(s => ({ ...s, markup: e.target.value.replace(/[^\d.]/g, '') }))} placeholder={DEFAULT_MARKUP.toFixed(2)} />
            <p className="text-[10px] text-ink-50 mt-0.5">Blank = default {DEFAULT_MARKUP.toFixed(2)}×</p>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={addTier} className="text-xs text-brand-600 hover:underline">+ Add quantity tier</button>
        </div>
        {state.tiers.length > 0 && (
          <div className="space-y-2 mb-2">
            {state.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-ink-50 w-10">Qty</span>
                <input className="input py-1.5 text-sm w-28" inputMode="numeric" value={t.quantity} onChange={setTier(i, 'quantity')} placeholder="e.g. 200" />
                <span className="text-xs text-ink-50">Lead (days)</span>
                <input className="input py-1.5 text-sm w-24" inputMode="numeric" value={t.lead_time_days} onChange={setTier(i, 'lead_time_days')} placeholder="—" />
                <button type="button" onClick={() => removeTier(i)} className="text-red-300 hover:text-red-500 ml-auto" title="Remove"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-50">Tiers set the order-quantity breakpoints (used with component volume tiers). No tiers = a single unit price.</p>
      </div>

      {/* Per-variant cost + sell table */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Per-variant cost &amp; sell <span className="font-normal text-ink-60">({markup.toFixed(2)}× markup)</span></h2>
        <p className="text-xs text-gray-400 mb-3">All-in cost = components + extras + plating/crystal adder (+ tooling amortised). Sell = ⌈cost × markup⌉, HKD.</p>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="text-sm border-separate border-spacing-0 w-full" style={{ minWidth: 360 + qtyCols.length * 120 + 'px' }}>
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left pb-2 pr-3 font-semibold text-gray-600">Variant</th>
                {qtyCols.map(q => (
                  <th key={q} className="text-right pb-2 px-3 font-semibold border-l border-gray-100 whitespace-nowrap">
                    {q === 1 && !tiers.length ? 'Unit' : `${q.toLocaleString()} pcs`}<br/>
                    <span className="text-gray-300 font-normal normal-case tracking-normal">cost → sell</span>
                  </th>
                ))}
              </tr>
              <tr><td colSpan={qtyCols.length + 1} className="pb-1"><div className="border-b border-gray-200" /></td></tr>
            </thead>
            <tbody>
              {variants.map((v, idx) => {
                const label = v.sku || [v.brand_code, v.plating_name].filter(Boolean).join(' · ') || `Variant ${idx + 1}`
                return (
                  <tr key={v.sku || idx} className={idx % 2 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="py-2.5 pr-3 align-top">
                      <p className="font-mono text-xs text-gray-800">{label}</p>
                      <p className="text-[11px] text-gray-400">{[v.plating_name, (v.crystal_colors || []).join('/')].filter(Boolean).join(' · ')}</p>
                    </td>
                    {qtyCols.map(q => {
                      const cost = variantAllInCostHKD(draft, lib, rates, v, q)
                      const sell = variantSellHKD(draft, lib, rates, v, q, markup)
                      return (
                        <td key={q} className="py-2.5 px-3 text-right border-l border-gray-100 whitespace-nowrap">
                          <span className="text-gray-500">{cost.toFixed(2)}</span>
                          <span className="text-gray-300"> → </span>
                          <span className="font-semibold text-gray-900">{sell.toLocaleString()}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {variants.length === 0 && (
                <tr><td colSpan={qtyCols.length + 1} className="py-4 text-center text-ink-50 text-sm">This product has no variants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Rates: {Object.entries(rates).filter(([k, v]) => k !== 'HKD' && typeof v === 'number').map(([k, v]) => `${k}→HKD ${v}`).join(' · ')}
          {' · '}<Link to="/settings" className="text-brand-500 hover:underline">Settings</Link>
          {toolHKD > 0 && <> · Tooling HKD {toolHKD.toFixed(2)} amortised over qty</>}
        </p>
      </div>

      {/* Actions */}
      <div className="card p-5 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-gray-400">
          {product.costing?.published_at
            ? <span className="inline-flex items-center gap-1 text-green-600"><BadgeCheck size={14} /> Published {product.costing.published_at?.toDate?.().toLocaleString?.() || ''}</span>
            : 'Not published yet.'}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => save()} disabled={saving} className="btn-secondary text-sm">{saving ? 'Saving…' : 'Save costing'}</button>
          <button onClick={() => save({ publish: true })} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save & publish'}</button>
        </div>
        {msg && <p className={`w-full text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}
