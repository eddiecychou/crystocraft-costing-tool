import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  doc, getDoc, collection, getDocs, onSnapshot,
  addDoc, updateDoc, deleteDoc, setDoc, writeBatch, orderBy, query, serverTimestamp, deleteField,
} from 'firebase/firestore'
import { db } from '../firebase'
import { AlertTriangle, X, BadgeCheck } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import {
  usePricingGroups, effectiveMarkup, DEFAULT_MARKUP,
  unitCostHKDAtQty, toolingCostHKD, totalUnitCostAtQty,
} from '../pricing'

const DEFAULT_RATES = { RMB: 1.09, USD: 7.78, EUR: 8.60, HKD: 1 }

export default function PricingTiers() {
  const { id } = useParams()

  const [product, setProduct]       = useState(null)
  const [components, setComponents] = useState([])
  const [tiers, setTiers]           = useState([])
  const [rates, setRates]           = useState(DEFAULT_RATES)
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const { groups }                  = usePricingGroups()

  // New tier form state
  const [newQty, setNewQty]         = useState('')
  const [newLeadTime, setNewLeadTime] = useState('')
  const [adding, setAdding]         = useState(false)

  // Publish state
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'products', id)).then(s => {
      if (s.exists()) setProduct({ id: s.id, ...s.data() })
    })
    getDoc(doc(db, 'settings', 'exchange_rates')).then(s => {
      if (s.exists()) {
        const data = s.data()
        const picked = Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'number'))
        setRates(r => ({ ...r, ...picked }))
      }
    })
  }, [id])

  useEffect(() => {
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

  const unitCostHKD = unitCostHKDAtQty(components, rates, tiers[0]?.quantity || 200)
  const hasVolumeTiers = components.some(c => c.preferred_quote?.volume_tiers?.length > 0)
  const toolingHKD = toolingCostHKD(components, rates)
  const missingPreferred = components.some(c => !c.preferred_quote)

  // Signature of everything that feeds published prices (cost inputs, the qty
  // ladder, and the group markups). Compared to what was stored at last publish
  // so we can flag when the live prices are stale.
  const signature = useMemo(() => JSON.stringify({
    tiers: tiers.map(t => [t.quantity, t.production_lead_time_days ?? null]),
    cost: components.map(c => {
      const q = c.preferred_quote
      return q
        ? [Number(c.qty_per_product) || 1, q.unit_cost, q.unit_cost_currency, q.volume_tiers || [], q.tooling_sample_cost || 0, q.tooling_sample_cost_currency || '']
        : [Number(c.qty_per_product) || 1, null]
    }),
    groups: groups.map(g => [g.id, g.markup]),
    rates,
  }), [tiers, components, groups, rates])

  const published = product?.prices_published_at != null
  const stale = !published || product?.prices_signature !== signature

  async function handleAddTier(e) {
    e.preventDefault()
    if (!newQty) return
    setAdding(true)
    try {
      await addDoc(collection(db, 'products', id, 'pricing_tiers'), {
        quantity: Number(newQty),
        production_lead_time_days: newLeadTime ? Number(newLeadTime) : null,
        createdAt: serverTimestamp(),
      })
      setNewQty('')
      setNewLeadTime('')
    } finally {
      setAdding(false)
    }
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

  // Compute each customer's price list (cost × their markup) and write one
  // customer_prices doc each. Raw cost never leaves the admin tool this way.
  async function publish() {
    if (!tiers.length) { setPublishMsg('Add at least one quantity tier first.'); return }
    setPublishing(true); setPublishMsg(null)
    try {
      const usersSnap = await getDocs(collection(db, 'users'))
      const customers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.role === 'customer' && u.status === 'approved')

      // Chunk writes so we stay well under the 500-op batch limit.
      const chunkSize = 400
      for (let i = 0; i < customers.length; i += chunkSize) {
        const batch = writeBatch(db)
        for (const u of customers.slice(i, i + chunkSize)) {
          const mk = effectiveMarkup(u, groups)
          const priced = tiers.map(t => ({
            quantity: t.quantity,
            price_hkd: Math.ceil(totalUnitCostAtQty(components, rates, t.quantity) * mk),
            lead_time_days: t.production_lead_time_days ?? null,
          }))
          batch.set(doc(db, 'products', id, 'customer_prices', u.id), {
            tiers: priced, markup: mk, computedAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }

      // Stamp a representative price (at the default markup) back onto each tier
      // doc so the admin Products grid has a figure to show. Customer-specific
      // prices still live in customer_prices.
      await Promise.all(tiers.map(t =>
        updateDoc(doc(db, 'products', id, 'pricing_tiers', t.id), {
          price_hkd: Math.ceil(totalUnitCostAtQty(components, rates, t.quantity) * DEFAULT_MARKUP),
          sell_currency: 'HKD',
          // Clear legacy fields from the old USD schema so stale values can't resurface.
          sell_price: deleteField(),
        })
      ))

      await setDoc(doc(db, 'products', id), {
        prices_published_at: serverTimestamp(),
        prices_signature: signature,
      }, { merge: true })
      setProduct(p => ({ ...p, prices_published_at: new Date(), prices_signature: signature }))
      setPublishMsg(`Published prices to ${customers.length} customer${customers.length === 1 ? '' : 's'}.`)
      setTimeout(() => setPublishMsg(null), 4000)
    } catch (e) {
      setPublishMsg('Error: ' + e.message)
    } finally {
      setPublishing(false)
    }
  }

  if (loading) return <LoadingBar />

  // Groups (plus an implicit Default) used for the price preview columns.
  const previewGroups = [
    ...groups.map(g => ({ id: g.id, name: g.name, markup: Number(g.markup) })),
    { id: '__default', name: 'Default', markup: DEFAULT_MARKUP },
  ]

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <Link to={`/products/${id}`} className="text-sm text-brand-600 hover:underline">← {product?.name}</Link>
      <h1 className="text-2xl font-bold text-ink mt-1 mb-6">Pricing</h1>

      {/* Cost Summary */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink-80">Cost Breakdown (from preferred suppliers)</h2>
          {hasVolumeTiers && <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">Volume pricing active</span>}
        </div>

        {components.length === 0 ? (
          <p className="text-sm text-ink-60">No components yet — <Link to={`/products/${id}`} className="text-brand-600 hover:underline">add components</Link> first.</p>
        ) : (
          <>
            <div className="divide-y divide-warm-grey mb-4">
              {components.map(c => {
                const q = c.preferred_quote
                const qty = Number(c.qty_per_product) || 1
                const costHKD = q?.unit_cost ? Number(q.unit_cost) * (rates[q.unit_cost_currency] || 1) * qty : null
                return (
                  <div key={c.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        {c.name}
                        {qty > 1 && <span className="ml-1.5 text-xs font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">×{c.qty_per_product}</span>}
                      </p>
                      {q ? (
                        <p className="text-xs text-ink-60">
                          {q.supplier_name} · {q.unit_cost} {q.unit_cost_currency}{qty > 1 ? ` × ${c.qty_per_product}` : ''}
                          {q.volume_tiers?.length > 0 && <span className="ml-1.5 text-brand-500">· {q.volume_tiers.length} volume tier{q.volume_tiers.length > 1 ? 's' : ''}</span>}
                        </p>
                      ) : c.has_quotes ? (
                        <Link to={`/products/${id}/components/${c.id}`} className="text-xs text-orange-500 hover:underline">
                          <AlertTriangle size={12} className="inline align-[-2px] mr-1" />Has quotes but no preferred set — click to fix
                        </Link>
                      ) : (
                        <Link to={`/products/${id}/components/${c.id}`} className="text-xs text-red-400 hover:underline">
                          <X size={12} className="inline align-[-2px] mr-1" />No supplier quotes yet — click to add
                        </Link>
                      )}
                    </div>
                    <p className="text-sm font-medium text-ink shrink-0">{costHKD != null ? `HKD ${costHKD.toFixed(2)}` : '—'}</p>
                  </div>
                )
              })}
            </div>

            {toolingHKD > 0 && (
              <div className="flex items-center justify-between py-2.5 border-t border-warm-grey">
                <div>
                  <p className="text-sm text-ink">Tooling / Sample Cost</p>
                  <p className="text-xs text-ink-60">One-time — amortised per tier quantity</p>
                </div>
                <p className="text-sm font-medium text-ink">HKD {toolingHKD.toFixed(2)}</p>
              </div>
            )}
            <div className="flex items-center justify-between pt-3 border-t border-warm-grey">
              <p className="text-sm font-semibold text-ink-80">Recurring Unit Cost</p>
              <p className="text-lg font-bold text-ink">HKD {unitCostHKD.toFixed(2)}</p>
            </div>

            <div className="mt-3 text-xs text-ink-60">
              Rates used: {Object.entries(rates).filter(([k, v]) => k !== 'HKD' && typeof v === 'number').map(([k, v]) => `${k}→HKD ${v}`).join(' · ')}
              {' · '}<Link to="/settings" className="text-brand-500 hover:underline">Update in Settings</Link>
            </div>
          </>
        )}
      </div>

      {missingPreferred && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 text-sm text-orange-700">
          <AlertTriangle size={13} className="inline align-[-2px] mr-1" />Some components have no preferred supplier — cost totals and prices below are incomplete.
        </div>
      )}

      {/* Quantity Tiers — qty + lead time only; price is derived from cost × markup */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-ink-80 mb-1">Quantity Tiers</h2>
        <p className="text-xs text-ink-60 mb-4">Set the order-quantity breakpoints. Customer prices are computed from the all-in cost at each quantity multiplied by the customer's pricing-group markup.</p>

        {tiers.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-4">No tiers yet — add your first quantity breakpoint below.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="text-sm border-separate border-spacing-0 w-full" style={{ minWidth: '520px' }}>
              <thead>
                <tr className="text-xs text-ink-60 uppercase tracking-wide">
                  <th className="text-left pb-3 pr-4 font-semibold text-ink-70 whitespace-nowrap">Qty</th>
                  <th className="text-right pb-3 px-4 font-semibold border-l border-warm-grey whitespace-nowrap">Unit Cost<br/><span className="text-platinum font-normal normal-case tracking-normal">{hasVolumeTiers ? 'at qty' : '(HKD)'}</span></th>
                  <th className="text-right pb-3 px-4 font-semibold border-l border-warm-grey whitespace-nowrap">Tooling<br/><span className="text-platinum font-normal normal-case tracking-normal">/unit</span></th>
                  <th className="text-right pb-3 px-4 font-semibold border-l border-warm-grey whitespace-nowrap">All-in Cost<br/><span className="text-platinum font-normal normal-case tracking-normal">(HKD)</span></th>
                  <th className="text-right pb-3 px-4 font-semibold border-l border-warm-grey whitespace-nowrap">Lead Time<br/><span className="text-platinum font-normal normal-case tracking-normal">(days)</span></th>
                  <th className="pb-3 pl-3 border-l border-warm-grey"></th>
                </tr>
                <tr><td colSpan={6} className="pb-1"><div className="border-b border-warm-grey" /></td></tr>
              </thead>
              <tbody>
                {tiers.map((tier, idx) => {
                  const toolingPerUnit = toolingHKD / tier.quantity
                  const allInCost = totalUnitCostAtQty(components, rates, tier.quantity)
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-ivory'
                  return (
                    <tr key={tier.id} className={rowBg}>
                      <td className="py-3 pr-4 font-bold text-ink whitespace-nowrap">{tier.quantity.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-ink-70 border-l border-warm-grey whitespace-nowrap">
                        {unitCostHKDAtQty(components, rates, tier.quantity).toFixed(2)}
                        {hasVolumeTiers && unitCostHKDAtQty(components, rates, tier.quantity) !== unitCostHKD && (
                          <span className="block text-xs text-brand-500">vol. price</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-ink-60 text-xs border-l border-warm-grey whitespace-nowrap">{toolingHKD > 0 ? `+${toolingPerUnit.toFixed(2)}` : '—'}</td>
                      <td className="py-3 px-4 text-right font-semibold text-ink border-l border-warm-grey whitespace-nowrap">{allInCost.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right border-l border-warm-grey">
                        <input type="number" className="input text-right w-20 py-1 text-sm" defaultValue={tier.production_lead_time_days ?? ''} placeholder="—"
                          onBlur={e => handleLeadTimeChange(tier.id, e.target.value)} />
                      </td>
                      <td className="py-3 pl-3 text-right border-l border-warm-grey">
                        <button type="button" onClick={() => setConfirmDelete(tier)} className="text-red-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleAddTier} className="flex gap-2 mt-4 pt-4 border-t border-warm-grey flex-wrap">
          <div>
            <p className="text-xs text-ink-60 mb-1">Quantity *</p>
            <input type="number" min="1" placeholder="e.g. 200" className="input w-28 py-1.5 text-sm" value={newQty} onChange={e => setNewQty(e.target.value)} required />
          </div>
          <div>
            <p className="text-xs text-ink-60 mb-1">Lead Time (days)</p>
            <input type="number" min="0" placeholder="e.g. 30" className="input w-28 py-1.5 text-sm" value={newLeadTime} onChange={e => setNewLeadTime(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary py-1.5 text-sm" disabled={adding}>{adding ? 'Adding…' : '+ Add Tier'}</button>
          </div>
        </form>
      </div>

      {/* Customer price preview by pricing group */}
      {tiers.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-semibold text-ink-80 mb-1">Customer Price Preview (HKD)</h2>
          <p className="text-xs text-ink-60 mb-4">
            All-in cost × each group's markup, rounded up. Customers with a per-customer override are priced at their own markup on publish.
          </p>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="text-sm border-separate border-spacing-0" style={{ minWidth: '420px' }}>
              <thead>
                <tr className="text-xs text-ink-60 uppercase tracking-wide">
                  <th className="text-left pb-3 pr-4 font-semibold text-ink-70 whitespace-nowrap">Qty</th>
                  {previewGroups.map(g => (
                    <th key={g.id} className="text-right pb-3 px-4 font-semibold border-l border-warm-grey whitespace-nowrap">
                      {g.name}<br/><span className="text-platinum font-normal normal-case tracking-normal">{g.markup.toFixed(2)}×</span>
                    </th>
                  ))}
                </tr>
                <tr><td colSpan={previewGroups.length + 1} className="pb-1"><div className="border-b border-warm-grey" /></td></tr>
              </thead>
              <tbody>
                {tiers.map((tier, idx) => {
                  const allIn = totalUnitCostAtQty(components, rates, tier.quantity)
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-ivory'
                  return (
                    <tr key={tier.id} className={rowBg}>
                      <td className="py-3 pr-4 font-bold text-ink whitespace-nowrap">{tier.quantity.toLocaleString()}</td>
                      {previewGroups.map(g => (
                        <td key={g.id} className="py-3 px-4 text-right text-ink border-l border-warm-grey whitespace-nowrap">{Math.ceil(allIn * g.markup).toLocaleString()}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Publish */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-ink-80">Publish to customers</h2>
            <p className="text-xs text-ink-60 mt-0.5">
              {!published ? 'Not published yet — customers see no corporate price until you publish.'
                : stale ? 'Costs, tiers or markups changed since the last publish.'
                : `Up to date · last published ${product.prices_published_at?.toDate?.().toLocaleString?.() || ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {published && !stale && <span className="inline-flex items-center gap-1 text-xs text-green-600"><BadgeCheck size={14} /> Up to date</span>}
            {stale && published && <span className="text-xs text-amber-600">Out of date</span>}
            <button onClick={publish} disabled={publishing || !tiers.length} className="btn-primary text-sm">
              {publishing ? 'Publishing…' : stale ? 'Publish prices' : 'Re-publish'}
            </button>
          </div>
        </div>
        {publishMsg && <p className={`text-xs mt-3 ${publishMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{publishMsg}</p>}
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
