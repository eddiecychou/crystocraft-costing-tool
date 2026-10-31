import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { Smartphone, Loader2, RefreshCw, AlertTriangle, Mic, ChevronUp, ChevronDown } from 'lucide-react'
import { formatOcDate } from '../../ocTime.js'
import { generateAndSaveWhatsappSummary } from '../../whatsappSummaryApi'
import { transcribeMessage, WHATSAPP_TRANSCRIBE_LANGUAGES } from '../../domain/whatsappImport'
import WhatsAppAttachment from '../WhatsAppAttachment'
import { fmtIsoDate } from './crmDates'
// WhatsApp threads (V8.2) — marketing_contacts/{id}/whatsapp_threads, written
// by the WhatsApp import page's "Save as Lead" path (whatsappImport.js) for
// a chat that never became a real customer. Same shape/posture as
// CustomerDetail.jsx's own WhatsApp card, including its AI summary (V8.9 —
// see whatsappSummaryApi.js's generateAndSaveWhatsappSummary, now
// parameterized by collection). Hidden entirely when nothing's been
// imported for this contact.
export function WhatsAppThreads({ contactId, phone, whatsappSummary, onSummaryUpdated }) {
  const [threads, setThreads] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [transcribingKey, setTranscribingKey] = useState(null) // `${threadId}:${index}`
  const [transcribeError, setTranscribeError] = useState('')
  const [transcribeLang, setTranscribeLang] = useState({}) // `${threadId}:${index}` -> Deepgram language code, per-message since a thread can mix languages
  const [summary, setSummary] = useState(whatsappSummary || null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  useEffect(() => setSummary(whatsappSummary || null), [whatsappSummary])
  useEffect(() => {
    return onSnapshot(collection(db, 'marketing_contacts', contactId, 'whatsapp_threads'), snap => {
      const all = snap.docs.filter(d => !d.data().migrated_to).map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
      setThreads(all)
    })
  }, [contactId])

  async function handleRefreshSummary() {
    setSummaryBusy(true); setSummaryError('')
    try {
      const next = await generateAndSaveWhatsappSummary('marketing_contacts', contactId, threads)
      const patched = { ...next, generated_at: new Date() }
      setSummary(patched)
      // Same stale-list fix as EmailThreads above — contacts is loaded
      // once, not live.
      onSummaryUpdated?.({ whatsapp_summary: patched })
    } catch (e) {
      setSummaryError(e.message || 'Could not refresh the WhatsApp summary.')
    } finally {
      setSummaryBusy(false)
    }
  }

  if (threads.length === 0) return null

  const target = { type: 'lead', phone }

  // No bulk "transcribe all" — a thread can have hundreds of voice notes,
  // and transcribing all of them in one guessed language would waste
  // Deepgram calls on whichever ones guessed wrong (owner's call,
  // 2026-08-13, same reasoning as CustomerDetail.jsx's WhatsApp card).
  async function handleTranscribeMessage(threadId, index, language) {
    setTranscribeError(''); setTranscribingKey(`${threadId}:${index}`)
    try {
      await transcribeMessage(target, threadId, index, language)
    } catch (e) {
      setTranscribeError(e.message || 'Could not transcribe this voice note.')
    } finally {
      setTranscribingKey(null)
    }
  }

  return (
    <div className="block border-t border-warm-grey pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-ink-60 flex items-center gap-1.5">
          <Smartphone size={13} className="text-ink-60" /> WhatsApp
          <span className="text-ink-60 font-normal">
            ({threads.length} chat{threads.length === 1 ? '' : 's'} imported
            {threads[0]?.date_range?.[1] && (
              <> · latest {formatOcDate(threads[0].date_range[1], { year: 'numeric', month: 'short', day: 'numeric' })}</>
            )})
          </span>
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
      {transcribeError && <p className="text-xs text-red-600 mb-1.5">{transcribeError}</p>}
      <div className="space-y-1.5">
        {threads.map(t => {
          const voiceCount = (t.messages || []).filter(m => m.needs_transcription).length
          const isOpen = expanded === t.id
          return (
            <div key={t.id} className="border border-warm-grey rounded-none">
              <button
                type="button"
                onClick={() => setExpanded(v => v === t.id ? null : t.id)}
                className="w-full flex items-center justify-between text-left px-2.5 py-2"
              >
                <p className="text-xs text-ink-70">
                  {t.channel} · {t.message_count} message{t.message_count === 1 ? '' : 's'}
                  {t.date_range?.length === 2 && ` · ${fmtIsoDate(t.date_range[0])} – ${fmtIsoDate(t.date_range[1])}`}
                  {voiceCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-600">
                      <Mic size={10} />{voiceCount} not transcribed
                    </span>
                  )}
                </p>
                {isOpen ? <ChevronUp size={14} className="text-ink-60 shrink-0" /> : <ChevronDown size={14} className="text-ink-60 shrink-0" />}
              </button>
              {isOpen && (
                <div className="max-h-56 overflow-y-auto space-y-1.5 border-t border-warm-grey px-2.5 py-2">
                  {(t.messages || []).map((m, i) => {
                    const msgBusy = transcribingKey === `${t.id}:${i}`
                    const langKey = `${t.id}:${i}`
                    const selectedLang = transcribeLang[langKey] || 'zh-HK'
                    return (
                      <div key={i} className="text-xs">
                        <span className="text-ink-60">{fmtIsoDate(m.date)} · {m.from}</span>
                        {m.body_text && <p className="text-ink-80">{m.body_text}</p>}
                        {m.transcript && (
                          <p className="text-ink-80 italic">
                            <Mic size={10} className="inline align-[-1px] mr-1 text-ink-60" />{m.transcript}
                          </p>
                        )}
                        {m.attachment_filename && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <WhatsAppAttachment filename={m.attachment_filename} url={m.attachment_url} />
                            {/\.opus$/i.test(m.attachment_filename || '') && m.attachment_url && (
                              <>
                                <select
                                  value={selectedLang}
                                  onChange={e => setTranscribeLang(prev => ({ ...prev, [langKey]: e.target.value }))}
                                  disabled={!!transcribingKey}
                                  className="border border-warm-grey rounded-none px-1 py-0.5 text-ink-70"
                                >
                                  {WHATSAPP_TRANSCRIBE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleTranscribeMessage(t.id, i, selectedLang)}
                                  disabled={!!transcribingKey}
                                  className="text-brand-600 hover:text-brand-800 disabled:opacity-50"
                                >
                                  {msgBusy ? 'Transcribing…' : m.transcript ? 'Re-transcribe' : 'Transcribe'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
