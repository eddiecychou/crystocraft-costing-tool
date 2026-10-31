import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { asOcDate, formatOcDate } from '../../ocTime.js'
import { CHANNELS } from '../../domain/customer'
import { addInteraction, listInteractions, deleteInteraction } from '../../domain/interactionLog'
function fmtIsoOrTimestamp(d) {
  if (!d) return '—'
  const dt = d.toDate ? d.toDate() : asOcDate(d)
  return formatOcDate(dt, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB')
}

// CRM Interaction Log — quick "log a finding" (V8.9, owner's own request).
// marketing_contacts/{id}/enquiries, same shape/collection-group as
// customers/{id}/enquiries (see domain/interactionLog.js) — a manual entry
// here shows up right alongside whatever Daily Drafts auto-logged (send/
// reply/WhatsApp — see DailyDrafts.jsx's logInteraction), same list, same
// place. Deliberately NOT the full EnquiryForm.jsx drawer (attachments,
// linked quotes, status workflow) — those are quote-sales concepts that
// don't fit a marketing lead, and "quickly" was the explicit ask.
export function InteractionLog({ contactId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [description, setDescription] = useState('')
  const [channel, setChannel] = useState(CHANNELS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = () => listInteractions('marketing_contacts', contactId).then(setEntries).finally(() => setLoading(false))
  useEffect(() => { reload() }, [contactId])

  async function handleAdd() {
    if (!description.trim()) return
    setBusy(true); setError('')
    try {
      await addInteraction('marketing_contacts', contactId, { description, channel })
      setDescription('')
      await reload()
    } catch (e) {
      setError(e.message || 'Could not log that.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(entryId) {
    if (!window.confirm('Delete this log entry?')) return
    try {
      await deleteInteraction('marketing_contacts', contactId, entryId)
      setEntries(prev => prev.filter(e => e.id !== entryId))
    } catch (e) {
      setError(e.message || 'Could not delete that.')
    }
  }

  return (
    <div className="block border-t border-warm-grey pt-3">
      <button type="button" onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-xs text-ink-60 mb-1.5">
        <span>Interaction Log {!loading && entries.length > 0 && <span className="text-ink-60 font-normal">({entries.length})</span>}</span>
        {expanded ? <ChevronUp size={14} className="text-ink-60" /> : <ChevronDown size={14} className="text-ink-60" />}
      </button>
      {expanded && (
        <div className="space-y-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <select value={channel} onChange={e => setChannel(e.target.value)}
              className="input text-xs py-1 w-32 shrink-0">
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={description} onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Log a finding — what happened, what you learned…"
              className="input text-xs py-1 flex-1" />
            <button type="button" onClick={handleAdd} disabled={busy || !description.trim()}
              className="btn-primary text-xs px-2.5 py-1 shrink-0">
              {busy ? '…' : 'Log'}
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-ink-60">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-ink-60">Nothing logged yet.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {entries.map(e => (
                <div key={e.id} className="flex items-start gap-2 text-xs bg-ivory-light rounded-none px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <span className="text-ink-60">{fmtIsoOrTimestamp(e.date)} · {e.channel}</span>
                    <p className="text-ink-80 whitespace-pre-wrap">{e.description}</p>
                  </div>
                  <button type="button" onClick={() => handleDelete(e.id)}
                    className="text-platinum hover:text-red-600 shrink-0"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
