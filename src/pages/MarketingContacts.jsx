import { useMemo, useState } from 'react'
import { Users, Mail, MailX, UserCheck, Link2, Tag, AlertCircle, Download, Trash2, X, Pencil } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import {
  useMarketingContacts, updateContactReview, saveContact, deleteContact, deleteContacts,
  contactName, MC_CATEGORIES, MC_REVIEW, MC_STATUSES, isCategoryTag, sortTags,
} from '../domain/marketingContact'

const STATUS_STYLE = {
  subscribed:    'bg-green-100 text-green-700',
  nonsubscribed: 'bg-gray-100 text-gray-500',
  unsubscribed:  'bg-amber-100 text-amber-700',
  cleaned:       'bg-red-100 text-red-700',
}
const AUD_STYLE = {
  trade:   'bg-indigo-100 text-indigo-700',
  retail:  'bg-teal-100 text-teal-700',
  website: 'bg-amber-100 text-amber-700',
}
const REVIEW_STYLE = {
  '':          'text-gray-400',
  keep:        'text-green-700',
  follow_up:   'text-amber-700',
  drop:        'text-red-600',
}
const DISPLAY_CAP = 300

function Stat({ Icon, label, value, tone = 'text-gray-900' }) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <Icon size={20} className="text-brand-600 shrink-0" />
      <div>
        <div className={`text-lg font-bold leading-none ${tone}`}>{value.toLocaleString()}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
    </div>
  )
}

// CSV of the current filtered view — a UTF-8 BOM so Excel keeps the Chinese
// company names, and every field text-quoted so codes/leading-zeros survive.
function exportCsv(rows) {
  const cols = ['email', 'first_name', 'last_name', 'company', 'country', 'status',
    'audiences', 'is_customer', 'tags', 'review_status', 'matched_customer']
  const esc = v => {
    const s = Array.isArray(v) ? v.join('|') : (v == null ? '' : String(v))
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = [cols.join(',')]
  for (const r of rows) {
    lines.push(cols.map(c => {
      if (c === 'matched_customer') return esc(r.possible_customer_match?.company_name || '')
      return esc(r[c])
    }).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `marketing_contacts_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Edit one contact. Local form state seeded from the row; the imported Mailchimp
// fields not shown here are preserved on save (the domain merges them).
function EditContactModal({ contact, onClose, onSaved, onDeleted }) {
  const [f, setF] = useState({
    first_name: contact.first_name, last_name: contact.last_name, email: contact.email,
    company: contact.company, country: contact.country, phone: contact.phone,
    status: contact.status,
    is_customer: contact.is_customer, review_status: contact.review_status,
    tags: contact.tags.join(', '), app_notes: contact.app_notes,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setBusy(true); setError('')
    try {
      const tags = [...new Set(f.tags.split(/[,|]/).map(t => t.trim().toLowerCase()).filter(Boolean))]
      const newId = await saveContact(contact.id, { ...f, tags })
      onSaved(contact.id, { ...contact, ...f, tags, id: newId, emailable: f.status === 'subscribed' })
    } catch (e) {
      setError(e.message || 'Could not save.'); setBusy(false)
    }
  }
  async function del() {
    if (!window.confirm(`Delete ${contact.email} permanently? This cannot be undone.`)) return
    setBusy(true); setError('')
    try { await deleteContact(contact.id); onDeleted([contact.id]) }
    catch (e) { setError(e.message || 'Could not delete.'); setBusy(false) }
  }

  const field = (label, k, type = 'text') => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input type={type} className="input w-full mt-0.5" value={f[k]} onChange={set(k)} />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Edit contact</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-auto">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {field('First name', 'first_name')}
            {field('Last name', 'last_name')}
          </div>
          {field('Email', 'email', 'email')}
          <div className="grid grid-cols-2 gap-3">
            {field('Company', 'company')}
            {field('Country', 'country')}
          </div>
          {field('Phone', 'phone')}
          <label className="block">
            <span className="text-xs text-gray-500">Status</span>
            <select className="input w-full mt-0.5" value={f.status} onChange={set('status')}>
              {MC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Tags (comma-separated)</span>
            <input className="input w-full mt-0.5" value={f.tags} onChange={set('tags')} placeholder="distributor, exhibition contact" />
            <span className="text-[11px] text-gray-400">Category tags ({MC_CATEGORIES.slice(0, 5).join(', ')}…) show highlighted.</span>
          </label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={f.is_customer} onChange={set('is_customer')}
                     className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              Likely customer
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Review
              <select className="input py-1" value={f.review_status} onChange={set('review_status')}>
                {MC_REVIEW.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">Notes</span>
            <textarea className="input w-full mt-0.5" rows={2} value={f.app_notes} onChange={set('app_notes')} />
          </label>
          <p className="text-[11px] text-gray-400">
            Status drives emailability automatically (only “subscribed” is emailable). Changing the email moves the record.
          </p>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200">
          <button onClick={del} disabled={busy}
            className="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Trash2 size={15} /> Delete
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={busy} className="btn-primary text-sm">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MarketingContacts() {
  const { contacts, loading, setContacts } = useMarketingContacts()
  const [search, setSearch] = useState('')
  const [audience, setAudience] = useState('')
  const [status, setStatus] = useState('subscribed')  // default to the emailable list
  const [segment, setSegment] = useState('')          // '', 'customer', 'prospect'
  const [category, setCategory] = useState('')
  const [country, setCountry] = useState('')
  const [review, setReview] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)

  const countries = useMemo(() => {
    const c = new Map()
    for (const x of contacts) if (x.country) c.set(x.country, (c.get(x.country) || 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [contacts])

  const stats = useMemo(() => ({
    total: contacts.length,
    emailable: contacts.filter(c => c.emailable).length,
    suppressed: contacts.filter(c => c.status === 'unsubscribed' || c.status === 'cleaned').length,
    customers: contacts.filter(c => c.is_customer).length,
    matched: contacts.filter(c => c.possible_customer_match).length,
  }), [contacts])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return contacts.filter(c => {
      if (q && !(
        c.email.toLowerCase().includes(q) ||
        contactName(c).toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.tags.some(t => t.includes(q))
      )) return false
      if (audience && !c.audiences.includes(audience)) return false
      if (status && c.status !== status) return false
      if (segment === 'customer' && !c.is_customer) return false
      if (segment === 'prospect' && c.is_customer) return false
      if (category && !c.tags.includes(category)) return false
      if (country && c.country !== country) return false
      if (review && c.review_status !== review) return false
      return true
    })
  }, [contacts, search, audience, status, segment, category, country, review])

  const shown = filtered.slice(0, DISPLAY_CAP)
  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.id))

  async function setReviewStatus(id, value) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, review_status: value } : c))
    try { await updateContactReview(id, { review_status: value }) } catch { /* optimistic; a reload corrects */ }
  }

  function toggleSel(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllShown() {
    setSelected(prev => {
      const n = new Set(prev)
      if (allShownSelected) shown.forEach(c => n.delete(c.id))
      else shown.forEach(c => n.add(c.id))
      return n
    })
  }

  // Remove ids from local state + selection after a delete.
  function removeLocal(ids) {
    const idset = new Set(ids)
    setContacts(prev => prev.filter(c => !idset.has(c.id)))
    setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
    setEditing(null)
  }
  function applySaved(oldId, updated) {
    setContacts(prev => prev.map(c => c.id === oldId ? { ...c, ...updated } : c))
    setEditing(null)
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} contact${ids.length === 1 ? '' : 's'} permanently? This cannot be undone.`)) return
    try { await deleteContacts(ids); removeLocal(ids) }
    catch (e) { window.alert(e.message || 'Bulk delete failed.') }
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      {editing && (
        <EditContactModal contact={editing} onClose={() => setEditing(null)}
          onSaved={applySaved} onDeleted={removeLocal} />
      )}

      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={22} className="text-brand-600" /> Marketing Contacts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cleaned Mailchimp list — kept separate from Customers. {stats.total.toLocaleString()} contacts.
          </p>
        </div>
        <button onClick={() => exportCsv(filtered)} className="btn-secondary text-sm flex items-center gap-1.5 shrink-0">
          <Download size={15} /> Export view
        </button>
      </div>

      {/* Segment summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
        <Stat Icon={Users}     label="Total contacts"          value={stats.total} />
        <Stat Icon={Mail}      label="Emailable (subscribed)"  value={stats.emailable} tone="text-green-700" />
        <Stat Icon={MailX}     label="Suppressed — never email" value={stats.suppressed} tone="text-amber-700" />
        <Stat Icon={UserCheck} label="Likely customers"        value={stats.customers} />
        <Stat Icon={Link2}     label="Match an app customer"   value={stats.matched} />
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <input
          type="text"
          placeholder="Search name, company, email, tag…"
          className="input w-full"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <select className="input flex-1 min-w-[110px]" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="subscribed">Subscribed (emailable)</option>
            <option value="nonsubscribed">Non-subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="cleaned">Cleaned (bounced)</option>
          </select>
          <select className="input flex-1 min-w-[110px]" value={audience} onChange={e => setAudience(e.target.value)}>
            <option value="">All audiences</option>
            <option value="trade">Trade (B2B)</option>
            <option value="retail">Retail (e-com)</option>
            <option value="website">Website signup</option>
          </select>
          <select className="input flex-1 min-w-[110px]" value={segment} onChange={e => setSegment(e.target.value)}>
            <option value="">Customer + prospect</option>
            <option value="customer">Likely customers</option>
            <option value="prospect">Prospects / leads</option>
          </select>
          <select className="input flex-1 min-w-[110px]" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {MC_CATEGORIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input flex-1 min-w-[110px]" value={country} onChange={e => setCountry(e.target.value)}>
            <option value="">All countries</option>
            {countries.map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="input flex-1 min-w-[110px]" value={review} onChange={e => setReview(e.target.value)}>
            <option value="">Any review</option>
            {MC_REVIEW.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* Count + bulk bar */}
      <div className="flex items-center justify-between mb-2 min-h-[28px]">
        <p className="text-xs text-gray-500">
          {filtered.length.toLocaleString()} match{filtered.length === 1 ? '' : 'es'}
          {filtered.length > DISPLAY_CAP && ` — showing first ${DISPLAY_CAP}, refine to narrow`}
        </p>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
            <button onClick={bulkDelete}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 rounded-md px-2 py-1">
              <Trash2 size={13} /> Delete selected
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown}
                         className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                         title="Select all shown" />
                </th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Country</th>
                <th className="px-3 py-2 font-medium">Audience</th>
                <th className="px-3 py-2 font-medium">Tags</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Review</th>
                <th className="px-3 py-2 font-medium w-12 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 align-top ${selected.has(c.id) ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)}
                           className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => setEditing(c)} className="text-brand-600 hover:underline font-medium text-left">
                      {contactName(c)}
                    </button>
                    {c.is_customer && <UserCheck size={13} className="inline ml-1 align-[-2px] text-brand-600" title="Likely customer (bought / logged in)" />}
                  </td>
                  <td className="px-3 py-2">
                    {c.company || <span className="text-gray-300">—</span>}
                    {c.possible_customer_match && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-brand-600 bg-brand-50 rounded px-1 py-0.5"
                            title={`Already an app customer: ${c.possible_customer_match.company_name}`}>
                        <Link2 size={10} /> in app
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.email}
                    {c.role_address && <span className="ml-1 text-[10px] text-gray-400" title="Role address (info@, sales@…)">role</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.country || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {c.audiences.map(a => (
                        <span key={a} className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${AUD_STYLE[a] || 'bg-gray-100 text-gray-500'}`}>{a}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {sortTags(c.tags).slice(0, 5).map(t => (
                        <span key={t} className={`inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 ${
                          isCategoryTag(t) ? 'text-teal-700 bg-teal-100 font-medium' : 'text-gray-600 bg-gray-100'
                        }`}>
                          <Tag size={9} />{t}
                        </span>
                      ))}
                      {c.tags.length > 5 && <span className="text-[10px] text-gray-400">+{c.tags.length - 5}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={c.review_status}
                      onChange={e => setReviewStatus(c.id, e.target.value)}
                      className={`text-xs bg-transparent border-0 focus:ring-0 cursor-pointer ${REVIEW_STYLE[c.review_status] || ''}`}
                    >
                      {MC_REVIEW.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(c)} title="Edit contact"
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 hover:underline">
                      <Pencil size={13} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-gray-400">
                  <AlertCircle size={32} strokeWidth={1.25} className="mx-auto mb-2 text-gray-300" />
                  No contacts match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Click <strong>Edit</strong> (or a contact’s name) to change their details; tick rows to delete in bulk. The suppressed list
        (unsubscribed / bounced) is retained for reference only and must never be emailed.
      </p>
    </div>
  )
}
