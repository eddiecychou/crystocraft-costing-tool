import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function ShipmentLineItemsHeader({ unclassified, onRematch, onAddLine }) {
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm text-ink-80">Line items &amp; reconciliation</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onRematch}
            className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
            title="Re-run product matching by item code (keeps lines you classified manually)">
            <RefreshCw size={12} /> Re-match
          </button>
          <button type="button" onClick={onAddLine} className="text-xs text-brand-600 hover:text-brand-800">+ Add line</button>
        </div>
      </div>

      {unclassified > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-3 py-2 mb-3">
          <AlertTriangle size={14} />
          {unclassified} line{unclassified > 1 ? 's' : ''} still need a type. Classify every line before packing.
        </div>
      )}
    </>
  )
}
