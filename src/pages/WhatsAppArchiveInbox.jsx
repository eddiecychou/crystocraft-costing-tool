import { useEffect, useState } from 'react'
import { collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useMarketingContacts, contactName } from '../domain/marketingContact'

const ACCOUNT_LABEL = { business: 'WhatsApp Business', personal: 'Personal WhatsApp' }

const errorMessage = error => error?.code === 'permission-denied'
  ? 'The archive inbox is waiting for its Firestore rules to be deployed.'
  : (error?.message || 'The archive inbox could not be loaded.')

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
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(row => row.status === 'pending'))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
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
  return <div className="space-y-4"><div><h2 className="eyebrow">Unassigned archive files</h2><p className="text-sm text-ink-60 mt-1 max-w-2xl">Review each new folder export once. The saved decision is reused only for the same account and filename; nothing is matched by a name guess.</p></div>{error && <div className="card p-4 border-brand-200 bg-brand-50"><p className="text-sm text-brand-700">{error}</p><button type="button" className="btn-secondary text-xs mt-3" onClick={load}>Try again</button></div>}{!error && rows.length === 0 ? <div className="card p-6 text-sm text-ink-60">No unassigned archives. Put a future ZIP in the Business or Personal archive folder, then run “Sync WhatsApp Archives Now” from the Desktop.</div> : rows.map(row => <InboxRow key={row.id} row={row} customers={customers} contacts={contacts} saving={saving === row.id} onApprove={approve} />)}</div>
}

function InboxRow({ row, customers, contacts, saving, onApprove }) {
  const [type, setType] = useState('customer'); const [customerId, setCustomerId] = useState(''); const [contactId, setContactId] = useState(''); const [leadId, setLeadId] = useState(''); const [groupName, setGroupName] = useState(row.suggested_name || '')
  const customer = customers.find(item => item.id === customerId); const account = ACCOUNT_LABEL[row.account] || row.account || 'Unknown account'
  const ready = type === 'customer' ? Boolean(customerId && contactId) : type === 'lead' ? Boolean(leadId) : Boolean(customerId && groupName.trim())
  const mapping = type === 'customer' ? { type, customerId, contactId } : type === 'lead' ? { type, leadId } : { type, customerId, groupName: groupName.trim() }
  return <section className="card p-4 space-y-4"><div className="flex gap-3"><div className="flex-1 min-w-0 break-words"><p className="text-sm font-medium text-ink">{row.file}</p><p className="text-xs text-ink-60 mt-1">{row.suggested_name || 'No display name'} · {row.message_count || 0} messages</p></div><span className="badge shrink-0">{account}</span></div><div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center"><label className="label mb-0">File as</label><select className="input text-sm" value={type} onChange={event => setType(event.target.value)}><option value="customer">Customer contact</option><option value="lead">Marketing lead</option><option value="group">Customer group</option></select></div>{type === 'customer' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><select className="input text-sm" value={customerId} onChange={event => { setCustomerId(event.target.value); setContactId('') }}><option value="">Choose customer…</option>{customers.map(item => <option key={item.id} value={item.id}>{item.company_name}</option>)}</select><select className="input text-sm" value={contactId} disabled={!customerId} onChange={event => setContactId(event.target.value)}><option value="">Choose contact…</option>{(customer?.contacts || []).map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>}{type === 'lead' && <select className="input text-sm" value={leadId} onChange={event => setLeadId(event.target.value)}><option value="">Choose marketing lead…</option>{contacts.map(item => <option key={item.id} value={item.id}>{contactName(item)}</option>)}</select>}{type === 'group' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><select className="input text-sm" value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Choose customer…</option>{customers.map(item => <option key={item.id} value={item.id}>{item.company_name}</option>)}</select><input className="input text-sm" value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Group name" /></div>}<div className="flex items-center justify-between gap-3 pt-1"><p className="text-xs text-ink-60">This approval enables the next daily or Desktop sync; it does not import immediately.</p><button className="btn-primary shrink-0 text-xs px-3 py-2" disabled={!ready || saving} onClick={() => onApprove(row, mapping)}>{saving ? 'Saving…' : 'Approve mapping'}</button></div></section>
}
