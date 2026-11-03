import { FileText } from 'lucide-react'

// Controlled document fields only. Allocation, revision updates, focus and saves
// remain owned by ShipmentForm. Never allocate or persist while rendering.
export default function ShipmentDocumentReferences({
  header,
  setH,
  doAllocateSo,
  allocatingSo,
  soError,
  doAllocateUc,
  allocatingUc,
  ucError,
  doAllocateSi,
  allocatingSi,
  siError,
  invoiceFieldRef,
  onNewRevision,
  sourceFile
}) {
  return (
        <div className="card p-4 md:p-6 space-y-3">
          <h2 className="text-xs text-ink-60 uppercase tracking-wide">Document References</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="label flex items-center justify-between gap-2">
                <span>SO / Doc No</span>
                {!header.erp_so_no && (
                  <button type="button" onClick={doAllocateSo} disabled={allocatingSo}
                          className="text-2xs text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case whitespace-nowrap shrink-0"
                          title="Allocate the next SO number. New orders get one automatically on create; this is for an older order that has none.">
                    {allocatingSo ? 'Allocating…' : 'Allocate'}
                  </button>
                )}
              </label>
              <input className="input" value={header.erp_so_no} onChange={setH('erp_so_no')} placeholder="e.g. SO260017" />
              {soError && <p className="text-xs text-red-600 mt-1">{soError}</p>}
            </div>
            <div>
              <label className="label flex items-center justify-between gap-2">
                <span>UC#</span>
                {!header.uc_no && (
                  <button type="button" onClick={doAllocateUc} disabled={allocatingUc}
                          className="text-2xs text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case whitespace-nowrap shrink-0"
                          title="Allocate a fresh UC# now, without waiting to raise an invoice. Never reuses an existing UC — a carried-over UC is exactly the slip this exists to prevent.">
                    {allocatingUc ? 'Allocating…' : 'Allocate'}
                  </button>
                )}
              </label>
              <input className="input" value={header.uc_no} onChange={setH('uc_no')} placeholder="e.g. UC4950/26" />
              {ucError && <p className="text-xs text-red-600 mt-1">{ucError}</p>}
            </div>
            <div>
              <label className="label">Customer PO</label>
              <input className="input" value={header.customer_po} onChange={setH('customer_po')} placeholder="e.g. 56909" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:max-w-md">
            <div>
              <label className="label flex items-center justify-between gap-2">
                <span>Invoice No</span>
                {!header.erp_si_no && (
                  <button type="button" onClick={doAllocateSi} disabled={allocatingSi}
                          className="text-2xs text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case whitespace-nowrap shrink-0"
                          title="Issue the invoice: allocate the next SI number (and a UC if none), and stamp today as the invoice date. Deliberately manual — an order is invoiced when you invoice it, not when it is created.">
                    {allocatingSi ? 'Allocating…' : 'Allocate'}
                  </button>
                )}
              </label>
              <input ref={invoiceFieldRef} className="input" value={header.erp_si_no} onChange={setH('erp_si_no')} placeholder="e.g. SI260094" />
              {siError && <p className="text-xs text-red-600 mt-1">{siError}</p>}
            </div>
            <div>
              <label className="label flex items-center justify-between gap-2">
                <span>Revision</span>
                <button type="button"
                        onClick={onNewRevision}
                        className="text-2xs text-brand-600 hover:text-brand-800 font-normal normal-case whitespace-nowrap shrink-0"
                        title="Bump the revision printed on the PI/Invoice — for when a customer needs to tell an updated version apart from one they've already seen. Never bumps automatically.">
                  + New Rev
                </button>
              </label>
              <input className="input" type="number" min="0" value={header.pi_revision}
                     onChange={setH('pi_revision')} placeholder="Original" />
            </div>
          </div>
          {sourceFile && (
            <a href={sourceFile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
              <FileText size={13} /> {sourceFile.name || 'View source PI'}
            </a>
          )}
        </div>
  )
}
