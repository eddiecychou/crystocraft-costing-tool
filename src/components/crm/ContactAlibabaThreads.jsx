import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { MessageSquare, Loader2, RefreshCw, AlertTriangle, Check, ChevronUp, ChevronDown } from 'lucide-react'
import { formatOcDate } from '../../ocTime.js'
import { savePastedAlibabaThread, generateAndSaveAlibabaSummary } from '../../alibabaSummaryApi'
// Alibaba Messages (V8.10) — marketing_contacts/{id}/alibaba_threads, one
// doc per pasted batch. Alibaba.com gives no export/API for its
// buyer-seller chat, so the owner copy-pastes it by hand — see
// alibabaSummaryApi.js. Same props shape/posture as WhatsAppThreads above,
// but always shown, not hidden until something exists — pasting into this
// component IS how content gets in, there's no separate import page to
// populate it first.
export function AlibabaThreads({ contactId, alibabaSummary, onSummaryUpdated }) {
  const [threads, setThreads] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [summary, setSummary] = useState(alibabaSummary || null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  useEffect(() => setSummary(alibabaSummary || null), [alibabaSummary])
  useEffect(() => {
    return onSnapshot(collection(db, 'marketing_contacts', contactId, 'alibaba_threads'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => {
        const av = a.pasted_at?.toMillis ? a.pasted_at.toMillis() : new Date(a.pasted_at || 0).getTime()
        const bv = b.pasted_at?.toMillis ? b.pasted_at.toMillis() : new Date(b.pasted_at || 0).getTime()
        return bv - av
      })
      setThreads(all)
    })
  }, [contactId])

  async function handleSavePaste() {
    setSaveBusy(true); setSaveError(''); setSaved(false)
    try {
      await savePastedAlibabaThread('marketing_contacts', contactId, pasteText)
      setPasteText('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError(e.message || 'Could not save that paste.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function handleRefreshSummary() {
    setSummaryBusy(true); setSummaryError('')
    try {
      const next = await generateAndSaveAlibabaSummary('marketing_contacts', contactId, threads)
      const patched = { ...next, generated_at: new Date() }
      setSummary(patched)
      onSummaryUpdated?.({ alibaba_summary: patched })
    } catch (e) {
      setSummaryError(e.message || 'Could not refresh the Alibaba summary.')
    } finally {
      setSummaryBusy(false)
    }
  }

  return (
    <div className="block border-t border-warm-grey pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-ink-60 flex items-center gap-1.5">
          <MessageSquare size={13} className="text-ink-60" /> Alibaba Messages
          {threads.length > 0 && (
            <span className="text-ink-60 font-normal">({threads.length} paste{threads.length === 1 ? '' : 's'})</span>
          )}
        </span>
        {threads.length > 0 && (
          <button type="button" onClick={handleRefreshSummary} disabled={summaryBusy}
            className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1 disabled:opacity-50">
            {summaryBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {summary ? 'Refresh summary' : 'Generate summary'}
          </button>
        )}
      </div>

      <div className="mb-1.5">
        {threads.length > 0 && (
          <p className="text-xs font-medium text-ink-60 mb-1">
            Last pasted: {formatOcDate(threads[0].pasted_at?.toDate ? threads[0].pasted_at.toDate() : new Date(threads[0].pasted_at || Date.now()), { year: 'numeric', month: 'short', day: 'numeric' })}
            {' — '}only copy what's newer than this next time.
          </p>
        )}
        <textarea
          className="input text-xs"
          rows={3}
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder="Paste the raw Alibaba.com chat text here…"
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={handleSavePaste}
            disabled={saveBusy || !pasteText.trim()}
            className="btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1"
          >
            {saveBusy ? <Loader2 size={11} className="animate-spin" /> : null}
            {saveBusy ? 'Saving…' : 'Save pasted messages'}
          </button>
          {saved && <span className="text-xs text-green-600 inline-flex items-center gap-1"><Check size={11} /> Saved</span>}
        </div>
        {saveError && (
          <div className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-none px-2 py-1.5 mt-1">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {saveError}
          </div>
        )}
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
      {threads.length > 0 && (
        <div className="space-y-1.5">
          {threads.map(t => {
            const isOpen = expanded === t.id
            const d = t.pasted_at?.toDate ? t.pasted_at.toDate() : (t.pasted_at ? new Date(t.pasted_at) : null)
            const dateLabel = d ? formatOcDate(d, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB') : '(unknown date)'
            return (
              <div key={t.id} className="border border-warm-grey rounded-none">
                <button
                  type="button"
                  onClick={() => setExpanded(v => v === t.id ? null : t.id)}
                  className="w-full flex items-center justify-between text-left px-2.5 py-2"
                >
                  <p className="text-xs text-ink-70">
                    Pasted {dateLabel} · {(t.char_count || (t.raw_text || '').length).toLocaleString()} characters
                  </p>
                  {isOpen ? <ChevronUp size={14} className="text-ink-60 shrink-0" /> : <ChevronDown size={14} className="text-ink-60 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="max-h-56 overflow-y-auto border-t border-warm-grey px-2.5 py-2">
                    <p className="text-xs text-ink-80 whitespace-pre-wrap">{t.raw_text}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
