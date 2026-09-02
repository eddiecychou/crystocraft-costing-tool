import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { PO_PAYMENT_TERM_LABEL, amountInWords } from '../constants'
import { poTotals, lineAmount } from '../purchaseOrders'
import { useUiLang } from '../i18n'

// The PO printout is bilingual by design: pick English or Simplified Chinese
// per print (defaults to the signed-in user's interface language, toggled on
// the page). Most suppliers are in China, so 中文 is often what you want — but
// a PO going to a non-China supplier still needs English.
const PO_L = {
  en: {
    title: 'PURCHASE ORDER', tel: 'Tel', supplier: 'Supplier', attn: 'Attn:',
    poNo: 'PO No.', issued: 'Issued', estShip: 'Est. Ship', currency: 'Currency',
    terms: 'Terms', shipTo: 'Ship To', itemCode: 'Item Code', description: 'Description',
    qty: 'Qty', unitPrice: 'Unit Price', amount: 'Amount', totalQty: 'Total Qty',
    subtotal: 'Subtotal', discount: 'Discount', addCharge: 'Additional charge',
    orderTotal: 'Order Total', deposit: 'Deposit', balanceDue: 'Balance Due',
    total: 'Total', remarks: 'Remarks', issuedBy: 'Issued By',
    authSign: 'Authorized Signature', pcs: 'pcs', printBtn: 'Print / Save as PDF',
  },
  zh: {
    title: '采购订单', tel: '电话', supplier: '供应商', attn: '收件人：',
    poNo: '采购单号', issued: '下单日期', estShip: '预计出货', currency: '币种',
    terms: '付款条件', shipTo: '送货至', itemCode: '物料编码', description: '描述',
    qty: '数量', unitPrice: '单价', amount: '金额', totalQty: '总数量',
    subtotal: '小计', discount: '折扣', addCharge: '附加费用',
    orderTotal: '订单总额', deposit: '定金', balanceDue: '应付余额',
    total: '合计', remarks: '备注', issuedBy: '制单',
    authSign: '供应商确认', pcs: '件', printBtn: '打印 / 存为 PDF',
  },
}

// Buyer entity — matches the ERP letterhead. Edit here if the registered
// details change; the PO print is the only consumer.
const COMPANY = {
  name_cn: '深圳市创联五金制品有限公司',
  address: '广东省深圳市龙华区大浪街道华盛路133号进门上楼梯 2楼',
  tel: '(86) 755-2770 4425',
}

const money = (v, cur) => {
  const dp = cur === 'HKD' ? 1 : 2
  return `${cur} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })}`
}
const fmtDate = s => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function PrintDoc({ po, lang }) {
  const L = PO_L[lang] || PO_L.en
  const cur = po.currency || 'RMB'
  const totals = poTotals(po)
  const termsLabel = [PO_PAYMENT_TERM_LABEL[po.payment_terms], po.payment_terms_custom].filter(Boolean).join(' · ') || '—'

  return (
    <div className="po-doc">
      <style>{`
        @page { size: A4 portrait; margin: 1.2cm; }
        @media print { body { margin: 0; } .print-btn { display: none !important; } }
        .po-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45; }
        .po-doc * { box-sizing: border-box; }
        .print-btn { display: block; margin: 0 auto 18px; padding: 9px 26px; background: #1a1a1a; color: #fff;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
        .po-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 16px; }
        .po-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .po-company { text-align: right; font-size: 9.5px; color: #555; line-height: 1.5; }
        .po-company .cn { font-size: 11px; color: #1a1a1a; font-weight: 600; }
        .po-title { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin: 4px 0 2px; }
        .po-title .cn { font-size: 13px; color: #888; font-weight: 500; margin-left: 8px; }
        .po-meta-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; margin: 14px 0 20px; }
        .po-box { border: 1px solid #e4e4e4; border-radius: 8px; padding: 12px 14px; }
        .po-box h4 { margin: 0 0 6px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; font-weight: 600; }
        .po-supplier .name { font-size: 13px; font-weight: 600; }
        .po-supplier .cn { color: #555; }
        .po-supplier .addr { color: #666; margin-top: 3px; }
        .po-kv { display: flex; justify-content: space-between; padding: 2px 0; }
        .po-kv .k { color: #888; }
        .po-kv .v { font-weight: 500; text-align: right; }
        table.po-lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        table.po-lines th { background: #1a1a1a; color: #fff; font-weight: 500; font-size: 9px; text-transform: uppercase;
          letter-spacing: .05em; padding: 7px 8px; text-align: left; }
        table.po-lines th.r, table.po-lines td.r { text-align: right; }
        table.po-lines td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        /* A line must never be sliced by a page boundary — same bug, same
           fix as ProformaInvoicePrint.jsx's .pi-lines (reported by CuiLing
           2026-07-24). This sibling document never got the same fix at the
           time — found 2026-08-07 while auditing every print document for
           the same gap. */
        table.po-lines tr, table.po-lines td { page-break-inside: avoid; break-inside: avoid; }
        table.po-lines thead { display: table-header-group; }
        table.po-lines tfoot { display: table-footer-group; }
        .po-totals, .po-words, .po-remarks, .po-sign { page-break-inside: avoid; break-inside: avoid; }
        table.po-lines tr:nth-child(even) td { background: #fafafa; }
        .po-code { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5px; }
        .po-totals { display: flex; justify-content: flex-end; margin-top: 10px; }
        .po-totals table { width: 250px; }
        .po-totals td { padding: 3px 8px; }
        .po-totals td.k { color: #777; }
        .po-totals td.v { text-align: right; font-variant-numeric: tabular-nums; }
        .po-totals tr.grand td { border-top: 2px solid #1a1a1a; font-size: 13px; font-weight: 700; padding-top: 6px; }
        .po-words { margin: 12px 0 20px; padding: 8px 12px; background: #faf6ef; border-left: 3px solid #b8935a;
          border-radius: 4px; font-style: italic; color: #6b5a3e; font-size: 10px; }
        .po-remarks { font-size: 10px; color: #555; margin-bottom: 26px; white-space: pre-wrap; }
        .po-remarks .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #999; display: block; margin-bottom: 3px; }
        .po-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
        .po-sign .space { height: 70px; }
        .po-sign .line { border-top: 1px solid #999; padding-top: 5px; font-size: 9px; color: #777; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>{L.printBtn}</button>

      <div className="po-accent" />

      {/* Header */}
      <div className="po-head">
        <div>
          <div className="po-title">{L.title}</div>
        </div>
        <div className="po-company">
          <div className="cn">{COMPANY.name_cn}</div>
          <div>{COMPANY.address}</div>
          <div>{L.tel} {COMPANY.tel}</div>
        </div>
      </div>

      {/* Supplier + meta */}
      <div className="po-meta-grid">
        <div className="po-box po-supplier">
          <h4>{L.supplier}</h4>
          <div className="name">{po.supplier_name}{po.supplier_erp_code ? `  ·  ${po.supplier_erp_code}` : ''}</div>
          {po.supplier_name_cn && <div className="cn">{po.supplier_name_cn}</div>}
          {po.supplier_contact && <div className="addr">{L.attn} {po.supplier_contact}</div>}
          {po.supplier_address && <div className="addr">{po.supplier_address}</div>}
        </div>
        <div className="po-box">
          <div className="po-kv"><span className="k">{L.poNo}</span><span className="v po-code">{po.pu_number || '—'}</span></div>
          <div className="po-kv"><span className="k">{L.issued}</span><span className="v">{fmtDate(po.issued_date)}</span></div>
          <div className="po-kv"><span className="k">{L.estShip}</span><span className="v">{fmtDate(po.est_ship_date)}</span></div>
          <div className="po-kv"><span className="k">{L.currency}</span><span className="v">{cur}</span></div>
          <div className="po-kv"><span className="k">{L.terms}</span><span className="v">{termsLabel}</span></div>
          {po.ship_to && <div className="po-kv"><span className="k">{L.shipTo}</span><span className="v">{po.ship_to}</span></div>}
        </div>
      </div>

      {/* Lines */}
      <table className="po-lines">
        <thead>
          <tr>
            <th style={{ width: '3%' }}>#</th>
            <th style={{ width: '20%' }}>{L.itemCode}</th>
            <th style={{ width: '39%' }}>{L.description}</th>
            <th className="r" style={{ width: '12%' }}>{L.qty}</th>
            <th className="r" style={{ width: '12%' }}>{L.unitPrice}</th>
            <th className="r" style={{ width: '14%' }}>{L.amount}</th>
          </tr>
        </thead>
        <tbody>
          {(po.lines || []).map((ln, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="po-code">{ln.code || '—'}</td>
              <td>{ln.description || '—'}</td>
              <td className="r">{Number(ln.qty).toLocaleString()} {ln.unit || L.pcs}</td>
              <td className="r">{Number(ln.unit_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="r">{lineAmount(ln).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="po-totals">
        <table>
          <tbody>
            <tr><td className="k">{L.totalQty}</td><td className="v">{totals.totalQty.toLocaleString()}</td></tr>
            <tr><td className="k">{L.subtotal}</td><td className="v">{money(totals.subtotal, cur)}</td></tr>
            {(po.adjustments || []).map((a, i) => {
              const disc = a.kind === 'discount'
              return (
                <tr key={i}><td className="k">{a.label || (disc ? L.discount : L.addCharge)}</td>
                  <td className="v">{disc ? '− ' : '+ '}{money(Math.abs(Number(a.amount) || 0), cur)}</td></tr>
              )
            })}
            {totals.adjustmentsTotal !== 0 && (
              <tr><td className="k">{L.orderTotal}</td><td className="v">{money(totals.grandTotal, cur)}</td></tr>
            )}
            {totals.deposit > 0 && (
              <tr><td className="k">{L.deposit} ({po.deposit_pct}%)</td><td className="v">− {money(totals.deposit, cur)}</td></tr>
            )}
            <tr className="grand">
              <td>{totals.deposit > 0 ? L.balanceDue : L.total}</td>
              <td className="v">{money(totals.balance, cur)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="po-words">{amountInWords(totals.balance, cur)}</div>

      {po.remarks && (
        <div className="po-remarks"><span className="lbl">{L.remarks}</span>{po.remarks}</div>
      )}

      <div className="po-sign">
        <div><div className="space" /><div className="line">{L.issuedBy}</div></div>
        <div><div className="space" /><div className="line">{L.authSign}</div></div>
      </div>
    </div>
  )
}

export default function PurchaseOrderPrint() {
  const { id } = useParams()
  const uiLang = useUiLang()
  const [po, setPo] = useState(null)
  const [error, setError] = useState('')
  // Per-print language — defaults to the signed-in user's UI language, but the
  // toggle below overrides it for this print only. Not auto-printing on load
  // any more (it was), so there's a chance to pick the language first.
  const [lang, setLang] = useState(uiLang === 'zh-Hans' ? 'zh' : 'en')

  useEffect(() => {
    getDoc(doc(db, 'purchase_orders', id))
      .then(snap => {
        if (!snap.exists()) { setError('Purchase order not found'); return }
        setPo({ id: snap.id, ...snap.data() })
      })
      .catch(e => setError(e.message || 'Failed to load'))
  }, [id])

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: 'red' }}>Error: {error}</div>
  if (!po) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#666' }}>Loading purchase order…</div>

  return (
    <div style={{ padding: '1.2cm', maxWidth: 820, margin: '0 auto', boxSizing: 'border-box' }}>
      <div className="print-btn" style={{ display: 'flex', gap: 6, justifyContent: 'center', background: 'none', padding: 0, marginBottom: 10 }}>
        <button onClick={() => setLang('en')}
          style={{ padding: '5px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
            border: '1px solid #1a1a1a', background: lang === 'en' ? '#1a1a1a' : '#fff', color: lang === 'en' ? '#fff' : '#1a1a1a' }}>
          English
        </button>
        <button onClick={() => setLang('zh')}
          style={{ padding: '5px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
            border: '1px solid #1a1a1a', background: lang === 'zh' ? '#1a1a1a' : '#fff', color: lang === 'zh' ? '#fff' : '#1a1a1a' }}>
          简体中文
        </button>
      </div>
      <PrintDoc po={po} lang={lang} />
    </div>
  )
}
