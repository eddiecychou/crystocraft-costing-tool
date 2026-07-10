import { useState, useEffect, useRef, Fragment } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  doc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, orderBy, query, addDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import QuoteExport from '../components/QuoteExport'
import { Package, X, Check, Paperclip, FileText, Copy } from 'lucide-react'

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
  const [duplicating, setDuplicating] = useState(false)
  const [liveImages, setLiveImages] = useState({}) // { product_id: heroImage }

  useEffect(() => {
    getDoc(doc(db, 'client_quotes', id)).then(snap => {
      if (snap.exists()) setQuote({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'client_quotes', id, 'items'), orderBy('createdAt'))
    return onSnapshot(q, async snap => {
      const loaded = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      setItems(loaded)
      // Fetch live heroImage for each product so image updates are reflected
      const productIds = [...new Set(loaded.map(i => i.product_id).filter(Boolean))]
      const entries = await Promise.all(
        productIds.map(async pid => {
          const pSnap = await getDoc(doc(db, 'products', pid))
          return [pid, pSnap.data()?.heroImage || null]
        })
      )
      setLiveImages(Object.fromEntries(entries))
    })
  }, [id])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered)
    // Persist new sort_order to Firestore
    await Promise.all(
      reordered.map((item, idx) =>
        updateDoc(doc(db, 'client_quotes', id, 'items', item.id), { sort_order: idx })
      )
    )
  }

  async function handleStatusChange(status) {
    await updateDoc(doc(db, 'client_quotes', id), { status })
    setQuote(q => ({ ...q, status }))
  }

  async function handleDelete() {
    await deleteDoc(doc(db, 'client_quotes', id))
    navigate('/quotes')
  }

  async function handleDuplicate() {
    setDuplicating(true)
    try {
      // Copy quote header (reset status to draft)
      const { id: _id, ...quoteData } = quote
      const newQuote = await addDoc(collection(db, 'client_quotes'), {
        ...quoteData,
        status: 'draft',
        item_count: items.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Copy all items
      await Promise.all(items.map(item => {
        const { id: _itemId, ...itemData } = item
        return addDoc(collection(db, 'client_quotes', newQuote.id, 'items'), {
          ...itemData,
          createdAt: serverTimestamp(),
        })
      }))
      navigate(`/quotes/${newQuote.id}`)
    } finally {
      setDuplicating(false)
    }
  }

  async function handleRemoveItem(itemId) {
    await deleteDoc(doc(db, 'client_quotes', id, 'items', itemId))
    await updateDoc(doc(db, 'client_quotes', id), { item_count: Math.max(0, (items.length - 1)) })
  }

  async function handleTiersChange(itemId, tiers) {
    await updateDoc(doc(db, 'client_quotes', id, 'items', itemId), { tiers })
  }

  async function handleUnitChange(itemId, unit) {
    await updateDoc(doc(db, 'client_quotes', id, 'items', itemId), { product_unit: unit })
  }


  async function handleImageChange(itemId, url) {
    await updateDoc(doc(db, 'client_quotes', id, 'items', itemId), { custom_image: url || null })
  }

  async function handleItemRemarksChange(itemId, item_remarks) {
    await updateDoc(doc(db, 'client_quotes', id, 'items', itemId), { item_remarks })
  }

  async function handleAddProducts(products) {
    const quoteCurrency = quote.quote_currency || 'HKD'
    const rates = { HKD: 1, RMB: quote.rmb_to_hkd, USD: quote.usd_to_hkd, EUR: quote.eur_to_hkd }

    function toQuoteCurrency(price_hkd) {
      return quoteCurrency === 'HKD' ? price_hkd : +(price_hkd / (rates[quoteCurrency] || 1)).toFixed(2)
    }

    await Promise.all(products.map(async p => {
      const [tierSnap, compSnap, ratesSnap] = await Promise.all([
        getDocs(query(collection(db, 'products', p.id, 'pricing_tiers'), orderBy('quantity'))),
        getDocs(collection(db, 'products', p.id, 'components')),
        getDoc(doc(db, 'settings', 'exchange_rates')),
      ])

      // Compute unit cost in HKD from preferred supplier quotes
      const fxRates = { HKD: 1, ...(ratesSnap.exists()
        ? Object.fromEntries(Object.entries(ratesSnap.data()).filter(([, v]) => typeof v === 'number'))
        : { RMB: 1.09, USD: 7.78, EUR: 8.60 }) }

      let unit_cost_hkd = 0
      let tooling_cost_hkd = 0
      await Promise.all(compSnap.docs.map(async cDoc => {
        const qSnap = await getDocs(collection(db, 'products', p.id, 'components', cDoc.id, 'supplier_quotes'))
        const preferred = qSnap.docs.map(d => d.data()).find(q => q.is_preferred)
        if (preferred?.unit_cost) {
          const qty = Number(cDoc.data().qty_per_product) || 1
          unit_cost_hkd += Number(preferred.unit_cost) * (fxRates[preferred.unit_cost_currency] || 1) * qty
        }
        if (preferred?.tooling_sample_cost) {
          tooling_cost_hkd += Number(preferred.tooling_sample_cost) * (fxRates[preferred.tooling_sample_cost_currency] || 1)
        }
      }))

      const tiers = tierSnap.docs.length > 0
        ? tierSnap.docs.map(d => {
            const td = d.data()
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
        product_unit: p.unit || 'pcs',
        unit_cost_hkd: unit_cost_hkd || null,
        tooling_cost_hkd: tooling_cost_hkd || null,
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

  // ── Uploaded quote view ──────────────────────────────────────────────────
  if (quote.quote_type === 'uploaded') {
    return <UploadedQuoteDetail quote={quote} id={id} onDelete={() => { deleteDoc(doc(db, 'client_quotes', id)); navigate('/quotes') }} />
  }

  const quoteCurrency = quote.quote_currency || 'HKD'
  const quoteRates = { HKD: 1, RMB: quote.rmb_to_hkd || 1.09, USD: quote.usd_to_hkd || 7.78, EUR: quote.eur_to_hkd || 8.60 }

  // Min total: first (lowest qty) tier of each item, in quote currency

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <Link to="/quotes" className="text-sm text-brand-600 hover:underline">← Quotes</Link>

      {/* Header */}
      <div className="mt-2 mb-6">
        <input
          className="text-xl md:text-2xl font-bold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-brand-300 focus:outline-none w-full"
          defaultValue={quote.client_name || ''}
          key={`client_name-${quote.client_name}`}
          placeholder="Client name"
          onBlur={e => {
            if (e.target.value !== (quote.client_name || '')) {
              updateDoc(doc(db, 'client_quotes', id), { client_name: e.target.value })
              setQuote(q => ({ ...q, client_name: e.target.value }))
            }
          }}
        />

        {/* Editable client detail fields */}
        <p className="text-xs text-gray-400 mt-2 mb-1">Click any field to edit — changes save automatically</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-w-lg">
          {[
            { label: 'Contact',  field: 'contact_name' },
            { label: 'Email',    field: 'contact_email' },
            { label: 'Phone',    field: 'contact_phone' },
          ].map(({ label, field }) => (
            <div key={field} className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 w-14 shrink-0">{label}</span>
              <input
                className="text-xs text-gray-600 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-brand-300 focus:outline-none flex-1 py-0.5"
                defaultValue={quote[field] || ''}
                key={`${field}-${quote[field]}`}
                placeholder="—"
                onBlur={e => {
                  if (e.target.value !== (quote[field] || '')) {
                    updateDoc(doc(db, 'client_quotes', id), { [field]: e.target.value })
                    setQuote(q => ({ ...q, [field]: e.target.value }))
                  }
                }}
              />
            </div>
          ))}
        </div>
        {/* Address — full-width textarea so long addresses can wrap across lines */}
        <div className="flex items-start gap-1.5 max-w-lg mt-1">
          <span className="text-xs text-gray-400 w-14 shrink-0 pt-0.5">Address</span>
          <textarea
            className="text-xs text-gray-600 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-brand-300 focus:outline-none flex-1 py-0.5 resize-none leading-relaxed"
            rows={2}
            defaultValue={quote.contact_address || ''}
            key={`contact_address-${quote.contact_address}`}
            placeholder="—"
            onBlur={e => {
              if (e.target.value !== (quote.contact_address || '')) {
                updateDoc(doc(db, 'client_quotes', id), { contact_address: e.target.value })
                setQuote(q => ({ ...q, contact_address: e.target.value }))
              }
            }}
          />
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Currency: <span className="font-medium text-gray-600">{quoteCurrency}</span>
          {' · '}
          Date:{' '}
          <input
            type="date"
            className="text-xs font-medium text-gray-600 bg-transparent border-b border-gray-200 hover:border-brand-300 focus:border-brand-400 focus:outline-none"
            defaultValue={quote.quote_date || ''}
            onBlur={e => {
              if (e.target.value !== (quote.quote_date || '')) {
                updateDoc(doc(db, 'client_quotes', id), { quote_date: e.target.value })
                setQuote(q => ({ ...q, quote_date: e.target.value }))
              }
            }}
          />
        </p>

        {/* Quote reference numbers — appear on the exported quotation header */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 max-w-lg">
          {[
            { label: 'QU P/O No.', field: 'quote_no',   ph: 'e.g. QU260602-1' },
            { label: 'Ref No.',    field: 'ref_no',      ph: 'e.g. UC4932/26' },
          ].map(({ label, field, ph }) => (
            <div key={field} className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 shrink-0">{label}</span>
              <input
                className="text-xs font-medium text-gray-600 bg-transparent border-b border-gray-200 hover:border-brand-300 focus:border-brand-400 focus:outline-none w-32"
                defaultValue={quote[field] || ''}
                key={`${field}-${quote[field]}`}
                placeholder={ph}
                onBlur={e => {
                  if (e.target.value !== (quote[field] || '')) {
                    updateDoc(doc(db, 'client_quotes', id), { [field]: e.target.value })
                    setQuote(q => ({ ...q, [field]: e.target.value }))
                  }
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <select
            className="input w-auto text-sm py-1.5"
            value={quote.status || 'draft'}
            onChange={e => handleStatusChange(e.target.value)}
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button className="btn-secondary text-sm" onClick={() => setShowExport(true)}>Export</button>
          <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={handleDuplicate} disabled={duplicating}>
            {duplicating ? 'Copying…' : <><Copy size={14} />Duplicate</>}
          </button>
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {items.map(item => (
                  <QuoteItem
                    key={item.id}
                    item={{ ...item, _quoteId: id }}
                    quoteCurrency={quoteCurrency}
                    heroImage={liveImages[item.product_id] ?? item.hero_image}
                    rates={quoteRates}
                    onTiersChange={tiers => handleTiersChange(item.id, tiers)}
                    onUnitChange={unit => handleUnitChange(item.id, unit)}
                    onImageChange={url => handleImageChange(item.id, url)}
                    onItemRemarksChange={r => handleItemRemarksChange(item.id, r)}
                    onRemove={() => handleRemoveItem(item.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>

          </div>
        )}
      </div>

      {/* Quote-level remarks — payment terms, delivery, bank details, etc.
          Renders below the table on the exported quotation. */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Remarks <span className="font-normal text-gray-400">(shown on the quotation)</span></h2>
        <textarea
          rows={4}
          placeholder={'Payment terms : 50% deposit, balance before shipment.\nDelivery : Hong Kong (one time shipment)\n\nBeneficiary Bank: …'}
          defaultValue={quote.notes || ''}
          key={`quote-notes-${quote.id}`}
          onBlur={e => {
            if (e.target.value !== (quote.notes || '')) {
              updateDoc(doc(db, 'client_quotes', id), { notes: e.target.value })
              setQuote(q => ({ ...q, notes: e.target.value }))
            }
          }}
          className="w-full text-sm text-gray-700 placeholder-gray-300 border border-gray-100 rounded-lg px-3 py-2 resize-y focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-200 bg-gray-50 hover:bg-white transition-colors leading-relaxed"
        />
      </div>

      {/* Product Picker Modal */}
      {showProductPicker && (
        <ProductPicker
          existingIds={items.map(i => i.product_id)}
          onAdd={handleAddProducts}
          onClose={() => setShowProductPicker(false)}
        />
      )}

      {showExport && (
        <QuoteExport
          quote={quote}
          items={items.map(i => ({ ...i, hero_image: liveImages[i.product_id] ?? i.hero_image }))}
          onClose={() => setShowExport(false)}
        />
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

const UNIT_OPTIONS = ['pcs', 'set', 'pair', 'box', 'kg', 'g', 'm']

function marginColor(m) {
  if (m == null) return 'text-gray-400'
  if (m >= 40) return 'text-green-600'
  if (m >= 25) return 'text-yellow-600'
  return 'text-red-500'
}

function QuoteItem({ item, quoteCurrency, rates, heroImage, onTiersChange, onUnitChange, onImageChange, onItemRemarksChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const currency = quoteCurrency || 'HKD'
  const baseTiers = (item.tiers || [{ quantity: item.quantity || 200, price: item.price_hkd || 0, currency }])
    .map(t => ({ ...t, price: t.price ?? t.price_hkd ?? 0, currency: t.currency || currency }))

  const [showImgPicker, setShowImgPicker] = useState(false)

  // Local price state for live margin display
  const [localPrices, setLocalPrices] = useState(() => baseTiers.map(t => t.price))
  const tiers = baseTiers

  // Recurring unit cost in quote currency (excludes tooling)
  const rate = rates[currency] || 1
  const recurringCost = item.unit_cost_hkd ? item.unit_cost_hkd / (currency === 'HKD' ? 1 : rate) : null
  const toolingHKD = item.tooling_cost_hkd || 0
  const hasTooling = toolingHKD > 0
  const costInQuoteCurrency = recurringCost  // kept for compatibility

  // All-in cost per unit at a given tier qty (recurring + amortised tooling)
  function allInCost(tierQty) {
    if (recurringCost == null) return null
    const toolingPerUnit = hasTooling && tierQty > 0 ? (toolingHKD / tierQty) / (currency === 'HKD' ? 1 : rate) : 0
    return recurringCost + toolingPerUnit
  }

  function calcMargin(price, tierQty) {
    const cost = allInCost(tierQty)
    if (cost == null || !price) return null
    return ((price - cost) / price) * 100
  }

  function updateTier(index, field, value) {
    const parsed = field === 'remarks' ? value : Number(value)
    const updated = tiers.map((t, i) => i === index ? { ...t, [field]: parsed } : t)
    if (field === 'price') {
      setLocalPrices(prev => prev.map((p, i) => i === index ? Number(value) : p))
    }
    onTiersChange(updated)
  }

  function addTier() {
    setLocalPrices(prev => [...prev, 0])
    onTiersChange([...tiers, { quantity: 0, price: 0, currency }])
  }

  function removeTier(index) {
    if (tiers.length === 1) return
    setLocalPrices(prev => prev.filter((_, i) => i !== index))
    onTiersChange(tiers.filter((_, i) => i !== index))
  }

  const displayImage = item.custom_image || heroImage

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={`flex gap-3 p-3 rounded-lg border transition-colors ${isDragging ? 'border-brand-300 bg-brand-50 shadow-lg opacity-80' : 'border-gray-100 hover:border-gray-200'}`}>
      {/* Drag handle */}
      <div {...attributes} {...listeners} className="flex items-start pt-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 shrink-0 touch-none">
        <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
          <circle cx="4" cy="4" r="1.5"/><circle cx="8" cy="4" r="1.5"/>
          <circle cx="4" cy="10" r="1.5"/><circle cx="8" cy="10" r="1.5"/>
          <circle cx="4" cy="16" r="1.5"/><circle cx="8" cy="16" r="1.5"/>
        </svg>
      </div>
      {/* Image — click to open product image picker */}
      <div className="group relative w-20 h-20 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center cursor-pointer"
           onClick={() => setShowImgPicker(true)}>
        {displayImage
          ? <img src={displayImage} alt={item.product_name} className="w-full h-full object-cover" />
          : <Package size={24} strokeWidth={1.5} className="text-gray-300" />}
        <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="bg-white/90 text-xs px-1.5 py-0.5 rounded text-gray-700">change</span>
        </div>
        {item.custom_image && (
          <div className="absolute bottom-1 left-1 bg-brand-600/80 text-white text-[9px] px-1 rounded leading-tight pointer-events-none">custom</div>
        )}
      </div>

      {showImgPicker && (
        <ProductImagePicker
          productId={item.product_id}
          selectedUrl={item.custom_image}
          onSelect={url => { onImageChange(url); setShowImgPicker(false) }}
          onClear={() => { onImageChange(null); setShowImgPicker(false) }}
          onClose={() => setShowImgPicker(false)}
        />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="font-medium text-sm text-gray-900">{item.product_name}</p>
            <p className="text-xs text-gray-500">
              {item.product_category}
              {recurringCost != null && (
                <span className="ml-2 text-gray-400">
                  · Cost: {currency} {recurringCost.toFixed(2)}
                  {hasTooling && <span className="text-amber-500"> +tooling</span>}
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600 shrink-0"><X size={14} /></button>
        </div>

        {/* Tier table */}
        <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="text-left font-normal pb-1 w-36">Quantity</th>
              <th className="text-left font-normal pb-1 w-32">Unit Price ({currency})</th>
              {recurringCost != null && <th className="text-right font-normal pb-1 w-24">All-in cost</th>}
              {recurringCost != null && <th className="text-right font-normal pb-1 w-16">Margin</th>}
              <th className="text-right font-normal pb-1">Subtotal ({currency})</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => {
              const livePrice = localPrices[i] ?? tier.price
              const tierAllIn = allInCost(tier.quantity)
              const margin = calcMargin(livePrice, tier.quantity)
              const colSpan = 2 + (recurringCost != null ? 2 : 0) + 2
              return (
              <Fragment key={i}>
                <tr className="group">
                  <td className="pr-2 pt-1.5 pb-0">
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min="1"
                        className="input py-1 w-20 text-sm"
                        defaultValue={tier.quantity}
                        key={`qty-${i}-${tier.quantity}`}
                        onBlur={e => updateTier(i, 'quantity', e.target.value)}
                      />
                      {i === 0 ? (
                        <select
                          className="input py-1 text-xs w-16"
                          value={item.product_unit || 'pcs'}
                          onChange={e => onUnitChange(e.target.value)}
                        >
                          {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-400 w-16">{item.product_unit || 'pcs'}</span>
                      )}
                    </div>
                  </td>
                  <td className="pr-2 pt-1.5 pb-0">
                    <input
                      type="number" step="0.01" min="0"
                      className="input py-1 w-28 text-sm"
                      defaultValue={tier.price}
                      key={`price-${i}-${tier.price}`}
                      onChange={e => setLocalPrices(prev => prev.map((p, j) => j === i ? Number(e.target.value) : p))}
                      onBlur={e => updateTier(i, 'price', e.target.value)}
                    />
                  </td>
                  {recurringCost != null && (
                    <td className="text-right pt-1.5 pb-0 whitespace-nowrap text-xs text-gray-500">
                      {tierAllIn != null ? tierAllIn.toFixed(2) : '—'}
                    </td>
                  )}
                  {recurringCost != null && (
                    <td className="text-right pt-1.5 pb-0 whitespace-nowrap">
                      {margin != null ? (
                        <span className={`text-xs font-semibold ${marginColor(margin)}`}>{margin.toFixed(1)}%</span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                  )}
                  <td className="text-right pt-1.5 pb-0 font-semibold text-gray-800 whitespace-nowrap">
                    {((livePrice || 0) * (tier.quantity || 0)).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="pl-2 pt-1.5 pb-0 text-center">
                    {tiers.length > 1 && (
                      <button type="button" onClick={() => removeTier(i)} className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                    )}
                  </td>
                </tr>
                <tr>
                  <td colSpan={colSpan} className="pb-1.5 pt-0.5">
                    <input
                      type="text"
                      placeholder="Add remark…"
                      defaultValue={tier.remarks || ''}
                      key={`remarks-${i}-${tier.remarks}`}
                      onBlur={e => updateTier(i, 'remarks', e.target.value)}
                      className="w-full text-xs text-gray-500 placeholder-gray-300 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-brand-300 focus:outline-none py-0.5 transition-colors"
                    />
                  </td>
                </tr>
              </Fragment>
            )})}
          </tbody>
        </table>
        </div>
        <button type="button" onClick={addTier} className="mt-1 text-xs text-brand-500 hover:text-brand-700">+ Add tier</button>

        {/* Product-level remarks */}
        <div className="mt-3 pt-2 border-t border-gray-100">
          <textarea
            rows={1}
            placeholder="Product remarks (e.g. customisation details, special requirements…)"
            defaultValue={item.item_remarks || ''}
            key={`item-remarks-${item.id}`}
            onBlur={e => onItemRemarksChange(e.target.value)}
            onChange={e => {
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            className="w-full text-xs text-gray-600 placeholder-gray-300 border border-gray-100 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-200 bg-gray-50 hover:bg-white transition-colors"
          />
        </div>
      </div>
    </div>
  )
}

async function resizeToJpeg(file, maxPx = 2400, quality = 0.93) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

function ProductImagePicker({ productId, selectedUrl, onSelect, onClear, onClose }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    getDocs(query(collection(db, 'products', productId, 'images'), orderBy('sort_order')))
      .then(snap => { setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))) })
      .finally(() => setLoading(false))
  }, [productId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const resized = await resizeToJpeg(file)
      const path = `products/${productId}/images/${Date.now()}.jpg`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, resized, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(sRef)
      // Save to product images subcollection
      const newDoc = await addDoc(collection(db, 'products', productId, 'images'), {
        file_url: url,
        storage_path: path,
        file_name: file.name,
        type: 'reference',
        caption: '',
        sort_order: images.length,
        uploaded_at: serverTimestamp(),
      })
      const newImg = { id: newDoc.id, file_url: url, storage_path: path, file_name: file.name }
      setImages(prev => [...prev, newImg])
      onSelect(url)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Choose Image</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : images.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No images uploaded for this product yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {images.map(img => {
                const isSelected = img.file_url === selectedUrl
                return (
                  <div
                    key={img.id}
                    onClick={() => onSelect(img.file_url)}
                    className={`relative cursor-pointer rounded-lg overflow-hidden aspect-square border-2 transition-all ${isSelected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-transparent hover:border-brand-300'}`}
                  >
                    <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-brand-500/20 flex items-center justify-center">
                        <span className="bg-brand-500 text-white rounded-full w-5 h-5 flex items-center justify-center"><Check size={12} /></span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              {uploading ? 'Uploading…' : '+ Upload new'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            {selectedUrl && (
              <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-red-500 py-1.5 px-2">
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">New uploads saved to product</p>
        </div>
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
                <div className="w-12 h-12 rounded bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                  {p.heroImage
                    ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" />
                    : <Package size={18} strokeWidth={1.5} className="text-gray-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.category}</p>
                </div>
                {isSelected && <Check size={18} className="text-brand-600" />}
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

// ── Uploaded Quote Detail ────────────────────────────────────────────────────
const UPLOADED_STATUS_OPTIONS = ['draft', 'sent', 'confirmed', 'lost']
const UPLOADED_STATUS_STYLES = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  lost:      'bg-red-100 text-red-600',
}

function UploadedQuoteDetail({ quote, id, onDelete }) {
  const navigate = useNavigate()
  const [q, setQ]                     = useState(quote)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removingIdx, setRemovingIdx] = useState(null)
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef(null)

  function save(field, value) {
    updateDoc(doc(db, 'client_quotes', id), { [field]: value, updatedAt: serverTimestamp() })
    setQ(prev => ({ ...prev, [field]: value }))
  }

  async function handleAddFiles(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const path = `client_quotes/${id}/${Date.now()}_${file.name}`
        const ref = storageRef(storage, path)
        uploadBytes(ref, file).then(async () => resolve({ url: await getDownloadURL(ref), path, name: file.name })).catch(reject)
      })))
      const updated = [...(q.attachments || []), ...uploaded]
      await updateDoc(doc(db, 'client_quotes', id), { attachments: updated, updatedAt: serverTimestamp() })
      setQ(prev => ({ ...prev, attachments: updated }))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleRemoveFile(idx) {
    setRemovingIdx(idx)
    try {
      const att = q.attachments[idx]
      if (att.path) { try { await deleteObject(storageRef(storage, att.path)) } catch {} }
      const updated = q.attachments.filter((_, i) => i !== idx)
      await updateDoc(doc(db, 'client_quotes', id), { attachments: updated, updatedAt: serverTimestamp() })
      setQ(prev => ({ ...prev, attachments: updated }))
    } finally {
      setRemovingIdx(null)
    }
  }

  const atts = q.attachments || []

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/quotes" className="text-sm text-brand-600 hover:underline">← Quotes</Link>

      <div className="flex items-start gap-3 mt-3 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">{q.client_name}</h1>
            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium"><Paperclip size={11} />Uploaded</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Click any field to edit — changes save automatically</p>
        </div>
      </div>

      <div className="card p-5 mb-4 space-y-4">
        <EditableField label="Client Name" value={q.client_name} onSave={v => save('client_name', v)} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Date</p>
            <input type="date" className="input text-sm" defaultValue={q.quote_date}
              onBlur={e => { if (e.target.value !== q.quote_date) save('quote_date', e.target.value) }} />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Currency</p>
            <select className="input text-sm" value={q.quote_currency || 'HKD'} onChange={e => save('quote_currency', e.target.value)}>
              {['HKD', 'USD', 'EUR', 'RMB', 'GBP', 'AUD', 'SGD', 'JPY'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Amount <span className="text-gray-300">(optional)</span></p>
          <input type="number" min="0" step="0.01" className="input text-sm w-48" defaultValue={q.amount || ''}
            placeholder="e.g. 12000"
            onBlur={e => { const v = e.target.value ? Number(e.target.value) : null; if (v !== q.amount) save('amount', v) }} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Status</p>
          <div className="flex flex-wrap gap-2">
            {UPLOADED_STATUS_OPTIONS.map(s => (
              <button key={s} type="button" onClick={() => save('status', s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                  (q.status || 'draft') === s
                    ? UPLOADED_STATUS_STYLES[s] + ' border-transparent'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Notes</p>
          <textarea className="input text-sm" rows={2} defaultValue={q.notes || ''} placeholder="Brief description…"
            onBlur={e => { if (e.target.value !== (q.notes || '')) save('notes', e.target.value) }} />
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Quote Files ({atts.length})</h2>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="text-xs text-brand-600 hover:underline font-medium">
            {uploading ? 'Uploading…' : '+ Add files'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleAddFiles} />
        </div>
        {atts.length === 0 ? (
          <button onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 rounded-lg py-6 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors">
            <span className="inline-flex items-center gap-1.5"><Paperclip size={15} />Tap to add PDF or image files</span>
          </button>
        ) : (
          <div className="space-y-2">
            {atts.map((att, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                {att.name?.match(/\.(jpg|jpeg|png|webp|gif)$/i)
                  ? <a href={att.url} target="_blank" rel="noreferrer" className="shrink-0"><img src={att.url} alt="" className="h-12 w-16 object-cover rounded border border-gray-200" /></a>
                  : <FileText size={24} className="text-gray-400 shrink-0" />
                }
                <a href={att.url} target="_blank" rel="noreferrer" className="flex-1 text-sm text-brand-600 hover:underline truncate min-w-0">
                  {att.name || `File ${i + 1}`}
                </a>
                <button onClick={() => handleRemoveFile(i)} disabled={removingIdx === i}
                  className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">
                  {removingIdx === i ? '…' : <X size={14} />}
                </button>
              </div>
            ))}
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="mt-1 w-full border-2 border-dashed border-gray-200 rounded-lg py-2.5 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors">
              <span className="inline-flex items-center gap-1.5"><Paperclip size={15} />Add more files</span>
            </button>
          </div>
        )}
      </div>

      <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-500 hover:text-red-700">Delete this quote</button>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Quote"
          message={`Delete uploaded quote for "${q.client_name}"? This cannot be undone.`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function EditableField({ label, value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value)
  if (editing) return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <input autoFocus className="input text-sm" value={val} onChange={e => setVal(e.target.value)}
        onBlur={() => { onSave(val); setEditing(false) }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(val); setEditing(false) } }} />
    </div>
  )
  return (
    <div onClick={() => setEditing(true)} className="cursor-pointer group">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">{val || <span className="text-gray-300 font-normal">—</span>}</p>
    </div>
  )
}
