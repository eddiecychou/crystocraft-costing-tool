import { Download } from 'lucide-react'

// Date-range + type filter with an export button. Shared by Purchase Orders,
// the UC registry and Sales Invoices so the three exports Cindy asked for
// behave identically — same control order, same inclusive dates, same
// "exports what you see" rule.
//
// The filter drives the LIST, not just the download. An export button that
// quietly applies a different filter from the one on screen is the fastest way
// to produce a wrong figure in a spreadsheet, so the page must show exactly
// what the file will contain, and the count says so out loud.
export default function ExportFilterBar({
  from, to, onFrom, onTo,
  typeLabel, typeValue, onType, typeOptions,   // optional second filter
  count, total, noun = 'rows',
  onExport, disabled,
}) {
  const filtered = count !== total

  return (
    <div className="flex flex-wrap items-end gap-2 mb-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">From</span>
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">To</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
      </label>

      {typeOptions && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{typeLabel}</span>
          <select value={typeValue} onChange={(e) => onType(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40">
            <option value="">All</option>
            {typeOptions.map((o) => (
              <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
            ))}
          </select>
        </label>
      )}

      {(from || to || typeValue) && (
        <button type="button" onClick={() => { onFrom(''); onTo(''); onType?.('') }}
          className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-gray-500">
          {filtered
            ? <><strong className="font-medium text-gray-700">{count}</strong> of {total} {noun}</>
            : <>{total} {noun}</>}
        </span>
        <button type="button" onClick={onExport} disabled={disabled || !count}
          className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
          title={count ? `Export these ${count} ${noun} to CSV` : `Nothing to export`}>
          <Download size={15} /> Export CSV
        </button>
      </div>
    </div>
  )
}
