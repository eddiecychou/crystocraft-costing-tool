import { useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { Gem, Package, Trash2, ClipboardList, CheckCircle2, Plus, Minus } from 'lucide-react'
import { useCart, designGroupKey, formatGroupKey, formatCodeOf, designNumberOf } from './store'
import { useFormatMoq } from '../formatMoq'
import { RANGE_FORMAT_CODES } from '../constants'
import { useRates, fromUSD, fmtMoney } from '../currency'

const FORMAT_LABEL = Object.fromEntries(RANGE_FORMAT_CODES.map(f => [f.code, f.label]))

export default function EnquiryPage({ profile }) {
  const cart = useCart()
  const { moq: formatMoqMap, labels: formatLabels } = useFormatMoq()
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'
  const disc = Math.max(0, Math.min(100, Number(profile?.ws_discount_pct) || 0)) / 100
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const items = cart?.items || []

  // Unit price (customer currency, discount applied) for figurine lines.
  const unitPrice = i => (i.type === 'figurine' && i.ws_price_usd != null)
    ? fromUSD(Number(i.ws_price_usd) * (1 - disc), cur, rates) : null
  const lineTotal = i => { const u = unitPrice(i); return u == null ? null : u * (Number(i.qty) || 1) }
  const total = items.reduce((s, i) => s + (lineTotal(i) || 0), 0)
  const hasIndicative = items.some(i => unitPrice(i) == null)

  // MOQ is a per-design (metal-part) minimum. All plating/colour variations AND
  // formats (freestand, music box, bible…) that share the same design number
  // count toward it together, so aggregate pieces by design group.
  const designPcs = items.reduce((m, i) => {
    const k = designGroupKey(i)
    m[k] = (m[k] || 0) + Math.max(1, Number(i.qty) || 1)
    return m
  }, {})

  // Second MOQ floor: the format base component (music box, bible…) pools across
  // every design sharing that format. Minimums come from admin Settings.
  const formatPcs = items.reduce((m, i) => {
    const k = formatGroupKey(i)
    m[k] = (m[k] || 0) + Math.max(1, Number(i.qty) || 1)
    return m
  }, {})

  async function submit() {
    if (!items.length) return
    setSending(true); setError('')
    try {
      await addDoc(collection(db, 'enquiries'), {
        uid: auth.currentUser?.uid || profile?.id || null,
        company_name: profile?.company_name || '',
        contact_name: profile?.contact_name || '',
        email: profile?.email || auth.currentUser?.email || '',
        base_currency: cur,
        items: items.map(i => ({
          type: i.type, id: i.id, name: i.name || '', code: i.code || '', design_no: i.design_no || '', format_code: i.format_code || '',
          image: i.image || '', qty: Number(i.qty) || 1, note: i.note || '',
          finish: i.finish || '', color: i.color || '', color_name: i.color_name || '',
          ws_price_usd: i.ws_price_usd ?? null,
          pcs_per_carton: Number(i.pcs_per_carton) || 0,
          cartons: Number(i.cartons) || 0,
          moq: Number(i.moq) || 0,
          unit_price: unitPrice(i), line_total: lineTotal(i),
        })),
        currency: cur,
        estimated_total: total,
        message,
        status: 'new',
        createdAt: serverTimestamp(),
      })
      cart.clear()
      setSent(true)
    } catch {
      setError('Could not send your enquiry. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center py-20">
        <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
        <h1 className="text-xl text-ink mb-1">Enquiry sent</h1>
        <p className="text-sm text-ink-60 mb-6">Thank you — our team will get back to you by email shortly.</p>
        <Link to="/shop/figurine" className="btn-primary">Continue browsing</Link>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="text-center py-20 text-ink-60">
        <ClipboardList size={32} className="mx-auto text-ink-30 mb-3" />
        <p>Your enquiry list is empty.</p>
        <p className="text-sm text-ink-50 mt-1">Add products from the catalogue to request a quotation.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl md:text-2xl mb-1">Enquiry <span className="text-ink-50 text-base">({items.length})</span></h1>
      <p className="text-sm text-ink-60 mb-5">Review your selection, add quantities and notes, then send us a request for quotation.</p>

      <div className="card divide-y divide-ivory-dark mb-5">
        {items.map(i => {
          const Icon = i.type === 'figurine' ? Gem : Package
          const ppc = Number(i.pcs_per_carton) || 0
          const moq = Number(i.moq) || 0
          const qtyPcs = Math.max(1, Number(i.qty) || 1)
          const cartons = ppc > 0 ? Math.max(1, Math.round(qtyPcs / ppc)) : 0
          const designTotal = designPcs[designGroupKey(i)] || qtyPcs
          const belowMoq = moq > 0 && designTotal < moq
          const fmtCode = formatCodeOf(i)
          const fmtMoq = Number(formatMoqMap[fmtCode]) || 0
          const formatTotal = formatPcs[formatGroupKey(i)] || qtyPcs
          const belowFormatMoq = fmtMoq > 0 && formatTotal < fmtMoq
          const fmtLabel = formatLabels[fmtCode] || FORMAT_LABEL[fmtCode] || `Format ${fmtCode}`
          const setCartons = n => { const c = Math.max(1, Math.floor(n) || 1); cart.update(i.key, { cartons: c, qty: c * ppc }) }
          const setPcs = n => cart.update(i.key, { qty: Math.max(1, Math.floor(n) || 1) })
          return (
            <div key={i.key} className="flex items-center gap-3 p-3">
              <div className="w-14 h-14 bg-white border border-ivory-dark rounded flex items-center justify-center overflow-hidden shrink-0">
                {i.image ? <img src={i.image} alt={i.name} className="w-full h-full object-contain" />
                  : <Icon size={20} className="text-gray-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{i.name}</p>
                {i.code && <p className="text-[11px] text-ink-50 font-mono">{i.code}</p>}
                {(i.finish || i.color_name || i.color) && (
                  <p className="text-[11px] text-ink-60 mt-0.5">
                    {i.finish && <span>{i.finish}</span>}
                    {i.finish && (i.color_name || i.color) && <span> · </span>}
                    {(i.color_name || i.color) && <span>{i.color_name || i.color}</span>}
                  </p>
                )}
                <input type="text" placeholder="Note (extra customisation, deadlines…)"
                  value={i.note || ''} onChange={e => cart.update(i.key, { note: e.target.value })}
                  className="input py-1 text-xs mt-1 w-full" />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[11px] text-ink-50">
                  {unitPrice(i) != null ? `${fmtMoney(unitPrice(i), cur)} ea` : 'On enquiry'}
                </span>
                {ppc > 0 ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="inline-flex items-center border border-ivory-dark rounded-md overflow-hidden">
                      <button type="button" onClick={() => setCartons(cartons - 1)}
                        className="px-2 py-1.5 hover:bg-ivory text-ink-70" aria-label="Fewer cartons"><Minus size={12} /></button>
                      <input type="number" min="1" value={cartons}
                        onChange={e => setCartons(Number(e.target.value))}
                        className="w-12 text-center text-sm py-1 outline-none border-x border-ivory-dark" />
                      <button type="button" onClick={() => setCartons(cartons + 1)}
                        className="px-2 py-1.5 hover:bg-ivory text-ink-70" aria-label="More cartons"><Plus size={12} /></button>
                    </div>
                    <span className="text-[10px] text-ink-50">{cartons} ctn · {qtyPcs.toLocaleString()} pcs</span>
                  </div>
                ) : (
                  <label className="text-[11px] text-ink-50">Qty (pcs)
                    <input type="number" min="1" value={qtyPcs}
                      onChange={e => setPcs(Number(e.target.value))}
                      className="input py-1 w-20 ml-1 inline-block" />
                  </label>
                )}
                <span className="text-sm text-ink font-medium">
                  {lineTotal(i) != null ? fmtMoney(lineTotal(i), cur) : '—'}
                </span>
                {belowMoq && <Link to={`/shop/figurine?design=${designNumberOf(i)}`} title="Find more items of this design to reach the minimum" className="text-[10px] text-amber-700 hover:text-amber-900 underline decoration-dotted text-right">Design total {designTotal.toLocaleString()} / min {moq.toLocaleString()} pcs — add more</Link>}
                {belowFormatMoq && <Link to={`/shop/figurine?format=${fmtCode}`} title={`Find more ${fmtLabel} designs to reach the minimum`} className="text-[10px] text-amber-700 hover:text-amber-900 underline decoration-dotted text-right">{fmtLabel} total {formatTotal.toLocaleString()} / min {fmtMoq.toLocaleString()} pcs — add more</Link>}
                <button onClick={() => cart.remove(i.key)} className="text-ink-40 hover:text-red-500" aria-label="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card p-4 mb-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-70">Estimated total <span className="text-ink-40">({cur})</span></span>
          <span className="text-lg font-medium text-ink">{fmtMoney(total, cur)}</span>
        </div>
        <p className="text-[11px] text-ink-40 mt-2">
          {profile?.ws_discount_pct > 0
            ? `Wholesale prices with your ${Number(profile.ws_discount_pct)}% discount applied. `
            : 'Indicative wholesale prices. '}
          {hasIndicative && 'Made-to-order corporate items are quoted separately and not included in this total. '}
          Final pricing, MOQ and availability are confirmed on quotation.
        </p>
      </div>

      <label className="label">Message (optional)</label>
      <textarea className="input min-h-[90px]" placeholder="Tell us about quantities, deadlines, branding or any questions…"
        value={message} onChange={e => setMessage(e.target.value)} />

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      <div className="flex items-center gap-3 mt-4">
        <button onClick={submit} disabled={sending} className="btn-primary">
          {sending ? 'Sending…' : 'Send enquiry'}
        </button>
        <button onClick={() => cart.clear()} className="text-sm text-ink-50 hover:text-ink">Clear list</button>
      </div>
      <p className="text-[11px] text-ink-40 mt-3">
        This sends a request for quotation to Crystocraft using your account details
        ({profile?.company_name || profile?.email}). No payment is taken.
      </p>
    </div>
  )
}
