import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { derivedCbm, effectiveGw } from '../packing'

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadPrintData(plId) {
  const plSnap = await getDoc(doc(db, 'packing_lists', plId))
  if (!plSnap.exists()) throw new Error('Packing list not found')
  const pl = { id: plSnap.id, ...plSnap.data() }

  // Load order for PI / SO numbers
  let order = null
  if (pl.order_id) {
    const oSnap = await getDoc(doc(db, 'orders', pl.order_id))
    if (oSnap.exists()) order = { id: oSnap.id, ...oSnap.data() }
  }

  // Load cartons with contents
  const cSnap = await getDocs(query(
    collection(db, 'packing_lists', plId, 'cartons'),
    orderBy('carton_seq'),
  ))
  const cartons = await Promise.all(cSnap.docs.map(async cd => {
    const contSnap = await getDocs(collection(db, 'packing_lists', plId, 'cartons', cd.id, 'contents'))
    const contents = contSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    return { id: cd.id, ...cd.data(), contents }
  }))

  return { pl, order, cartons }
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt(n, dec = 4) {
  if (n == null || n === '') return ''
  const v = parseFloat(n)
  return isNaN(v) ? '' : v.toFixed(dec)
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ctnRange(c) {
  const start = parseInt(c.carton_seq) || 1
  const count = parseInt(c.carton_count) || 1
  return count > 1 ? `${start}–${start + count - 1}` : `${start}`
}

// ── Print document ────────────────────────────────────────────────────────────
function PrintDoc({ pl, order, cartons }) {
  const pallets = pl.pallets || []

  // Group cartons by pallet number
  const palletNums = [...new Set(cartons.map(c => parseInt(c.pallet_no) || 1))].sort((a, b) => a - b)
  const byPallet = palletNums.reduce((acc, no) => {
    acc[no] = cartons.filter(c => (parseInt(c.pallet_no) || 1) === no)
    return acc
  }, {})

  // Grand totals
  const totalCtns  = cartons.reduce((s, c) => s + (parseInt(c.carton_count) || 1), 0)
  const totalQty   = cartons.reduce((s, c) => {
    const count = parseInt(c.carton_count) || 1
    const qty = (c.contents || []).reduce((q, it) => q + (parseFloat(it.qty) || 0), 0)
    return s + qty * count
  }, 0)
  const totalGw    = cartons.reduce((s, c) => s + effectiveGw(c) * (parseInt(c.carton_count) || 1), 0)
  const totalCbm   = cartons.reduce((s, c) => s + (derivedCbm(c) || 0) * (parseInt(c.carton_count) || 1), 0)
  const totalNw    = cartons.reduce((s, c) => s + (parseFloat(c.nw_kg) || 0) * (parseInt(c.carton_count) || 1), 0)

  // Pallet summaries
  const palletSummaries = palletNums.map(no => {
    const cs = byPallet[no]
    const firstSeq = parseInt(cs[0]?.carton_seq) || 1
    const lastC = cs[cs.length - 1]
    const lastSeq = (parseInt(lastC?.carton_seq) || 1) + (parseInt(lastC?.carton_count) || 1) - 1
    const ctns = cs.reduce((s, c) => s + (parseInt(c.carton_count) || 1), 0)
    const cbm  = cs.reduce((s, c) => s + (derivedCbm(c) || 0) * (parseInt(c.carton_count) || 1), 0)
    const dims = pallets.find(p => p.pallet_no === no)
    return { no, firstSeq, lastSeq, ctns, cbm, dims }
  })

  // Header info
  const consignee = pl.consignee_name || order?.customer_name || ''
  const caseMark  = pl.case_mark || ''
  const plDate    = fmtDate(pl.pl_date) || fmtDate(pl.updatedAt) || ''
  const refNo     = order?.erp_pi_no || ''
  const poNo      = order?.erp_so_no || ''
  const vessel    = pl.shipped_per || ''

  // Compute C/NO range (first carton seq to last carton seq+count-1)
  const cnoStart = cartons.length ? parseInt(cartons[0].carton_seq) || 1 : 1
  const cnoEnd   = cartons.length
    ? (parseInt(cartons[cartons.length - 1].carton_seq) || 1) + (parseInt(cartons[cartons.length - 1].carton_count) || 1) - 1
    : 1

  return (
    <div className="pl-doc">
      <style>{`
        @page { size: A4 landscape; margin: 1cm; }
        @media print {
          body { margin: 0; }
          .pl-doc { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; }
        }
        .pl-doc { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; }
        .pl-doc table { border-collapse: collapse; width: 100%; }
        .pl-doc td, .pl-doc th {
          border: 1px solid #000; padding: 2px 4px; vertical-align: top;
        }
        .pl-doc th { background: #e8e8e8; font-weight: bold; text-align: center; }
        .pl-doc .no-border td { border: none; }
        .pl-doc .pallet-row td {
          background: #d0d0d0; font-weight: bold; padding: 2px 4px; border: 1px solid #000;
        }
        .pl-doc .total-row td { font-weight: bold; background: #f0f0f0; }
        .pl-doc .header-table td { border: none; padding: 1px 4px; }
        .print-btn {
          display: block;
          margin: 20px auto;
          padding: 8px 24px;
          background: #222;
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        }
        @media print { .print-btn { display: none; } }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>

      {/* ── Document title ── */}
      <h1 style={{ textAlign: 'center', fontSize: '14pt', fontWeight: 'bold', marginBottom: 8 }}>PACKING LIST</h1>

      {/* ── Header ── */}
      <table className="header-table" style={{ marginBottom: 8, width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ width: '50%' }}>
              <strong>Consignee Name: </strong>{consignee}
            </td>
            <td style={{ width: '25%', textAlign: 'center' }}>
              <strong>CASE MARK</strong>
            </td>
            <td style={{ width: '25%', textAlign: 'right' }}>
              <strong>DATE: </strong>{plDate}
            </td>
          </tr>
          <tr>
            <td><strong>Shipped Per S/S: </strong>{vessel}</td>
            <td rowSpan={4} style={{ textAlign: 'center', verticalAlign: 'middle', border: '1px solid #000', padding: 4 }}>
              <div style={{ fontWeight: 'bold', fontSize: '10pt' }}>{caseMark}</div>
            </td>
            <td></td>
          </tr>
          <tr>
            <td><strong>Invoice No: </strong>{poNo ? `ORDER NO. ${poNo}` : ''}</td>
            <td></td>
          </tr>
          <tr>
            <td><strong>Ref No: </strong>{refNo}</td>
            <td></td>
          </tr>
          <tr>
            <td><strong>PO NO: </strong>{poNo}</td>
            <td><strong>C/NO.: </strong>{cnoStart}–{cnoEnd}</td>
          </tr>
          <tr>
            <td colSpan={3}><strong>Total Package: ({totalCtns}) Cartons</strong></td>
          </tr>
        </tbody>
      </table>

      {/* ── Main table ── */}
      <table>
        <thead>
          <tr>
            <th style={{ width: '4%' }}>Pallet</th>
            <th style={{ width: '6%' }}>CTN NO</th>
            <th style={{ width: '9%' }}>Item NO</th>
            <th style={{ width: '18%' }}>Description</th>
            <th style={{ width: '4%' }}>Pcs/<br/>Ctn</th>
            <th style={{ width: '5%' }}>Kgs/<br/>Ctn</th>
            <th style={{ width: '4%' }}>Total<br/>CTN</th>
            <th style={{ width: '5%' }}>Total<br/>Qty</th>
            <th style={{ width: '5%' }}>G.W<br/>(kg)</th>
            <th style={{ width: '11%' }}>Dimension<br/>(CM)</th>
            <th style={{ width: '5%' }}>CBM/<br/>Ctn</th>
            <th style={{ width: '5%' }}>Total<br/>CBM</th>
            <th style={{ width: '5%' }}>N.W/<br/>Ctn (kg)</th>
            <th style={{ width: '5%' }}>N.W<br/>(kg)</th>
            <th style={{ width: '9%' }}>Pack Code</th>
          </tr>
        </thead>
        <tbody>
          {palletNums.map(no => {
            const pcs = byPallet[no]
            const isFirst = palletNums[0] === no
            return [
              // Pallet separator row (except first — already clear from header)
              !isFirst && (
                <tr key={`plt-sep-${no}`} className="pallet-row">
                  <td colSpan={15} style={{ background: '#d8d8d8' }}>
                    {(() => {
                      const dims = pallets.find(p => p.pallet_no === no)
                      const dimsStr = dims?.length_m && dims?.width_m && dims?.height_m
                        ? ` ${dims.length_m} x ${dims.width_m} x ${dims.height_m} Metres`
                        : ''
                      return `Pallet ${no}:${dimsStr}`
                    })()}
                  </td>
                </tr>
              ),
              ...pcs.map((c, ci) => {
                const count = parseInt(c.carton_count) || 1
                const gw = effectiveGw(c)
                const cbm = derivedCbm(c)
                const dims = [c.length_cm, c.width_cm, c.height_cm].every(Boolean)
                  ? `${c.length_cm} x ${c.width_cm} x ${c.height_cm} CM`
                  : ''
                const contents = c.contents?.length ? c.contents : [{}]

                return contents.map((item, ii) => {
                  const qty = parseFloat(item.qty) || 0
                  const isFirstRow = ii === 0
                  return (
                    <tr key={`${c.id || c._localId}-${ii}`}>
                      {/* Pallet number — only on first carton of the pallet */}
                      {isFirstRow && ci === 0
                        ? <td rowSpan={pcs.reduce((s, x) => s + Math.max(1, x.contents?.length || 1), 0)}
                               style={{ textAlign: 'center', verticalAlign: 'top' }}>{no}</td>
                        : isFirstRow && ci > 0 ? <td style={{ textAlign: 'center' }}></td>
                        : null}
                      {isFirstRow && (
                        <>
                          <td style={{ textAlign: 'center' }}>{ctnRange(c)}</td>
                          <td style={{ fontFamily: 'monospace' }}>{item.item_code || ''}</td>
                          <td>{item.description || ''}</td>
                          <td style={{ textAlign: 'right' }}>{qty > 0 ? qty : ''}</td>
                          <td style={{ textAlign: 'right' }}>{gw > 0 ? fmt(gw, 1) : ''}</td>
                          <td style={{ textAlign: 'center' }}>{count > 1 ? count : 1}</td>
                          <td style={{ textAlign: 'right' }}>{qty > 0 ? qty * count : ''}</td>
                          <td style={{ textAlign: 'right' }}>{gw > 0 ? fmt(gw * count, 1) : ''}</td>
                          <td style={{ textAlign: 'center' }}>{dims}</td>
                          <td style={{ textAlign: 'right' }}>{cbm > 0 ? fmt(cbm) : ''}</td>
                          <td style={{ textAlign: 'right' }}>{cbm > 0 ? fmt(cbm * count) : ''}</td>
                          <td style={{ textAlign: 'right' }}>{c.nw_kg > 0 ? fmt(c.nw_kg, 1) : ''}</td>
                          <td style={{ textAlign: 'right' }}>{c.nw_kg > 0 ? fmt(c.nw_kg * count, 1) : ''}</td>
                          <td style={{ fontSize: '7pt' }}>{c.packaging_code || ''}</td>
                        </>
                      )}
                      {!isFirstRow && (
                        <>
                          <td style={{ textAlign: 'center' }}></td>
                          <td style={{ fontFamily: 'monospace' }}>{item.item_code || ''}</td>
                          <td>{item.description || ''}</td>
                          <td style={{ textAlign: 'right' }}>{qty > 0 ? qty : ''}</td>
                          <td></td>
                          <td></td>
                          <td style={{ textAlign: 'right' }}>{qty > 0 ? qty * count : ''}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                        </>
                      )}
                    </tr>
                  )
                })
              }),
            ]
          })}

          {/* Grand totals row */}
          <tr className="total-row">
            <td colSpan={6} style={{ textAlign: 'right' }}>TOTAL</td>
            <td style={{ textAlign: 'center' }}>{totalCtns}</td>
            <td style={{ textAlign: 'right' }}>{totalQty}</td>
            <td style={{ textAlign: 'right' }}>{fmt(totalGw, 1)}</td>
            <td></td>
            <td></td>
            <td style={{ textAlign: 'right' }}>{fmt(totalCbm)}</td>
            <td></td>
            <td style={{ textAlign: 'right' }}>{fmt(totalNw, 1)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      {/* ── Pallet summary footer ── */}
      {palletSummaries.length > 0 && (
        <div style={{ marginTop: 10, fontSize: '8pt' }}>
          {palletSummaries.map(ps => {
            const dimsStr = ps.dims?.length_m && ps.dims?.width_m && ps.dims?.height_m
              ? ` ${ps.dims.length_m} x ${ps.dims.width_m} x ${ps.dims.height_m} metres,`
              : ''
            return (
              <div key={ps.no}>
                Pallet {ps.no}:{dimsStr} No. {ps.firstSeq}~{ps.lastSeq} &nbsp;&nbsp;
                Total {ps.ctns} CTNS, {fmt(ps.cbm)} CBM
              </div>
            )
          })}
          <div style={{ marginTop: 4, fontWeight: 'bold' }}>
            Total {totalCtns} CTNS, {fmt(totalGw, 1)} kgs, {fmt(totalCbm)} CBM
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PackingListPrint() {
  const { plId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!plId) return
    loadPrintData(plId)
      .then(d => {
        setData(d)
        // Auto-print after a short delay so the DOM renders first
        setTimeout(() => window.print(), 500)
      })
      .catch(e => setError(e.message || 'Failed to load packing list'))
  }, [plId])

  if (error) return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', color: 'red' }}>
      Error: {error}
    </div>
  )
  if (!data) return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#666' }}>
      Loading packing list…
    </div>
  )

  return (
    <div style={{ padding: '1cm', maxWidth: '100%', boxSizing: 'border-box' }}>
      <PrintDoc {...data} />
    </div>
  )
}
