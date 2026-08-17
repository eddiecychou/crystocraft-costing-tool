import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { amountInWords } from '../constants'
import { pdfFileTitle } from '../pdfFilename'
import { cnTotals } from '../creditNotes'
import logoUrl from '../assets/logo.png'

// Credit Note — Sales Return / Credit Note Phase C. Same layout family as
// SalesInvoicePrint.jsx/ProformaInvoicePrint.jsx so a customer sees one
// document family; what differs is the title, the CN number, and that this
// one is a credit rather than a demand for payment (no remittance block).
// Remarks print above the signature — Cindy, 2026-08-17: "add a remark
// field above the signature section... where we can put in extra message
// when issuing the document to customer", same placement Phase A already
// built for the Sales Invoice.

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

export default function CreditNotePrint() {
  const { id } = useParams()
  const [cn, setCn] = useState(null)
  const [stampUrl, setStampUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'credit_notes', id))
        if (!snap.exists()) throw new Error('Credit note not found.')
        if (!alive) return
        setCn({ id: snap.id, ...snap.data() })
        try {
          const bSnap = await getDoc(doc(db, 'settings', 'quote_branding'))
          if (alive && bSnap.exists()) setStampUrl(bSnap.data().stamp_url || '')
        } catch { /* unstamped */ }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this credit note.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    if (!cn) return
    const prev = document.title
    document.title = pdfFileTitle([cn.cn_no || 'CN', cn.original_uc_no || null, cn.customer_name])
    return () => { document.title = prev }
  }, [cn])

  if (loading) return <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p>
  if (error) return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>{error}</p>

  const cur = cn.currency || 'USD'
  const lines = cn.lines || []
  const { subtotal: systemAmount, totalQty } = cnTotals(lines)
  const accountingAmount = cn.accounting_amount ?? systemAmount
  const adjustment = Math.round((accountingAmount - systemAmount) * 100) / 100
  const hasAdjustment = Math.abs(adjustment) > 0.005

  return (
    <div className="cn-doc">
      <style>{`
        @page { size: A4 portrait; margin: 1.8cm; }
        @media print { body { margin: 0; } .print-btn, .cn-warn { display: none !important; } }
        /* Plain white, unconditionally — same mobile "Save as PDF" reasoning
           as SalesInvoicePrint.jsx's identical comment. */
        .cn-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45;
          background: #fff; padding: 32px clamp(16px, 5vw, 48px); }
        .cn-doc * { box-sizing: border-box; }
        .print-btn { display: block; margin: 0 auto 18px; padding: 9px 26px; background: #1a1a1a; color: #fff;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
        .cn-warn { max-width: 640px; margin: 0 auto 16px; padding: 8px 12px; border-radius: 6px; font-size: 11px; text-align: center; }
        .cn-warn.red { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
        .cn-warn.amber { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
        .cn-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 16px; }
        .cn-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .cn-logo { height: 30px; width: auto; aspect-ratio: 617 / 108; margin-bottom: 10px; display: block; }
        .cn-company { text-align: right; font-size: 9.5px; color: #555; line-height: 1.5; }
        .cn-company .nm { font-size: 11px; color: #1a1a1a; font-weight: 600; }
        .cn-title { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin: 4px 0 2px; }
        .cn-meta-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; margin: 14px 0 20px; }
        .cn-box { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; }
        .cn-box h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .cn-cust .name { font-size: 13px; font-weight: 600; }
        .cn-kv { display: flex; justify-content: space-between; padding: 2px 0; gap: 12px; }
        .cn-kv .k { color: #888; }
        .cn-kv .v { font-weight: 500; text-align: right; }
        .cn-kv .v.big { font-size: 12px; font-weight: 700; }
        table.cn-lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        table.cn-lines th { background: #1a1a1a; color: #fff; font-weight: 500; font-size: 9px; text-transform: uppercase;
          letter-spacing: .05em; padding: 7px 8px; text-align: left; }
        table.cn-lines th.r, table.cn-lines td.r { text-align: right; }
        table.cn-lines td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        table.cn-lines tr, table.cn-lines td { page-break-inside: avoid; break-inside: avoid; }
        table.cn-lines thead { display: table-header-group; }
        table.cn-lines tfoot { display: table-footer-group; }
        .cn-totals, .cn-words, .cn-sign, .cn-foot { page-break-inside: avoid; break-inside: avoid; }
        table.cn-lines td.desc { white-space: pre-wrap; }
        table.cn-lines tr:nth-child(even) td { background: #fafafa; }
        .cn-code { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5px; }
        .cn-totals { display: flex; justify-content: flex-end; margin-top: 10px; }
        .cn-totals table { width: 260px; }
        .cn-totals td { padding: 3px 8px; }
        .cn-totals td.k { color: #777; }
        .cn-totals td.v { text-align: right; font-variant-numeric: tabular-nums; }
        .cn-totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 13px; font-weight: 700; padding-top: 6px; }
        .cn-words { margin: 12px 0 18px; padding: 8px 12px; background: #faf6ef; border-left: 3px solid #b8935a;
          border-radius: 4px; font-style: italic; color: #6b5a3e; font-size: 10px; }
        .cn-notes { font-size: 10px; color: #555; margin-bottom: 22px; white-space: pre-wrap; }
        .cn-notes .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; display: block; margin-bottom: 3px; }
        .cn-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
        .cn-sign .space { height: 70px; position: relative; }
        .cn-sign .stamp { position: absolute; bottom: 0; left: 4px; max-width: 240px; max-height: 92px;
          object-fit: contain; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .cn-sign .line { border-top: 1px solid #999; padding-top: 5px; font-size: 9px; color: #777; }
        .cn-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 9px; color: #888; line-height: 1.6; }
        .cn-foot .nm { font-weight: 600; color: #555; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>

      {cn.status !== 'posted' && (
        <div className="cn-warn red">
          This credit note has <strong>not been posted</strong> yet — it is a draft, not a financial record.
        </div>
      )}
      {cn.status === 'void' && (
        <div className="cn-warn red">This credit note has been <strong>voided</strong>.</div>
      )}
      {!cn.original_si_no && !cn.original_uc_no && (
        <div className="cn-warn amber">
          This credit note has no original invoice or UC reference on file.
        </div>
      )}

      <div className="cn-accent" />

      <div className="cn-head">
        <div>
          <img className="cn-logo" src={logoUrl} alt="" width="617" height="108" />
          <div className="cn-title">CREDIT NOTE</div>
        </div>
        <div className="cn-company">
          <div className="nm">{SELLER.name}</div>
          <div>{SELLER.address}</div>
          <div>{SELLER.contact}</div>
        </div>
      </div>

      <div className="cn-meta-grid">
        <div className="cn-box cn-cust">
          <h4>Customer</h4>
          <div className="name">{cn.customer_name || cn.marketplace_ref || '—'}</div>
          {cn.marketplace_ref && <div style={{ color: '#666', marginTop: 3 }}>Ref: {cn.marketplace_ref}</div>}
        </div>
        <div className="cn-box">
          <div className="cn-kv"><span className="k">Credit Note No.</span><span className="v big cn-code">{cn.cn_no || '—'}</span></div>
          <div className="cn-kv"><span className="k">Date</span><span className="v">{fmtDate(cn.accounting_date || cn.record_date)}</span></div>
          {cn.original_si_no && <div className="cn-kv"><span className="k">Original Invoice</span><span className="v cn-code">{cn.original_si_no}</span></div>}
          {cn.original_uc_no && <div className="cn-kv"><span className="k">UC#</span><span className="v cn-code">{cn.original_uc_no}</span></div>}
          <div className="cn-kv"><span className="k">Currency</span><span className="v">{cur}</span></div>
          {cn.channel && <div className="cn-kv"><span className="k">Channel</span><span className="v">{cn.channel}</span></div>}
        </div>
      </div>

      <table className="cn-lines">
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
          {lines.map((l, i) => {
            const qty = parseFloat(l.qty_returned) || 0
            const up = parseFloat(l.unit_price) || 0
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="cn-code">{l.item_code || '—'}</td>
                <td className="desc">{l.description || '—'}</td>
                <td className="r">{qty.toLocaleString()}{l.unit ? ` ${l.unit}` : ''}</td>
                <td className="r">{up.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="r">{(qty * up).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            )
          })}
          {lines.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: '18px 0' }}>No lines on this credit note.</td></tr>
          )}
        </tbody>
      </table>

      <div className="cn-totals">
        <table>
          <tbody>
            {totalQty > 0 && (
              <tr><td className="k">Total Qty</td><td className="v">{totalQty.toLocaleString()}</td></tr>
            )}
            <tr className={hasAdjustment ? '' : 'grand'}><td className="k">{hasAdjustment ? 'System Amount' : 'Credit Amount'}</td><td className="v">{money(systemAmount, cur)}</td></tr>
            {/* Adjustment — never a rewrite of the calculated amount above (SR-05). */}
            {hasAdjustment && (
              <>
                <tr><td className="k">Adjustment</td><td className="v">{adjustment > 0 ? '+ ' : '− '}{money(Math.abs(adjustment), cur)}</td></tr>
                <tr className="grand"><td className="k">Credit Amount</td><td className="v">{money(accountingAmount, cur)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {hasAdjustment && cn.adjustment_reason && (
        <p style={{ fontSize: 9.5, color: '#9a3412', textAlign: 'right', marginTop: -4, marginBottom: 10 }}>
          Adjustment reason: {cn.adjustment_reason}
        </p>
      )}

      <div className="cn-words">{amountInWords(accountingAmount, cur)}</div>

      {cn.remarks && (
        <div className="cn-notes">
          <span className="lbl">Remarks</span>
          {cn.remarks}
        </div>
      )}

      <div className="cn-sign">
        <div>
          <div className="space">
            {stampUrl && <img className="stamp" src={stampUrl} alt="" />}
          </div>
          <div className="line">ISSUED BY · {SELLER.name}</div>
        </div>
        <div>
          <div className="space" />
          <div className="line">RECEIVED BY · {cn.customer_name || '—'}</div>
        </div>
      </div>

      <div className="cn-foot">
        <div className="nm">{SELLER.name}</div>
        <div>{SELLER.address}</div>
        <div>{SELLER.contact}</div>
      </div>
    </div>
  )
}
