import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { Mail, Loader2, RefreshCw, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'
import { refreshEmailSummary, renderThreadsText } from '../../emailSummaryApi'
import { fmtIsoDate } from './crmDates'
// Email threads (V8.9) — marketing_contacts/{id}/email_threads, written by
// email-sync (see email-sync/common.py's load_marketing_contact_index) for
// a lead whose email showed up in the mailbox with no customer match. Same
// shape/posture as CustomerDetail.jsx's Email Summary card — Generate/
// Refresh runs the same DeepSeek call (refresh-email-summary.js via
// emailSummaryApi.js), just written onto marketing_contacts/{id} instead of
// customers/{id}. Hidden entirely when nothing's been ingested yet.
export function EmailThreads({ contactId, emailSummary, onSummaryUpdated }) {
  const [threads, setThreads] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [summary, setSummary] = useState(emailSummary || null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  useEffect(() => setSummary(emailSummary || null), [emailSummary])
  useEffect(() => {
    return onSnapshot(collection(db, 'marketing_contacts', contactId, 'email_threads'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
      setThreads(all)
    })
  }, [contactId])

  async function handleRefreshSummary() {
    setSummaryBusy(true); setSummaryError('')
    try {
      const result = await refreshEmailSummary(renderThreadsText(threads))
      const email_summary = { ...result, thread_count: threads.length, generated_at: serverTimestamp() }
      await updateDoc(doc(db, 'marketing_contacts', contactId), { email_summary, has_email_threads: true })
      const patched = { ...result, thread_count: threads.length, generated_at: new Date() }
      setSummary(patched)
      // Same stale-list bug the bulk generator had (fixed 2026-08-24) —
      // MarketingContacts.jsx's `contacts` is loaded once, not live, so
      // without this the write succeeds but looks like it "didn't save" the
      // moment the modal is closed and reopened (owner report: "the email
      // summary is not saving at all if i do that manually" — it WAS
      // saving, just invisible on reopen).
      onSummaryUpdated?.({ email_summary: patched })
    } catch (e) {
      setSummaryError(e.message || 'Could not refresh the email summary.')
    } finally {
      setSummaryBusy(false)
    }
  }

  if (threads.length === 0) return null

  return (
    <div className="block border-t border-warm-grey pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-ink-60 flex items-center gap-1.5">
          <Mail size={13} className="text-ink-60" /> Email
          <span className="text-ink-60 font-normal">({threads.length} thread{threads.length === 1 ? '' : 's'})</span>
        </span>
        <button type="button" onClick={handleRefreshSummary} disabled={summaryBusy}
          className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1 disabled:opacity-50">
          {summaryBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {summary ? 'Refresh summary' : 'Generate summary'}
        </button>
      </div>
      {summaryError && (
        <div className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-none px-2 py-1.5 mb-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {summaryError}
        </div>
      )}
      {summary && (
        <div className="bg-ivory-light rounded-none px-2.5 py-2 mb-1.5 space-y-1">
          <p className="text-xs text-ink-80">{summary.summary}</p>
          {summary.recent_activity && <p className="text-xs text-ink-70">{summary.recent_activity}</p>}
          {summary.open_commitments?.length > 0 && (
            <ul className="text-xs text-ink-70 list-disc list-inside">
              {summary.open_commitments.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          <p className="text-2xs text-ink-60">A draft, not verified — used by Daily Drafts.</p>
        </div>
      )}
      <div className="space-y-1.5">
        {threads.map(t => {
          const isOpen = expanded === t.id
          return (
            <div key={t.id} className="border border-warm-grey rounded-none">
              <button type="button" onClick={() => setExpanded(v => v === t.id ? null : t.id)}
                className="w-full flex items-center justify-between text-left px-2.5 py-2">
                <p className="text-xs text-ink-70 truncate">
                  {t.subject || '(no subject)'} · {t.message_count} message{t.message_count === 1 ? '' : 's'}
                  {t.date_range?.length === 2 && ` · ${fmtIsoDate(t.date_range[0])} – ${fmtIsoDate(t.date_range[1])}`}
                </p>
                {isOpen ? <ChevronUp size={14} className="text-ink-60 shrink-0" /> : <ChevronDown size={14} className="text-ink-60 shrink-0" />}
              </button>
              {isOpen && (
                <div className="max-h-56 overflow-y-auto space-y-2 border-t border-warm-grey px-2.5 py-2">
                  {(t.messages || []).map((m, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-ink-60">{fmtIsoDate(m.date)} · {m.from}</span>
                      {m.body_text && <p className="text-ink-80 whitespace-pre-wrap">{m.body_text.slice(0, 500)}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
