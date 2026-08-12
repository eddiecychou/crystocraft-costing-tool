import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Check, AlertCircle, Loader2, Mic } from 'lucide-react'
import { useCustomers, CHANNELS } from '../domain/customer'
import { previewWhatsAppZip, importWhatsAppZip } from '../domain/whatsappImport'

// V8.2 — bulk uploader for WhatsApp's own "Export Chat" .zip files (Business
// and Personal both — no API access to either, see PROJECT-PLAN.md's "Where
// V8.2 starts"). Each zip has to be matched to a customer by hand — the
// export carries no phone/email, only a display name (confirmed against a
// real export, 2026-08-12) — so this previews every file locally first
// (message count, date range, a best-guess customer match) before anything
// is actually uploaded.
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

function FileRow({ entry, customers, onChangeCustomer, onChangeChannel, onImport }) {
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const selected = customers.find(c => c.id === entry.customerId)

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase()
    if (!q) return customers.slice(0, 20)
    return customers.filter(c => c.company_name?.toLowerCase().includes(q)).slice(0, 20)
  }, [customerSearch, customers])

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
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
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
          <select className="input text-sm" value={entry.channel} onChange={e => onChangeChannel(e.target.value)}>
            {WA_CHANNELS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      )}

      {entry.status === 'ready' && (
        <button
          type="button"
          onClick={onImport}
          disabled={!entry.customerId}
          className="btn-primary text-sm w-full sm:w-auto"
        >
          Import
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
  const [entries, setEntries] = useState([]) // { key, file, status, preview, customerId, channel, error, progress }

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.zip'))
    const newEntries = files.map(file => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file, status: 'parsing', preview: null, customerId: null, channel: 'WhatsApp Business', error: null, progress: null,
    }))
    setEntries(prev => [...prev, ...newEntries.filter(e => !prev.some(p => p.key === e.key))])

    for (const entry of newEntries) {
      try {
        const preview = await previewWhatsAppZip(entry.file)
        const matches = matchCustomers(preview.contactName, customers)
        setEntries(prev => prev.map(e => e.key === entry.key
          ? { ...e, status: 'ready', preview, customerId: matches.length === 1 ? matches[0].id : null }
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
      await importWhatsAppZip(entry.file, {
        customerId: entry.customerId,
        channel: entry.channel,
        onProgress: (done, total) => updateEntry(entry.key, { progress: { done, total } }),
      })
      updateEntry(entry.key, { status: 'done', progress: null })
    } catch (err) {
      updateEntry(entry.key, { status: 'error', error: err.message })
    }
  }

  const readyCount = entries.filter(e => e.status === 'ready' && e.customerId).length

  async function handleImportAll() {
    for (const entry of entries) {
      if (entry.status === 'ready' && entry.customerId) await handleImport(entry)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Import WhatsApp Chats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload the .zip files from WhatsApp's own "Export Chat" (Contact Info → Export Chat, on iPhone or web.whatsapp.com).
          Each one gets matched to a customer and stored on their record — voice notes are archived but not yet
          transcribed to text.
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
                onImport={() => handleImport(entry)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
