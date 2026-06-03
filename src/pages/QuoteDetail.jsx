import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  doc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, orderBy, query, addDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import QuoteExport from '../components/QuoteExport'

const STATUS_OPTIONS = ['draft', 'sent', 'won', 'lost']
const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

export default function QuoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [quote, setQuote]           = useState(null)
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showExport, setShowExport] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'client_quotes', id)).then(snap => {
      if (snap.exists()) setQuote({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'client_quotes', id, 'items'), orderBy('createdAt'))
    return onSnapshot(q, snap => setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id])

  async function handleStatusChange(status) {
    await updateDoc(doc(db, 'client_quotes', id), { status })
    setQuote(q => ({ ...q, status }))
  }

  async function handleDelete() {
    await deleteDoc(doc(db, 'client_quotes', id))
    navigate('/quotes')
  }

  async function handleRemoveItem(itemId) {
    await deleteDoc(doc(db, 'client_quotes', id, 'items', itemId))
    await updateDoc(doc(db, 'client_quotes', id), { item_count: Math.max(0, (items.length - 1)) })
  }

  async function handleTiersChange(itemId, tiers) {
    await updateDoc(doc(db, 'client_quotes', id, 'items', itemId), { tiers })
  }

  async function handleAddProducts(products) {
    const quoteCurrency = quote.quote_currency || 'HKD'
    const rates = { HKD: 1, RMB: quote.rmb_to_hkd, USD: quote.usd_to_hkd, EUR: quote.eur_to_hkd }

    function toQuoteCurrency(price_hkd) {
      return quoteCurrency === 'HKD' ? price_hkd : +(price_hkd / (rates[quoteCurrency] || 1)).toFixed(2)
    }

    await Promise.all(products.map(async p => {
      const tierSnap = await getDocs(query(collection(db, 'products', p.id, 'pricing_tiers'), orderBy('quantity')))
      const tiers = tierSnap.docs.length > 0
        ? tierSnap.docs.map(d => {
            const td = d.data()
            // Use the sell_price directly if currency matches, otherwise convert from price_hkd
            const price = td.sell_currency === quoteCurrency
              ? (td.sell_price || 0)
              : toQuoteCurrency(td.price_hkd || 0)
            return { quantity: td.quantity || 200, price, currency: quoteCurrency }
          })
        : [{ quantity: 200, price: 0, currency: quoteCurrency }]

      await addDoc(collection(db, 'client_quotes', id, 'items'), {
        product_id: p.id,
        product_name: p.name,
        product_category: p.category,
        product_description: p.description || '',
        hero_image: p.heroImage || null,
        tiers,
        status: p.status,
        createdAt: serverTimestamp(),
      })
    }))

    await updateDoc(doc(db, 'client_quotes', id), {
      item_count: items.length + products.length,
      updatedAt: serverTimestamp(),
    })
    setShowProductPicker(false)
  }

  if (loading) return <LoadingBar />
  if (!quote) return <div className="p-6 text-gray-500">Quote not found.</div>

  const quoteCurrency = quote.quote_currency || 'HKD'

  // Min total: first (lowest qty) tier of each item, in quote currency
  const minTotal = items.reduce((sum, i) => {
    const tiers = i.tiers || [{ quantity: i.quantity || 0, price: i.price_hkd || 0, currency: 'HKD' }]
    const t = tiers[0] || {}
    const price = t.price ?? t.price_hkd ?? 0
    return sum + price * (t.quantity || 0)
  }, 0)

  return (
    <div className="p-6 max-w-4xl">
      <Link to="/quotes" className="text-sm text-brand-600 hover:underline">← Quotes</Link>

      {/* Header */}
      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{quote.client_name}</h1>
          {quote.contact_name && <p className="text-sm text-gray-500 mt-0.5">{quote.contact_name} {quote.contact_email && `· ${quote.contact_email}`}</p>}
          <p className="text-xs text-gray-400 mt-1">Currency: <span className="font-medium text-gray-600">{quoteCurrency}</span></p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="input w-auto text-sm py-1.5"
            value={quote.status || 'draft'}
            onChange={e => handleStatusChange(e.target.value)}
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button className="btn-secondary text-sm" onClick={() => setShowExport(true)}>Export</button>
          <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      {/* Items */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Products ({items.length})</h2>
          <button className="btn-primary text-xs py-1.5 px-3" onClick={() => setShowProductPicker(true)}>+ Add Products</button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No products yet — click "Add Products" to select from your catalogue.</p>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <QuoteItem
                key={item.id}
                item={item}
                quoteCurrency={quoteCurrency}
                onTiersChange={tiers => handleTiersChange(item.id, tiers)}
                onRemove={() => handleRemoveItem(item.id)}
              />
            ))}

            <div className="flex justify-end pt-3 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700">
                Min. Total: <span className="text-lg font-bold text-gray-900">{quoteCurrency} {minTotal.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      {quote.notes && (
        <div className="card p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Notes</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{quote.notes}</p>
        </div>
      )}

      {/* Product Picker Modal */}
      {showProductPicker && (
        <ProductPicker
          existingIds={items.map(i => i.product_id)}
          onAdd={handleAddProducts}
          onClose={() => setShowProductPicker(false)}
        />
      )}

      {showExport && (
        <QuoteExport quote={quote} items={items} onClose={() => setShowExport(false)} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete quote for "${quote.client_name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function QuoteItem({ item, quoteCurrency, onTiersChange, onRemove }) {
  const currency = quoteCurrency || 'HKD'
  const tiers = (item.tiers || [{ quantity: item.quantity || 200, price: item.price_hkd || 0, currency }])
    .map(t => ({ ...t, price: t.price ?? t.price_hkd ?? 0, currency: t.currency || currency }))

  function updateTier(index, field, value) {
    const updated = tiers.map((t, i) => i === index ? { ...t, [field]: Number(value) } : t)
    onTiersChange(updated)
  }

  function addTier() {
    onTiersChange([...tiers, { quantity: 0, price: 0, currency }])
  }

  function removeTier(index) {
    if (tiers.length === 1) return
    onTiersChange(tiers.filter((_, i) => i !== index))
  }

  return (
    <div className="flex gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200">
      {/* Image */}
      <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
        {item.hero_image
          ? <img src={item.hero_image} alt={item.product_name} className="w-full h-full object-cover" />
          : <span className="text-2xl">📦</span>}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="font-medium text-sm text-gray-900">{item.product_name}</p>
            <p className="text-xs text-gray-500">{item.product_category}</p>
          </div>
          <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>

        {/* Tier table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="text-left font-normal pb-1 w-28">Quantity</th>
              <th className="text-left font-normal pb-1 w-32">Unit Price ({currency})</th>
              <th className="text-right font-normal pb-1">Subtotal ({currency})</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => (
              <tr key={i} className="group">
                <td className="pr-2 py-0.5">
                  <input
                    type="number" min="1"
                    className="input py-1 w-24 text-sm"
                    defaultValue={tier.quantity}
                    key={`qty-${i}-${tier.quantity}`}
                    onBlur={e => updateTier(i, 'quantity', e.target.value)}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <input
                    type="number" step="0.01" min="0"
                    className="input py-1 w-28 text-sm"
                    defaultValue={tier.price}
                    key={`price-${i}-${tier.price}`}
                    onBlur={e => updateTier(i, 'price', e.target.value)}
                  />
                </td>
                <td className="text-right py-0.5 font-semibold text-gray-800 whitespace-nowrap">
                  {((tier.price || 0) * (tier.quantity || 0)).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="pl-2 py-0.5 text-center">
                  {tiers.length > 1 && (
                    <button type="button" onClick={() => removeTier(i)} className="text-xs text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={addTier} className="mt-1 text-xs text-brand-500 hover:text-brand-700">+ Add tier</button>
      </div>
    </div>
  )
}

function ProductPicker({ existingIds, onAdd, onClose }) {
  const [products, setProducts] = useState([])
  const [selected, setSelected] = useState([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name'))).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = products.filter(p =>
    !existingIds.includes(p.id) &&
    (!search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()))
  )

  function toggle(p) {
    setSelected(s => s.find(x => x.id === p.id) ? s.filter(x => x.id !== p.id) : [...s, p])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-3">Add Products to Quote</h2>
          <input
            type="text" placeholder="Search products…"
            className="input" value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No products found.</p>
          ) : filtered.map(p => {
            const isSelected = selected.find(x => x.id === p.id)
            return (
              <div
                key={p.id}
                onClick={() => toggle(p)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-brand-50 border border-brand-200' : 'hover:bg-gray-50 border border-transparent'}`}
              >
                <div className="w-10 h-10 rounded bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                  {p.heroImage
                    ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" />
                    : <span className="text-lg">📦</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.category}</p>
                </div>
                {isSelected && <span className="text-brand-600 text-lg">✓</span>}
              </div>
            )
          })}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-3 justify-between items-center">
          <p className="text-sm text-gray-500">{selected.length} selected</p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={selected.length === 0} onClick={() => onAdd(selected)}>
              Add {selected.length > 0 ? selected.length : ''} Product{selected.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
