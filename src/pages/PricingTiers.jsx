import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  doc, getDoc, collection, getDocs, onSnapshot,
  addDoc, updateDoc, deleteDoc, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCIES } from '../constants'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'

const DEFAULT_RATES = { RMB: 1.09, USD: 7.78, EUR: 8.60, HKD: 1 }

export default function PricingTiers() {
  const { id } = useParams()

  const [product, setProduct]       = useState(null)
  const [components, setComponents] = useState([])
  const [tiers, setTiers]           = useState([])
  const [rates, setRates]           = useState(DEFAULT_RATES)
  const [markup, setMarkup]         = useState(1.5)
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // New tier form state
  const [newQty, setNewQty]   = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newLeadTime, setNewLeadTime] = useState('')
  const [adding, setAdding]   = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'products', id)).then(s => {
      if (s.exists()) setProduct({ id: s.id, ...s.data() })
    })

    // Load exchange rates from settings
    getDoc(doc(db, 'settings', 'exchange_rates')).then(s => {
      if (s.exists()) setRates(r => ({ ...r, ...s.data() }))
    })
  }, [id])

  useEffect(() => {
    // Load all components with their preferred supplier quotes
    const fetchComponents = async () => {
      const cSnap = await getDocs(query(collection(db, 'products', id, 'components'), orderBy('sort_order')))
      const comps = await Promise.all(
        cSnap.docs.map(async cDoc => {
          const qSnap = await getDocs(collection(db, 'products', id, 'components', cDoc.id, 'supplier_quotes'))
          const quotes = qSnap.docs.map(q => ({ id: q.id, ...q.data() }))
          const preferred = quotes.find(q => q.is_preferred) || null
          return { id: cDoc.id, ...cDoc.data(), preferred_quote: preferred, has_quotes: quotes.length > 0 }
        })
      )
      setComponents(comps)
      setLoading(false)
    }
    fetchComponents()
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'products', id, 'pricing_tiers'), orderBy('quantity'))
    return onSnapshot(q, snap => setTiers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id])

  // Total recurring unit cost HKD (no tooling)
  const unitCostHKD = components.reduce((sum, c) => {
    const q = c.preferred_quote
    if (!q || !q.unit_cost) return sum
    return sum + Number(q.unit_cost) * (rates[q.unit_cost_currency] || 1)
  }, 0)

  // Total one-time tooling/sample cost in HKD across all components
  const toolingCostHKD = components.reduce((sum, c) => {
    const q = c.preferred_quote
    if (!q || !q.tooling_sample_cost) return sum
    return sum + Number(q.tooling_sample_cost) * (rates[q.tooling_sample_cost_currency] || 1)
  }, 0)

  // Total unit cost including amortised tooling at a given quantity
  function totalUnitCostAtQty(qty) {
    return unitCostHKD + (qty > 0 ? toolingCostHKD / qty : 0)
  }

  const suggestedPrice = totalUnitCostAtQty(tiers[0]?.quantity || 200) * markup

  async function handleAddTier(e) {
    e.preventDefault()
    if (!newQty) return
    setAdding(true)
    const qty = Number(newQty)
    const price = newPrice ? Number(newPrice) : Math.ceil(totalUnitCostAtQty(qty) * markup)
    try {
      await addDoc(collection(db, 'products', id, 'pricing_tiers'), {
        quantity: qty,
        price_hkd: price,
        production_lead_time_days: newLeadTime ? Number(newLeadTime) : null,
        createdAt: serverTimestamp(),
      })
      setNewQty('')
      setNewPrice('')
      setNewLeadTime('')
    } finally {
      setAdding(false)
    }
  }

  async function handlePriceChange(tierId, value) {
    await updateDoc(doc(db, 'products', id, 'pricing_tiers', tierId), {
      price_hkd: Number(value),
    })
  }

  async function handleLeadTimeChange(tierId, value) {
    await updateDoc(doc(db, 'products', id, 'pricing_tiers', tierId), {
      production_lead_time_days: value ? Number(value) : null,
    })
  }

  async function handleDelete(tier) {
    await deleteDoc(doc(db, 'products', id, 'pricing_tiers', tier.id))
    setConfirmDelete(null)
  }

  if (loading) return <LoadingBar />

  return (
    <div className="p-6 max-w-3xl">
      {/* Breadcrumb */}
      <Link to={`/products/${id}`} className="text-sm text-brand-600 hover:underline">← {product?.name}</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-1 mb-6">Pricing Tiers</h1>

      {/* Cost Summary */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Cost Breakdown (from preferred suppliers)</h2>

        {components.length === 0 ? (
          <p className="text-sm text-gray-400">No components yet — <Link to={`/products/${id}`} className="text-brand-600 hover:underline">add components</Link> first.</p>
        ) : (
          <>
            <div className="divide-y divide-gray-100 mb-4">
              {components.map(c => {
                const q = c.preferred_quote
                const costHKD = q?.unit_cost ? Number(q.unit_cost) * (rates[q.unit_cost_currency] || 1) : null
                return (
                  <div key={c.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{c.name}</p>
                      {q ? (
                        <p className="text-xs text-gray-500">{q.supplier_name} · {q.unit_cost} {q.unit_cost_currency}</p>
                      ) : c.has_quotes ? (
                        <Link to={`/products/${id}/components/${c.id}`} className="text-xs text-orange-500 hover:underline">
                          ⚠ Has quotes but no preferred set — click to fix
                        </Link>
                      ) : (
                        <Link to={`/products/${id}/components/${c.id}`} className="text-xs text-red-400 hover:underline">
                          ✕ No supplier quotes yet — click to add
                        </Link>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 shrink-0">
                      {costHKD != null ? `HKD ${costHKD.toFixed(2)}` : '—'}
                    </p>
                  </div>
                )
              })}
            </div>

            {toolingCostHKD > 0 && (
              <div className="flex items-center justify-between py-2.5 border-t border-gray-100">
                <div>
                  <p className="text-sm text-gray-800">Tooling / Sample Cost</p>
                  <p className="text-xs text-gray-400">One-time — amortised per tier quantity</p>
                </div>
                <p className="text-sm font-medium text-gray-900">HKD {toolingCostHKD.toFixed(2)}</p>
              </div>
            )}
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <p className="text-sm font-semibold text-gray-700">Recurring Unit Cost</p>
              <p className="text-lg font-bold text-gray-900">HKD {unitCostHKD.toFixed(2)}</p>
            </div>

            {/* Markup slider */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-600">Markup: <span className="font-semibold">{markup.toFixed(2)}×</span></label>
                <p className="text-sm text-gray-600">Suggested price: <span className="font-semibold text-brand-700">HKD {suggestedPrice.toFixed(2)}</span></p>
              </div>
              <input
                type="range" min="1.0" max="4.0" step="0.05"
                value={markup}
                onChange={e => setMarkup(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>1.0×</span><span>2.0×</span><span>3.0×</span><span>4.0×</span>
              </div>
            </div>

            {/* Exchange rates note */}
            <div className="mt-3 text-xs text-gray-400">
              Rates used: {Object.entries(rates).filter(([k]) => k !== 'HKD').map(([k, v]) => `${k}→HKD ${v}`).join(' · ')}
              {' · '}<Link to="/settings" className="text-brand-500 hover:underline">Update in Settings</Link>
            </div>
          </>
        )}
      </div>

      {/* Warning if any component is missing a preferred supplier */}
      {components.some(c => !c.preferred_quote) && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 text-sm text-orange-700">
          ⚠ Some components have no preferred supplier — cost totals and margins below are incomplete.
        </div>
      )}

      {/* Pricing Tiers Table */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Quantity Tiers</h2>

        {tiers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No tiers yet — add your first quantity breakpoint below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Qty</th>
                  <th className="text-right pb-2 font-medium">Unit Cost HKD</th>
                  <th className="text-right pb-2 font-medium whitespace-nowrap">Tooling / Unit</th>
                  <th className="text-right pb-2 font-medium whitespace-nowrap">All-in Cost</th>
                  <th className="text-right pb-2 font-medium">Sell Price HKD</th>
                  <th className="text-right pb-2 font-medium">Margin</th>
                  <th className="text-right pb-2 font-medium">Lead Time (days)</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tiers.map(tier => {
                  const toolingPerUnit = toolingCostHKD / tier.quantity
                  const allInCost = totalUnitCostAtQty(tier.quantity)
                  const margin = tier.price_hkd && allInCost
                    ? ((tier.price_hkd - allInCost) / tier.price_hkd * 100)
                    : null
                  return (
                    <tr key={tier.id}>
                      <td className="py-2.5 font-semibold text-gray-800">{tier.quantity.toLocaleString()}</td>
                      <td className="py-2.5 text-right text-gray-600">{unitCostHKD.toFixed(2)}</td>
                      <td className="py-2.5 text-right text-gray-400 text-xs">{toolingCostHKD > 0 ? `+${toolingPerUnit.toFixed(2)}` : '—'}</td>
                      <td className="py-2.5 text-right font-medium text-gray-800">{allInCost.toFixed(2)}</td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          step="0.5"
                          className="input text-right w-24 py-1 text-sm"
                          defaultValue={tier.price_hkd}
                          onBlur={e => handlePriceChange(tier.id, e.target.value)}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        {margin != null ? (
                          <span className={`font-medium ${margin >= 40 ? 'text-green-600' : margin >= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {margin.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          className="input text-right w-20 py-1 text-sm"
                          defaultValue={tier.production_lead_time_days ?? ''}
                          placeholder="—"
                          onBlur={e => handleLeadTimeChange(tier.id, e.target.value)}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(tier)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add tier row */}
        <form onSubmit={handleAddTier} className="flex gap-2 mt-4 pt-4 border-t border-gray-100 flex-wrap">
          <div>
            <p className="text-xs text-gray-500 mb-1">Quantity *</p>
            <input
              type="number" min="1" placeholder="e.g. 200"
              className="input w-28 py-1.5 text-sm"
              value={newQty} onChange={e => setNewQty(e.target.value)} required
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Sell Price HKD</p>
            <input
              type="number" step="0.5" min="0"
              placeholder={suggestedPrice ? Math.ceil(suggestedPrice).toString() : '0'}
              className="input w-28 py-1.5 text-sm"
              value={newPrice} onChange={e => setNewPrice(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Lead Time (days)</p>
            <input
              type="number" min="0" placeholder="e.g. 30"
              className="input w-28 py-1.5 text-sm"
              value={newLeadTime} onChange={e => setNewLeadTime(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary py-1.5 text-sm" disabled={adding}>
              {adding ? 'Adding…' : '+ Add Tier'}
            </button>
          </div>
        </form>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Remove the ${confirmDelete.quantity.toLocaleString()} pcs tier?`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
