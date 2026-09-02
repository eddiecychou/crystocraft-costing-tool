import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { fmtMoney } from '../currency'
import { Receipt } from 'lucide-react'
import { useT } from '../i18n'

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Reference badge — the most recent ACTUAL price paid for a component, pulled
// from linked purchase-order lines. A sanity signal against the quoted cost;
// it never feeds the costing engine. Renders nothing when no PO is linked.
export default function LastActualPaid({ componentId }) {
  const t = useT()
  const [rows, setRows] = useState(null)   // null = loading, [] = none

  useEffect(() => {
    if (!componentId) { setRows([]); return }
    let alive = true
    getDocs(query(collection(db, 'purchase_orders'), where('linked_component_ids', 'array-contains', componentId)))
      .then(snap => {
        const out = []
        snap.docs.forEach(d => {
          const po = d.data()
          ;(po.lines || []).forEach(ln => {
            if (ln.linked?.component_id === componentId && ln.unit_price != null) {
              out.push({
                po_id: d.id,
                pu_number: po.pu_number || '(no PU no.)',
                issued_date: po.issued_date || '',
                currency: po.currency || 'RMB',
                unit_price: Number(ln.unit_price),
                qty: Number(ln.qty) || 0,
              })
            }
          })
        })
        out.sort((a, b) => (b.issued_date || '').localeCompare(a.issued_date || ''))
        if (alive) setRows(out)
      })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [componentId])

  if (!rows || rows.length === 0) return null
  const latest = rows[0]

  return (
    <div className="rounded-none border border-amber-200 bg-amber-50/60 px-3 py-2 mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Receipt size={14} className="text-amber-600 shrink-0" />
          <span className="text-xs text-amber-800">
            <span className="font-medium">{t('Last actual paid:')}</span>{' '}
            <span className="font-semibold tabular-nums">{fmtMoney(latest.unit_price, latest.currency)}</span>
          </span>
        </div>
        <Link to={`/purchase-orders/${latest.po_id}`}
              className="text-2xs font-mono text-amber-700 hover:underline shrink-0">
          {latest.pu_number}{latest.issued_date ? ` · ${fmtDate(latest.issued_date)}` : ''}
        </Link>
      </div>
      {rows.length > 1 && (
        <p className="text-2xs text-amber-600/80 mt-1 pl-6">
          {t('{n} linked PO lines · range', { n: rows.length })} {fmtMoney(Math.min(...rows.map(r => r.unit_price)), latest.currency)}–{fmtMoney(Math.max(...rows.map(r => r.unit_price)), latest.currency).replace(/^\w+\s/, '')}
        </p>
      )}
    </div>
  )
}
