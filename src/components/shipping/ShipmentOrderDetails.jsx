export function ShipmentDestination({ destination, setDest }) {
  return (
    <div className="card p-4 md:p-6 space-y-3">
      <h2 className="text-xs text-ink-60 uppercase tracking-wide">Destination</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div><label className="label">Dest. Country</label><input className="input" value={destination.country} onChange={setDest('country')} placeholder="Germany" /></div>
        <div><label className="label">Dest. City</label><input className="input" value={destination.city} onChange={setDest('city')} placeholder="Hamburg" /></div>
        <div><label className="label">Port (optional)</label><input className="input" value={destination.port} onChange={setDest('port')} placeholder="Hamburg" /></div>
      </div>
    </div>
  )
}

export function ShipmentRemarks({ notes, onNotesChange, hideTotalQty, onHideTotalQtyChange }) {
  return (
    <div className="card p-4">
      <label className="label">Remarks</label>
      <textarea className="input" rows={2} value={notes} onChange={onNotesChange}
                 placeholder="Prints on the Proforma and Sales Invoice — accounting context, exceptions, etc." />
      <label className="flex items-center gap-2 mt-3 text-sm text-ink-70">
        <input
          type="checkbox"
          checked={hideTotalQty}
          onChange={onHideTotalQtyChange}
        />
        Hide "Total Qty" on the printed Proforma Invoice and Sales Invoice
      </label>
    </div>
  )
}
