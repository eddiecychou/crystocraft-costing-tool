import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getOrder, getOrderLines, computeOrderTotals, orderUc } from '../shipping'
import { loadCustomers } from '../domain/customer'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { listBankAccounts, accountForCurrency, formatBankDetails } from '../bankAccounts'
import { downloadCsv } from '../exportCsv'
import { amountInWords } from '../constants'
import { pdfFileTitle } from '../pdfFilename'
import logoUrl from '../assets/logo.png'

// Proforma Invoice — the document CuiLing currently generates in JES and prints
// to PDF for the customer. Reproducing it here is what lets an order be
// originated in the app instead of re-keyed from JES, and it retires the
// AI-parse loop: the app has been parsing a PDF of a document it could produce
// itself (netlify/edge-functions/extract-pi.js).
//
// Same approach as PurchaseOrderPrint: print-CSS + window.print(), not
// @react-pdf. Keeps bilingual text and page breaks the browser's problem, and
// matches the document the team already recognises.

// Seller entity. The HK company that invoices the customer — deliberately NOT
// the Shenzhen factory used on purchase orders (that is the buying entity).
// Matches the quotation footer so a customer sees one consistent identity.
const SELLER = {
  name: 'United Art Metals Factory Limited',
  address: '11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong',
  contact: 'WhatsApp: +852 4608 3219   |   Email: sales@uart.com.hk',
}

const money = (v, cur) =>
  `${cur} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ProformaInvoicePrint() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [lines, setLines] = useState([])
  const [customer, setCustomer] = useState(null)
  const [bank, setBank] = useState(null)
  // The company chop, uploaded once in Settings → Quote branding and already
  // used on quotations. Reused rather than given its own setting: it is the
  // same company signing the same customer's document, and two places to
  // upload it is two places for it to be out of date.
  const [stampUrl, setStampUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const o = await getOrder(id)
        if (!o) throw new Error('Order not found.')
        const [ls, customers] = await Promise.all([getOrderLines(id), loadCustomers()])
        if (!alive) return
        setOrder(o)
        setLines(ls)
        setCustomer(customers.find((c) => c.id === o.customer_id) || null)
        // Bank details are admin-gated; a non-admin can still print the PI, it
        // just omits the remittance block rather than failing the whole page.
        try {
          const accounts = await listBankAccounts()
          if (alive) setBank(accountForCurrency(accounts || [], o.currency))
        } catch { /* no bank block */ }
        // Same treatment as the bank block: a missing or unreadable chop prints
        // an unstamped invoice rather than failing the page.
        try {
          const snap = await getDoc(doc(db, 'settings', 'quote_branding'))
          if (alive && snap.exists()) setStampUrl(snap.data().stamp_url || '')
        } catch { /* unstamped */ }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this order.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  // Drive the browser's "Save as PDF" default filename (see pdfFilename.js) —
  // restore the previous title on unmount so navigating elsewhere in the app
  // doesn't leave the tab stuck on this order's name.
  useEffect(() => {
    if (!order) return
    const prev = document.title
    document.title = pdfFileTitle([
      order.erp_so_no || 'PI',
      orderUc(order) || null,
      order.customer_name || customer?.company_name,
    ])
    return () => { document.title = prev }
  }, [order, customer])

  if (loading) return <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p>
  if (error) return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>{error}</p>

  const cur = order.currency || 'USD'
  const { subtotal, chargesTotal, discountAmount, total } = computeOrderTotals(order, lines)
  // Charge lines (freight, insurance, one-off fees) carry a price but no qty.
  // They are listed after the product lines and aggregated in the totals — an
  // invoice that is ONLY a freight charge is a real case and must not render an
  // empty line table.
  const productLines = lines.filter((l) => (parseFloat(l.qty_ordered) || 0) > 0)
  const chargeLines = lines.filter((l) => !((parseFloat(l.qty_ordered) || 0) > 0) && (parseFloat(l.unit_price) || 0) !== 0)
  // Sum across all product lines regardless of each line's own unit (almost
  // always PCS in practice) — a count of "how many pieces total", not a
  // unit-aware conversion.
  const totalQty = productLines.reduce((sum, l) => sum + (parseFloat(l.qty_ordered) || 0), 0)
  const qtyUnits = new Set(productLines.map((l) => (l.unit || '').trim()).filter(Boolean))
  const qtyUnitLabel = qtyUnits.size === 1 ? [...qtyUnits][0] : ''
  const dest = order.destination || {}
  const destText = [dest.city, dest.country].filter(Boolean).join(', ')
  const bankBlock = formatBankDetails(bank)
  // A PI raised in one currency against a bank account in another is a real
  // payment failure, so say so on screen rather than letting it print silently.
  const currencyMismatch = bank && bank.currency && bank.currency !== cur

  // The PI's line table as a CSV. `withPrices` is the whole point of the
  // feature: the factory needs codes, descriptions and quantities, and should
  // not be handed the customer's pricing.
  //
  // Charge lines (freight, insurance) are included in both. They are part of
  // the order, and dropping them silently from the unpriced file would make it
  // disagree with the printed document for no stated reason — they simply come
  // out with a blank quantity, as they print.
  function exportCsv(withPrices) {
    const rows = [
      ...productLines.map((l, i) => ({ n: i + 1, l, charge: false })),
      ...chargeLines.map((l, i) => ({ n: productLines.length + i + 1, l, charge: true })),
    ]
    const qtyOf = r => (r.charge ? '' : (parseFloat(r.l.qty_ordered) || 0))
    const upOf = r => (parseFloat(r.l.unit_price) || 0)
    const columns = [
      { label: '#', value: r => r.n },
      { label: 'Item Code', value: r => r.l.item_code || '', text: true },
      { label: 'Description', value: r => r.l.description || '' },
      { label: 'Qty', value: qtyOf },
      { label: 'Unit', value: r => (r.charge ? '' : (r.l.unit || '')) },
      ...(withPrices ? [
        { label: `Unit Price (${cur})`, value: upOf },
        { label: `Amount (${cur})`, value: r => (r.charge ? upOf(r) : (parseFloat(r.l.qty_ordered) || 0) * upOf(r)) },
      ] : []),
    ]
    const ref = String(orderUc(order) || order.erp_so_no || id).replace(/[^\w.-]+/g, '-')
    downloadCsv(`PI_${ref}${withPrices ? '' : '_no-prices'}`, columns, rows)
  }

  return (
    <div className="pi-doc">
      <style>{`
        @page { size: A4 portrait; margin: 1.8cm; }
        @media print { body { margin: 0; } .print-btn, .pi-warn, .pi-tools { display: none !important; } }
        .pi-tools { display: flex; justify-content: center; gap: 10px; margin: 0 auto 18px; flex-wrap: wrap; }
        .pi-tools button { padding: 7px 16px; background: #fff; color: #444; border: 1px solid #d8d8d8;
          border-radius: 6px; cursor: pointer; font-size: 12px; }
        .pi-tools button:hover { border-color: #b8935a; color: #1a1a1a; }
        /* Plain white, unconditionally — not gated behind @media print and not
           wrapped in a card (max-width/padding/box-shadow). A card needs
           @media print to strip it back to a flat page, and several mobile
           "Save as PDF" paths (iOS Share Sheet in particular) render the
           on-screen layout as-is without ever applying print media — so the
           shadow and margins baked straight into the PDF instead of being
           stripped. A plain white block has nothing that needs stripping.
           Reported by the owner 2026-07-30, then again 2026-07-30 after the
           first (card-based) fix regressed this exact document on mobile. */
        .pi-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45;
          background: #fff; }
        .pi-doc * { box-sizing: border-box; }
        .print-btn { display: block; margin: 0 auto 18px; padding: 9px 26px; background: #1a1a1a; color: #fff;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
        .pi-warn { max-width: 640px; margin: 0 auto 16px; padding: 8px 12px; background: #fff7ed; border: 1px solid #fed7aa;
          border-radius: 6px; color: #9a3412; font-size: 11px; text-align: center; }
        .pi-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 16px; }
        .pi-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .pi-logo { height: 30px; width: auto; margin-bottom: 10px; display: block; }
        .pi-company { text-align: right; font-size: 9.5px; color: #555; line-height: 1.5; }
        .pi-company .nm { font-size: 11px; color: #1a1a1a; font-weight: 600; }
        .pi-title { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin: 4px 0 2px; }
        .pi-meta-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; margin: 14px 0 20px; }
        .pi-box { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; }
        .pi-box h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .pi-cust .name { font-size: 13px; font-weight: 600; }
        .pi-cust .addr { color: #666; margin-top: 3px; white-space: pre-wrap; }
        .pi-kv { display: flex; justify-content: space-between; padding: 2px 0; gap: 12px; }
        .pi-kv .k { color: #888; }
        .pi-kv .v { font-weight: 500; text-align: right; }
        table.pi-lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        table.pi-lines th { background: #1a1a1a; color: #fff; font-weight: 500; font-size: 9px; text-transform: uppercase;
          letter-spacing: .05em; padding: 7px 8px; text-align: left; }
        table.pi-lines th.r, table.pi-lines td.r { text-align: right; }
        table.pi-lines td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        /* A line must never be sliced by a page boundary. Without this, row 50
           of a 52-line invoice printed as "1," with the rest of the amount on
           the far side of the break, and row 49's total came out cut through
           the middle — a figure on an invoice rendered unreadable, which is
           worse than an ugly page. Reported by CuiLing 2026-07-24.
           Both spellings: page-break-inside is what most print engines still
           honour, break-inside is the modern one. */
        table.pi-lines tr, table.pi-lines td { page-break-inside: avoid; break-inside: avoid; }
        /* Repeat the column headers on every page. A 3-page invoice whose
           later pages are unlabelled columns of numbers is hard to check. */
        table.pi-lines thead { display: table-header-group; }
        table.pi-lines tfoot { display: table-footer-group; }
        /* Keep the closing blocks whole; splitting a total or a bank block
           across pages is the same class of problem as splitting a line. */
        .pi-totals, .pi-words, .pi-bank, .pi-sign, .pi-foot { page-break-inside: avoid; break-inside: avoid; }
        /* One-off MISC lines carry multi-line descriptions; without this they
           collapse into one run-on line. */
        table.pi-lines td.desc { white-space: pre-wrap; }
        table.pi-lines tr:nth-child(even) td { background: #fafafa; }
        .pi-code { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5px; }
        .pi-totals { display: flex; justify-content: flex-end; margin-top: 10px; }
        .pi-totals table { width: 260px; }
        .pi-totals td { padding: 3px 8px; }
        .pi-totals td.k { color: #777; }
        .pi-totals td.v { text-align: right; font-variant-numeric: tabular-nums; }
        .pi-totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 13px; font-weight: 700; padding-top: 6px; }
        .pi-words { margin: 12px 0 18px; padding: 8px 12px; background: #faf6ef; border-left: 3px solid #b8935a;
          border-radius: 4px; font-style: italic; color: #6b5a3e; font-size: 10px; }
        .pi-bank { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; }
        .pi-bank h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .pi-bank pre { margin: 0; font-family: inherit; font-size: 10px; color: #333; white-space: pre-wrap; line-height: 1.6; }
        .pi-notes { font-size: 10px; color: #555; margin-bottom: 22px; white-space: pre-wrap; }
        .pi-notes .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; display: block; margin-bottom: 3px; }
        .pi-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
        .pi-sign .space { height: 70px; position: relative; }
        /* The company chop sits ON the signature line, as it does on a quote
           (QuotePDF signBox/stampImg) — same asset, same placement, so the two
           documents a customer receives look like they came from one company.
           print-color-adjust keeps it from being dropped by "background
           graphics off", which is the default in some print dialogs. */
        .pi-sign .stamp { position: absolute; bottom: 0; left: 4px; max-width: 240px; max-height: 92px;
          object-fit: contain; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .pi-sign .line { border-top: 1px solid #999; padding-top: 5px; font-size: 9px; color: #777; }
        .pi-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 9px; color: #888; line-height: 1.6; }
        .pi-foot .nm { font-weight: 600; color: #555; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>

      {/* CSV of the line table (XiangXia, 2026-07-23). Two buttons rather than a
          checkbox so the choice is one click and, more importantly, so the
          FILENAME records which one it is — a priced PI and an unpriced one look
          identical sitting in a Downloads folder, and only one of them should
          reach the factory floor. Lines only: totals as trailing rows would
          break the table for Excel, and a sum is one formula away. */}
      <div className="pi-tools">
        <button type="button" onClick={() => exportCsv(true)}>Export CSV</button>
        <button type="button" onClick={() => exportCsv(false)}>Export CSV — no prices</button>
      </div>

      {currencyMismatch && (
        <div className="pi-warn">
          This PI is in <strong>{cur}</strong> but the bank account shown is in <strong>{bank.currency}</strong>.
          Set a default {cur} account in Settings → Bank Accounts before sending.
        </div>
      )}

      <div className="pi-accent" />

      <div className="pi-head">
        <div>
          <img className="pi-logo" src={logoUrl} alt="" />
          <div className="pi-title">PROFORMA INVOICE</div>
        </div>
        <div className="pi-company">
          <div className="nm">{SELLER.name}</div>
          <div>{SELLER.address}</div>
          <div>{SELLER.contact}</div>
        </div>
      </div>

      <div className="pi-meta-grid">
        <div className="pi-box pi-cust">
          <h4>Bill To</h4>
          <div className="name">{order.customer_name || customer?.company_name || '—'}</div>
          {customer?.contact_name && <div className="addr">Attn: {customer.contact_name}</div>}
          {customer?.address && <div className="addr">{customer.address}</div>}
          {customer?.contact_emails?.[0] && <div className="addr">{customer.contact_emails[0]}</div>}
        </div>
        <div className="pi-box">
          {/* One reference, not two. "PI No." and "UC#" printed the same
              number on the same document until 2026-07-21. */}
          <div className="pi-kv"><span className="k">UC#</span><span className="v pi-code">{orderUc(order) || '—'}</span></div>
          <div className="pi-kv"><span className="k">{/^SO/i.test(order.erp_so_no || '') ? 'SO No.' : 'Doc No.'}</span><span className="v pi-code">{order.erp_so_no || '—'}</span></div>
          <div className="pi-kv"><span className="k">Date</span><span className="v">{fmtDate(order.order_date)}</span></div>
          <div className="pi-kv"><span className="k">Currency</span><span className="v">{cur}</span></div>
          {order.incoterm && <div className="pi-kv"><span className="k">Incoterm</span><span className="v">{order.incoterm}</span></div>}
          {order.payment_terms && <div className="pi-kv"><span className="k">Payment Terms</span><span className="v">{order.payment_terms}</span></div>}
          {order.est_ship_date && <div className="pi-kv"><span className="k">Est. Ship Date</span><span className="v">{fmtDate(order.est_ship_date)}</span></div>}
          {destText && <div className="pi-kv"><span className="k">Destination</span><span className="v">{destText}</span></div>}
          {dest.port && <div className="pi-kv"><span className="k">Port</span><span className="v">{dest.port}</span></div>}
        </div>
      </div>

      <table className="pi-lines">
        <thead>
          <tr>
            <th style={{ width: '3%' }}>#</th>
            <th style={{ width: '20%' }}>Item Code</th>
            <th style={{ width: '41%' }}>Description</th>
            <th className="r" style={{ width: '10%' }}>Qty</th>
            <th className="r" style={{ width: '13%' }}>Unit Price</th>
            <th className="r" style={{ width: '13%' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {productLines.map((l, i) => {
            const qty = parseFloat(l.qty_ordered) || 0
            const up = parseFloat(l.unit_price) || 0
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="pi-code">{l.item_code || '—'}</td>
                <td className="desc">{l.description || '—'}</td>
                <td className="r">{qty.toLocaleString()}{l.unit ? ` ${l.unit}` : ''}</td>
                <td className="r">{up.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="r">{(qty * up).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            )
          })}
          {chargeLines.map((l, i) => (
            <tr key={`c${i}`}>
              <td>{productLines.length + i + 1}</td>
              <td className="pi-code">{l.item_code || '—'}</td>
              <td className="desc">{l.description || 'Charge'}</td>
              <td className="r" />
              <td className="r" />
              <td className="r">{(parseFloat(l.unit_price) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {productLines.length === 0 && chargeLines.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: '18px 0' }}>No line items on this order.</td></tr>
          )}
        </tbody>
      </table>

      <div className="pi-totals">
        <table>
          <tbody>
            {totalQty > 0 && (
              <tr><td className="k">Total Qty</td><td className="v">{totalQty.toLocaleString()}{qtyUnitLabel ? ` ${qtyUnitLabel}` : ''}</td></tr>
            )}
            <tr><td className="k">Subtotal</td><td className="v">{money(subtotal, cur)}</td></tr>
            {discountAmount > 0 && (
              <tr><td className="k">Discount{order.discount_pct ? ` (${order.discount_pct}%)` : ''}</td>
                  <td className="v">− {money(discountAmount, cur)}</td></tr>
            )}
            {chargesTotal > 0 && (
              <tr><td className="k">Charges</td><td className="v">{money(chargesTotal, cur)}</td></tr>
            )}
            <tr className="grand"><td className="k">Total</td><td className="v">{money(total, cur)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="pi-words">{amountInWords(total, cur)}</div>

      {bankBlock && (
        <div className="pi-bank">
          <h4>Remittance</h4>
          <pre>{bankBlock}</pre>
        </div>
      )}

      {order.notes && (
        <div className="pi-notes">
          <span className="lbl">Remarks</span>
          {order.notes}
        </div>
      )}

      <div className="pi-sign">
        <div>
          <div className="space">
            {stampUrl && <img className="stamp" src={stampUrl} alt="" />}
          </div>
          <div className="line">ISSUED BY · {SELLER.name}</div>
        </div>
        <div>
          <div className="space" />
          <div className="line">CONFIRMED BY · {order.customer_name || '—'}</div>
        </div>
      </div>

      <div className="pi-foot">
        <div className="nm">{SELLER.name}</div>
        <div>{SELLER.address}</div>
        <div>{SELLER.contact}</div>
      </div>
    </div>
  )
}
