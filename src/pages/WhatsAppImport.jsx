import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Check, AlertCircle, Loader2, Mic, Plus, X, RefreshCw } from 'lucide-react'
import { useCustomers, CHANNELS, CRM_CATEGORIES, CUSTOMER_COUNTRIES, saveCustomer } from '../domain/customer'
import { previewWhatsAppZip, importWhatsAppZip, findExistingThread } from '../domain/whatsappImport'

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
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">New Customer</p>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
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
              crmCategory === cat ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
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

function FileRow({ entry, customers, onChangeCustomer, onChangeChannel, onChangeMode, onChangeLeadPhone, onImport }) {
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const selected = customers.find(c => c.id === entry.customerId)

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase()
    if (!q) return customers.slice(0, 20)
    return customers.filter(c => c.company_name?.toLowerCase().includes(q)).slice(0, 20)
  }, [customerSearch, customers])

  const canImport = entry.matchMode === 'lead' ? !!entry.leadPhone?.trim() : !!entry.customerId

  // Duplicate check — re-importing the same file for the same target is
  // safe either way (the doc id is deterministic, so it updates rather
  // than duplicates), but the admin should know BEFORE hitting Import
  // again, not discover it only after. Re-checks whenever the target
  // actually changes; never creates anything itself.
  const [existing, setExisting] = useState(undefined) // undefined = not checked yet, null = no existing thread
  useEffect(() => {
    if (entry.status !== 'ready' || !canImport) { setExisting(undefined); return }
    let cancelled = false
    const target = entry.matchMode === 'lead' ? { type: 'lead', phone: entry.leadPhone } : { type: 'customer', customerId: entry.customerId }
    findExistingThread(target, entry.file.name).then(r => { if (!cancelled) setExisting(r) })
    return () => { cancelled = true }
  }, [entry.status, entry.matchMode, entry.customerId, entry.leadPhone, entry.file.name, canImport])

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{entry.file.name}</p>
          {entry.status === 'parsing' && <p className="text-xs text-gray-400 mt-0.5">Reading zip…</p>}
          {entry.status === 'error' && (
            <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1"><AlertCircle size={12} />{entry.error}</p>
          )}
          {entry.preview && (
            <p className="text-xs text-gray-500 mt-0.5">
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
                  entry.matchMode === m ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
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
                    <div className="absolute z-20 left-0 right-0 mt-1 border border-gray-200 rounded-lg bg-white shadow-lg max-h-52 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <p className="text-xs text-gray-400 px-3 py-2">No matches</p>
                      ) : filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => { onChangeCustomer(c.id); setCustomerOpen(false) }}
                          className="w-full text-left text-sm px-3 py-2 hover:bg-gray-50 transition-colors text-gray-700"
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
            <p className="text-xs text-gray-400">
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

export default function WhatsAppImport() {
  const { customers } = useCustomers()
  const [entries, setEntries] = useState([]) // { key, file, status, preview, matchMode, customerId, leadPhone, channel, error, progress }

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.zip'))
    const newEntries = files.map(file => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file, status: 'parsing', preview: null,
      matchMode: 'customer', customerId: null, leadPhone: '',
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
        : { type: 'customer', customerId: entry.customerId }
      await importWhatsAppZip(entry.file, {
        target,
        channel: entry.channel,
        onProgress: (done, total) => updateEntry(entry.key, { progress: { done, total } }),
      })
      updateEntry(entry.key, { status: 'done', progress: null })
    } catch (err) {
      updateEntry(entry.key, { status: 'error', error: err.message })
    }
  }

  const readyCount = entries.filter(e =>
    e.status === 'ready' && (e.matchMode === 'lead' ? e.leadPhone?.trim() : e.customerId)
  ).length

  async function handleImportAll() {
    for (const entry of entries) {
      const ready = entry.status === 'ready' && (entry.matchMode === 'lead' ? entry.leadPhone?.trim() : entry.customerId)
      if (ready) await handleImport(entry)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Import WhatsApp Chats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload the .zip files from WhatsApp's own "Export Chat" (Contact Info → Export Chat, on iPhone or web.whatsapp.com).
          Match each one to a real customer, or save it as a lead (for a number that never converted) — voice notes are
          archived but not yet transcribed to text.
        </p>
      </div>

      <label className="card p-8 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-brand-400 transition-colors cursor-pointer mb-6">
        <Upload size={28} className="text-gray-400" />
        <span className="text-sm font-medium text-gray-700">Choose or drop .zip files</span>
        <span className="text-xs text-gray-400">Multiple files at once is fine</span>
        <input type="file" accept=".zip" multiple className="hidden" onChange={e => e.target.files.length && handleFiles(e.target.files)} />
      </label>

      {entries.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{entries.length} file{entries.length === 1 ? '' : 's'}</p>
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
                onChangeCustomer={id => updateEntry(entry.key, { customerId: id })}
                onChangeChannel={ch => updateEntry(entry.key, { channel: ch })}
                onChangeMode={m => updateEntry(entry.key, { matchMode: m })}
                onChangeLeadPhone={phone => updateEntry(entry.key, { leadPhone: phone })}
                onImport={() => handleImport(entry)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
