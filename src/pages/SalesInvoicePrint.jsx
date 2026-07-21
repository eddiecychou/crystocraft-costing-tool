import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getOrder, getOrderLines, computeOrderTotals } from '../shipping'
import { loadCustomers } from '../domain/customer'
import { listBankAccounts, accountForCurrency, formatBankDetails } from '../bankAccounts'
import { amountInWords } from '../constants'

// Sales Invoice — the commercial invoice, raised from an order the same way
// CuiLing's JES workflow does it ("Load Document" pulls the sales order into a
// new SI rather than re-keying it). Deliberately the same layout as the
// Proforma Invoice so a customer sees one document family; what differs is the
// title, the number shown, and that this one is the demand for payment.
//
// The PBIS export (see PBIS-IMPORT-FORMAT.md) reads the same three facts this
// prints — invoice number, date, total — so what a customer receives and what
// reaches the books cannot drift apart.

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

export default function SalesInvoicePrint() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [lines, setLines] = useState([])
  const [customer, setCustomer] = useState(null)
  const [bank, setBank] = useState(null)
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
        try {
          const accounts = await listBankAccounts()
          if (alive) setBank(accountForCurrency(accounts || [], o.currency))
        } catch { /* non-admin: print without the remittance block */ }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this order.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  if (loading) return <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p>
  if (error) return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>{error}</p>

  const cur = order.currency || 'USD'
  const { subtotal, chargesTotal, discountAmount, total } = computeOrderTotals(order, lines)
  const productLines = lines.filter((l) => (parseFloat(l.qty_ordered) || 0) > 0)
  const chargeLines = lines.filter((l) => !((parseFloat(l.qty_ordered) || 0) > 0) && (parseFloat(l.unit_price) || 0) !== 0)
  const dest = order.destination || {}
  const destText = [dest.city, dest.country].filter(Boolean).join(', ')
  const bankBlock = formatBankDetails(bank)
  const currencyMismatch = bank && bank.currency && bank.currency !== cur

  return (
    <div className="si-doc">
      <style>{`
        @page { size: A4 portrait; margin: 1.2cm; }
        @media print { body { margin: 0; } .print-btn, .si-warn { display: none !important; } }
        .si-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45; }
        .si-doc * { box-sizing: border-box; }
        .print-btn { display: block; margin: 0 auto 18px; padding: 9px 26px; background: #1a1a1a; color: #fff;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
        .si-warn { max-width: 640px; margin: 0 auto 16px; padding: 8px 12px; border-radius: 6px; font-size: 11px; text-align: center; }
        .si-warn.amber { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
        .si-warn.red { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
        .si-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 16px; }
        .si-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .si-company { text-align: right; font-size: 9.5px; color: #555; line-height: 1.5; }
        .si-company .nm { font-size: 11px; color: #1a1a1a; font-weight: 600; }
        .si-title { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin: 4px 0 2px; }
        .si-title .cn { font-size: 13px; color: #888; font-weight: 500; margin-left: 8px; }
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
        /* One-off MISC lines carry multi-line descriptions; without this they
           collapse into one run-on line. */
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
        .si-bank { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; }
        .si-bank h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .si-bank pre { margin: 0; font-family: inherit; font-size: 10px; color: #333; white-space: pre-wrap; line-height: 1.6; }
        .si-notes { font-size: 10px; color: #555; margin-bottom: 22px; white-space: pre-wrap; }
        .si-notes .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; display: block; margin-bottom: 3px; }
        .si-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
        .si-sign .space { height: 70px; }
        .si-sign .line { border-top: 1px solid #999; padding-top: 5px; font-size: 9px; color: #777; }
        .si-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 9px; color: #888; line-height: 1.6; }
        .si-foot .nm { font-weight: 600; color: #555; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>

      {/* An invoice with no number is not an invoice — say so before it is sent,
          not after the customer asks what to quote on the remittance. */}
      {!order.erp_si_no && (
        <div className="si-warn red">
          This order has <strong>no invoice number</strong>. Allocate one on the order before sending this.
        </div>
      )}
      {/* The UC is the required key on an invoice — it is what joins this
          document to Cindy's books and the PBIS import. A sales order is NOT
          required (retail sales are invoiced directly), so its absence is
          normal and deliberately not flagged. A missing UC is not. */}
      {!order.uc_no && (
        <div className="si-warn red">
          This invoice has <strong>no UC number</strong>. Every invoice needs one — it is what matches
          this document to the books. Allocate one on the order before sending.
        </div>
      )}
      {currencyMismatch && (
        <div className="si-warn amber">
          This invoice is in <strong>{cur}</strong> but the bank account shown is in <strong>{bank.currency}</strong>.
          Set a default {cur} account in Settings → Bank Accounts before sending.
        </div>
      )}

      <div className="si-accent" />

      <div className="si-head">
        <div>
          <div className="si-title">INVOICE<span className="cn">發票</span></div>
        </div>
        <div className="si-company">
          <div className="nm">{SELLER.name}</div>
          <div>{SELLER.address}</div>
          <div>{SELLER.contact}</div>
        </div>
      </div>

      <div className="si-meta-grid">
        <div className="si-box si-cust">
          <h4>Bill To 客戶</h4>
          <div className="name">{order.customer_name || customer?.company_name || '—'}</div>
          {customer?.contact_name && <div className="addr">Attn: {customer.contact_name}</div>}
          {customer?.address && <div className="addr">{customer.address}</div>}
          {customer?.contact_emails?.[0] && <div className="addr">{customer.contact_emails[0]}</div>}
        </div>
        <div className="si-box">
          <div className="si-kv"><span className="k">Invoice No.</span><span className="v big si-code">{order.erp_si_no || '—'}</span></div>
          <div className="si-kv"><span className="k">Date</span><span className="v">{fmtDate(order.invoiced_at || order.order_date)}</span></div>
          {order.erp_so_no && <div className="si-kv"><span className="k">SO No.</span><span className="v si-code">{order.erp_so_no}</span></div>}
          {order.erp_pi_no && <div className="si-kv"><span className="k">PI No.</span><span className="v si-code">{order.erp_pi_no}</span></div>}
          {order.uc_no && <div className="si-kv"><span className="k">UC#</span><span className="v si-code">{order.uc_no}</span></div>}
          <div className="si-kv"><span className="k">Currency</span><span className="v">{cur}</span></div>
          {order.incoterm && <div className="si-kv"><span className="k">Incoterm</span><span className="v">{order.incoterm}</span></div>}
          {destText && <div className="si-kv"><span className="k">Destination</span><span className="v">{destText}</span></div>}
        </div>
      </div>

      <table className="si-lines">
        <thead>
          <tr>
            <th style={{ width: '3%' }}>#</th>
            <th style={{ width: '20%' }}>Item Code</th>
            <th style={{ width: '41%' }}>Description 描述</th>
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
                <td className="si-code">{l.item_code || '—'}</td>
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
              <td className="si-code">{l.item_code || '—'}</td>
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

      <div className="si-totals">
        <table>
          <tbody>
            <tr><td className="k">Subtotal</td><td className="v">{money(subtotal, cur)}</td></tr>
            {discountAmount > 0 && (
              <tr><td className="k">Discount{order.discount_pct ? ` (${order.discount_pct}%)` : ''}</td>
                  <td className="v">− {money(discountAmount, cur)}</td></tr>
            )}
            {chargesTotal > 0 && (
              <tr><td className="k">Charges</td><td className="v">{money(chargesTotal, cur)}</td></tr>
            )}
            <tr className="grand"><td className="k">Total Due</td><td className="v">{money(total, cur)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="si-words">{amountInWords(total, cur)}</div>

      {bankBlock && (
        <div className="si-bank">
          <h4>Remittance 匯款資料</h4>
          <pre>{bankBlock}</pre>
        </div>
      )}

      {order.notes && (
        <div className="si-notes">
          <span className="lbl">Remarks 備註</span>
          {order.notes}
        </div>
      )}

      <div className="si-sign">
        <div>
          <div className="space" />
          <div className="line">ISSUED BY · {SELLER.name}</div>
        </div>
        <div>
          <div className="space" />
          <div className="line">RECEIVED BY · {order.customer_name || '—'}</div>
        </div>
      </div>

      <div className="si-foot">
        <div className="nm">{SELLER.name}</div>
        <div>{SELLER.address}</div>
        <div>{SELLER.contact}</div>
      </div>
    </div>
  )
}
