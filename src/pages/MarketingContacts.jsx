import { useMemo, useState } from 'react'
import { Users, Mail, MailX, UserCheck, Link2, Tag, Tags, AlertCircle, Download, Trash2, X, Pencil, UserPlus } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import {
  useMarketingContacts, saveContact, deleteContact, deleteContacts,
  contactName, MC_CATEGORIES, MC_STATUSES, MC_AUDIENCES, isCategoryTag, sortTags,
  promoteContactsToCustomers, tagCounts, renameTagEverywhere, deleteTagEverywhere,
  linkContactToCustomer, unlinkContactFromCustomer,
} from '../domain/marketingContact'
import { useCustomers, customerName } from '../domain/customer'
import { CustomerPicker } from './CustomerAccounts'

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
const DISPLAY_CAP = 300

// Plain when there's nothing to filter to (Total, Suppressed); a button when
// `onClick` is given, so a stat can double as a quick filter — click again
// (active=true) to clear it.
function Stat({ Icon, label, value, tone = 'text-gray-900', onClick, active }) {
  const Tag_ = onClick ? 'button' : 'div'
  return (
    <Tag_
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card px-4 py-3 flex items-center gap-3 text-left w-full ${onClick ? 'hover:border-brand-300 hover:bg-brand-50/30 transition-colors cursor-pointer' : ''} ${active ? 'ring-2 ring-brand-400 border-brand-300' : ''}`}
      title={onClick ? (active ? 'Click to clear this filter' : 'Click to filter to these') : undefined}
    >
      <Icon size={20} className="text-brand-600 shrink-0" />
      <div>
        <div className={`text-lg font-bold leading-none ${tone}`}>{value.toLocaleString()}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
    </Tag_>
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
function EditContactModal({ contact, customers, onClose, onSaved, onLinked, onDeleted }) {
  const [f, setF] = useState({
    first_name: contact.first_name, last_name: contact.last_name, email: contact.email,
    company: contact.company, country: contact.country, phone: contact.phone,
    status: contact.status, audiences: contact.audiences,
    is_customer: contact.is_customer,
    tags: contact.tags.join(', '), app_notes: contact.app_notes,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Kept separate from `f` (and from saveContact's patch shape) — linking is
  // its own immediate write via linkContactToCustomer/unlinkContactFromCustomer,
  // not deferred to the Save button, same as AccountEdit.jsx's customer link.
  // OPTIMISTIC: the link is a direct Firestore write (not a Netlify call, so
  // it carries raw write latency), and this modal is a full-screen overlay
  // that hides the list row behind it — without an instant local update the
  // link read as "nothing happened, better refresh." So the UI updates the
  // moment you pick, then reconciles/reverts if the write actually fails.
  const [match, setMatch] = useState(contact.possible_customer_match || null)
  const [linkState, setLinkState] = useState(null)   // null | 'saving' | 'saved'
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const toggleAudience = a => setF(s => ({
    ...s, audiences: s.audiences.includes(a) ? s.audiences.filter(x => x !== a) : [...s.audiences, a],
  }))

  async function doLink(customerId) {
    if (!customerId) { doUnlink(); return }   // picker's built-in clear passes ''
    const c = customers.find(x => x.id === customerId)
    const prev = match
    const newMatch = { customer_id: customerId, company_name: customerName(c) }
    setMatch(newMatch); setF(s => ({ ...s, is_customer: true }))   // optimistic
    onLinked(contact.id, { possible_customer_match: newMatch, is_customer: true })
    setLinkState('saving'); setError('')
    try {
      await linkContactToCustomer(contact.id, customerId, customerName(c))
      setLinkState('saved'); setTimeout(() => setLinkState(s => s === 'saved' ? null : s), 2000)
    } catch (e) {
      setMatch(prev)                                               // revert on failure
      onLinked(contact.id, { possible_customer_match: prev })
      setLinkState(null); setError(e.message || 'Could not link this contact.')
    }
  }
  async function doUnlink() {
    const prev = match
    setMatch(null)                                                 // optimistic
    onLinked(contact.id, { possible_customer_match: null })
    setLinkState('saving'); setError('')
    try {
      await unlinkContactFromCustomer(contact.id)
      setLinkState('saved'); setTimeout(() => setLinkState(s => s === 'saved' ? null : s), 2000)
    } catch (e) {
      setMatch(prev)
      onLinked(contact.id, { possible_customer_match: prev })
      setLinkState(null); setError(e.message || 'Could not unlink this contact.')
    }
  }

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
          <div className="block">
            <span className="text-xs text-gray-500">Audience</span>
            {/* A website signup defaults to ['website'] but that's a source,
                not a classification — it can genuinely be trade, retail, or
                both, and needs sorting into the right one. */}
            <div className="flex gap-3 mt-1">
              {MC_AUDIENCES.map(a => (
                <label key={a} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={f.audiences.includes(a)} onChange={() => toggleAudience(a)}
                         className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  {a}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">Tags (comma-separated)</span>
            <input className="input w-full mt-0.5" value={f.tags} onChange={set('tags')} placeholder="distributor, exhibition contact" />
            <span className="text-[11px] text-gray-400">Category tags ({MC_CATEGORIES.slice(0, 5).join(', ')}…) show highlighted.</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={f.is_customer} onChange={set('is_customer')}
                   className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            Likely customer
          </label>
          <div className="block border-t border-gray-100 pt-3">
            <span className="text-xs text-gray-500">Linked app customer</span>
            <p className="text-[11px] text-gray-400 mb-1.5">
              {match ? `Currently linked to "${match.company_name}".` : 'Not linked — pick a customer if you know this contact is already in the app.'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <CustomerPicker customers={customers} value={match?.customer_id || ''} onChange={doLink} />
              {linkState === 'saving' && <span className="text-[11px] text-gray-400">Saving…</span>}
              {linkState === 'saved' && <span className="text-[11px] text-green-600">Saved ✓</span>}
            </div>
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

// Bulk tag cleanup — the Mailchimp import left tags genuinely chaotic (one-off
// variants, near-duplicates like "personal network" vs "personal contact").
// Editing one contact at a time can't fix that; this renames/merges or
// removes a tag across every contact carrying it in one action.
function TagManagerModal({ contacts, onClose, onApplied }) {
  const [q, setQ] = useState('')
  const [edits, setEdits] = useState({})
  const [busyTag, setBusyTag] = useState(null)
  const counts = useMemo(() => tagCounts(contacts), [contacts])
  const shown = counts.filter(([t]) => t.includes(q.toLowerCase().trim()))

  async function handleRename(tag) {
    const to = (edits[tag] ?? tag).trim().toLowerCase()
    if (!to || to === tag) return
    setBusyTag(tag)
    try {
      const n = await renameTagEverywhere(contacts, tag, to)
      onApplied({ type: 'rename', from: tag, to, count: n })
      setEdits(s => { const n2 = { ...s }; delete n2[tag]; return n2 })
    } catch (e) {
      window.alert(e.message || 'Rename failed.')
    } finally {
      setBusyTag(null)
    }
  }

  async function handleDelete(tag, count) {
    if (!window.confirm(`Remove tag "${tag}" from ${count} contact${count === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBusyTag(tag)
    try {
      const n = await deleteTagEverywhere(contacts, tag)
      onApplied({ type: 'delete', tag, count: n })
    } catch (e) {
      window.alert(e.message || 'Delete failed.')
    } finally {
      setBusyTag(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Manage tags</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="px-5 pt-3">
          <input type="text" placeholder="Search tags…" className="input w-full" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="p-5 space-y-2 max-h-[65vh] overflow-auto">
          {shown.map(([tag, count]) => (
            <div key={tag} className="flex items-center gap-2">
              <span className={`shrink-0 w-8 text-center text-[10px] rounded px-1 py-0.5 ${isCategoryTag(tag) ? 'text-teal-700 bg-teal-100 font-medium' : 'text-gray-600 bg-gray-100'}`}>
                {count}
              </span>
              <input
                className="input flex-1 text-sm"
                value={edits[tag] ?? tag}
                onChange={e => setEdits(s => ({ ...s, [tag]: e.target.value }))}
              />
              <button onClick={() => handleRename(tag)} disabled={busyTag === tag || (edits[tag] ?? tag) === tag}
                className="btn-secondary text-xs shrink-0 disabled:opacity-50"
                title="Rename — merges into an existing tag instead of duplicating it">
                {busyTag === tag ? '…' : 'Rename'}
              </button>
              <button onClick={() => handleDelete(tag, count)} disabled={busyTag === tag}
                className="text-red-600 hover:text-red-700 shrink-0 disabled:opacity-50" title={`Remove from all ${count} contacts`}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {shown.length === 0 && <div className="text-sm text-gray-400 text-center py-8">No tags match.</div>}
        </div>
        <p className="px-5 pb-4 text-[11px] text-gray-400">
          Renaming to a tag that already exists on some of these contacts merges the two — no duplicates.
        </p>
      </div>
    </div>
  )
}

export default function MarketingContacts() {
  const { contacts, loading, setContacts } = useMarketingContacts()
  const { customers } = useCustomers()
  const [search, setSearch] = useState('')
  const [audience, setAudience] = useState('')
  const [status, setStatus] = useState('subscribed')  // default to the emailable list
  // Whether the contact is actually linked to a real app Customer record
  // (possible_customer_match) — NOT the softer is_customer flag, which used
  // to drive a "Customer + prospect" filter the owner found too vague:
  // "I only need to know if this contact is in the app or not."
  const [inApp, setInApp] = useState('')              // '', 'yes', 'no'
  const [category, setCategory] = useState('')
  const [country, setCountry] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [managingTags, setManagingTags] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const countries = useMemo(() => {
    const c = new Map()
    for (const x of contacts) if (x.country) c.set(x.country, (c.get(x.country) || 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [contacts])

  // Real tags with counts, not the fixed MC_CATEGORIES subset — that list
  // only ever covered the "promoted for filtering" handful and hid every
  // one-off tag the Mailchimp import left behind.
  const tagOptions = useMemo(() => tagCounts(contacts), [contacts])

  const stats = useMemo(() => ({
    total: contacts.length,
    emailable: contacts.filter(c => c.emailable).length,
    suppressed: contacts.filter(c => c.status === 'unsubscribed' || c.status === 'cleaned').length,
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
      if (inApp === 'yes' && !c.possible_customer_match) return false
      if (inApp === 'no' && c.possible_customer_match) return false
      if (category && !c.tags.includes(category)) return false
      if (country && c.country !== country) return false
      return true
    })
  }, [contacts, search, audience, status, inApp, category, country])

  const shown = filtered.slice(0, DISPLAY_CAP)
  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.id))

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
  // Link/unlink is an immediate write (see EditContactModal's doLink/doUnlink)
  // — reflects into local state WITHOUT closing the modal, unlike applySaved,
  // so the admin can keep editing other fields right after linking.
  function applyLinked(id, patch) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  // Reflect a tag rename/delete already committed in Firestore (see
  // TagManagerModal) into local state, so the list updates without a full
  // reload. Also clears the category filter if it was pointed at a tag that
  // just changed underneath it.
  function applyTagChange(change) {
    const target = change.type === 'rename' ? change.from : change.tag
    setContacts(prev => prev.map(c => {
      if (!c.tags.includes(target)) return c
      const tags = change.type === 'rename'
        ? [...new Set(c.tags.map(t => (t === change.from ? change.to : t)))]
        : c.tags.filter(t => t !== change.tag)
      return { ...c, tags }
    }))
    setCategory(cat => (cat === target ? '' : cat))
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} contact${ids.length === 1 ? '' : 's'} permanently? This cannot be undone.`)) return
    try { await deleteContacts(ids); removeLocal(ids) }
    catch (e) { window.alert(e.message || 'Bulk delete failed.') }
  }

  // Create a real app Customer for each selected contact that isn't already
  // linked to one (already-matched contacts are skipped, not duplicated).
  async function bulkPromote() {
    const ids = [...selected]
    if (!ids.length) return
    const rows = contacts.filter(c => ids.includes(c.id))
    const already = rows.filter(c => c.possible_customer_match).length
    const toAdd = rows.length - already
    if (!toAdd) { window.alert('All selected contacts are already linked to an app customer.'); return }
    if (!window.confirm(
      `Add ${toAdd} contact${toAdd === 1 ? '' : 's'} as new Customers in the app?` +
      (already ? ` (${already} already linked — will be skipped.)` : '')
    )) return
    setPromoting(true)
    try {
      const { created, skipped } = await promoteContactsToCustomers(rows)
      const byId = new Map(created.map(r => [r.contactId, r]))
      setContacts(prev => prev.map(c => byId.has(c.id)
        ? { ...c, is_customer: true, possible_customer_match: { customer_id: byId.get(c.id).customerId, company_name: byId.get(c.id).companyName } }
        : c))
      setSelected(new Set())
      window.alert(`Added ${created.length} customer${created.length === 1 ? '' : 's'}.` +
        (skipped.length ? ` ${skipped.length} skipped (already linked).` : ''))
    } catch (e) {
      window.alert(e.message || 'Could not add customers.')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      {editing && (
        <EditContactModal contact={editing} customers={customers} onClose={() => setEditing(null)}
          onSaved={applySaved} onLinked={applyLinked} onDeleted={removeLocal} />
      )}
      {managingTags && (
        <TagManagerModal contacts={contacts} onClose={() => setManagingTags(false)} onApplied={applyTagChange} />
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
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setManagingTags(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Tags size={15} /> Manage tags
          </button>
          <button onClick={() => exportCsv(filtered)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Download size={15} /> Export view
          </button>
        </div>
      </div>

      {/* Segment summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
        <Stat Icon={Users}     label="Total contacts"          value={stats.total} />
        <Stat Icon={Mail}      label="Emailable (subscribed)"  value={stats.emailable} tone="text-green-700" />
        <Stat Icon={MailX}     label="Suppressed — never email" value={stats.suppressed} tone="text-amber-700" />
        <Stat Icon={Link2}     label="In the app"              value={stats.matched}
              active={inApp === 'yes'} onClick={() => setInApp(v => v === 'yes' ? '' : 'yes')} />
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
          {/* Whether the contact is actually linked to a real app Customer
              record (possible_customer_match) — replaces the old "Customer +
              prospect" dropdown, which filtered on the softer is_customer
              flag and the owner found too vague. */}
          <select className="input flex-1 min-w-[110px]" value={inApp} onChange={e => setInApp(e.target.value)}>
            <option value="">In app: any</option>
            <option value="yes">In app</option>
            <option value="no">Not in app</option>
          </select>
          <select className="input flex-1 min-w-[130px]" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All tags</option>
            {tagOptions.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
          </select>
          <select className="input flex-1 min-w-[110px]" value={country} onChange={e => setCountry(e.target.value)}>
            <option value="">All countries</option>
            {countries.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Count + bulk bar */}
      <div className="flex items-center justify-between mb-2 min-h-[28px] flex-wrap gap-2">
        <p className="text-xs text-gray-500 flex items-center gap-2">
          {filtered.length.toLocaleString()} match{filtered.length === 1 ? '' : 'es'}
          {filtered.length > DISPLAY_CAP && ` — showing first ${DISPLAY_CAP}, refine to narrow`}
          {inApp === 'yes' && (
            <span className="inline-flex items-center gap-1 text-brand-600 bg-brand-50 rounded-full px-2 py-0.5">
              in the app
              <button onClick={() => setInApp('')} className="hover:text-brand-800"><X size={11} /></button>
            </span>
          )}
        </p>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
            <button onClick={bulkPromote} disabled={promoting}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 border border-brand-200 rounded-md px-2 py-1 disabled:opacity-50">
              <UserPlus size={13} /> {promoting ? 'Adding…' : 'Add to Customers'}
            </button>
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
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(c)} title="Edit contact"
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 hover:underline">
                      <Pencil size={13} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">
                  <AlertCircle size={32} strokeWidth={1.25} className="mx-auto mb-2 text-gray-300" />
                  No contacts match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Click <strong>Edit</strong> (or a contact’s name) to change their details; tick rows to delete in bulk or add them as
        Customers. The two stat tiles above are filters too — click one to narrow the list. The suppressed list
        (unsubscribed / bounced) is retained for reference only and must never be emailed.
      </p>
    </div>
  )
}
