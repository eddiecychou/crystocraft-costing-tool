import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Check, AlertCircle, Loader2, Mic, Plus, X, RefreshCw, Sparkles } from 'lucide-react'
import { useCustomers, CHANNELS, CRM_CATEGORIES, CUSTOMER_COUNTRIES, saveCustomer } from '../domain/customer'
import { previewWhatsAppZip, importWhatsAppZip, findExistingThread, loadLegacyWhatsappThreads, migrateLegacyThread, undoMigrateLegacyThread } from '../domain/whatsappImport'
import { loadWhatsappSummaryCandidates, loadContactWhatsappSummaryCandidates, generateAndSaveWhatsappSummary } from '../whatsappSummaryApi'

// V8.2 — bulk uploader for WhatsApp's own "Export Chat" .zip files (Business
// and Personal both — no API access to either, see PROJECT-PLAN.md's "Where
// V8.2 starts"). Each zip has to be matched by hand — the export carries no
// phone/email, only a display name (confirmed against a real export,
// 2026-08-12) — so this previews every file locally first (message count,
// date range, a best-guess match) before anything is actually uploaded.
//
// Two destinations, per file: a real customer relationship (customers/), or
// — for a number that messaged in but never converted, "weak leads", mostly
// retail (owner, 2026-08-12) — a marketing_contacts/ lead instead, kept
// deliberately out of the Customers list. WhatsApp itself hints at which:
// an un-saved contact shows up as its raw phone number rather than a name.
const WA_CHANNELS = CHANNELS.filter(c => c === 'WhatsApp Business' || c === 'Personal WhatsApp')

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

// Best-guess customer for a parsed contact name — company_name or any
// contact's own name containing it (either direction, case-insensitive).
// Several matches is common (e.g. a common first name) and deliberately
// left unresolved rather than guessed at further.
function matchCustomers(contactName, customers) {
  const q = contactName.toLowerCase()
  if (!q) return []
  return customers.filter(c => {
    const company = (c.company_name || '').toLowerCase()
    if (company.includes(q) || q.includes(company)) return true
    return (c.contacts || []).some(ct => {
      const name = (ct.name || '').toLowerCase()
      return name && (name.includes(q) || q.includes(name))
    })
  })
}

// Inline quick-create — the whole point is not having to leave the import
// flow to go create a customer first. Deliberately minimal (the fields the
// owner asked for, 2026-08-12), not the full CustomerForm — country/type
// etc. are all editable properly later from the customer's own Edit page.
function NewCustomerInline({ prefillWhatsapp, defaultChannel, onCreated, onCancel }) {
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [whatsapp, setWhatsapp] = useState(prefillWhatsapp || '')
  const [country, setCountry] = useState('Hong Kong')
  const [crmCategory, setCrmCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!companyName.trim()) { setError('Company name is required.'); return }
    setSaving(true); setError('')
    try {
      const res = await saveCustomer(null, {
        company_name: companyName.trim(),
        contact_name: contactName.trim(),
        whatsapp: whatsapp.trim(),
        country,
        crm_category: crmCategory,
        channels: defaultChannel ? [defaultChannel] : [],
      })
      if (!res.ok) { setError(res.result.errors?.[0]?.message || 'Could not create customer.'); return }
      onCreated(res.id, companyName.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-warm-grey rounded-none p-3 space-y-2 bg-ivory">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">New Customer</p>
        <button type="button" onClick={onCancel} className="text-ink-60 hover:text-ink-70"><X size={14} /></button>
      </div>
      <input className="input text-sm" placeholder="Company Name *" value={companyName} onChange={e => setCompanyName(e.target.value)} />
      <input className="input text-sm" placeholder="Name" value={contactName} onChange={e => setContactName(e.target.value)} />
      <input className="input text-sm" placeholder="WhatsApp Number" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
      <select className="input text-sm" value={country} onChange={e => setCountry(e.target.value)}>
        {CUSTOMER_COUNTRIES.map(c => <option key={c}>{c}</option>)}
      </select>
      <div className="flex flex-wrap gap-1.5">
        {CRM_CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCrmCategory(v => v === cat ? '' : cat)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
 crmCategory === cat ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink-70 border-warm-grey hover:border-ink-60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="button" onClick={handleCreate} disabled={saving} className="btn-primary text-xs px-3 py-1.5 w-full">
        {saving ? 'Creating…' : 'Create & Select'}
      </button>
    </div>
  )
}

function FileRow({ entry, customers, onChangeCustomer, onChangeChannel, onChangeMode, onChangeLeadPhone, onChangeContact, onImport }) {
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const selected = customers.find(c => c.id === entry.customerId)

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase()
    if (!q) return customers.slice(0, 20)
    return customers.filter(c => c.company_name?.toLowerCase().includes(q)).slice(0, 20)
  }, [customerSearch, customers])

  // Suggested contact within the selected customer, from the export's display
  // name — shown as a hint only, never auto-selected (§5.4: human confirms).
  const suggestedContact = useMemo(() => {
    const q = (entry.preview?.contactName || '').toLowerCase()
    if (!q || !selected?.contacts?.length) return null
    const exact = selected.contacts.find(c => (c.name || '').toLowerCase() === q)
    if (exact) return exact
    return selected.contacts.find(c => {
      const n = (c.name || '').toLowerCase()
      return n && (n.includes(q) || q.includes(n))
    }) || null
  }, [entry.preview?.contactName, selected])

  const canImport = entry.matchMode === 'lead' ? !!entry.leadPhone?.trim() : !!(entry.customerId && entry.contactId)

  // Duplicate check — re-importing the same file for the same target is
  // safe either way (the doc id is deterministic, so it updates rather
  // than duplicates), but the admin should know BEFORE hitting Import
  // again, not discover it only after. Re-checks whenever the target
  // actually changes; never creates anything itself.
  const [existing, setExisting] = useState(undefined) // undefined = not checked yet, null = no existing thread
  useEffect(() => {
    if (entry.status !== 'ready' || !canImport) { setExisting(undefined); return }
    let cancelled = false
    const target = entry.matchMode === 'lead'
      ? { type: 'lead', phone: entry.leadPhone }
      : { type: 'customer', customerId: entry.customerId, contactId: entry.contactId }
    findExistingThread(target, entry.channel).then(r => { if (!cancelled) setExisting(r) })
    return () => { cancelled = true }
  }, [entry.status, entry.matchMode, entry.customerId, entry.contactId, entry.leadPhone, entry.channel, canImport])

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{entry.file.name}</p>
          {entry.status === 'parsing' && <p className="text-xs text-ink-60 mt-0.5">Reading zip…</p>}
          {entry.status === 'error' && (
            <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1"><AlertCircle size={12} />{entry.error}</p>
          )}
          {entry.preview && (
            <p className="text-xs text-ink-60 mt-0.5">
              {entry.preview.messageCount} messages · {fmtDate(entry.preview.dateRange?.[0])} – {fmtDate(entry.preview.dateRange?.[1])}
              {entry.preview.voiceCount > 0 && (
                <span className="inline-flex items-center gap-0.5 ml-2 text-amber-600">
                  <Mic size={11} />{entry.preview.voiceCount} voice note{entry.preview.voiceCount === 1 ? '' : 's'} (not transcribed yet)
                </span>
              )}
            </p>
          )}
        </div>
        {entry.status === 'done' && (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
            <Check size={12} /> Imported
          </span>
        )}
      </div>

      {entry.status === 'ready' && (
        <>
          <div className="flex gap-1.5">
            {['customer', 'lead'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => onChangeMode(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
 entry.matchMode === m ? 'bg-ink text-white border-ink' : 'bg-white text-ink-70 border-warm-grey hover:border-warm-grey'
                }`}
              >
                {m === 'customer' ? 'Match to Customer' : 'Save as Lead'}
              </button>
            ))}
          </div>

          {entry.matchMode === 'customer' ? (
            creatingNew ? (
              <NewCustomerInline
                prefillWhatsapp={entry.preview?.looksLikePhone ? entry.preview.contactName : ''}
                defaultChannel={entry.channel}
                onCreated={(id, name) => { onChangeCustomer(id, name); setCreatingNew(false) }}
                onCancel={() => setCreatingNew(false)}
              />
            ) : (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                <div className="relative">
                  <input
                    type="text"
                    className="input text-sm"
                    placeholder="Search customer…"
                    value={customerOpen ? customerSearch : (selected?.company_name || '')}
                    onFocus={() => { setCustomerOpen(true); setCustomerSearch('') }}
                    onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
                    onChange={e => setCustomerSearch(e.target.value)}
                  />
                  {customerOpen && (
                    <div className="absolute z-20 left-0 right-0 mt-1 border border-warm-grey rounded-none bg-white shadow-lg max-h-52 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <p className="text-xs text-ink-60 px-3 py-2">No matches</p>
                      ) : filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => { onChangeCustomer(c.id); setCustomerOpen(false) }}
                          className="w-full text-left text-sm px-3 py-2 hover:bg-ivory transition-colors text-ink-80"
                        >
                          {c.company_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setCreatingNew(true)} className="btn-secondary text-sm inline-flex items-center gap-1 px-3">
                  <Plus size={14} /> New
                </button>
                <select className="input text-sm" value={entry.channel} onChange={e => onChangeChannel(e.target.value)}>
                  {WA_CHANNELS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              {entry.customerId && (
                <div className="space-y-1">
                  <select
                    className={`input text-sm ${entry.contactId ? '' : 'border-amber-400'}`}
                    value={entry.contactId || ''}
                    onChange={e => onChangeContact(e.target.value || null)}
                  >
                    <option value="">Select contact person…</option>
                    {(selected?.contacts || []).map(ct => (
                      <option key={ct.id} value={ct.id}>
                        {[ct.name, ct.title].filter(Boolean).join(' · ') || ct.id}
                      </option>
                    ))}
                  </select>
                  {(selected?.contacts || []).length === 0 ? (
                    <p className="text-xs text-amber-600">This customer has no contacts — add one on the customer page before importing.</p>
                  ) : (
                    <p className="text-xs text-ink-60">
                      {suggestedContact ? `Suggested: ${suggestedContact.name} — confirm before importing.` : 'Pick the exact person you were chatting with.'}
                    </p>
                  )}
                </div>
              )}
              </>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <input
                type="text"
                className="input text-sm"
                placeholder="Phone number"
                value={entry.leadPhone}
                onChange={e => onChangeLeadPhone(e.target.value)}
              />
              <select className="input text-sm" value={entry.channel} onChange={e => onChangeChannel(e.target.value)}>
                {WA_CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          )}
          {entry.matchMode === 'lead' && (
            <p className="text-xs text-ink-60">
              Saved under Marketing Contacts (not Customers) — matched or created by this phone number.
            </p>
          )}
          {existing && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <RefreshCw size={11} />
              Already imported ({existing.message_count} message{existing.message_count === 1 ? '' : 's'}, {fmtDate(existing.imported_at?.toDate?.())}) — importing again will update this thread, not duplicate it.
            </p>
          )}
        </>
      )}

      {entry.status === 'ready' && (
        <button type="button" onClick={onImport} disabled={!canImport} className="btn-primary text-sm w-full sm:w-auto">
          {existing ? 'Re-import (update)' : 'Import'}
        </button>
      )}
      {entry.status === 'importing' && (
        <p className="text-sm text-brand-600 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Uploading{entry.progress ? ` (${entry.progress.done}/${entry.progress.total} attachments)` : '…'}
        </p>
      )}
    </div>
  )
}

// Bulk "generate WhatsApp summaries" — owner asked directly (2026-08-12):
// after importing everything, does Daily Drafts use it? It didn't, until
// each customer's summary is generated at least once (see
// whatsappSummaryApi.js's generateAndSaveWhatsappSummary). Doing that one
// customer at a time was the obvious next friction point, so this scans
// every customer with an import and (re)generates for anyone missing one OR
// whose message count has grown since their last one — not just the ones
// with zero, since a bulk pass that only filled gaps would leave anyone
// re-imported-with-new-messages permanently stale.
function SummaryScanSection() {
  const [candidates, setCandidates] = useState(null) // null = not scanned yet
  const [scanning, setScanning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [results, setResults] = useState({}) // customerId -> 'done' | error message

  async function handleScan() {
    setScanning(true)
    try {
      setCandidates(await loadWhatsappSummaryCandidates())
    } finally {
      setScanning(false)
    }
  }

  const pending = (candidates || []).filter(c => !c.upToDate)

  async function handleGenerateAll() {
    setGenerating(true); setResults({})
    for (let i = 0; i < pending.length; i++) {
      setProgress({ done: i, total: pending.length })
      const c = pending[i]
      try {
        await generateAndSaveWhatsappSummary('customers', c.customerId, c.threads)
        setResults(r => ({ ...r, [c.customerId]: 'done' }))
      } catch (e) {
        setResults(r => ({ ...r, [c.customerId]: e.message || 'Failed' }))
      }
    }
    setProgress(null)
    setGenerating(false)
    setCandidates(await loadWhatsappSummaryCandidates()) // refresh upToDate flags
  }

  return (
    <div className="card p-5 mt-8">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-sm text-ink-80">Generate WhatsApp Summaries</h2>
        <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {candidates ? 'Re-scan' : 'Scan customers'}
        </button>
      </div>
      <p className="text-xs text-ink-60 mb-3">
        Daily Drafts only uses a customer's WhatsApp history once a summary's been generated for them — this finds
        everyone with imported chats and (re)generates for anyone missing one or whose message count has grown since.
      </p>

      {candidates && (
        <>
          <p className="text-sm text-ink-70 mb-2">
            {candidates.length} customer{candidates.length === 1 ? '' : 's'} with imported WhatsApp —{' '}
            <span className={pending.length ? 'text-amber-600 font-medium' : 'text-green-600'}>
              {pending.length ? `${pending.length} need${pending.length === 1 ? 's' : ''} generating` : 'all up to date'}
            </span>
          </p>

          {pending.length > 0 && (
            <button type="button" onClick={handleGenerateAll} disabled={generating} className="btn-primary text-sm mb-3 inline-flex items-center gap-1.5">
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generating
                ? `Generating${progress ? ` (${progress.done + 1}/${progress.total})` : '…'}`
                : `Generate all (${pending.length})`}
            </button>
          )}

          <div className="divide-y divide-warm-grey border-t border-warm-grey">
            {candidates.map(c => (
              <div key={c.customerId} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-ink">{c.companyName || c.customerId}</span>
                  <span className="text-xs text-ink-60 ml-2">
                    {c.threadCount} chat{c.threadCount === 1 ? '' : 's'} · {c.messageCount} messages
                  </span>
                </div>
                <span className="text-xs shrink-0 ml-2">
                  {results[c.customerId] === 'done' ? (
                    <span className="text-green-600 inline-flex items-center gap-1"><Check size={11} /> Generated</span>
                  ) : results[c.customerId] ? (
                    <span className="text-red-600">{results[c.customerId]}</span>
                  ) : c.upToDate ? (
                    <span className="text-ink-60">Up to date</span>
                  ) : c.hasSummary ? (
                    <span className="text-amber-600">Stale — new messages</span>
                  ) : (
                    <span className="text-amber-600">Not generated</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Same bulk scan/generate as SummaryScanSection above, over
// marketing_contacts instead of customers (V8.9 — owner asked directly to
// run this once for every marketing lead with imported WhatsApp; see
// whatsappSummaryApi.js's loadContactWhatsappSummaryCandidates).
function ContactSummaryScanSection() {
  const [candidates, setCandidates] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(null) // { scanned, total } — see loadContactWhatsappSummaryCandidates
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState({})

  async function handleScan() {
    setScanning(true); setScanProgress(null)
    try {
      setCandidates(await loadContactWhatsappSummaryCandidates((scanned, total) => setScanProgress({ scanned, total })))
    } finally {
      setScanning(false); setScanProgress(null)
    }
  }

  const pending = (candidates || []).filter(c => !c.upToDate)

  async function handleGenerateAll() {
    setGenerating(true); setResults({})
    for (let i = 0; i < pending.length; i++) {
      setProgress({ done: i, total: pending.length })
      const c = pending[i]
      try {
        await generateAndSaveWhatsappSummary('marketing_contacts', c.contactId, c.threads)
        setResults(r => ({ ...r, [c.contactId]: 'done' }))
      } catch (e) {
        setResults(r => ({ ...r, [c.contactId]: e.message || 'Failed' }))
      }
    }
    setProgress(null)
    setGenerating(false)
    setCandidates(await loadContactWhatsappSummaryCandidates())
  }

  return (
    <div className="card p-5 mt-8">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-sm text-ink-80">Generate WhatsApp Summaries — Marketing Leads</h2>
        <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {scanning
            ? `Scanning${scanProgress ? ` (${scanProgress.scanned}/${scanProgress.total})` : '…'}`
            : candidates ? 'Re-scan' : 'Scan marketing contacts'}
        </button>
      </div>
      <p className="text-xs text-ink-60 mb-3">
        Same as the customer scan above, over marketing_contacts leads — finds everyone with imported WhatsApp chats
        and (re)generates for anyone missing a summary or whose message count has grown since. Scans all ~2,600
        contacts, so this can take a while even when few actually have anything imported.
      </p>

      {candidates && (
        <>
          <p className="text-sm text-ink-70 mb-2">
            {candidates.length} contact{candidates.length === 1 ? '' : 's'} with imported WhatsApp —{' '}
            <span className={pending.length ? 'text-amber-600 font-medium' : 'text-green-600'}>
              {pending.length ? `${pending.length} need${pending.length === 1 ? 's' : ''} generating` : 'all up to date'}
            </span>
          </p>

          {pending.length > 0 && (
            <button type="button" onClick={handleGenerateAll} disabled={generating} className="btn-primary text-sm mb-3 inline-flex items-center gap-1.5">
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generating
                ? `Generating${progress ? ` (${progress.done + 1}/${progress.total})` : '…'}`
                : `Generate all (${pending.length})`}
            </button>
          )}

          <div className="divide-y divide-warm-grey border-t border-warm-grey">
            {candidates.map(c => (
              <div key={c.contactId} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-ink">{c.name || c.contactId}</span>
                  <span className="text-xs text-ink-60 ml-2">
                    {c.threadCount} chat{c.threadCount === 1 ? '' : 's'} · {c.messageCount} messages
                  </span>
                </div>
                <span className="text-xs shrink-0 ml-2">
                  {results[c.contactId] === 'done' ? (
                    <span className="text-green-600 inline-flex items-center gap-1"><Check size={11} /> Generated</span>
                  ) : results[c.contactId] ? (
                    <span className="text-red-600">{results[c.contactId]}</span>
                  ) : c.upToDate ? (
                    <span className="text-ink-60">Up to date</span>
                  ) : c.hasSummary ? (
                    <span className="text-amber-600">Stale — new messages</span>
                  ) : (
                    <span className="text-amber-600">Not generated</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// One-time migration review for legacy (filename-keyed, pre-§5.1) WhatsApp
// threads. Re-keys each to the account×contact id via migrateLegacyThread
// (safe: never hard-deletes the source; undoable via undoMigrateLegacyThread).
// Account defaults to the thread's existing channel; contact is always an
// explicit pick (never auto-selected). Run this BEFORE importing new chats so
// a re-import updates the migrated thread instead of duplicating it.
function LegacyThreadsSection({ customers }) {
  const [rows, setRows] = useState(null) // null = not scanned yet
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [scanError, setScanError] = useState('')
  const [selections, setSelections] = useState({}) // key -> { channel, contactId }
  const [states, setStates] = useState({}) // key -> { status, newId?, error? }

  const rowKey = r => `${r.kind}:${r.parentId}:${r.legacyId}`

  async function handleScan() {
    setScanning(true); setScanError(''); setProgress(null)
    try {
      const list = await loadLegacyWhatsappThreads(({ done, total }) => setProgress({ done, total }))
      setRows(list)
      const seed = {}
      for (const r of list) seed[rowKey(r)] = { channel: r.channel || 'WhatsApp Business', contactId: null }
      setSelections(seed)
      setStates({})
    } catch (e) {
      setScanError(e.message || 'Could not scan legacy threads.')
    } finally {
      setScanning(false); setProgress(null)
    }
  }

  async function handleMigrate(r) {
    const key = rowKey(r)
    const sel = selections[key] || {}
    const collectionName = r.kind === 'lead' ? 'marketing_contacts' : 'customers'
    const contactId = r.kind === 'lead' ? r.parentId : sel.contactId
    setStates(s => ({ ...s, [key]: { status: 'migrating' } }))
    try {
      const res = await migrateLegacyThread({ collectionName, parentId: r.parentId, legacyId: r.legacyId, account: sel.channel, contactId })
      setStates(s => ({ ...s, [key]: { status: 'done', ...res } }))
    } catch (e) {
      setStates(s => ({ ...s, [key]: { status: 'error', error: e.message } }))
    }
  }

  async function handleUndo(r) {
    const key = rowKey(r)
    const st = states[key]
    if (!st?.newId) return
    const collectionName = r.kind === 'lead' ? 'marketing_contacts' : 'customers'
    setStates(s => ({ ...s, [key]: { status: 'undoing' } }))
    try {
      await undoMigrateLegacyThread({ collectionName, parentId: r.parentId, legacyId: r.legacyId, newId: st.newId })
      setStates(s => { const next = { ...s }; delete next[key]; return next })
    } catch (e) {
      setStates(s => ({ ...s, [key]: { status: 'error', error: e.message } }))
    }
  }

  return (
    <div className="card p-5 mt-8">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-sm text-ink-80">Re-key legacy WhatsApp threads</h2>
        <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {rows ? 'Re-scan' : 'Scan for legacy threads'}
        </button>
      </div>
      <p className="text-xs text-ink-60 mb-3">
        Threads imported before contact attribution were keyed by filename, so two people can collide and re-imports can duplicate.
        Re-key each to its account and contact person — safe and undoable — before importing new chats.
      </p>

      {scanning && (
        <p className="text-xs text-brand-600">
          Scanning{progress ? ` (${progress.done}/${progress.total})` : '…'}
        </p>
      )}
      {scanError && <p className="text-xs text-red-600">{scanError}</p>}

      {rows && rows.length === 0 && (
        <p className="text-sm text-ink-60">No legacy threads — everything is already attributed. You're clear to import.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="divide-y divide-warm-grey border-t border-warm-grey">
          {rows.map(r => {
            const key = rowKey(r)
            const sel = selections[key] || { channel: r.channel || 'WhatsApp Business', contactId: null }
            const st = states[key]
            const contacts = r.kind === 'customer' ? (customers.find(c => c.id === r.parentId)?.contacts || []) : []
            const canMigrate = r.kind === 'lead' ? true : !!sel.contactId
            return (
              <div key={key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {r.displayName} <span className="text-ink-60">· {r.subject || r.legacyId}</span>
                    </p>
                    <p className="text-xs text-ink-60 mt-0.5">
                      {r.channel} · {r.message_count} message{r.message_count === 1 ? '' : 's'}
                      {r.date_range?.length === 2 && ` · ${fmtDate(r.date_range[0])} – ${fmtDate(r.date_range[1])}`}
                    </p>
                  </div>
                  {!st && <span className="shrink-0 text-2xs font-normal uppercase tracking-wide rounded-none px-1 py-0.5 text-amber-600 bg-amber-50">Legacy</span>}
                </div>

                {st?.status === 'done' ? (
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-xs text-green-700">Migrated → {st.newId}</span>
                    <button type="button" onClick={() => handleUndo(r)} disabled={st.status === 'undoing'} className="btn-secondary text-xs px-2.5 py-1">
                      {st.status === 'undoing' ? 'Undoing…' : 'Undo'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <select className="input text-sm" value={sel.channel} onChange={e => setSelections(s => ({ ...s, [key]: { ...sel, channel: e.target.value } }))}>
                      {WA_CHANNELS.map(c => <option key={c}>{c}</option>)}
                    </select>
                    {r.kind === 'customer' && (
                      <select
                        className={`input text-sm ${sel.contactId ? '' : 'border-amber-400'}`}
                        value={sel.contactId || ''}
                        onChange={e => setSelections(s => ({ ...s, [key]: { ...sel, contactId: e.target.value || null } }))}
                      >
                        <option value="">Select contact person…</option>
                        {contacts.map(ct => <option key={ct.id} value={ct.id}>{[ct.name, ct.title].filter(Boolean).join(' · ') || ct.id}</option>)}
                      </select>
                    )}
                    {r.kind === 'lead' && <span className="text-xs text-ink-60">lead — attributed to {r.displayName}</span>}
                    <button type="button" onClick={() => handleMigrate(r)} disabled={!canMigrate || st?.status === 'migrating'} className="btn-primary text-xs px-3 py-1.5">
                      {st?.status === 'migrating' ? 'Migrating…' : 'Migrate'}
                    </button>
                  </div>
                )}
                {st?.status === 'error' && <p className="text-xs text-red-600 mt-1">{st.error}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function WhatsAppImport() {
  const { customers } = useCustomers()
  const [entries, setEntries] = useState([]) // { key, file, status, preview, matchMode, customerId, leadPhone, channel, error, progress }

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.zip'))
    const newEntries = files.map(file => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file, status: 'parsing', preview: null,
      matchMode: 'customer', customerId: null, contactId: null, leadPhone: '',
      channel: 'WhatsApp Business', error: null, progress: null,
    }))
    setEntries(prev => [...prev, ...newEntries.filter(e => !prev.some(p => p.key === e.key))])

    for (const entry of newEntries) {
      try {
        const preview = await previewWhatsAppZip(entry.file)
        const matches = matchCustomers(preview.contactName, customers)
        setEntries(prev => prev.map(e => e.key === entry.key
          ? {
              ...e,
              status: 'ready',
              preview,
              // An un-saved contact shows up as its raw phone number — a
              // strong signal this was never a real customer relationship.
              matchMode: preview.looksLikePhone ? 'lead' : 'customer',
              leadPhone: preview.looksLikePhone ? preview.contactName : '',
              customerId: matches.length === 1 ? matches[0].id : null,
            }
          : e))
      } catch (err) {
        setEntries(prev => prev.map(e => e.key === entry.key ? { ...e, status: 'error', error: err.message } : e))
      }
    }
  }

  function updateEntry(key, patch) {
    setEntries(prev => prev.map(e => e.key === key ? { ...e, ...patch } : e))
  }

  async function handleImport(entry) {
    updateEntry(entry.key, { status: 'importing', progress: null })
    try {
      const target = entry.matchMode === 'lead'
        ? { type: 'lead', phone: entry.leadPhone }
        : { type: 'customer', customerId: entry.customerId, contactId: entry.contactId }
      await importWhatsAppZip(entry.file, {
        target,
        channel: entry.channel,
        matchedBy: entry.preview?.looksLikePhone ? 'phone' : 'name',
        onProgress: (done, total) => updateEntry(entry.key, { progress: { done, total } }),
      })
      updateEntry(entry.key, { status: 'done', progress: null })
    } catch (err) {
      updateEntry(entry.key, { status: 'error', error: err.message })
    }
  }

  const readyCount = entries.filter(e =>
    e.status === 'ready' && (e.matchMode === 'lead' ? e.leadPhone?.trim() : !!(e.customerId && e.contactId))
  ).length

  async function handleImportAll() {
    for (const entry of entries) {
      const ready = entry.status === 'ready' && (entry.matchMode === 'lead' ? entry.leadPhone?.trim() : !!(entry.customerId && entry.contactId))
      if (ready) await handleImport(entry)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl text-ink mt-1">Import WhatsApp Chats</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          Upload the .zip files from WhatsApp's own "Export Chat" (Contact Info → Export Chat, on iPhone or web.whatsapp.com).
          Match each one to a real customer, or save it as a lead (for a number that never converted) — voice notes are
          archived but not yet transcribed to text.
        </p>
      </div>

      <label className="card p-8 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-warm-grey hover:border-brand-400 transition-colors cursor-pointer mb-6">
        <Upload size={28} className="text-ink-60" />
        <span className="text-sm font-medium text-ink-80">Choose or drop .zip files</span>
        <span className="text-xs text-ink-60">Multiple files at once is fine</span>
        <input type="file" accept=".zip" multiple className="hidden" onChange={e => e.target.files.length && handleFiles(e.target.files)} />
      </label>

      {entries.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-ink-60">{entries.length} file{entries.length === 1 ? '' : 's'}</p>
            {readyCount > 1 && (
              <button type="button" onClick={handleImportAll} className="btn-secondary text-sm">
                Import all matched ({readyCount})
              </button>
            )}
          </div>
          <div className="space-y-3">
            {entries.map(entry => (
              <FileRow
                key={entry.key}
                entry={entry}
                customers={customers}
                onChangeCustomer={id => updateEntry(entry.key, { customerId: id, contactId: null })}
                onChangeContact={cid => updateEntry(entry.key, { contactId: cid })}
                onChangeChannel={ch => updateEntry(entry.key, { channel: ch })}
                onChangeMode={m => updateEntry(entry.key, { matchMode: m, contactId: null })}
                onChangeLeadPhone={phone => updateEntry(entry.key, { leadPhone: phone })}
                onImport={() => handleImport(entry)}
              />
            ))}
          </div>
        </>
      )}

      <LegacyThreadsSection customers={customers} />
      <SummaryScanSection />
      <ContactSummaryScanSection />
    </div>
  )
}
