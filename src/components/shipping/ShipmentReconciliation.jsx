import { Database, AlertTriangle } from 'lucide-react'
import { stockStatusDetail, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE } from '../../orderStockStatus.js'

// Shows how the parsed PI compares to the ERP's own sales order. The ERP rows
// are the original record; the parse is a reading of a picture of it. So when
// they disagree, the ERP is right — but this says so rather than silently
// overwriting, because the mirror can be a few days stale and the person
// importing knows which document they're holding.
export function ErpCrossCheck({ check, onUse }) {
  if (!check) return null
  const { soNo, erp, diff, adopted } = check
  const clean = !diff.differing.length && !diff.onlyParsed.length && !diff.onlyErp.length

  return (
    <div className={`mt-3 rounded-none border px-3 py-2.5 text-xs ${
 clean ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center gap-1.5 font-semibold mb-1">
        <Database size={13} />
        {soNo} found in the ERP — {erp.length} line{erp.length === 1 ? '' : 's'}
      </div>

      {clean ? (
        <p className="text-green-800">The parsed lines match the ERP exactly.</p>
      ) : (
        <div className="text-amber-900 space-y-1">
          {diff.differing.map((d) => (
            <div key={d.item_code}>
              <span className="font-mono">{d.item_code}</span>{' '}
              {d.fields.map((f) => (
                <span key={f.field}>
                  {f.field} read as <strong>{String(f.parsed)}</strong>, ERP says{' '}
                  <strong>{String(f.erp)}</strong>{' '}
                </span>
              ))}
            </div>
          ))}
          {diff.onlyParsed.map((l, i) => (
            <div key={`p${i}`}>
              <span className="font-mono">{l.item_code || '(no code)'}</span> — read from the
              PDF but not in the ERP order
            </div>
          ))}
          {diff.onlyErp.map((l) => (
            <div key={l.item_code}>
              <span className="font-mono">{l.item_code}</span> — in the ERP order but missed
              by the parser
            </div>
          ))}
        </div>
      )}

      {adopted ? (
        <p className="mt-2 text-green-800 font-medium">Using the ERP's lines.</p>
      ) : (
        <button type="button" onClick={onUse}
                className="mt-2 px-2.5 py-1 rounded-none border border-current text-xs font-medium hover:bg-white/60">
          Use the ERP's lines{clean ? '' : ' (recommended)'}
        </button>
      )}
    </div>
  )
}

export function ShipmentStockStatusBadge({ stock }) {
  if (!stock) return null
  return (
    <span className={`mt-1.5 inline-flex items-center gap-1 text-2xs font-medium border rounded-full px-2 py-0.5 ${STOCK_STATUS_STYLE[stock.state]}`}
          title={stockStatusDetail(stock) || 'All material consumption for this order has been recorded.'}>
      {stock.state !== 'recorded' && <AlertTriangle size={11} />}
      {STOCK_STATUS_LABEL[stock.state]}
    </span>
  )
}
