import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import ExcelJS from 'exceljs'
import { getOrder, getOrderLines, computeOrderTotals, orderUc } from '../shipping'
import { myInvoiceDetail } from '../customerOrderHistoryApi'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { amountInWords } from '../constants'
import { pdfFileTitle } from '../pdfFilename'
import { Download } from 'lucide-react'
import logoUrl from '../assets/logo.png'

// A customer's own invoice, printable/PDF-able — owner, 2026-08-07: "the
// clicked view needs to be more serious, with the same format as our sales
// invoices, and customer can view and download with PDF or Excel." Reuses
// the exact print CSS/layout SalesInvoicePrint.jsx (admin) already has —
// same document family, so a customer's copy looks identical to the one
// Cindy would print internally — but sourced safely for a customer's own
// browser session:
//  - App invoices (key "app-<orderId>"): getOrder/getOrderLines read
//    orders/{id} + its lines subcollection directly — already permitted for
//    this customer's own order by firestore.rules' customer-scoped branch.
//  - JES invoices (key "erp-<code>"): header + lines come from the
//    customer-scoped /api/customer-order-history 'lines' action, which
//    re-verifies server-side that the invoice belongs to the caller before
//    returning anything.
// Deliberately OMITTED vs the admin version: bank remittance details
// (bank_accounts has no customer-readable path — served only via the
// admin-gated /api/bank) and the "Bill To" full address (only on
// customers/{id}, admin-only; profile.company_name/contact_name substitute).
export default function CustomerInvoicePrint({ profile }) {
  const { key } = useParams()
  const isApp = key?.startsWith('app-')
  const orderId = isApp ? key.slice(4) : null
  const code = !isApp ? (key || '').replace(/^erp-/, '') : null

  const [header, setHeader] = useState(null)   // normalized: { no, uc, date, currency, customer_po, status }
  const [lines, setLines] = useState([])
  const [totals, setTotals] = useState(null)   // app only — computeOrderTotals shape
  const [stampUrl, setStampUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (isApp) {
          const o = await getOrder(orderId)
          if (!o) throw new Error('Invoice not found.')
          if (o.customer_id !== profile?.customer_id) throw new Error('Invoice not found.')
          const ls = await getOrderLines(orderId)
          if (!alive) return
          setHeader({
            no: o.erp_si_no || o.erp_so_no, uc: orderUc(o), date: o.invoiced_at || o.order_date,
            currency: o.currency || 'USD', customer_po: o.customer_po, status: null,
          })
          setLines(ls.filter(l => (parseFloat(l.qty_ordered) || 0) > 0 || (parseFloat(l.unit_price) || 0) !== 0)
            .map(l => ({ item_code: l.item_code, description: l.description, qty: l.qty_ordered, unit_price: l.unit_price, amount: (parseFloat(l.qty_ordered) || 0) * (parseFloat(l.unit_price) || 0) })))
          setTotals(computeOrderTotals(o, ls))
        } else {
          const { header: h, lines: ls } = await myInvoiceDetail(code)
          if (!h) throw new Error('Invoice not found.')
          if (!alive) return
          setHeader({ no: h.code, uc: h.ref, date: h.date, currency: h.currency || 'USD', customer_po: h.customer_po, status: h.status })
          setLines(ls)
        }
        try {
          const snap = await getDoc(doc(db, 'settings', 'quote_branding'))
          if (alive && snap.exists()) setStampUrl(snap.data().stamp_url || '')
        } catch { /* unstamped */ }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this invoice.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [isApp, orderId, code, profile?.customer_id])

  useEffect(() => {
    if (!header) return
    const prev = document.title
    document.title = pdfFileTitle([header.no || 'SI', header.uc || null, profile?.company_name])
    return () => { document.title = prev }
  }, [header, profile?.company_name])

  const cur = header?.currency || 'USD'
  const money = v => `${cur} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtDate = s => {
    if (!s) return '—'
    const d = new Date(s)
    return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const lineSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const total = isApp ? totals?.total : lineSum
  const subtotal = isApp ? totals?.subtotal : lineSum
  const discountAmount = isApp ? totals?.discountAmount : 0
  const chargesTotal = isApp ? totals?.chargesTotal : 0

  async function downloadExcel() {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Invoice')
    ws.addRow(['Invoice No.', header.no])
    ws.addRow(['UC#', header.uc || ''])
    ws.addRow(['Date', fmtDate(header.date)])
    ws.addRow(['Currency', cur])
    ws.addRow([])
    ws.addRow(['Item Code', 'Description', 'Qty', 'Unit Price', 'Amount']).font = { bold: true }
    lines.forEach(l => ws.addRow([l.item_code || '', l.description || '', Number(l.qty) || 0, Number(l.unit_price) || 0, Number(l.amount) || 0]))
    ws.addRow([])
    ws.addRow(['', '', '', 'Total', Number(total) || 0]).font = { bold: true }
    ws.columns.forEach(c => { c.width = 22 })
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${pdfFileTitle([header.no || 'SI', header.uc || null])}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (loading) return <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p>
  if (error) return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>{error}</p>

  return (
    <div className="si-doc">
      <style>{`
        @page { size: A4 portrait; margin: 1.8cm; }
        @media print { body { margin: 0; } .print-btn, .si-warn { display: none !important; } }
        .si-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45;
          background: #fff; padding: 32px clamp(16px, 5vw, 48px); }
        .si-doc * { box-sizing: border-box; }
        .print-btn { display: inline-block; margin: 0 8px 18px 0; padding: 9px 26px; background: #1a1a1a; color: #fff;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
        .print-btn.secondary { background: #fff; color: #1a1a1a; border: 1px solid #ccc; }
        .print-btn-row { text-align: center; }
        .si-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 16px; }
        .si-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .si-logo { height: 30px; width: auto; margin-bottom: 10px; display: block; }
        .si-company { text-align: right; font-size: 9.5px; color: #555; line-height: 1.5; }
        .si-company .nm { font-size: 11px; color: #1a1a1a; font-weight: 600; }
        .si-title { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin: 4px 0 2px; }
        .si-meta-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; margin: 14px 0 20px; }
        .si-box { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; }
        .si-box h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .si-cust .name { font-size: 13px; font-weight: 600; }
        .si-cust .addr { color: #666; margin-top: 3px; white-space: pre-wrap; }
        .si-kv { display: flex; justify-content: space-between; padding: 2px 0; gap: 12px; }
        .si-kv .k { color: #888; }
        .si-kv .v { font-weight: 500; text-align: right; }
        .si-kv .v.big { font-size: 12px; font-weight: 700; }
        table.si-lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        table.si-lines th { background: #1a1a1a; color: #fff; font-weight: 500; font-size: 9px; text-transform: uppercase;
          letter-spacing: .05em; padding: 7px 8px; text-align: left; }
        table.si-lines th.r, table.si-lines td.r { text-align: right; }
        table.si-lines td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        /* A line must never be sliced by a page boundary — owner, 2026-08-07,
           on a real printed test invoice: a row split mid-way across the
           page break. Same fix as ProformaInvoicePrint.jsx's .pi-lines. */
        table.si-lines tr, table.si-lines td { page-break-inside: avoid; break-inside: avoid; }
        table.si-lines thead { display: table-header-group; }
        table.si-lines tfoot { display: table-footer-group; }
        .si-totals, .si-words, .si-sign, .si-foot { page-break-inside: avoid; break-inside: avoid; }
        table.si-lines td.desc { white-space: pre-wrap; }
        table.si-lines tr:nth-child(even) td { background: #fafafa; }
        .si-code { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5px; }
        .si-totals { display: flex; justify-content: flex-end; margin-top: 10px; }
        .si-totals table { width: 260px; }
        .si-totals td { padding: 3px 8px; }
        .si-totals td.k { color: #777; }
        .si-totals td.v { text-align: right; font-variant-numeric: tabular-nums; }
        .si-totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 13px; font-weight: 700; padding-top: 6px; }
        .si-words { margin: 12px 0 18px; padding: 8px 12px; background: #faf6ef; border-left: 3px solid #b8935a;
          border-radius: 4px; font-style: italic; color: #6b5a3e; font-size: 10px; }
        .si-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
        .si-sign .space { height: 70px; position: relative; }
        .si-sign .stamp { position: absolute; bottom: 0; left: 4px; max-width: 240px; max-height: 92px;
          object-fit: contain; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .si-sign .line { border-top: 1px solid #999; padding-top: 5px; font-size: 9px; color: #777; }
        .si-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 9px; color: #888; line-height: 1.6; }
        .si-foot .nm { font-weight: 600; color: #555; }
      `}</style>

      <div className="print-btn-row">
        <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>
        <button className="print-btn secondary" onClick={downloadExcel}>
          <Download size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Download Excel
        </button>
      </div>

      <div className="si-accent" />

      <div className="si-head">
        <div>
          <img className="si-logo" src={logoUrl} alt="" />
          <div className="si-title">INVOICE</div>
        </div>
        <div className="si-company">
          <div className="nm">United Art Metals Factory Limited</div>
          <div>11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong</div>
          <div>WhatsApp: +852 4608 3219 | Email: sales@uart.com.hk</div>
        </div>
      </div>

      <div className="si-meta-grid">
        <div className="si-box si-cust">
          <h4>Bill To</h4>
          <div className="name">{profile?.company_name || profile?.contact_name || '—'}</div>
          {profile?.contact_name && profile?.company_name && <div className="addr">Attn: {profile.contact_name}</div>}
          {profile?.email && <div className="addr">{profile.email}</div>}
        </div>
        <div className="si-box">
          <div className="si-kv"><span className="k">Invoice No.</span><span className="v big si-code">{header.no || '—'}</span></div>
          <div className="si-kv"><span className="k">Date</span><span className="v">{fmtDate(header.date)}</span></div>
          {header.uc && <div className="si-kv"><span className="k">UC#</span><span className="v si-code">{header.uc}</span></div>}
          <div className="si-kv"><span className="k">Currency</span><span className="v">{cur}</span></div>
          {header.customer_po && <div className="si-kv"><span className="k">Customer PO</span><span className="v">{header.customer_po}</span></div>}
        </div>
      </div>

      <table className="si-lines">
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
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="si-code">{l.item_code || '—'}</td>
              <td className="desc">{l.description || '—'}</td>
              <td className="r">{(Number(l.qty) || 0).toLocaleString()}</td>
              <td className="r">{(Number(l.unit_price) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td className="r">{(Number(l.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: '18px 0' }}>No line items on this invoice.</td></tr>
          )}
        </tbody>
      </table>

      <div className="si-totals">
        <table>
          <tbody>
            <tr><td className="k">Subtotal</td><td className="v">{money(subtotal)}</td></tr>
            {discountAmount > 0 && <tr><td className="k">Discount</td><td className="v">− {money(discountAmount)}</td></tr>}
            {chargesTotal > 0 && <tr><td className="k">Charges</td><td className="v">{money(chargesTotal)}</td></tr>}
            <tr className="grand"><td className="k">Total</td><td className="v">{money(total)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="si-words">{amountInWords(total, cur)}</div>

      <div className="si-sign">
        <div>
          <div className="space">
            {stampUrl && <img className="stamp" src={stampUrl} alt="" />}
          </div>
          <div className="line">ISSUED BY · United Art Metals Factory Limited</div>
        </div>
        <div>
          <div className="space" />
          <div className="line">RECEIVED BY · {profile?.company_name || '—'}</div>
        </div>
      </div>

      <div className="si-foot">
        <div className="nm">United Art Metals Factory Limited</div>
        <div>11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong</div>
        <div>WhatsApp: +852 4608 3219 | Email: sales@uart.com.hk</div>
      </div>
    </div>
  )
}
