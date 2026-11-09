import { formatOcDateTime } from '../../ocTime'

function DraftContents({ header, lines }) {
  return (
    <div className="space-y-3 mt-3">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Customer</dt><dd className="break-words">{header.customer_name}</dd>
        <dt>Currency</dt><dd>{header.currency}</dd>
        <dt>Customer PO</dt><dd className="break-words">{header.customer_po || '—'}</dd>
        <dt>Payment terms</dt><dd className="whitespace-pre-wrap break-words">{header.payment_terms || '—'}</dd>
        <dt>Accounting total</dt><dd>{header.accounting_total ?? '—'}</dd>
        <dt>Deposit paid</dt><dd>{header.deposit_paid ?? '—'}</dd>
        <dt>Notes</dt><dd className="whitespace-pre-wrap break-words">{header.notes || '—'}</dd>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Item</th><th>Quantity</th><th>Unit price</th></tr></thead>
          <tbody>{lines.map((line, index) => <tr key={line.id || index}>
            <td className="py-1 pr-3 whitespace-pre-wrap">{line.item_code || line.description || 'Item'}</td>
            <td className="text-right px-2">{line.qty_ordered ?? '—'}</td>
            <td className="text-right pl-2">{line.unit_price ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <details><summary className="cursor-pointer text-brand-600">All draft fields</summary>
        <pre className="mt-2 text-xs whitespace-pre-wrap break-words">{JSON.stringify({ header, lines }, null, 2)}</pre>
      </details>
    </div>
  )
}

export default function OrderEditConflict({
  conflict, drafts, warning, busy, onCheck, onLoadLatest, onRestore, onDiscard
}) {
  if (!conflict && !drafts.length && !warning) return null
  return (
    <section aria-label="Saved order draft" className="card p-4 mb-5 space-y-3">
      {warning && <p role="alert" className="text-sm text-brand-700">{warning}</p>}
      {conflict && <div className="space-y-3">
        <p role="alert" className="text-brand-700">This order changed or its save could not be confirmed. Your draft has been kept.</p>
        <p className="text-sm text-ink-60">Review the latest saved order, then reapply the changes you want to keep. Your preserved draft stays available below.</p>
        {conflict.error && <p className="text-sm">{conflict.error}</p>}
        {conflict.latest && <details>
          <summary className="cursor-pointer text-brand-600">Latest saved order</summary>
          <DraftContents header={conflict.latest.order} lines={conflict.latest.lines} />
        </details>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={onCheck}>
            {busy ? 'Checking…' : 'Check latest saved order'}
          </button>
          <button type="button" className="btn-secondary text-sm" disabled={busy || !conflict.latest} onClick={onLoadLatest}>
            Load latest and keep my draft
          </button>
        </div>
      </div>}
      {drafts.map(draft => <details key={draft.id} className="border-t border-warm-grey pt-3">
        <summary className="cursor-pointer text-brand-600">Your preserved draft · {formatOcDateTime(draft.savedAt)}</summary>
        <DraftContents header={draft.header} lines={draft.lines} />
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => onRestore(draft)}>Restore draft for review</button>
          <button type="button" className="text-sm text-brand-600" disabled={busy} onClick={() => onDiscard(draft.id)}>Discard this draft</button>
        </div>
      </details>)}
    </section>
  )
}
