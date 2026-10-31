import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { loadCustomers, previewCustomerMerge, mergeCustomers } from '../../domain/customer'
const MERGE_FIELD_LABELS = {
  website: 'website', address: 'address', country: 'country',
  crm_category: 'type', crm_status: 'status', source: 'source', segment: 'segment',
  erp_code: 'ERP code', notes: 'notes', folder_path: 'folder',
  tags: 'tags', channels: 'channels', contacts: 'contact(s)',
  is_vip: 'VIP flag', is_personal_wa: 'personal-WhatsApp flag', sensitive: 'sensitive flag',
}

// Merges `customer` into another record you pick — the survivor's data wins,
// this record's blanks-only fields fill in, and this record is deleted once
// its orders/quotes/portal-accounts have moved. See domain/customer.js for the
// actual merge rule.
export default function MergeCustomerModal({ customer, onClose, onMerged }) {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [survivorId, setSurvivorId] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadCustomers().then(setCustomers) }, [])

  useEffect(() => {
    if (!survivorId) { setPreview(null); return }
    let alive = true
    setError(''); setPreviewing(true)
    previewCustomerMerge(customer.id, survivorId)
      .then(p => { if (alive) setPreview(p) })
      .catch(e => { if (alive) setError(e.message || 'Could not load a preview.') })
      .finally(() => { if (alive) setPreviewing(false) })
    return () => { alive = false }
  }, [survivorId, customer.id])

  const results = search
    ? customers.filter(c => c.id !== customer.id && c.company_name.toLowerCase().includes(search.toLowerCase())).slice(0, 20)
    : []

  async function confirm() {
    setBusy(true); setError('')
    try {
      await mergeCustomers(customer.id, survivorId)
      onMerged(survivorId)
    } catch (e) {
      setError(e.message || 'Merge failed.'); setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => {if (!busy) onClose()}}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <h2 className=" text-ink">Merge “{customer.company_name}” into…</h2>
          <button disabled={busy} onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          <label className="block">
            <span className="text-xs text-ink-60">The surviving record — search by company name</span>
            <input className="input w-full mt-0.5" placeholder="Search customers…" value={search}
              onChange={e => { setSearch(e.target.value); setSurvivorId('') }} disabled={busy} autoFocus />
          </label>
          {search && !survivorId && (
            <div className="border border-warm-grey rounded-none max-h-48 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-xs text-ink-60 px-3 py-2">No match.</p>
              ) : results.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setSurvivorId(c.id); setSearch(c.company_name) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-ivory border-b border-warm-grey last:border-0">
                  {c.company_name} {c.country && <span className="text-ink-60">— {c.country}</span>}
                </button>
              ))}
            </div>
          )}

          {previewing && <p className="text-xs text-ink-60">Checking what would move…</p>}

          {preview && (
            <div className="rounded-none border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 space-y-1.5">
              <p>
                <strong>{preview.ordersCount}</strong> order{preview.ordersCount === 1 ? '' : 's'},{' '}
                <strong>{preview.quotesCount}</strong> quote{preview.quotesCount === 1 ? '' : 's'}, and{' '}
                <strong>{preview.accountsCount}</strong> portal account{preview.accountsCount === 1 ? '' : 's'} will move to{' '}
                <strong>{preview.survivor.company_name}</strong>.
              </p>
              {(preview.tasksCount > 0 || preview.notesCount > 0 || preview.whatsappThreadsCount > 0 || preview.alibabaThreadsCount > 0 || preview.assetsCount > 0 || preview.interactionsCount > 0 || preview.brandedImagesCount > 0 || preview.emailThreadsCount > 0) && (
                <p>
                  {[
                    preview.tasksCount > 0 && `${preview.tasksCount} task(s), including completed tasks`,
                    preview.notesCount > 0 && `${preview.notesCount} note(s), including archived notes`,
                    preview.whatsappThreadsCount > 0 && `${preview.whatsappThreadsCount} WhatsApp thread(s)`,
                    preview.alibabaThreadsCount > 0 && `${preview.alibabaThreadsCount} Alibaba thread(s)`,
                    preview.interactionsCount > 0 && `${preview.interactionsCount} interaction log entr${preview.interactionsCount === 1 ? 'y' : 'ies'}`,
                    preview.assetsCount > 0 && `${preview.assetsCount} Brand Gallery asset${preview.assetsCount === 1 ? '' : 's'}`,
                    preview.emailThreadsCount > 0 && `${preview.emailThreadsCount} email thread${preview.emailThreadsCount === 1 ? '' : 's'}`,
                    preview.brandedImagesCount > 0 && `${preview.brandedImagesCount} "branded for" product photo tag${preview.brandedImagesCount === 1 ? '' : 's'}`,
                  ].filter(Boolean).join(', ')} will also move to <strong>{preview.survivor.company_name}</strong>.
                </p>
              )}
              <p className="text-xs text-amber-800">
                {Object.keys(preview.fieldsToFill).length > 0
                  ? <>{preview.survivor.company_name} will gain: {Object.keys(preview.fieldsToFill).map(f => MERGE_FIELD_LABELS[f] || f).join(', ')} — existing tasks, notes and history are preserved.</>
                  : <>No fields to fill in — the surviving record already has everything this one does.</>}
              </p>
              <p className="text-xs text-amber-700 font-medium">
                Both records’ tasks, notes and history will be kept. The duplicate customer will leave the list only after the transfer is verified.
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-warm-grey">
          <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">Cancel</button>
          <button onClick={confirm} disabled={busy || !preview} className="btn-danger text-sm">
            {busy ? 'Merging…' : 'Merge & Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
