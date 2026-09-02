import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCIES } from '../constants'
import { useT } from '../i18n'

export default function SupplierAddQuoteModal({ supplier, onClose, onSaved }) {
  const t = useT()
  const [products, setProducts]       = useState([])
  const [components, setComponents]   = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedComponent, setSelectedComponent] = useState(null)
  const [loadingComponents, setLoadingComponents] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productOpen, setProductOpen] = useState(false)

  const [form, setForm] = useState({
    unit_cost: '',
    unit_cost_currency: 'RMB',
    moq: '',
    tooling_sample_cost: '',
    tooling_sample_cost_currency: 'RMB',
    sampling_lead_time_days: '',
    tooling_lead_time_days: '',
    production_lead_time_days: '',
    is_preferred: false,
    notes: '',
  })
  const [volumeTiers, setVolumeTiers] = useState([])

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name'))).then(snap =>
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [])

  async function handleProductSelect(product) {
    setSelectedProduct(product)
    setSelectedComponent(null)
    setComponents([])
    setProductSearch(product.name)
    setProductOpen(false)
    setLoadingComponents(true)
    const snap = await getDocs(collection(db, 'products', product.id, 'components'))
    setComponents(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)))
    setLoadingComponents(false)
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedProduct) { setError(t('Please select a product.')); return }
    if (!selectedComponent) { setError(t('Please select a component.')); return }
    if (!form.unit_cost) { setError(t('Unit cost is required.')); return }
    setSaving(true)
    setError('')
    try {
      const basePath = collection(db, 'products', selectedProduct.id, 'components', selectedComponent.id, 'supplier_quotes')

      // If preferred, clear others first
      if (form.is_preferred) {
        const existing = await getDocs(basePath)
        await Promise.all(existing.docs.map(d => updateDoc(d.ref, { is_preferred: false })))
      }

      await addDoc(basePath, {
        supplier_id:   supplier.id,
        supplier_name: supplier.name_cn ? `${supplier.name} (${supplier.name_cn})` : supplier.name,
        unit_cost:     Number(form.unit_cost),
        unit_cost_currency: form.unit_cost_currency,
        moq:           form.moq ? Number(form.moq) : null,
        tooling_sample_cost: form.tooling_sample_cost ? Number(form.tooling_sample_cost) : null,
        tooling_sample_cost_currency: form.tooling_sample_cost_currency,
        sampling_lead_time_days:  form.sampling_lead_time_days  ? Number(form.sampling_lead_time_days)  : null,
        tooling_lead_time_days:   form.tooling_lead_time_days   ? Number(form.tooling_lead_time_days)   : null,
        production_lead_time_days: form.production_lead_time_days ? Number(form.production_lead_time_days) : null,
        is_preferred:  form.is_preferred,
        notes:         form.notes.trim(),
        attachments:   [],
        volume_tiers:  volumeTiers
          .filter(vt => vt.min_qty !== '' && vt.unit_cost !== '')
          .map(vt => ({ min_qty: Number(vt.min_qty), unit_cost: Number(vt.unit_cost) }))
          .sort((a, b) => a.min_qty - b.min_qty),
        createdAt: serverTimestamp(),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const filteredProducts = products.filter(p =>
    !productSearch || p.name?.toLowerCase().includes(productSearch.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-none shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base text-ink">{t('Add Quote')}</h2>
            <p className="text-xs text-ink-60 mt-0.5">{supplier.name}</p>
          </div>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Product picker */}
          <div>
            <label className="label">{t('Product *')}</label>
            <div className="relative">
              <input
                className="input"
                placeholder={t('Search products…')}
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setProductOpen(true); setSelectedProduct(null); setSelectedComponent(null); setComponents([]) }}
                onFocus={() => setProductOpen(true)}
                onBlur={() => setTimeout(() => setProductOpen(false), 150)}
              />
              {productOpen && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-warm-grey rounded-none shadow-lg max-h-48 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <p className="text-xs text-ink-60 px-3 py-2">{t('No products found')}</p>
                  ) : filteredProducts.map(p => (
                    <button key={p.id} type="button"
                      onMouseDown={() => handleProductSelect(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-ivory border-b border-warm-grey last:border-0"
                    >
                      <p className="text-sm font-medium text-ink">{p.name}</p>
                      {p.category && <p className="text-xs text-ink-60">{p.category}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Component picker */}
          <div>
            <label className="label">{t('Component *')}</label>
            {!selectedProduct ? (
              <p className="text-xs text-ink-60 mt-1">{t('Select a product first')}</p>
            ) : loadingComponents ? (
              <p className="text-xs text-ink-60 mt-1">{t('Loading components…')}</p>
            ) : components.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">{t('This product has no components yet.')}</p>
            ) : (
              <div className="flex flex-col gap-1.5 mt-1">
                {components.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedComponent(c)}
                    className={`text-left px-3 py-2 rounded-none border text-sm transition-colors ${
 selectedComponent?.id === c.id
                        ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                        : 'border-warm-grey text-ink-80 hover:border-warm-grey hover:bg-ivory'
                    }`}
                  >
                    {c.name}
                    {c.spec && <span className="text-xs text-ink-60 ml-1.5">{c.spec}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-warm-grey pt-3 space-y-4">
            {/* Unit cost */}
            <div>
              <label className="label">{t('Unit Cost *')}</label>
              <div className="flex gap-2">
                <input className="input flex-1" type="number" step="0.01" min="0" value={form.unit_cost} onChange={set('unit_cost')} placeholder="0.00" />
                <select className="input w-28" value={form.unit_cost_currency} onChange={set('unit_cost_currency')}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Volume tiers */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0 text-xs">{t('Volume Price Tiers')} <span className="text-ink-60 font-normal">{t('(optional)')}</span></label>
                <button type="button" onClick={() => setVolumeTiers(prev => [...prev, { min_qty: '', unit_cost: '' }])}
                  className="text-xs text-brand-600 hover:text-brand-800">{t('+ Add')}</button>
              </div>
              {volumeTiers.map((tier, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center mb-2">
                  <input className="input py-1.5 text-sm" type="number" min="1" placeholder={t('Min qty')}
                    value={tier.min_qty} onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, min_qty: e.target.value } : r))} />
                  <input className="input py-1.5 text-sm" type="number" step="0.01" min="0" placeholder={t('Unit cost')}
                    value={tier.unit_cost} onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, unit_cost: e.target.value } : r))} />
                  <button type="button" onClick={() => setVolumeTiers(prev => prev.filter((_, j) => j !== i))}
                    className="text-red-300 hover:text-red-500 text-lg leading-none px-1">×</button>
                </div>
              ))}
            </div>

            {/* MOQ */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">MOQ</label>
                <input className="input" type="number" min="0" value={form.moq} onChange={set('moq')} placeholder="e.g. 200" />
              </div>
              <div>
                <label className="label">{t('Tooling / Sample Cost')}</label>
                <div className="flex gap-1.5">
                  <input className="input flex-1 min-w-0" type="number" step="0.01" min="0" value={form.tooling_sample_cost} onChange={set('tooling_sample_cost')} placeholder="0.00" />
                  <select className="input w-20 shrink-0" value={form.tooling_sample_cost_currency} onChange={set('tooling_sample_cost_currency')}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Lead times */}
            <div>
              <label className="label">{t('Lead Times (days)')}</label>
              <div className="grid grid-cols-3 gap-2">
                {[['Sampling', 'sampling_lead_time_days'], ['Tooling', 'tooling_lead_time_days'], ['Production', 'production_lead_time_days']].map(([label, field]) => (
                  <div key={field}>
                    <p className="text-xs text-ink-60 mb-1">{t(label)}</p>
                    <input className="input" type="number" min="0" value={form[field]} onChange={set(field)} placeholder={t('days')} />
                  </div>
                ))}
              </div>
            </div>

            {/* Preferred */}
            <label className="flex items-center gap-2.5 text-sm text-ink-80 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.is_preferred}
                onChange={e => setForm(f => ({ ...f, is_preferred: e.target.checked }))} />
              {t('Mark as preferred supplier for this component')}
            </label>

            {/* Notes */}
            <div>
              <label className="label">{t('Notes')}</label>
              <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder={t('Any conditions, remarks…')} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? t('Saving…') : t('Save Quote')}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>{t('Cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
