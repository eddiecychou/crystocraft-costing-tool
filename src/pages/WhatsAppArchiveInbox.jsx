import { useEffect, useState } from 'react'
import { collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useMarketingContacts, contactName } from '../domain/marketingContact'

const ACCOUNT_LABEL = { business: 'WhatsApp Business', personal: 'Personal WhatsApp' }

const errorMessage = error => error?.code === 'permission-denied'
  ? 'The archive inbox is waiting for its Firestore rules to be deployed.'
  : (error?.message || 'The archive inbox could not be loaded.')

const asDate = value => value?.toDate?.() || (value ? new Date(value) : null)
const formatDateTime = value => {
  const date = asDate(value)
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-HK', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not recorded'
}

export default function WhatsAppArchiveInbox({ customers = [] }) {
  const { contacts = [] } = useMarketingContacts()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const snap = await getDocs(collection(db, 'whatsapp_archive_inbox'))
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  const pending = rows.filter(row => row.status === 'pending')
  const checkpoints = rows.filter(row => row.status !== 'pending' && row.last_message_at)
    .sort((a, b) => (asDate(b.source_file_modified_at)?.getTime() || 0) - (asDate(a.source_file_modified_at)?.getTime() || 0))
  const approve = async (row, mapping) => {
    setSaving(row.id)
    setError('')
    try {
      const batch = writeBatch(db)
      batch.set(doc(db, 'whatsapp_archive_mappings', row.id), { file: row.file, archive_key: row.archive_key, channel: ACCOUNT_LABEL[row.account] || row.account, approved: true, approved_at: serverTimestamp(), ...mapping })
      batch.set(doc(db, 'whatsapp_archive_inbox', row.id), { status: 'mapped', mapping_type: mapping.type, mapped_at: serverTimestamp(), updated_at: serverTimestamp() }, { merge: true })
      await batch.commit()
      await load()
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving('')
    }
  }
  if (loading) return <div className="card p-6 text-sm text-ink-60">Loading unassigned archives…</div>
  return <div className="space-y-8">
    <section className="space-y-4"><div><h2 className="eyebrow">Unassigned archive files</h2><p className="text-sm text-ink-60 mt-1 max-w-2xl">Review each new folder export once. The saved decision is reused only for the same account and filename; nothing is matched by a name guess.</p></div>{error && <div className="card p-4 border-brand-200 bg-brand-50"><p className="text-sm text-brand-700">{error}</p><button type="button" className="btn-secondary text-xs mt-3" onClick={load}>Try again</button></div>}{!error && pending.length === 0 ? <div className="card p-6 text-sm text-ink-60">No unassigned archives. Put a future ZIP in the Business or Personal archive folder, then run “Sync WhatsApp Archives Now” from the Desktop.</div> : pending.map(row => <InboxRow key={row.id} row={row} customers={customers} contacts={contacts} saving={saving === row.id} onApprove={approve} />)}</section>
    {!error && <ArchiveCheckpoints rows={checkpoints} customers={customers} contacts={contacts} />}
  </div>
}

function ArchiveCheckpoints({ rows, customers, contacts }) {
  const targetName = row => {
    if (row.mapping_type === 'lead') {
      const lead = contacts.find(item => item.id === row.lead_id)
      return (lead ? contactName(lead) : '') || row.suggested_name
    }
    const customer = customers.find(item => item.id === row.customer_id)
    if (row.mapping_type === 'group') return `${row.group_name || row.suggested_name}${customer?.company_name ? ` · ${customer.company_name}` : ''}`
    const person = customer?.contacts?.find(item => item.id === row.contact_id)?.name
    return [person || row.suggested_name, customer?.company_name].filter(Boolean).join(' · ')
  }
  return <section className="space-y-4">
    <div><h2 className="eyebrow">Export checkpoints</h2><p className="text-sm text-ink-60 mt-1 max-w-3xl">In WhatsApp, check for messages after <span className="text-ink">Newest message saved</span>. Re-export only chats with newer activity; replacing the ZIP updates this checkpoint on the next Desktop sync.</p></div>
    {rows.length === 0 ? <div className="card p-6 text-sm text-ink-60">Run “Sync WhatsApp Archives Now” once to record the current ZIP dates and newest saved messages.</div> : <div className="card overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-warm-grey">{['Conversation', 'Account', 'Newest message saved', 'ZIP placed or replaced', 'Last OC sync'].map(label => <th key={label} className="label px-4 py-3">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b border-warm-grey last:border-b-0"><td className="px-4 py-3"><p className="text-sm text-ink">{targetName(row) || row.file}</p><p className="text-xs text-ink-60 mt-1">{row.message_count || 0} messages</p></td><td className="px-4 py-3 text-sm text-ink-60">{ACCOUNT_LABEL[row.account] || row.account}</td><td className="px-4 py-3 text-sm text-ink">{formatDateTime(row.last_message_at)}</td><td className="px-4 py-3 text-sm text-ink-60">{formatDateTime(row.source_file_modified_at)}</td><td className="px-4 py-3 text-sm text-ink-60">{formatDateTime(row.imported_at || row.updated_at)}</td></tr>)}</tbody></table></div>}
  </section>
}

function InboxRow({ row, customers, contacts, saving, onApprove }) {
  const [type, setType] = useState('customer'); const [customerId, setCustomerId] = useState(''); const [contactId, setContactId] = useState(''); const [leadId, setLeadId] = useState(''); const [groupName, setGroupName] = useState(row.suggested_name || '')
  const customer = customers.find(item => item.id === customerId); const account = ACCOUNT_LABEL[row.account] || row.account || 'Unknown account'
  const ready = type === 'customer' ? Boolean(customerId && contactId) : type === 'lead' ? Boolean(leadId) : Boolean(customerId && groupName.trim())
  const mapping = type === 'customer' ? { type, customerId, contactId } : type === 'lead' ? { type, leadId } : { type, customerId, groupName: groupName.trim() }
  return <section className="card p-4 space-y-4"><div className="flex gap-3"><div className="flex-1 min-w-0 break-words"><p className="text-sm font-medium text-ink">{row.file}</p><p className="text-xs text-ink-60 mt-1">{row.suggested_name || 'No display name'} · {row.message_count || 0} messages</p></div><span className="badge shrink-0">{account}</span></div><div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center"><label className="label mb-0">File as</label><select className="input text-sm" value={type} onChange={event => setType(event.target.value)}><option value="customer">Customer contact</option><option value="lead">Marketing lead</option><option value="group">Customer group</option></select></div>{type === 'customer' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><select className="input text-sm" value={customerId} onChange={event => { setCustomerId(event.target.value); setContactId('') }}><option value="">Choose customer…</option>{customers.map(item => <option key={item.id} value={item.id}>{item.company_name}</option>)}</select><select className="input text-sm" value={contactId} disabled={!customerId} onChange={event => setContactId(event.target.value)}><option value="">Choose contact…</option>{(customer?.contacts || []).map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>}{type === 'lead' && <select className="input text-sm" value={leadId} onChange={event => setLeadId(event.target.value)}><option value="">Choose marketing lead…</option>{contacts.map(item => <option key={item.id} value={item.id}>{contactName(item)}</option>)}</select>}{type === 'group' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><select className="input text-sm" value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Choose customer…</option>{customers.map(item => <option key={item.id} value={item.id}>{item.company_name}</option>)}</select><input className="input text-sm" value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Group name" /></div>}<div className="flex items-center justify-between gap-3 pt-1"><p className="text-xs text-ink-60">This approval enables the next daily or Desktop sync; it does not import immediately.</p><button className="btn-primary shrink-0 text-xs px-3 py-2" disabled={!ready || saving} onClick={() => onApprove(row, mapping)}>{saving ? 'Saving…' : 'Approve mapping'}</button></div></section>
}
