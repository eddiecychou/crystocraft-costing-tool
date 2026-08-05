import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  doc, getDoc, deleteDoc, updateDoc, collection, query, where, orderBy, getDocs,
  onSnapshot, deleteDoc as deleteDocument, serverTimestamp,
} from 'firebase/firestore'
import { db, storage } from '../firebase'
import { ref as storageRef, deleteObject } from 'firebase/storage'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import EnquiryForm from './EnquiryForm'
import CustomerBrandGallery from '../components/CustomerBrandGallery'
import { Star, AlertTriangle, FileText, Sparkle, Check, RotateCcw, Package, X } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'
import { loadBlogProducts } from '../productSource'
import { normalizeCustomer, loadCustomers, previewCustomerMerge, mergeCustomers } from '../domain/customer'

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && typeof val === 'string') return [val]
  return []
}

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

const ENQUIRY_STATUS_STYLES = {
  Open:      'bg-amber-100 text-amber-700',
  Quoted:    'bg-blue-100 text-blue-700',
  Confirmed: 'bg-green-100 text-green-700',
  Lost:      'bg-red-100 text-red-600',
  'On Hold': 'bg-gray-100 text-gray-500',
  // Legacy statuses (no longer offered) — kept so old records still render
  Won:            'bg-green-100 text-green-700',
  Completed:      'bg-teal-100 text-teal-700',
  'In Production':'bg-purple-100 text-purple-700',
}

const ENQUIRY_STATUS_DOT = {
  Open:      'bg-amber-400',
  Quoted:    'bg-blue-500',
  Confirmed: 'bg-green-500',
  Lost:      'bg-red-500',
  'On Hold': 'bg-gray-400',
  Won:            'bg-green-500',
  Completed:      'bg-teal-500',
  'In Production':'bg-purple-500',
}

// Portal enquiry status (top-level `enquiries` collection from the storefront).
const PORTAL_STATUS_STYLES = {
  new:      'bg-amber-100 text-amber-700',
  handled:  'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
}

function fmtMoney(n, cur) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return `${cur || ''} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}

// Terminal statuses → sorted into "History" below the active pipeline.
// Confirmed = won (now an Order); Completed/Won kept for legacy records.
const RESOLVED_STATUSES = ['Confirmed', 'Won', 'Completed', 'Lost']

const CRM_STATUS_STYLES = {
  Active:   'bg-green-100 text-green-700',
  Prospect: 'bg-blue-100 text-blue-700',
  Dormant:  'bg-amber-100 text-amber-700',
  Inactive: 'bg-gray-100 text-gray-500',
}

const CHANNEL_BADGE = {
  'Email':             'bg-purple-100 text-purple-700',
  'WhatsApp Business': 'bg-green-100 text-green-700',
  'Alibaba':           'bg-orange-100 text-orange-700',
  'Personal WhatsApp': 'bg-amber-100 text-amber-700',
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const MERGE_FIELD_LABELS = {
  contact_name: 'contact name', website: 'website', address: 'address', country: 'country',
  crm_category: 'type', crm_status: 'status', source: 'source', segment: 'segment',
  erp_code: 'ERP code', notes: 'notes', folder_path: 'folder',
  contact_emails: 'email(s)', contact_phones: 'phone(s)', contact_whatsapps: 'WhatsApp(s)',
  contact_wechats: 'WeChat(s)', tags: 'tags', channels: 'channels',
  is_vip: 'VIP flag', is_personal_wa: 'personal-WhatsApp flag',
}

// Merges `customer` into another record you pick — the survivor's data wins,
// this record's blanks-only fields fill in, and this record is deleted once
// its orders/quotes/portal-accounts have moved. See domain/customer.js for the
// actual merge rule.
function MergeCustomerModal({ customer, onClose, onMerged }) {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [survivorId, setSurvivorId] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadCustomers().then(setCustomers) }, [])

  useEffect(() => {
    if (!survivorId) { setPreview(null); return }
    let alive = true
    setError(''); setPreviewing(true)
    previewCustomerMerge(customer.id, survivorId)
      .then(p => { if (alive) setPreview(p) })
      .catch(e => { if (alive) setError(e.message || 'Could not load a preview.') })
      .finally(() => { if (alive) setPreviewing(false) })
    return () => { alive = false }
  }, [survivorId, customer.id])

  const results = search
    ? customers.filter(c => c.id !== customer.id && c.company_name.toLowerCase().includes(search.toLowerCase())).slice(0, 20)
    : []

  async function confirm() {
    setBusy(true); setError('')
    try {
      await mergeCustomers(customer.id, survivorId)
      onMerged(survivorId)
    } catch (e) {
      setError(e.message || 'Merge failed.'); setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Merge “{customer.company_name}” into…</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          <label className="block">
            <span className="text-xs text-gray-500">The surviving record — search by company name</span>
            <input className="input w-full mt-0.5" placeholder="Search customers…" value={search}
              onChange={e => { setSearch(e.target.value); setSurvivorId('') }} autoFocus />
          </label>
          {search && !survivorId && (
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">No match.</p>
              ) : results.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setSurvivorId(c.id); setSearch(c.company_name) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  {c.company_name} {c.country && <span className="text-gray-400">— {c.country}</span>}
                </button>
              ))}
            </div>
          )}

          {previewing && <p className="text-xs text-gray-400">Checking what would move…</p>}

          {preview && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 space-y-1.5">
              <p>
                <strong>{preview.ordersCount}</strong> order{preview.ordersCount === 1 ? '' : 's'},{' '}
                <strong>{preview.quotesCount}</strong> quote{preview.quotesCount === 1 ? '' : 's'}, and{' '}
                <strong>{preview.accountsCount}</strong> portal account{preview.accountsCount === 1 ? '' : 's'} will move to{' '}
                <strong>{preview.survivor.company_name}</strong>.
              </p>
              {(preview.assetsCount > 0 || preview.interactionsCount > 0 || preview.brandedImagesCount > 0) && (
                <p>
                  {[
                    preview.interactionsCount > 0 && `${preview.interactionsCount} interaction log entr${preview.interactionsCount === 1 ? 'y' : 'ies'}`,
                    preview.assetsCount > 0 && `${preview.assetsCount} Brand Gallery asset${preview.assetsCount === 1 ? '' : 's'}`,
                    preview.brandedImagesCount > 0 && `${preview.brandedImagesCount} "branded for" product photo tag${preview.brandedImagesCount === 1 ? '' : 's'}`,
                  ].filter(Boolean).join(', ')} will also move to <strong>{preview.survivor.company_name}</strong>.
                </p>
              )}
              <p className="text-xs text-amber-800">
                {Object.keys(preview.fieldsToFill).length > 0
                  ? <>{preview.survivor.company_name} will gain: {Object.keys(preview.fieldsToFill).map(f => MERGE_FIELD_LABELS[f] || f).join(', ')} — nothing it already has is overwritten.</>
                  : <>No fields to fill in — the surviving record already has everything this one does.</>}
              </p>
              <p className="text-xs text-amber-700 font-medium">
                “{customer.company_name}” will be deleted once merged. This cannot be undone.
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">Cancel</button>
          <button onClick={confirm} disabled={busy || !preview} className="btn-danger text-sm">
            {busy ? 'Merging…' : 'Merge & Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [customer, setCustomer]         = useState(null)
  const [quotes, setQuotes]             = useState([])
  const [orders, setOrders]             = useState([])
  const [accounts, setAccounts]         = useState([])
  const [enquiries, setEnquiries]       = useState([])
  const [portalEnquiries, setPortalEnquiries] = useState([])
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteEnquiry, setConfirmDeleteEnquiry] = useState(null)
  const [merging, setMerging] = useState(false)
  const remember = useScrollMemory(`customer-${id}`, !loading)

  // Enquiry form state
  const [enquiryFormOpen, setEnquiryFormOpen] = useState(false)
  const [editingEnquiry, setEditingEnquiry]   = useState(null)
  const [removingAtt, setRemovingAtt]         = useState(null) // `${enquiryId}-${attIdx}`

  // Compose message state
  const [composeProduct, setComposeProduct]     = useState(null)   // { id, name, category, description }
  const [composeProductSearch, setComposeProductSearch] = useState('')
  const [composeProductOpen, setComposeProductOpen]     = useState(false)
  const [allProducts, setAllProducts]           = useState([])
  const [composeContext, setComposeContext]      = useState('')
  const [composeChannel, setComposeChannel]     = useState('')
  const [composeResult, setComposeResult]       = useState('')
  const [composeLoading, setComposeLoading]     = useState(false)
  const [composeError, setComposeError]         = useState('')
  const [composeCopied, setComposeCopied]       = useState(false)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'customers', id)),
      getDocs(query(collection(db, 'client_quotes'), where('customer_id', '==', id))),
      getDocs(collection(db, 'products')),
      getDocs(query(collection(db, 'users'), where('customer_id', '==', id))),
      loadBlogProducts('range'),
      getDocs(query(collection(db, 'orders'), where('customer_id', '==', id))),
    ]).then(([cSnap, qSnap, pSnap, uSnap, rangeProducts, oSnap]) => {
      setAccounts(uSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setOrders(
        oSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))
      )
      if (cSnap.exists()) {
        const c = { id: cSnap.id, ...normalizeCustomer(cSnap.data()) }
        setCustomer(c)
        setComposeChannel(c.channels?.[0] || c.primary_channel || '')
      }
      setQuotes(
        qSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      )
      const corporate = pSnap.docs
        .map(d => ({ id: d.id, source: 'corporate', name: d.data().name || '', category: d.data().category || '', description: d.data().description || '' }))
        .filter(p => p.name)
      const range = rangeProducts
        .map(p => ({ id: p.id, source: 'range', name: p.name || '', category: p.category || 'Crystocraft Range', description: p.description || '' }))
        .filter(p => p.name)
      setAllProducts(
        [...corporate, ...range].sort((a, b) => a.name.localeCompare(b.name))
      )
      setLoading(false)
    })
  }, [id])

  // Real-time enquiry listener (no orderBy — sort client-side)
  const [contextAutoFilled, setContextAutoFilled] = useState(false)
  useEffect(() => {
    const q = query(collection(db, 'customers', id, 'enquiries'))
    return onSnapshot(q, snap => {
      const byDateDesc = (a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0)
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Active threads (not yet Completed/Lost) pinned above resolved history,
      // so wrapping up one thread doesn't visually bury a still-open one.
      const active   = all.filter(e => !RESOLVED_STATUSES.includes(e.status)).sort(byDateDesc)
      const resolved = all.filter(e =>  RESOLVED_STATUSES.includes(e.status)).sort(byDateDesc)
      const sorted = [...active, ...resolved]
      setEnquiries(sorted)
      // Auto-fill compose context from latest enquiry (once only)
      if (!contextAutoFilled && sorted.length > 0 && sorted[0].description) {
        setComposeContext(sorted[0].description)
        setContextAutoFilled(true)
      }
    })
  }, [id])

  // Portal enquiries (top-level `enquiries`) submitted by this customer's linked
  // storefront accounts. Real-time, so an enquiry archived or deleted on the
  // admin Enquiries page just drops out here instead of leaving a stale/broken
  // row: archived is filtered out, and deletes vanish from the snapshot. The
  // error callback degrades to an empty list rather than throwing.
  const accountUids = accounts.map(a => a.id).filter(Boolean)
  const accountUidKey = accountUids.join(',')
  useEffect(() => {
    if (!accountUids.length) { setPortalEnquiries([]); return }
    // Firestore `in` allows up to 30 values; linked accounts are far fewer.
    const q = query(collection(db, 'enquiries'), where('uid', 'in', accountUids.slice(0, 30)))
    return onSnapshot(
      q,
      snap => setPortalEnquiries(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(e => (e.status || 'new') !== 'archived')   // archived = handled/dismissed, hide here
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      ),
      () => setPortalEnquiries([]),                           // permission/other error → show none, never crash
    )
  }, [accountUidKey])

  async function handleDelete() {
    await deleteDoc(doc(db, 'customers', id))
    navigate('/customers')
  }

  async function handleDeleteEnquiry(enquiryId) {
    await deleteDocument(doc(db, 'customers', id, 'enquiries', enquiryId))
    setConfirmDeleteEnquiry(null)
  }

  async function handleRemoveAttachment(enq, attIdx) {
    const key = `${enq.id}-${attIdx}`
    setRemovingAtt(key)
    try {
      const atts = enq.attachments?.length
        ? enq.attachments
        : enq.attachment_url ? [{ url: enq.attachment_url, name: enq.attachment_name, path: enq.attachment_path }] : []
      const att = atts[attIdx]
      if (att?.path) { try { await deleteObject(storageRef(storage, att.path)) } catch {} }
      const updated = atts.filter((_, i) => i !== attIdx)
      await updateDoc(doc(db, 'customers', id, 'enquiries', enq.id), {
        attachments: updated,
        attachment_url: null, attachment_name: null, attachment_path: null,
        updatedAt: serverTimestamp(),
      })
    } finally {
      setRemovingAtt(null)
    }
  }

  async function handleCompose(e) {
    e.preventDefault()
    if (!composeContext.trim()) {
      setComposeError('Please describe the situation / what you want to say.')
      return
    }
    setComposeLoading(true)
    setComposeError('')
    setComposeResult('')
    try {
      const res = await fetch('/api/compose-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          product: composeProduct
            ? `${composeProduct.name}${composeProduct.category ? ` (${composeProduct.category})` : ''}${composeProduct.description ? ` — ${composeProduct.description}` : ''}`
            : 'General / Full Catalogue',
          channel: composeChannel,
          context: composeContext,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setComposeResult(data.message)
    } catch (err) {
      setComposeError(err.message || 'Failed to generate message.')
    } finally {
      setComposeLoading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(composeResult).then(() => {
      setComposeCopied(true)
      setTimeout(() => setComposeCopied(false), 2000)
    })
  }

  if (loading) return <LoadingBar />
  if (!customer) return <div className="p-4 text-gray-500">Customer not found.</div>

  const followUpEnquiries = enquiries.filter(e => e.follow_up_date)

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>

      {/* Header */}
      <div className="mb-4 mt-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">{customer.company_name}</h1>
          {customer.erp_code && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{customer.erp_code}</span>
          )}
        </div>
              {customer.is_vip && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold"><Star size={12} className="fill-current" />VIP</span>}
              {customer.crm_status && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CRM_STATUS_STYLES[customer.crm_status] || 'bg-gray-100 text-gray-500'}`}>
                  {customer.crm_status}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{customer.country || customer.region || ''}</p>
            {customer.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customer.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Link to={`/customers/${id}/edit`} onClick={remember} className="btn-secondary text-sm">Edit</Link>
            <button className="btn-secondary text-sm" onClick={() => setMerging(true)}>Merge…</button>
            <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        </div>
      </div>

      {/* Personal WA warning banner */}
      {(customer.is_personal_wa || customer.channels?.includes('Personal WhatsApp')) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            <strong>{customer.contact_name || customer.company_name}</strong> communicates via
            Eddie's <strong>personal WhatsApp</strong> — they will not appear in WhatsApp Business.
          </span>
        </div>
      )}

      {/* Contact info */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Contact Details</h2>
        <dl className="space-y-2">
          {customer.contact_name && <Row label="Contact" value={customer.contact_name} />}
          {toArray(customer.contact_emails ?? customer.contact_email).length > 0 && (
            <Row label="Email" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_emails ?? customer.contact_email).map((e, i) => (
                  <a key={i} href={`mailto:${e}`} className="text-brand-600 hover:underline block">{e}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_phones ?? customer.contact_phone).length > 0 && (
            <Row label="Phone" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_phones ?? customer.contact_phone).map((p, i) => (
                  <a key={i} href={`tel:${p}`} className="text-brand-600 hover:underline block">{p}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_whatsapps ?? customer.whatsapp).length > 0 && (
            <Row label="WhatsApp" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_whatsapps ?? customer.whatsapp).map((w, i) => (
                  <a key={i} href={`https://wa.me/${w.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline block">{w}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_wechats).length > 0 && (
            <Row label="WeChat" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_wechats).map((w, i) => (
                  <span key={i} className="block text-gray-700">{w}</span>
                ))}
              </div>
            } />
          )}
          {customer.website && (
            <Row label="Website" value={
              <a href={customer.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate block">{customer.website.replace(/^https?:\/\//, '')}</a>
            } />
          )}
          {customer.country && <Row label="Country" value={customer.country} />}
          {customer.address && <Row label="Address" value={customer.address} />}
          {/* CRM fields */}
          {customer.crm_category && (
            <Row label="Type" value={
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{customer.crm_category}</span>
            } />
          )}
          {(() => {
            const chs = customer.channels?.length ? customer.channels : customer.primary_channel ? [customer.primary_channel] : []
            return chs.length > 0 ? (
              <Row label="Channels" value={
                <div className="flex flex-wrap gap-1">
                  {chs.map(ch => (
                    <span key={ch} className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHANNEL_BADGE[ch] || 'bg-gray-100 text-gray-600'}`}>
                      {ch}
                    </span>
                  ))}
                </div>
              } />
            ) : null
          })()}
          {customer.source && <Row label="Source" value={customer.source} />}
          {customer.segment && <Row label="Segment" value={customer.segment} />}
          {customer.folder_path && (
            <Row label="Folder" value={
              <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{customer.folder_path}</span>
            } />
          )}
        </dl>
      </div>

      {/* Linked storefront accounts */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Storefront Accounts ({accounts.length})</h2>
        <p className="text-xs text-gray-400 mb-3">Login accounts linked to this customer. Manage links on the Accounts page.</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-400">
            No accounts linked yet. Link one from <Link to="/customer-accounts" className="text-brand-600 hover:underline">Accounts</Link>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="text-gray-800">{a.contact_name || a.company_name || a.email}</span>
                  {a.email && <span className="text-gray-400"> · {a.email}</span>}
                </div>
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                  a.role === 'admin' ? 'bg-purple-100 text-purple-700'
                  : a.status === 'approved' ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'}`}>
                  {a.role === 'admin' ? 'Admin' : a.status === 'approved' ? 'Approved' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {customer.notes && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Notes</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
        </div>
      )}

      {/* PI Orders */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">PI Orders ({orders.length})</h2>
          <Link to={`/shipments/new?customer_id=${id}`} className="btn-primary text-xs py-1.5 px-3">+ New PI</Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No PI orders for this customer.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {orders.map(o => {
              const piNo = o.uc_no || o.erp_pi_no || o.erp_so_no || '—'
              const dateStr = o.order_date
                ? new Date(o.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'
              const statusColour = {
                draft:     'bg-gray-100 text-gray-600',
                confirmed: 'bg-blue-100 text-blue-700',
                shipped:   'bg-amber-100 text-amber-700',
                delivered: 'bg-green-100 text-green-700',
                cancelled: 'bg-red-100 text-red-600',
              }[o.status] || 'bg-gray-100 text-gray-600'
              return (
                <Link key={o.id} to={`/shipments/${o.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Package size={15} className="text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{piNo}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{dateStr}{o.currency ? ` · ${o.currency}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`badge ${statusColour}`}>{o.status || 'draft'}</span>
                    <span className="text-xs text-gray-400">→</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Quote history */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Quotes ({quotes.length})</h2>
          <Link to={`/quotes/new?customer_id=${id}`} onClick={remember} className="btn-primary text-xs py-1.5 px-3">+ New Quote</Link>
        </div>
        {quotes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No quotes yet for this customer.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {quotes.map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} onClick={remember} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {q.quote_date || q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {q.item_count ? `${q.item_count} item${q.item_count > 1 ? 's' : ''}` : 'No items'}
                    {q.quote_currency ? ` · ${q.quote_currency}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge ${STATUS_STYLES[q.status] || STATUS_STYLES.draft}`}>{q.status || 'draft'}</span>
                  <span className="text-xs text-gray-400">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Brand Gallery — customer logos / brand assets (admin-curated) */}
      <CustomerBrandGallery customerId={id} />

      {/* Portal Enquiries (from the storefront) */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Portal Enquiries ({portalEnquiries.length})</h2>
          <Link to="/enquiries" onClick={remember} className="text-xs text-brand-600 hover:underline">Manage →</Link>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No storefront account linked, so portal enquiries can't be matched.{' '}
            <Link to="/customer-accounts" className="text-brand-600 hover:underline">Link one</Link>.
          </p>
        ) : portalEnquiries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No portal enquiries from this customer.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {portalEnquiries.map(e => {
              const items = Array.isArray(e.items) ? e.items : []
              return (
                <div key={e.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs text-gray-500">{fmtDate(e.createdAt)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PORTAL_STATUS_STYLES[e.status || 'new'] || 'bg-gray-100 text-gray-500'}`}>
                      {e.status || 'new'}
                    </span>
                    <span className="text-xs text-gray-400">
                      · {items.length} item{items.length === 1 ? '' : 's'}
                      {e.estimated_total ? ` · est. ${fmtMoney(e.estimated_total, e.currency)}` : ''}
                    </span>
                  </div>
                  {e.message && <p className="text-sm text-gray-800 whitespace-pre-wrap mb-1.5">{e.message}</p>}
                  {items.length > 0 && (
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      {items.slice(0, 6).map((it, i) => (
                        <li key={i} className="truncate">
                          <span className="text-gray-400">{it.qty || 1}×</span>{' '}
                          {it.name || it.code || 'Item'}
                          {it.code && it.name ? <span className="text-gray-400"> ({it.code})</span> : null}
                        </li>
                      ))}
                      {items.length > 6 && <li className="text-gray-400">…and {items.length - 6} more</li>}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Interaction Log */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Interaction Log ({enquiries.length})</h2>
          <button
            onClick={() => { setEditingEnquiry(null); setEnquiryFormOpen(true) }}
            className="btn-primary text-xs py-1.5 px-3"
          >
            + Log Interaction
          </button>
        </div>

        {enquiries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No interactions logged yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {(() => {
              const hasResolved = enquiries.some(e => RESOLVED_STATUSES.includes(e.status))
              const hasActive   = enquiries.some(e => !RESOLVED_STATUSES.includes(e.status))
              const showSections = hasResolved && hasActive
              let printedResolvedHeader = false
              return enquiries.map((enq, i) => {
                const isResolved = RESOLVED_STATUSES.includes(enq.status)
                const showHeader = showSections && ((i === 0 && !isResolved) || (isResolved && !printedResolvedHeader))
                if (isResolved) printedResolvedHeader = true
                return (
              <div key={enq.id}>
                {showHeader && (
                  <div className="px-5 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                    {isResolved ? 'History' : 'Active'}
                  </div>
                )}
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Date · Channel · Status */}
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs text-gray-500">{fmtDate(enq.date)}</span>
                      {enq.channel && <span className="text-xs text-gray-400">· {enq.channel}</span>}
                      {enq.status && (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ENQUIRY_STATUS_STYLES[enq.status] || 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ENQUIRY_STATUS_DOT[enq.status] || 'bg-gray-400'}`} />
                          {enq.status}
                        </span>
                      )}
                    </div>
                    {/* Description */}
                    <p className="text-sm text-gray-800">{enq.description}</p>
                    {/* Products */}
                    {enq.product_interest?.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        <span className="font-medium">Products:</span> {enq.product_interest.join(', ')}
                      </p>
                    )}
                    {/* Follow-up + linked quotes */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {enq.follow_up_date && (
                        <p className={`text-xs font-medium ${isOverdue(enq.follow_up_date) ? 'text-red-600' : 'text-gray-500'}`}>
                          Follow-up: {fmtDate(enq.follow_up_date)}
                          {isOverdue(enq.follow_up_date) && <AlertTriangle size={11} className="inline align-[-1px] ml-1" />}
                        </p>
                      )}
                      {enq.linked_quote_ids?.length > 0 && (
                        <p className="text-xs text-gray-500">
                          Linked: {enq.linked_quote_ids.length} quote{enq.linked_quote_ids.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {/* Outcome notes */}
                    {enq.outcome_notes && (
                      <p className="text-xs text-gray-500 mt-1 italic">{enq.outcome_notes}</p>
                    )}
                    {/* Quote attachments */}
                    {(() => {
                      const atts = enq.attachments?.length
                        ? enq.attachments
                        : enq.attachment_url
                          ? [{ url: enq.attachment_url, name: enq.attachment_name || 'attachment', path: enq.attachment_path }]
                          : []
                      if (!atts.length) return null
                      return (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {atts.map((att, i) => (
                            <div key={i} className="relative group">
                              <a href={att.url} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
                              >
                                {att.name?.match(/\.(jpg|jpeg|png|webp|gif)$/i)
                                  ? <img src={att.url} alt="" className="h-10 w-14 object-cover rounded border border-gray-200" />
                                  : <><FileText size={14} className="shrink-0" /><span className="truncate max-w-[140px]">{att.name || `Quote ${i + 1}`}</span></>
                                }
                              </a>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleRemoveAttachment(enq, i) }}
                                disabled={removingAtt === `${enq.id}-${i}`}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs leading-none flex items-center justify-center hover:bg-red-600"
                              >
                                {removingAtt === `${enq.id}-${i}` ? '…' : '×'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Actions */}
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => { setEditingEnquiry(enq); setEnquiryFormOpen(true) }}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDeleteEnquiry(enq.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
              </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* Compose Message */}
      <div className="card mb-4">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Sparkle size={15} />Compose Message</h2>
          <p className="text-xs text-gray-400 mt-0.5">AI-written message tailored to this customer</p>
        </div>
        <div className="p-5 space-y-4">

          {/* Product picker */}
          <div>
            <label className="label">Product <span className="text-gray-400 font-normal">(optional)</span></label>
            {composeProduct ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-brand-200 bg-brand-50">
                <span className="text-sm font-medium text-brand-700 flex-1">{composeProduct.name}</span>
                {composeProduct.category && <span className="text-xs text-brand-500">{composeProduct.category}</span>}
                <button type="button" onClick={() => { setComposeProduct(null); setComposeProductSearch('') }} className="text-brand-400 hover:text-brand-700 text-lg leading-none">×</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  className="input"
                  placeholder="Search your products… (leave blank for general catalogue)"
                  value={composeProductSearch}
                  onChange={e => { setComposeProductSearch(e.target.value); setComposeProductOpen(true) }}
                  onFocus={() => setComposeProductOpen(true)}
                  onBlur={() => setTimeout(() => setComposeProductOpen(false), 150)}
                />
                {composeProductOpen && composeProductSearch && (
                  <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {allProducts.filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase())).length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No products found</p>
                    ) : allProducts
                        .filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => { setComposeProduct(p); setComposeProductSearch(''); setComposeProductOpen(false) }}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            <p className="text-sm font-medium text-gray-800">{p.name}</p>
                            {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                          </button>
                        ))
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channel */}
          <div>
            <label className="label">Channel</label>
            <select className="input" value={composeChannel} onChange={e => setComposeChannel(e.target.value)}>
              <option value="">— Select —</option>
              {['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Situation / context — the main field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">What's the situation? *</label>
              {enquiries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setComposeContext(enquiries[0].description || '')}
                  className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
                >
                  <RotateCcw size={12} />Use latest interaction
                </button>
              )}
            </div>
            <textarea
              className="input"
              rows={4}
              value={composeContext}
              onChange={e => setComposeContext(e.target.value)}
              placeholder="Describe what you want to say or what's happening — e.g. 'They asked about crystal fabric roses last month, we now have 3 new colours, want to follow up and ask if they want samples'"
            />
          </div>

          <button onClick={handleCompose} disabled={composeLoading} className="btn-primary">
            {composeLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating…
              </span>
            ) : <span className="inline-flex items-center gap-1.5"><Sparkle size={15} />Generate Message</span>}
          </button>

          {composeError && <p className="text-sm text-red-600">{composeError}</p>}

          {composeResult && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Generated Message</label>
                <button onClick={handleCopy} className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                  {composeCopied ? <span className="inline-flex items-center gap-1"><Check size={12} />Copied!</span> : 'Copy'}
                </button>
              </div>
              <textarea
                className="input font-mono text-xs"
                rows={12}
                value={composeResult}
                onChange={e => setComposeResult(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Enquiry form drawer */}
      {enquiryFormOpen && (
        <EnquiryForm
          customerId={id}
          customerQuotes={quotes}
          enquiry={editingEnquiry}
          onSave={() => {}}
          onClose={() => { setEnquiryFormOpen(false); setEditingEnquiry(null) }}
        />
      )}

      {merging && (
        <MergeCustomerModal
          customer={customer}
          onClose={() => setMerging(false)}
          onMerged={(survivorId) => {
            // Close first: /customers/:id reuses the same CustomerDetail instance
            // rather than remounting (React Router keeps one element for the
            // route), so navigating alone left this modal open. It then re-ran
            // its own preview effect once `customer` re-fetched as the survivor
            // — merging the survivor into itself — which is the "Cannot merge a
            // customer into itself" error, even though the merge had already
            // succeeded before that point.
            setMerging(false)
            navigate(`/customers/${survivorId}`)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${customer.company_name}? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {confirmDeleteEnquiry && (
        <ConfirmDialog
          message="Delete this interaction? This cannot be undone."
          onConfirm={() => handleDeleteEnquiry(confirmDeleteEnquiry)}
          onCancel={() => setConfirmDeleteEnquiry(null)}
        />
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-20 text-gray-400 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{value}</dd>
    </div>
  )
}

function isOverdue(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d < new Date()
}
