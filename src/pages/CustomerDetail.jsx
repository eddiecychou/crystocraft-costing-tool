import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  doc, getDoc, deleteDoc, updateDoc, collection, query, where, orderBy, getDocs,
  onSnapshot, deleteDoc as deleteDocument, serverTimestamp,
} from 'firebase/firestore'
import { db, storage, authHeader } from '../firebase'
import { ref as storageRef, deleteObject } from 'firebase/storage'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import EnquiryForm from './EnquiryForm'
import { useCustomerAssets, cannotRenderAsImage } from '../customerAssets'
import { loadProposal } from '../customerProposal'
import { Star, AlertTriangle, FileText, Sparkle, Check, RotateCcw, Package, X, Receipt, ChevronDown, ChevronUp, ChevronRight, Database, Mail, MessageCircle, MessageSquare, Loader2, RefreshCw, Smartphone, Mic, ShoppingCart } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'
import { loadBlogProducts } from '../productSource'
import { normalizeCustomer, loadCustomers, previewCustomerMerge, mergeCustomers, CHANNELS, NO_API_CHANNELS } from '../domain/customer'
import { transcribeMessage, WHATSAPP_TRANSCRIBE_LANGUAGES } from '../domain/whatsappImport'
import { erpLookup } from '../erpApi'
import { mergeSalesInvoiceHistory } from '../domain/salesInvoiceHistory'
import ErpDocModal from '../components/ErpDocModal'
import WhatsAppAttachment from '../components/WhatsAppAttachment'
import { refreshEmailSummary, discussCustomerEmail, renderThreadsText, buildYearIndex, routeEmailQuestion, renderThreadsTextForYears, buildKeywordFacets, composeEmailAnswer } from '../emailSummaryApi'
import { generateAndSaveWhatsappSummary } from '../whatsappSummaryApi'
import { savePastedAlibabaThread, generateAndSaveAlibabaSummary } from '../alibabaSummaryApi'
import { createInvitation } from '../portalInviteApi'
import { wooOrdersByCustomerId, searchWooOrders } from '../wooSyncApi'

const STATUS_STYLES = {
  draft: 'bg-ivory-dark text-ink-70',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

const ENQUIRY_STATUS_STYLES = {
  Open:      'bg-amber-100 text-amber-700',
  Quoted:    'bg-blue-100 text-blue-700',
  Confirmed: 'bg-green-100 text-green-700',
  Lost:      'bg-red-100 text-red-600',
  'On Hold': 'bg-ivory-dark text-ink-60',
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
  'On Hold': 'bg-ink-60',
  Won:            'bg-green-500',
  Completed:      'bg-teal-500',
  'In Production':'bg-purple-500',
}

// Portal enquiry status (top-level `enquiries` collection from the storefront).
const PORTAL_STATUS_STYLES = {
  new:      'bg-amber-100 text-amber-700',
  handled:  'bg-green-100 text-green-700',
  archived: 'bg-ivory-dark text-ink-60',
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
  Inactive: 'bg-ivory-dark text-ink-60',
}

const CHANNEL_BADGE = {
  'Email':             'bg-purple-100 text-purple-700',
  'WhatsApp Business': 'bg-green-100 text-green-700',
  'Alibaba':           'bg-orange-100 text-orange-700',
  'Personal WhatsApp': 'bg-amber-100 text-amber-700',
  'WeChat':            'bg-emerald-100 text-emerald-700',
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// WhatsApp thread docs (domain/whatsappImport.js) store dates as plain ISO
// strings, not Firestore Timestamps — fmtDate() above expects a Timestamp
// (.toDate()/.seconds) and would silently produce "Invalid Date" on a string.
function fmtIsoDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const MERGE_FIELD_LABELS = {
  website: 'website', address: 'address', country: 'country',
  crm_category: 'type', crm_status: 'status', source: 'source', segment: 'segment',
  erp_code: 'ERP code', notes: 'notes', folder_path: 'folder',
  tags: 'tags', channels: 'channels', contacts: 'contact(s)',
  is_vip: 'VIP flag', is_personal_wa: 'personal-WhatsApp flag', sensitive: 'sensitive flag',
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
      <div className="bg-white rounded-none shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <h2 className=" text-ink">Merge “{customer.company_name}” into…</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          <label className="block">
            <span className="text-xs text-ink-60">The surviving record — search by company name</span>
            <input className="input w-full mt-0.5" placeholder="Search customers…" value={search}
              onChange={e => { setSearch(e.target.value); setSurvivorId('') }} autoFocus />
          </label>
          {search && !survivorId && (
            <div className="border border-warm-grey rounded-none max-h-48 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-xs text-ink-60 px-3 py-2">No match.</p>
              ) : results.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setSurvivorId(c.id); setSearch(c.company_name) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-ivory border-b border-warm-grey last:border-0">
                  {c.company_name} {c.country && <span className="text-ink-60">— {c.country}</span>}
                </button>
              ))}
            </div>
          )}

          {previewing && <p className="text-xs text-ink-60">Checking what would move…</p>}

          {preview && (
            <div className="rounded-none border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 space-y-1.5">
              <p>
                <strong>{preview.ordersCount}</strong> order{preview.ordersCount === 1 ? '' : 's'},{' '}
                <strong>{preview.quotesCount}</strong> quote{preview.quotesCount === 1 ? '' : 's'}, and{' '}
                <strong>{preview.accountsCount}</strong> portal account{preview.accountsCount === 1 ? '' : 's'} will move to{' '}
                <strong>{preview.survivor.company_name}</strong>.
              </p>
              {(preview.assetsCount > 0 || preview.interactionsCount > 0 || preview.brandedImagesCount > 0 || preview.emailThreadsCount > 0) && (
                <p>
                  {[
                    preview.interactionsCount > 0 && `${preview.interactionsCount} interaction log entr${preview.interactionsCount === 1 ? 'y' : 'ies'}`,
                    preview.assetsCount > 0 && `${preview.assetsCount} Brand Gallery asset${preview.assetsCount === 1 ? '' : 's'}`,
                    preview.emailThreadsCount > 0 && `${preview.emailThreadsCount} email thread${preview.emailThreadsCount === 1 ? '' : 's'}`,
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
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-warm-grey">
          <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">Cancel</button>
          <button onClick={confirm} disabled={busy || !preview} className="btn-danger text-sm">
            {busy ? 'Merging…' : 'Merge & Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// This page grew to a dozen-plus stacked sections over time (owner,
// post-launch: "too many sections, make it easy to expand/collapse"). One
// shared wrapper for all of them — title + optional right-side controls
// (buttons/links that stay clickable even when collapsed, via
// stopPropagation) in a clickable header row, body hidden when collapsed.
// Open/closed state is per customer + section (sessionStorage, keyed by
// `${customerId}:${sectionKey}`) so it survives a save/reload within the
// same visit without polluting localStorage forever or leaking one
// customer's layout preference onto another's page.
function readCollapsed(key, defaultOpen) {
  if (!key) return !defaultOpen
  try {
    const v = sessionStorage.getItem(`cd-collapse:${key}`)
    return v === null ? !defaultOpen : v === '1'
  } catch { return !defaultOpen }
}
function Collapsible({ storageKey, title, right, defaultOpen = true, children, className = 'card mb-4', bodyClassName = 'px-5 pb-5 -mt-1' }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey, defaultOpen))
  function toggle() {
    setCollapsed(c => {
      const next = !c
      if (storageKey) { try { sessionStorage.setItem(`cd-collapse:${storageKey}`, next ? '1' : '0') } catch {} }
      return next
    })
  }
  return (
    <div className={className}>
      <div className={`flex items-center justify-between gap-2 px-5 py-4 cursor-pointer select-none ${!collapsed ? 'border-b border-warm-grey' : ''}`} onClick={toggle}>
        <div className="flex items-center gap-1.5 min-w-0">
          {collapsed ? <ChevronRight size={15} className="text-ink-60 shrink-0" /> : <ChevronDown size={15} className="text-ink-60 shrink-0" />}
          <h2 className="text-sm text-ink-80 truncate">{title}</h2>
        </div>
        {right && <div onClick={e => e.stopPropagation()} className="shrink-0 flex items-center gap-2">{right}</div>}
      </div>
      {!collapsed && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}

// Summary card for the Brand & Proposal page (split off from this page
// 2026-09-04). Shows a thumbnail strip of the customer's own brand assets +
// the proposal's status, and links to /customers/:id/brand.
function BrandThumb({ asset }) {
  if (cannotRenderAsImage(asset.filename)) {
    return (
      <span className="w-9 h-9 rounded-none border border-warm-grey bg-ivory-dark flex items-center justify-center shrink-0" title={asset.title || asset.filename}>
        <FileText size={14} className="text-ink-60" />
      </span>
    )
  }
  return (
    <img src={asset.file_url} alt={asset.title || asset.filename} loading="lazy"
      className="w-9 h-9 rounded-none border border-warm-grey object-contain bg-white shrink-0"
      title={asset.title || asset.filename} />
  )
}

function BrandProposalCard({ customerId }) {
  const { assets } = useCustomerAssets(customerId)
  const [proposal, setProposal] = useState(undefined)   // undefined = loading, null = none

  useEffect(() => {
    let alive = true
    loadProposal(customerId)
      .then(p => { if (alive) setProposal(p) })
      .catch(() => { if (alive) setProposal(null) })
    return () => { alive = false }
  }, [customerId])

  const brand = assets.filter(a => a.category === 'brand_asset')
  const thumbs = brand.slice(0, 5)

  const proposalLine =
    proposal === undefined ? 'loading proposal…'
      : proposal === null ? 'no proposal yet'
        : `proposal ${proposal.status}${proposal.updated_at ? ` · updated ${fmtDate(proposal.updated_at)}` : ''}`

  return (
    <Link to={`/customers/${customerId}/brand`}
      className="card mb-4 block px-5 py-4 hover:border-brand-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm text-ink-80">Brand &amp; Proposal</h2>
        <span className="text-xs text-brand-600 inline-flex items-center gap-0.5 shrink-0">
          Open <ChevronRight size={13} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {thumbs.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {thumbs.map(a => <BrandThumb key={a.id} asset={a} />)}
            {brand.length > thumbs.length && (
              <span className="text-xs text-ink-60">+{brand.length - thumbs.length}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-ink-60">No brand assets yet</span>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-60">
        {brand.length} brand asset{brand.length === 1 ? '' : 's'} · {proposalLine}
      </p>
    </Link>
  )
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [customer, setCustomer]         = useState(null)
  // SU-07A — "Invite to portal" per-contact busy/result state, keyed by
  // email since a customer can have several contacts.
  const [inviteBusy, setInviteBusy] = useState(null)
  const [inviteResult, setInviteResult] = useState({})
  const [quotes, setQuotes]             = useState([])
  const [orders, setOrders]             = useState([])
  const [accounts, setAccounts]         = useState([])
  const [enquiries, setEnquiries]       = useState([])
  const [portalEnquiries, setPortalEnquiries] = useState([])
  const [erpSiRows, setErpSiRows] = useState([])              // raw erp_sales_invoice rows, by erp_code
  const [erpHistoryLoading, setErpHistoryLoading] = useState(false)
  const [invoiceHistoryOpen, setInvoiceHistoryOpen] = useState(true)
  const [invoiceHistoryShown, setInvoiceHistoryShown] = useState(10)
  const [erpDoc, setErpDoc] = useState(null)   // JES invoice being viewed, read-only
  // Some erp_codes are shared JES "bucket" codes (owner, 2026-08-07: "for C13
  // and A29 (alibaba) customer code we share across different customers").
  // Confirmed: A29 (generic Alibaba), C13 (another shared retail bucket), and
  // O07 (website orders) each map to a dozen-plus DIFFERENT real customers —
  // JES never created individual codes for one-off marketplace/website
  // buyers. Filtering ERP history by customer_code alone would attribute
  // every other customer's orders on that same code to whoever's page you're
  // viewing. Holds the count of app customers sharing this customer's code;
  // >1 means "don't claim per-customer history for this code."
  const [erpCodeShareCount, setErpCodeShareCount] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteEnquiry, setConfirmDeleteEnquiry] = useState(null)
  const [merging, setMerging] = useState(false)
  const remember = useScrollMemory(`customer-${id}`, !loading)

  // WooCommerce order history (2026-08-22) — for a customer linked via
  // wooImport.js's linkCustomerToWoo. Fetched live from WooCommerce, not
  // stored in Firestore — same read-only posture as the WooCommerce Sync
  // page. null | 'loading' | rows[] | { error }
  const [wooOrders, setWooOrders] = useState(null)
  useEffect(() => {
    if (!customer || customer.source !== 'WooCommerce') return
    let alive = true
    setWooOrders('loading')
    // woo_customer_id is exact and preferred; a guest-checkout order has no
    // real WooCommerce account behind it (id 0/absent), so guest-linked
    // customers fall back to an email search — still their real history,
    // just matched by email/name instead of an account ID that doesn't exist.
    const fetch = customer.woo_customer_id
      ? wooOrdersByCustomerId(customer.woo_customer_id)
      : customer.contact_emails?.[0]
        ? searchWooOrders(customer.contact_emails[0])
        : Promise.resolve([])
    fetch.then(rows => { if (alive) setWooOrders(rows) })
        .catch(e => { if (alive) setWooOrders({ error: e.message || 'Could not load WooCommerce orders.' }) })
    return () => { alive = false }
  }, [customer?.id, customer?.source, customer?.woo_customer_id])

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

  // V8.1 email ingestion (Phase 2) — customers/{id}/email_threads is written
  // by email-sync/sync.py (a script run outside this app, see PROJECT-PLAN.md's
  // V8.1 entry), never by the browser. This just reads what's there.
  const [emailThreads, setEmailThreads] = useState([])
  const [emailSummaryBusy, setEmailSummaryBusy] = useState(false)
  const [emailSummaryError, setEmailSummaryError] = useState('')
  const [emailChatOpen, setEmailChatOpen] = useState(false)
  const [emailChatHistory, setEmailChatHistory] = useState([])
  const [emailChatInput, setEmailChatInput] = useState('')
  const [emailChatBusy, setEmailChatBusy] = useState(false)
  useEffect(() => {
    return onSnapshot(collection(db, 'customers', id, 'email_threads'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
      setEmailThreads(all)
    })
  }, [id])

  // When email-sync/sync.py (the weekly IMAP sync — see weekly_rescan.sh /
  // launchd, runs on the sync Mac, not this app) last actually ran. One
  // global doc, not per-customer — the sync covers every customer in one
  // pass, so "last synced" means the same thing everywhere it's shown.
  const [emailSyncStatus, setEmailSyncStatus] = useState(null)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'email_sync_status')).then(s => setEmailSyncStatus(s.exists() ? s.data() : null)).catch(() => {})
  }, [])

  // V8.2 WhatsApp ingestion — customers/{id}/whatsapp_threads, written by
  // WhatsAppImport.jsx from the owner's manual "Export Chat" .zip files (no
  // API access to either Business or Personal WhatsApp). Read-only here,
  // same posture as emailThreads above; no AI summary yet, just the raw
  // ingested list so an import is actually visible/verifiable afterward.
  const [whatsappThreads, setWhatsappThreads] = useState([])
  const [whatsappExpanded, setWhatsappExpanded] = useState(null) // thread id currently expanded
  const [transcribingKey, setTranscribingKey] = useState(null) // `${threadId}:${index}` mid-transcription
  const [transcribeError, setTranscribeError] = useState('')
  const [transcribeLang, setTranscribeLang] = useState({}) // `${threadId}:${index}` -> Deepgram language code, per-message since a thread can mix languages
  useEffect(() => {
    return onSnapshot(collection(db, 'customers', id, 'whatsapp_threads'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
      setWhatsappThreads(all)
    })
  }, [id])

  // SU-08 Phase 2 (2026-08-19) — every marketing_contacts lead in
  // customer.linked_marketing_contact_ids (domain/marketingContact.js's
  // linkContactToCustomer) may have its OWN whatsapp_threads subcollection,
  // deliberately left in place at marketing_contacts/{contactId} rather than
  // copied here (see that function's own comment — avoids fragmenting
  // future re-imports, and there's nothing to duplicate). This subscribes
  // to each linked contact's threads read-only and merges them into the
  // same card below, tagged so they're visibly distinct from this
  // customer's own imports. Admin-only, same rule as everywhere else in
  // this app — a customer-portal login has no read access to
  // marketing_contacts at all, so this can never leak between customers.
  const linkedContactIds = customer?.linked_marketing_contact_ids || []
  const [linkedWhatsappThreads, setLinkedWhatsappThreads] = useState({}) // contactId -> threads[]
  useEffect(() => {
    if (!linkedContactIds.length) { setLinkedWhatsappThreads({}); return }
    const unsubs = linkedContactIds.map(contactId =>
      onSnapshot(collection(db, 'marketing_contacts', contactId, 'whatsapp_threads'), snap => {
        const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setLinkedWhatsappThreads(prev => ({ ...prev, [contactId]: threads }))
      })
    )
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when the SET of linked ids actually changes, not on every unrelated customer re-render
  }, [linkedContactIds.join(',')])

  // Merged, deduped, sorted list the card below actually renders. Dedupe by
  // thread doc id — if a thread doc id appears in both this customer's own
  // collection AND a linked contact's (only possible from data written
  // before Phase 2, e.g. Phase 1's now-removed copy-then-delete), the
  // customer's own copy wins and the linked one is dropped rather than
  // shown twice.
  const mergedWhatsappThreads = useMemo(() => {
    const seenIds = new Set(whatsappThreads.map(t => t.id))
    const own = whatsappThreads.map(t => ({ ...t, _source: 'own' }))
    const linked = linkedContactIds.flatMap(contactId =>
      (linkedWhatsappThreads[contactId] || [])
        .filter(t => !seenIds.has(t.id) && (seenIds.add(t.id), true))
        .map(t => ({ ...t, _source: 'linked', _linkedContactId: contactId }))
    )
    const all = [...own, ...linked]
    all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
    return all
  }, [whatsappThreads, linkedWhatsappThreads, linkedContactIds])

  // Email ingestion (V8.9) — same merge as mergedWhatsappThreads above, now
  // that email-sync also matches marketing_contacts (see
  // domain/marketingContact.js's linkContactToCustomer comment on why
  // linked-contact subcollections are left in place, never copied). Real
  // gap this closes: before this, a lead's email_threads accumulated while
  // still a lead became invisible the moment they were linked to a customer
  // — contactToEntity() stops surfacing a linked contact to Daily Drafts at
  // all, and nothing here read marketing_contacts/{contactId}/email_threads,
  // so that correspondence just silently stopped counting for anyone.
  const [linkedEmailThreads, setLinkedEmailThreads] = useState({}) // contactId -> threads[]
  useEffect(() => {
    if (!linkedContactIds.length) { setLinkedEmailThreads({}); return }
    const unsubs = linkedContactIds.map(contactId =>
      onSnapshot(collection(db, 'marketing_contacts', contactId, 'email_threads'), snap => {
        const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setLinkedEmailThreads(prev => ({ ...prev, [contactId]: threads }))
      })
    )
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when the SET of linked ids actually changes, not on every unrelated customer re-render
  }, [linkedContactIds.join(',')])

  const mergedEmailThreads = useMemo(() => {
    const seenIds = new Set(emailThreads.map(t => t.id))
    const own = emailThreads.map(t => ({ ...t, _source: 'own' }))
    const linked = linkedContactIds.flatMap(contactId =>
      (linkedEmailThreads[contactId] || [])
        .filter(t => !seenIds.has(t.id) && (seenIds.add(t.id), true))
        .map(t => ({ ...t, _source: 'linked', _linkedContactId: contactId }))
    )
    const all = [...own, ...linked]
    all.sort((a, b) => String(b.date_range?.[1] || '').localeCompare(String(a.date_range?.[1] || '')))
    return all
  }, [emailThreads, linkedEmailThreads, linkedContactIds])

  const whatsappTarget = { type: 'customer', customerId: id }

  // No bulk "transcribe all" — owner's own call, 2026-08-13: a thread can
  // have hundreds of voice notes (Joe Feder's had 326), and transcribing
  // all of them in one guessed language would be a real Deepgram cost
  // wasted on whichever ones guessed wrong. Per-message, with a language
  // picker, instead.
  async function handleTranscribeMessage(threadId, index, language) {
    setTranscribeError(''); setTranscribingKey(`${threadId}:${index}`)
    try {
      await transcribeMessage(whatsappTarget, threadId, index, language)
      // whatsappThreads updates on its own via the onSnapshot listener above
      // once the write lands — no local state patch needed here.
    } catch (e) {
      setTranscribeError(e.message || 'Could not transcribe this voice note.')
    } finally {
      setTranscribingKey(null)
    }
  }

  // V8.2 — customers/{id}.whatsapp_summary, generated on demand (same
  // "admin reviews/refreshes" posture as email_summary above). This is what
  // makes WhatsApp correspondence usable by Daily Drafts
  // (generate-outreach-drafts.js): that function reads this cached field
  // exactly the way it already reads email_summary, rather than re-rendering
  // raw threads for every candidate on every batch run — see
  // customerToEntity in DailyDrafts.jsx.
  const [whatsappSummaryBusy, setWhatsappSummaryBusy] = useState(false)
  const [whatsappSummaryError, setWhatsappSummaryError] = useState('')
  async function handleRefreshWhatsappSummary() {
    setWhatsappSummaryBusy(true); setWhatsappSummaryError('')
    try {
      const whatsapp_summary = await generateAndSaveWhatsappSummary('customers', id, whatsappThreads)
      // `customer` is a one-time fetch, not a live listener — same reason
      // Email Summary's handler patches it locally too (see above).
      setCustomer(prev => (prev ? { ...prev, whatsapp_summary: { ...whatsapp_summary, generated_at: new Date() } } : prev))
    } catch (e) {
      setWhatsappSummaryError(e.message || 'Could not refresh the WhatsApp summary.')
    } finally {
      setWhatsappSummaryBusy(false)
    }
  }

  // Alibaba Messages (V8.10) — customers/{id}/alibaba_threads, one doc per
  // pasted batch (no export/API exists for Alibaba.com's buyer-seller chat,
  // so the owner copy-pastes it by hand — see alibabaSummaryApi.js). Same
  // live-subscribe/summary posture as WhatsApp above, but always visible
  // (not gated behind "something already imported") since pasting IS how
  // content gets in here — there's no separate import page to populate it
  // first.
  const [alibabaThreads, setAlibabaThreads] = useState([])
  const [alibabaExpanded, setAlibabaExpanded] = useState(null)
  const [alibabaPasteText, setAlibabaPasteText] = useState('')
  const [alibabaSaveBusy, setAlibabaSaveBusy] = useState(false)
  const [alibabaSaveError, setAlibabaSaveError] = useState('')
  const [alibabaSaved, setAlibabaSaved] = useState(false)
  useEffect(() => {
    return onSnapshot(collection(db, 'customers', id, 'alibaba_threads'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => {
        const av = a.pasted_at?.toMillis ? a.pasted_at.toMillis() : new Date(a.pasted_at || 0).getTime()
        const bv = b.pasted_at?.toMillis ? b.pasted_at.toMillis() : new Date(b.pasted_at || 0).getTime()
        return bv - av
      })
      setAlibabaThreads(all)
    })
  }, [id])

  // Same merge as mergedWhatsappThreads/mergedEmailThreads above — a
  // marketing-contact lead's alibaba_threads (pasted before this customer
  // record even existed) are left in place at marketing_contacts/{contactId}
  // rather than copied on promotion (see linkContactToCustomer's comment),
  // so this subscribes to each linked contact's threads and merges them in
  // here. Real gap this closes: a lead's Alibaba conversation history was
  // silently dropped the moment "Promote to Customer" ran, because nothing
  // here read marketing_contacts/{contactId}/alibaba_threads at all.
  const [linkedAlibabaThreads, setLinkedAlibabaThreads] = useState({}) // contactId -> threads[]
  useEffect(() => {
    if (!linkedContactIds.length) { setLinkedAlibabaThreads({}); return }
    const unsubs = linkedContactIds.map(contactId =>
      onSnapshot(collection(db, 'marketing_contacts', contactId, 'alibaba_threads'), snap => {
        const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setLinkedAlibabaThreads(prev => ({ ...prev, [contactId]: threads }))
      })
    )
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when the SET of linked ids actually changes, not on every unrelated customer re-render
  }, [linkedContactIds.join(',')])

  const mergedAlibabaThreads = useMemo(() => {
    const seenIds = new Set(alibabaThreads.map(t => t.id))
    const own = alibabaThreads.map(t => ({ ...t, _source: 'own' }))
    const linked = linkedContactIds.flatMap(contactId =>
      (linkedAlibabaThreads[contactId] || [])
        .filter(t => !seenIds.has(t.id) && (seenIds.add(t.id), true))
        .map(t => ({ ...t, _source: 'linked', _linkedContactId: contactId }))
    )
    const all = [...own, ...linked]
    all.sort((a, b) => {
      const av = a.pasted_at?.toMillis ? a.pasted_at.toMillis() : new Date(a.pasted_at || 0).getTime()
      const bv = b.pasted_at?.toMillis ? b.pasted_at.toMillis() : new Date(b.pasted_at || 0).getTime()
      return bv - av
    })
    return all
  }, [alibabaThreads, linkedAlibabaThreads, linkedContactIds])

  async function handleSaveAlibabaPaste() {
    setAlibabaSaveBusy(true); setAlibabaSaveError(''); setAlibabaSaved(false)
    try {
      await savePastedAlibabaThread('customers', id, alibabaPasteText)
      setAlibabaPasteText('')
      setAlibabaSaved(true)
      setTimeout(() => setAlibabaSaved(false), 2500)
    } catch (e) {
      setAlibabaSaveError(e.message || 'Could not save that paste.')
    } finally {
      setAlibabaSaveBusy(false)
    }
  }

  const [alibabaSummaryBusy, setAlibabaSummaryBusy] = useState(false)
  const [alibabaSummaryError, setAlibabaSummaryError] = useState('')
  async function handleRefreshAlibabaSummary() {
    setAlibabaSummaryBusy(true); setAlibabaSummaryError('')
    try {
      const alibaba_summary = await generateAndSaveAlibabaSummary('customers', id, mergedAlibabaThreads)
      setCustomer(prev => (prev ? { ...prev, alibaba_summary: { ...alibaba_summary, generated_at: new Date() } } : prev))
    } catch (e) {
      setAlibabaSummaryError(e.message || 'Could not refresh the Alibaba summary.')
    } finally {
      setAlibabaSummaryBusy(false)
    }
  }

  async function handleInviteContact(contact) {
    setInviteBusy(contact.email)
    try {
      const res = await createInvitation(id, contact.email, contact.name || '')
      setInviteResult(prev => ({
        ...prev,
        [contact.email]: {
          ok: true,
          message: res.reused ? 'Already invited — see Portal → Invitations.' : 'Invitation sent.',
        },
      }))
    } catch (e) {
      setInviteResult(prev => ({ ...prev, [contact.email]: { ok: false, message: e.message || 'Could not send the invitation.' } }))
    } finally {
      setInviteBusy(null)
    }
  }

  // Clears the possible-B2B-match flag once reviewed — this is acknowledgment
  // that the two records are genuinely separate people, not a merge action.
  // If they're actually the same person, that's a manual decision outside
  // this button (no auto-merge exists anywhere in this feature by design).
  async function handleDismissB2bMatch() {
    await updateDoc(doc(db, 'customers', id), { possible_b2b_match: null, updatedAt: serverTimestamp() })
    setCustomer(prev => (prev ? { ...prev, possible_b2b_match: null } : prev))
  }

  async function handleRefreshEmailSummary() {
    setEmailSummaryBusy(true); setEmailSummaryError('')
    try {
      const result = await refreshEmailSummary(renderThreadsText(mergedEmailThreads))
      const email_summary = { ...result, thread_count: mergedEmailThreads.length, generated_at: serverTimestamp() }
      await updateDoc(doc(db, 'customers', id), { email_summary })
      // `customer` is a one-time fetch (see the load effect above), not a
      // live listener like emailThreads — without this the card would keep
      // showing "Not generated yet" until the page was reloaded, even
      // though the write above just succeeded.
      setCustomer(prev => (prev ? { ...prev, email_summary: { ...result, thread_count: mergedEmailThreads.length, generated_at: new Date() } } : prev))
    } catch (e) {
      setEmailSummaryError(e.message || 'Could not refresh the email summary.')
    } finally {
      setEmailSummaryBusy(false)
    }
  }

  async function handleEmailChatSend() {
    const message = emailChatInput.trim()
    if (!message || emailChatBusy) return
    setEmailChatBusy(true)
    setEmailChatHistory(prev => [...prev, { role: 'user', content: message }])
    setEmailChatInput('')
    try {
      // Map-reduce (2026-08-12, owner's suggestion) — decompose the
      // question into independent facets (one per person/keyword, plus one
      // for the routed time range if any), answer each against its OWN
      // full-budget slice of thread content IN PARALLEL (map), then merge
      // the short partial answers into one reply (reduce). Replaces the
      // earlier approach of splitting one shared budget across facets,
      // which could still starve a facet once enough others were in play.
      // Falls back to the single general recent+oldest split only when no
      // facet (keyword or year) was found at all.
      const facets = buildKeywordFacets(mergedEmailThreads, message)
      try {
        const yearIndex = buildYearIndex(mergedEmailThreads)
        const years = yearIndex ? await routeEmailQuestion(yearIndex, message) : []
        if (years.length) {
          const text = renderThreadsTextForYears(mergedEmailThreads, years)
          if (text) facets.push({ label: `year ${years.join('/')}`, threadsText: text })
        }
      } catch { /* routing is a nice-to-have — proceed with whatever facets were found locally */ }

      let reply
      if (!facets.length) {
        const result = await discussCustomerEmail(renderThreadsText(mergedEmailThreads), emailChatHistory, message)
        reply = result.reply
      } else if (facets.length === 1) {
        const result = await discussCustomerEmail(facets[0].threadsText, emailChatHistory, message)
        reply = result.reply
      } else {
        // Each map call is a fresh, focused question — no shared chat
        // history (that's the ORIGINAL question's context, not relevant to
        // "what does this one facet's slice say"), so each one only ever
        // carries its own facet's content.
        const partials = await Promise.all(facets.map(f => discussCustomerEmail(f.threadsText, [], message)))
        const composed = await composeEmailAnswer(message, facets.map((f, i) => ({ label: f.label, answer: partials[i].reply })))
        reply = composed.reply
      }
      setEmailChatHistory(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setEmailChatHistory(prev => [...prev, { role: 'assistant', content: `(error: ${e.message || 'chat failed'})` }])
    } finally {
      setEmailChatBusy(false)
    }
  }

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

  // JES sales invoice history for this customer, matched by erp_code — what's
  // actually been sold to them is what matters here, not sales orders/"PI"
  // (those already have their own app-native section above); merged with the
  // app's own invoiced orders into one "Sales Invoice History" (owner,
  // 2026-08-07: "I will just need to list out all the Sales Invoices... I
  // want to combine both in JES and in App sales invoice"). erp_code
  // substring-matches via erpLookup's existing search (same ilike pattern
  // every other ERP search box uses) — no new backend needed, /api/erp is
  // already admin-gated and this page is admin-only.
  useEffect(() => {
    const code = customer?.erp_code
    if (!code) { setErpSiRows([]); setErpCodeShareCount(null); return }
    let cancelled = false
    setErpHistoryLoading(true)
    getDocs(query(collection(db, 'customers'), where('erp_code', '==', code)))
      .then(shareSnap => {
        if (cancelled) return
        setErpCodeShareCount(shareSnap.size)
        if (shareSnap.size > 1) { setErpSiRows([]); setErpHistoryLoading(false); return }
        return erpLookup('sales_invoice', { q: code, limit: 100 }).then(rows => {
          if (cancelled) return
          // erpLookup's ilike is a substring match on customer_code among
          // other columns — an exact match on THIS customer's code is
          // required here, not "contains it as a substring of a longer code."
          setErpSiRows(rows.filter(r => String(r.customer_code || '').toUpperCase() === code.toUpperCase()))
        }).finally(() => { if (!cancelled) setErpHistoryLoading(false) })
      }).catch(() => { if (!cancelled) { setErpSiRows([]); setErpHistoryLoading(false) } })
    return () => { cancelled = true }
  }, [customer?.erp_code])

  const invoiceHistory = useMemo(
    () => mergeSalesInvoiceHistory(orders, erpSiRows, customer?.erp_code),
    [orders, erpSiRows, customer?.erp_code],
  )

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
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
  if (!customer) return <div className="p-4 text-ink-60">Customer not found.</div>

  const followUpEnquiries = enquiries.filter(e => e.follow_up_date)

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>

      {/* Header */}
      <div className="mb-4 mt-1">
        {/* flex-col on mobile: Edit/Merge/Delete were squeezed into a tiny
            row alongside a long/wrapping (often multi-line CJK) company
            name on a narrow screen — stack instead, buttons get their own
            full-width row below the title there. */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl text-ink">{customer.company_name}</h1>
          {customer.erp_code && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-none bg-ivory-dark text-ink-60 border border-warm-grey">{customer.erp_code}</span>
          )}
        </div>
              {customer.is_vip && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold"><Star size={12} className="fill-current" />VIP</span>}
              {/* WooCommerce linkage badge (2026-08-22) — reported as missing:
                  the "Source" field was already shown further down as a plain
                  text row, but nothing this prominent said "this is a
                  WooCommerce-linked record" at a glance the way the Sales
                  Invoices page's "Woo #57844" badge does. */}
              {customer.source === 'WooCommerce' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold"
                      title={customer.woo_customer_id ? `WooCommerce customer #${customer.woo_customer_id}` : 'Linked to WooCommerce'}>
                  WooCommerce{customer.woo_customer_id ? ` #${customer.woo_customer_id}` : ''}
                </span>
              )}
              {customer.crm_status && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CRM_STATUS_STYLES[customer.crm_status] || 'bg-ivory-dark text-ink-60'}`}>
                  {customer.crm_status}
                </span>
              )}
            </div>
            <p className="text-sm text-ink-60 mt-0.5">{customer.country || customer.region || ''}</p>
            {customer.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customer.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Link to={`/customers/${id}/edit`} onClick={remember} className="btn-secondary text-sm">Edit</Link>
            <button className="btn-secondary text-sm" onClick={() => setMerging(true)}>Merge…</button>
            <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        </div>
      </div>

      {/* Interaction Log — moved directly under the header (owner,
          2026-08-21): "I usually first find the customer and log the
          interaction from the customer page" — this used to sit near the
          bottom of a long page, well below Contacts/Company details/Sales
          History/Quotes/Brand Gallery/Email/WhatsApp, so + Log Interaction
          needed a long scroll to reach on every visit. */}
      <Collapsible storageKey={`${id}:interaction-log`} title={`Interaction Log (${enquiries.length})`} bodyClassName=""
        right={<button
            onClick={() => { setEditingEnquiry(null); setEnquiryFormOpen(true) }}
            className="btn-primary text-xs py-1.5 px-3"
          >
            + Log Interaction
          </button>}>
        {enquiries.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">No interactions logged yet.</p>
        ) : (
          <div className="divide-y divide-warm-grey">
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
                  <div className="px-5 pt-3 pb-1 text-xs font-semibold text-ink-60 uppercase tracking-wide bg-ivory">
                    {isResolved ? 'History' : 'Active'}
                  </div>
                )}
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Date · Channel · Status */}
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs text-ink-60">{fmtDate(enq.date)}</span>
                      {enq.channel && <span className="text-xs text-ink-60">· {enq.channel}</span>}
                      {enq.contact_id && (() => {
                        const c = (customer.contacts || []).find(x => x.id === enq.contact_id)
                        return c ? <span className="text-xs text-ink-60">· with {c.name || '(no name)'}</span> : null
                      })()}
                      {enq.status && (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ENQUIRY_STATUS_STYLES[enq.status] || 'bg-ivory-dark text-ink-60'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ENQUIRY_STATUS_DOT[enq.status] || 'bg-ink-60'}`} />
                          {enq.status}
                        </span>
                      )}
                    </div>
                    {/* Description */}
                    <p className="text-sm text-ink">{enq.description}</p>
                    {/* Products */}
                    {enq.product_interest?.length > 0 && (
                      <p className="text-xs text-ink-60 mt-1">
                        <span className="font-medium">Products:</span> {enq.product_interest.join(', ')}
                      </p>
                    )}
                    {/* Follow-up + linked quotes */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {enq.follow_up_date && (
                        <p className={`text-xs font-medium ${isOverdue(enq.follow_up_date) ? 'text-red-600' : 'text-ink-60'}`}>
                          Follow-up: {fmtDate(enq.follow_up_date)}
                          {isOverdue(enq.follow_up_date) && <AlertTriangle size={11} className="inline align-[-1px] ml-1" />}
                        </p>
                      )}
                      {enq.linked_quote_ids?.length > 0 && (
                        <p className="text-xs text-ink-60">
                          Linked: {enq.linked_quote_ids.length} quote{enq.linked_quote_ids.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {/* Outcome notes */}
                    {enq.outcome_notes && (
                      <p className="text-xs text-ink-60 mt-1 italic">{enq.outcome_notes}</p>
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
                                  ? <img src={att.url} alt="" className="h-10 w-14 object-cover rounded-none border border-warm-grey" />
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
      </Collapsible>

      {/* Personal WA warning banner */}
      {(customer.is_personal_wa || customer.channels?.includes('Personal WhatsApp')) && (
        <div className="mb-4 flex items-center gap-2 rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            <strong>{customer.contact_name || customer.company_name}</strong> communicates via
            Eddie's <strong>personal WhatsApp</strong> — they will not appear in WhatsApp Business.
          </span>
        </div>
      )}

      {/* Bounced/complained-email banner — set by resend-webhook.js on a hard
          bounce or spam complaint against a Daily Draft send tagged with
          this customer's id. Shown, not just silently flagged, so a dead/
          out-of-business address (or a "stop emailing me") is something
          Eddie actually sees rather than a record that quietly stops
          getting outreach for no visible reason. Bounce and complaint are
          separate signals (see resend-webhook.js) — both are shown if both
          happened. */}
      {customer.email_bounced && (
        <div className="mb-4 flex items-center gap-2 rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            An email to <strong>{customer.contact_name || customer.company_name}</strong> bounced
            {customer.email_bounce_reason ? ` (${customer.email_bounce_reason})` : ''} — the address may be
            inactive or the company no longer reachable at it. Daily Drafts will stop suggesting this
            customer until this is resolved.
          </span>
        </div>
      )}
      {customer.email_complained && (
        <div className="mb-4 flex items-center gap-2 rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            <strong>{customer.contact_name || customer.company_name}</strong> marked a Daily Draft email as spam
            {customer.email_complain_reason ? ` (${customer.email_complain_reason})` : ''} — Daily Drafts will
            stop suggesting this customer until this is resolved.
          </span>
        </div>
      )}
      {customer.possible_b2b_match && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            This WooCommerce-sourced customer's email also matches{' '}
            <Link to={`/customers/${customer.possible_b2b_match.customer_id}`} className="underline font-medium">
              {customer.possible_b2b_match.company_name}
            </Link>{' '}— review before treating these as separate people. Never auto-merged.
          </span>
          <button type="button" onClick={handleDismissB2bMatch}
            className="text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2 shrink-0">
            Dismiss (reviewed, keep separate)
          </button>
        </div>
      )}

      {/* Contacts — separate named people (owner, 2026-08-05), not one shared
          contact_name + unattributed emails. */}
      <Collapsible storageKey={`${id}:contacts`} title={`Contacts (${(customer.contacts || []).length})`}
                   right={<Link to={`/customers/${id}/edit`} className="text-xs text-brand-600 hover:underline">Edit →</Link>}>
        {(customer.contacts || []).length === 0 ? (
          <p className="text-sm text-ink-60">No contacts on file yet.</p>
        ) : (
          <div className="space-y-3">
            {customer.contacts.map(c => (
              <div key={c.id} className="rounded-none border border-warm-grey p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-ink">{c.name || '(no name)'}</span>
                  {c.title && <span className="text-xs text-ink-60">· {c.title}</span>}
                  {c.is_primary && <Star size={12} className="fill-current text-amber-400 shrink-0" />}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                  {c.email && <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline">{c.phone}</a>}
                  {/* whatsapp_personal/whatsapp_business are separate, optional
                      fields (Draft Daily WhatsApp channel support) — shown
                      alongside the older unclassified `whatsapp` when set,
                      never replacing it (owner, 2026-08-19: group WhatsApp
                      links with the contact they belong to, not a separate
                      page-level box). */}
                  {c.whatsapp_personal && <a href={`https://wa.me/${c.whatsapp_personal.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">WA Personal: {c.whatsapp_personal}</a>}
                  {c.whatsapp_business && <a href={`https://wa.me/${c.whatsapp_business.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">WA Business: {c.whatsapp_business}</a>}
                  {c.whatsapp && <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">WA: {c.whatsapp}</a>}
                  {c.wechat && <span className="text-ink-70">WeChat: {c.wechat}</span>}
                </div>
                {c.address && <p className="mt-1 text-xs text-ink-60">{c.address}</p>}
                {/* SU-07A — the natural moment to invite this specific
                    contact: an admin looking at a real named person's email
                    on a real customer record, same spot the SU-07A audit
                    identified. */}
                {c.email && (
                  <div className="mt-2">
                    {inviteResult[c.email] ? (
                      <span className={`text-2xs ${inviteResult[c.email].ok ? 'text-green-600' : 'text-red-600'}`}>
                        {inviteResult[c.email].message}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInviteContact(c)}
                        disabled={inviteBusy === c.email}
                        className="text-2xs text-brand-600 hover:text-brand-800 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {inviteBusy === c.email ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                        {inviteBusy === c.email ? 'Sending invite…' : 'Invite to portal'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Collapsible>

      {/* WooCommerce order history (2026-08-22) — read live from WooCommerce,
          not stored in Firestore; only shown once a customer is actually
          linked (source === 'WooCommerce'). "How many orders has this
          customer made" was the direct ask that led to this. */}
      {customer.source === 'WooCommerce' && (
        <Collapsible storageKey={`${id}:woo-orders`}
          title={`WooCommerce Orders${Array.isArray(wooOrders) ? ` (${wooOrders.length})` : ''}`}
          right={<Link to="/woo-sync" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1"><ShoppingCart size={12} /> Open sync</Link>}>
          {wooOrders === 'loading' && <p className="text-sm text-ink-60">Loading…</p>}
          {wooOrders?.error && <p className="text-sm text-amber-700">{wooOrders.error}</p>}
          {Array.isArray(wooOrders) && wooOrders.length === 0 && (
            <p className="text-sm text-ink-60">No WooCommerce orders found.</p>
          )}
          {Array.isArray(wooOrders) && wooOrders.length > 0 && (() => {
            // Total spent per currency, shown as a one-line summary above the
            // table — never summed across currencies (same rule as the
            // WooCommerce Sync page's "By item" report: orders can be in
            // GBP/HKD/USD/EUR, and a cross-currency total is meaningless).
            const byCurrency = new Map()
            for (const o of wooOrders) byCurrency.set(o.currency, (byCurrency.get(o.currency) || 0) + (o.total || 0))
            return (
              <>
                <p className="text-xs text-ink-60 mb-3">
                  Total spent: {[...byCurrency.entries()].map(([cur, sum]) => fmtMoney(sum, cur)).join(' · ')}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-60 border-b border-warm-grey">
                        <th className="pb-1.5 pr-3 font-medium">Order</th>
                        <th className="pb-1.5 pr-3 font-medium">Status</th>
                        <th className="pb-1.5 pr-3 font-medium">Date paid</th>
                        <th className="pb-1.5 pr-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-warm-grey">
                      {wooOrders.map(o => (
                        <tr key={o.id}>
                          <td className="py-1.5 pr-3 font-mono text-xs">#{o.number}</td>
                          <td className="py-1.5 pr-3 text-xs text-ink-60">{o.status}</td>
                          <td className="py-1.5 pr-3 text-xs text-ink-60">{fmtIsoDate(o.date_paid)}</td>
                          <td className="py-1.5 pr-3 text-right text-xs tabular-nums">{fmtMoney(o.total, o.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </Collapsible>
      )}

      {/* Company details */}
      <Collapsible storageKey={`${id}:company`} title="Company Details">
        <dl className="space-y-2">
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
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ivory-dark text-ink-80">{customer.crm_category}</span>
            } />
          )}
          {(() => {
            const chs = customer.channels?.length ? customer.channels : customer.primary_channel ? [customer.primary_channel] : []
            return chs.length > 0 ? (
              <Row label="Channels" value={
                <div className="flex flex-wrap gap-1">
                  {chs.map(ch => (
                    <span key={ch} className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHANNEL_BADGE[ch] || 'bg-ivory-dark text-ink-70'}`}>
                      {ch}
                    </span>
                  ))}
                </div>
              } />
            ) : null
          })()}
          {customer.source && <Row label="Source" value={customer.source} />}
          {customer.woo_customer_id && <Row label="WooCommerce customer ID" value={`#${customer.woo_customer_id}`} />}
          {customer.segment && <Row label="Segment" value={customer.segment} />}
          {customer.folder_path && (
            <Row label="Folder" value={
              <span className="font-mono text-xs text-ink-70 bg-ivory-dark px-2 py-0.5 rounded-none">{customer.folder_path}</span>
            } />
          )}
        </dl>
      </Collapsible>

      {/* Linked storefront accounts */}
      <Collapsible storageKey={`${id}:accounts`} title={`Storefront Accounts (${accounts.length})`}>
        <p className="text-xs text-ink-60 mb-3">Login accounts linked to this customer. Manage links on the Accounts page.</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-60">
            No accounts linked yet. Link one from <Link to="/customer-accounts" className="text-brand-600 hover:underline">Accounts</Link>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="text-ink">{a.contact_name || a.company_name || a.email}</span>
                  {a.email && <span className="text-ink-60"> · {a.email}</span>}
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
      </Collapsible>

      {/* Notes */}
      {customer.notes && (
        <Collapsible storageKey={`${id}:notes`} title="Notes">
          <p className="text-sm text-ink-70 whitespace-pre-wrap">{customer.notes}</p>
        </Collapsible>
      )}

      {/* PI Orders */}
      <Collapsible storageKey={`${id}:pi-orders`} title={`PI Orders (${orders.length})`} bodyClassName=""
                   right={<Link to={`/shipments/new?customer_id=${id}`} className="btn-primary text-xs py-1.5 px-3">+ New PI</Link>}>
        {orders.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">No PI orders for this customer.</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {orders.map(o => {
              const piNo = o.uc_no || o.erp_pi_no || o.erp_so_no || '—'
              const dateStr = o.order_date
                ? new Date(o.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'
              const statusColour = {
                draft:     'bg-ivory-dark text-ink-70',
                confirmed: 'bg-blue-100 text-blue-700',
                shipped:   'bg-amber-100 text-amber-700',
                delivered: 'bg-green-100 text-green-700',
                cancelled: 'bg-red-100 text-red-600',
              }[o.status] || 'bg-ivory-dark text-ink-70'
              return (
                <Link key={o.id} to={`/shipments/${o.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-ivory transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Package size={15} className="text-ink-60 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{piNo}</p>
                      <p className="text-xs text-ink-60 mt-0.5">{dateStr}{o.currency ? ` · ${o.currency}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`badge ${statusColour}`}>{o.status || 'draft'}</span>
                    <span className="text-xs text-ink-60">→</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Collapsible>

      {/* Sales Invoice History — merged app + JES, see domain/
          salesInvoiceHistory.js. Only invoices (what's actually been sold to
          this customer), not sales orders/"PI" — owner, 2026-08-07: "since I
          only concern about what's being ordered and sold to the customer,
          I will just need to list out all the Sales Invoices." Source (App/
          JES) is shown here since this is the admin page; the portal
          equivalent (OrderHistoryPage.jsx) hides it. */}
      {customer.erp_code && (
        <div className="card mb-4">
          <button type="button" onClick={() => setInvoiceHistoryOpen(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 border-b border-warm-grey text-left">
            <h2 className="text-sm text-ink-80">
              Sales Invoice History {erpCodeShareCount === null || erpCodeShareCount > 1 ? '' : `(${invoiceHistory.length})`}
            </h2>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono text-ink-60">{customer.erp_code}</span>
              {invoiceHistoryOpen ? <ChevronUp size={16} className="text-ink-60" /> : <ChevronDown size={16} className="text-ink-60" />}
            </span>
          </button>
          {invoiceHistoryOpen && (
            erpHistoryLoading ? (
              <p className="text-sm text-ink-60 text-center py-8">Loading…</p>
            ) : erpCodeShareCount > 1 ? (
              <div className="px-5 py-4 flex items-start gap-2 text-sm text-amber-700 bg-amber-50">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>
                  ERP code <strong className="font-mono">{customer.erp_code}</strong> is shared by {erpCodeShareCount} customers in the app
                  (a JES "bucket" code, not unique to this one) — individual sales history can't be attributed
                  to just this customer, so it isn't shown here.
                </span>
              </div>
            ) : invoiceHistory.length === 0 ? (
              <p className="text-sm text-ink-60 text-center py-8">No sales invoices found for this customer.</p>
            ) : (
              <div className="divide-y divide-warm-grey">
                {invoiceHistory.slice(0, invoiceHistoryShown).map(r => {
                  const dateStr = r.date ? new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
                  const isApp = r.src === 'app'
                  const open = () => isApp ? navigate(`/shipments/${r.id}`) : setErpDoc(r.raw)
                  return (
                    <div key={r.key} onClick={open}
                         className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-ivory transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Receipt size={15} className="text-ink-60 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">
                            {r.no || '—'}
                            {/* r.uc (JES siref / app uc_no) already reads "UC4920/26" — no extra label prefix, or it doubles up. */}
                            {r.uc && <span className="ml-1.5 text-xs font-mono font-normal text-ink-60">{r.uc}</span>}
                          </p>
                          <p className="text-xs text-ink-60 mt-0.5">{dateStr}{r.currency ? ` · ${r.currency}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {r.amount != null && <span className="text-sm text-ink-80 tabular-nums">{Number(r.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                        {/* An app row's status is always null by design
                            (domain/salesInvoiceHistory.js: "an app row's
                            invoiced-ness IS its confirmation") — shown as
                            CONFIRMED here rather than no badge, which read as
                            "not confirmed" next to a JES row's real status
                            pill (found live, 2026-08-21). A JES row with no
                            status still shows nothing — unlike the portal
                            page, this list isn't pre-filtered to confirmed
                            rows only, so a genuinely-unconfirmed JES row must
                            not get an invented CONFIRMED label. */}
                        {(r.status || isApp) && <span className="badge bg-ivory-dark text-ink-70">{r.status || 'CONFIRMED'}</span>}
                        <span title={isApp ? 'Raised in the app' : 'From JES (read-only)'}
                              className="text-2xs font-medium text-ink-60 inline-flex items-center gap-1 border border-warm-grey rounded-full px-1.5 py-0.5">
                          {isApp ? 'App' : <><Database size={9} /> JES</>}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {invoiceHistory.length > invoiceHistoryShown && (
                  <button type="button" onClick={() => setInvoiceHistoryShown(n => n + 20)}
                          className="w-full text-xs text-brand-600 hover:text-brand-800 text-center py-2.5">
                    …and {invoiceHistory.length - invoiceHistoryShown} more — show more
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
      {erpDoc && <ErpDocModal of="sales_invoice" doc={erpDoc} onClose={() => setErpDoc(null)} />}

      {/* Quote history */}
      <Collapsible storageKey={`${id}:quotes`} title={`Quotes (${quotes.length})`} bodyClassName=""
                   right={<Link to={`/quotes/new?customer_id=${id}`} onClick={remember} className="btn-primary text-xs py-1.5 px-3">+ New Quote</Link>}>
        {quotes.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">No quotes yet for this customer.</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {quotes.map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} onClick={remember} className="flex items-center justify-between px-5 py-3.5 hover:bg-ivory transition-colors">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {q.quote_date || q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-ink-60 mt-0.5">
                    {q.item_count ? `${q.item_count} item${q.item_count > 1 ? 's' : ''}` : 'No items'}
                    {q.quote_currency ? ` · ${q.quote_currency}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge ${STATUS_STYLES[q.status] || STATUS_STYLES.draft}`}>{q.status || 'draft'}</span>
                  <span className="text-xs text-ink-60">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Collapsible>

      {/* Brand assets + customer proposal now live on their own page
          (/customers/:id/brand) — this is the summary + entry point. */}
      <BrandProposalCard customerId={id} />

      {/* Portal Enquiries (from the storefront) */}
      <Collapsible storageKey={`${id}:portal-enquiries`} title={`Portal Enquiries (${portalEnquiries.length})`} bodyClassName=""
                   right={<Link to="/enquiries" onClick={remember} className="text-xs text-brand-600 hover:underline">Manage →</Link>}>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">
            No storefront account linked, so portal enquiries can't be matched.{' '}
            <Link to="/customer-accounts" className="text-brand-600 hover:underline">Link one</Link>.
          </p>
        ) : portalEnquiries.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">No portal enquiries from this customer.</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {portalEnquiries.map(e => {
              const items = Array.isArray(e.items) ? e.items : []
              return (
                <div key={e.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs text-ink-60">{fmtDate(e.createdAt)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PORTAL_STATUS_STYLES[e.status || 'new'] || 'bg-ivory-dark text-ink-60'}`}>
                      {e.status || 'new'}
                    </span>
                    <span className="text-xs text-ink-60">
                      · {items.length} item{items.length === 1 ? '' : 's'}
                      {e.estimated_total ? ` · est. ${fmtMoney(e.estimated_total, e.currency)}` : ''}
                    </span>
                  </div>
                  {e.message && <p className="text-sm text-ink whitespace-pre-wrap mb-1.5">{e.message}</p>}
                  {items.length > 0 && (
                    <ul className="text-xs text-ink-70 space-y-0.5">
                      {items.slice(0, 6).map((it, i) => (
                        <li key={i} className="truncate">
                          <span className="text-ink-60">{it.qty || 1}×</span>{' '}
                          {it.name || it.code || 'Item'}
                          {it.code && it.name ? <span className="text-ink-60"> ({it.code})</span> : null}
                        </li>
                      ))}
                      {items.length > 6 && <li className="text-ink-60">…and {items.length - 6} more</li>}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Collapsible>

      {/* Email Summary (V8.1) — draft AI read of customers/{id}/email_threads,
          ingested by email-sync/sync.py outside this app, PLUS (V8.9) any
          linked marketing_contacts lead's own email_threads merged in — see
          mergedEmailThreads above. Hidden entirely when nothing's been
          ingested yet, rather than showing an empty card for the ~most
          customers not yet backfilled/matched. */}
      {mergedEmailThreads.length > 0 && (
        <Collapsible storageKey={`${id}:email-summary`}
          title={<span className="inline-flex items-center gap-1.5">
            <Mail size={15} className="text-ink-60" /> Email Summary
            <span className="text-xs font-normal text-ink-60">({mergedEmailThreads.length} thread{mergedEmailThreads.length === 1 ? '' : 's'} ingested)</span>
            {emailSyncStatus?.last_run_at && (
              <span className="text-xs font-normal text-ink-60"
                    title={`Mailbox last synced ${new Date(emailSyncStatus.last_run_at).toLocaleString('en-GB')} (${emailSyncStatus.new_messages ?? '?'} new message${emailSyncStatus.new_messages === 1 ? '' : 's'} that run)`}>
                · mailbox synced {new Date(emailSyncStatus.last_run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </span>}
          right={<button onClick={handleRefreshEmailSummary} disabled={emailSummaryBusy}
              className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
              {emailSummaryBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {customer?.email_summary ? 'Refresh' : 'Generate'}
            </button>}
          bodyClassName="px-5 py-4 space-y-3">
            {emailSummaryError && (
              <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {emailSummaryError}
              </div>
            )}
            {!customer?.email_summary ? (
              <p className="text-sm text-ink-60">Not generated yet — click {emailSummaryBusy ? '…' : 'Generate'} to have DeepSeek read the ingested threads.</p>
            ) : (
              <>
                <p className="text-sm text-ink-80">{customer.email_summary.summary}</p>
                {customer.email_summary.recent_activity && (
                  <div>
                    <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Recent activity</h4>
                    <p className="text-sm text-ink-70">{customer.email_summary.recent_activity}</p>
                  </div>
                )}
                {customer.email_summary.open_commitments?.length > 0 && (
                  <div>
                    <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Open commitments</h4>
                    <ul className="text-sm text-ink-70 list-disc list-inside space-y-0.5">
                      {customer.email_summary.open_commitments.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-2xs text-ink-60">
                  Generated over {customer.email_summary.thread_count ?? mergedEmailThreads.length} thread{(customer.email_summary.thread_count ?? mergedEmailThreads.length) === 1 ? '' : 's'} — a draft, not verified. Refresh after new mail comes in.
                </p>
              </>
            )}

            <div className="pt-2 border-t border-warm-grey">
              <button onClick={() => setEmailChatOpen(v => !v)}
                className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1">
                <MessageCircle size={13} /> {emailChatOpen ? 'Close' : 'Discover more about this customer'}
              </button>
              {emailChatOpen && (
                <div className="mt-2 border border-ivory-dark rounded-none p-3 bg-ivory-light space-y-2">
                  {emailChatHistory.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {emailChatHistory.map((h, i) => (
                        <div key={i} className={`text-sm ${h.role === 'assistant' ? 'text-ink-80' : 'text-ink'}`}>
                          <span className="font-medium">{h.role === 'assistant' ? 'AI: ' : 'You: '}</span>{h.content}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input value={emailChatInput} onChange={e => setEmailChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEmailChatSend()}
                      placeholder="e.g. What did we last discuss about pricing?"
                      className="input w-full text-sm" disabled={emailChatBusy} />
                    <button onClick={handleEmailChatSend} disabled={emailChatBusy || !emailChatInput.trim()}
                      className="btn-secondary shrink-0 text-xs px-3">
                      {emailChatBusy ? <Loader2 size={13} className="animate-spin" /> : 'Ask'}
                    </button>
                  </div>
                </div>
              )}
            </div>
        </Collapsible>
      )}

      {/* WhatsApp threads (V8.2) — see customers/{id}/whatsapp_threads comment
          above. Hidden entirely when nothing's imported yet, same posture as
          Email Summary — including its own AI summary now, generated the
          same way (Generate/Refresh below) and read by Daily Drafts via
          customers/{id}.whatsapp_summary. Deepgram transcription for voice
          notes (owner's own account, 2026-08-12) so a voice-heavy chat isn't
          silently missing content from that summary. */}
      {mergedWhatsappThreads.length > 0 && (
        <Collapsible storageKey={`${id}:whatsapp`} bodyClassName=""
          title={<span className="inline-flex items-center gap-1.5">
            <Smartphone size={15} className="text-ink-60" /> WhatsApp
            <span className="text-xs font-normal text-ink-60">
              ({mergedWhatsappThreads.length} chat{mergedWhatsappThreads.length === 1 ? '' : 's'} imported
              {mergedWhatsappThreads[0]?.date_range?.[1] && (
                <> · latest message {new Date(mergedWhatsappThreads[0].date_range[1]).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>
              )})
            </span>
          </span>}
          right={<button onClick={handleRefreshWhatsappSummary} disabled={whatsappSummaryBusy}
              className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
              {whatsappSummaryBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {customer?.whatsapp_summary ? 'Refresh' : 'Generate'}
            </button>}>
          <div className="px-5 py-4 space-y-3 border-b border-warm-grey">
            {whatsappSummaryError && (
              <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {whatsappSummaryError}
              </div>
            )}
            {!customer?.whatsapp_summary ? (
              <p className="text-sm text-ink-60">Not generated yet — click {whatsappSummaryBusy ? '…' : 'Generate'} to have DeepSeek read the imported chats.</p>
            ) : (
              <>
                <p className="text-sm text-ink-80">{customer.whatsapp_summary.summary}</p>
                {customer.whatsapp_summary.recent_activity && (
                  <div>
                    <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Recent activity</h4>
                    <p className="text-sm text-ink-70">{customer.whatsapp_summary.recent_activity}</p>
                  </div>
                )}
                {customer.whatsapp_summary.open_commitments?.length > 0 && (
                  <div>
                    <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Open commitments</h4>
                    <ul className="text-sm text-ink-70 list-disc list-inside space-y-0.5">
                      {customer.whatsapp_summary.open_commitments.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-2xs text-ink-60">
                  Generated over {customer.whatsapp_summary.thread_count ?? whatsappThreads.length} chat{(customer.whatsapp_summary.thread_count ?? whatsappThreads.length) === 1 ? '' : 's'} — a draft, not verified. Refresh after new chats come in. Used by Daily Drafts.
                </p>
              </>
            )}
          </div>
          {transcribeError && (
            <p className="px-5 pt-3 text-xs text-red-600">{transcribeError}</p>
          )}
          <div className="divide-y divide-warm-grey">
            {mergedWhatsappThreads.map(t => {
              const voiceCount = (t.messages || []).filter(m => m.needs_transcription).length
              const expanded = whatsappExpanded === t.id
              const isLinked = t._source === 'linked'
              return (
                <div key={t.id} className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setWhatsappExpanded(v => v === t.id ? null : t.id)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink flex items-center gap-1.5">
                        {t.subject || t.id}
                        {isLinked && (
                          <span className="text-2xs font-normal uppercase tracking-wide rounded-none px-1 py-0.5 text-amber-600 bg-amber-50 shrink-0">
                            via linked lead
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-60 mt-0.5">
                        {t.channel} · {t.message_count} message{t.message_count === 1 ? '' : 's'}
                        {t.date_range?.length === 2 && ` · ${fmtIsoDate(t.date_range[0])} – ${fmtIsoDate(t.date_range[1])}`}
                        {voiceCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 ml-2 text-amber-600">
                            <Mic size={11} />{voiceCount} not transcribed
                          </span>
                        )}
                      </p>
                    </div>
                    {expanded ? <ChevronUp size={16} className="text-ink-60 shrink-0" /> : <ChevronDown size={16} className="text-ink-60 shrink-0" />}
                  </button>
                  {expanded && (
                    <div className="mt-3 max-h-80 overflow-y-auto space-y-2 border-t border-warm-grey pt-3">
                      {isLinked && (
                        <p className="text-2xs text-ink-60 italic">
                          Imported under the linked Marketing Contact record, not this customer — transcription isn't available from here. Open it from Marketing Contacts to transcribe.
                        </p>
                      )}
                      {(t.messages || []).map((m, i) => {
                        const msgBusy = transcribingKey === `${t.id}:${i}`
                        const langKey = `${t.id}:${i}`
                        const selectedLang = transcribeLang[langKey] || 'zh-HK'
                        return (
                          <div key={i} className="text-sm">
                            <span className="text-xs text-ink-60">{fmtIsoDate(m.date)} · {m.from}</span>
                            {m.body_text && <p className="text-ink-80">{m.body_text}</p>}
                            {m.transcript && (
                              <p className="text-ink-80 italic">
                                <Mic size={11} className="inline align-[-1px] mr-1 text-ink-60" />{m.transcript}
                              </p>
                            )}
                            {m.attachment_filename && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <WhatsAppAttachment filename={m.attachment_filename} url={m.attachment_url} className="text-xs" />
                                {!isLinked && /\.opus$/i.test(m.attachment_filename || '') && m.attachment_url && (
                                  <>
                                    <select
                                      value={selectedLang}
                                      onChange={e => setTranscribeLang(prev => ({ ...prev, [langKey]: e.target.value }))}
                                      disabled={!!transcribingKey}
                                      className="text-xs border border-warm-grey rounded-none px-1 py-0.5 text-ink-70"
                                    >
                                      {WHATSAPP_TRANSCRIBE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => handleTranscribeMessage(t.id, i, selectedLang)}
                                      disabled={!!transcribingKey}
                                      className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50 inline-flex items-center gap-1"
                                    >
                                      {msgBusy ? <Loader2 size={11} className="animate-spin" /> : null}
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
        </Collapsible>
      )}

      {/* Alibaba Messages (V8.10) — customers/{id}/alibaba_threads, see the
          state/handlers comment above. Always shown, unlike WhatsApp/Email
          above which hide until something's been imported — there's no
          import page for Alibaba, pasting into this card IS how content
          gets in. */}
      <Collapsible storageKey={`${id}:alibaba`} bodyClassName=""
        title={<span className="inline-flex items-center gap-1.5">
          <MessageSquare size={15} className="text-ink-60" /> Alibaba Messages
          {mergedAlibabaThreads.length > 0 && (
            <span className="text-xs font-normal text-ink-60">
              ({mergedAlibabaThreads.length} paste{mergedAlibabaThreads.length === 1 ? '' : 's'})
            </span>
          )}
        </span>}
        right={mergedAlibabaThreads.length > 0 && (
          <button onClick={handleRefreshAlibabaSummary} disabled={alibabaSummaryBusy}
            className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
            {alibabaSummaryBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {customer?.alibaba_summary ? 'Refresh' : 'Generate'}
          </button>
        )}>
        <div className="px-5 py-4 space-y-3 border-b border-warm-grey">
          <div>
            <label className="label">Paste Alibaba chat</label>
            <p className="text-xs text-ink-60 mb-1.5">
              Alibaba.com gives no export for buyer-seller chat — copy the conversation off the site and paste it here. Safe to paste again later as new messages come in; nothing is overwritten.
            </p>
            {alibabaThreads.length > 0 && (
              <p className="text-xs font-medium text-ink-60 mb-1.5">
                Last pasted: {(alibabaThreads[0].pasted_at?.toDate ? alibabaThreads[0].pasted_at.toDate() : new Date(alibabaThreads[0].pasted_at || Date.now())).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                {' — '}Alibaba shows the whole conversation every time, so only copy what's newer than this date next time.
              </p>
            )}
            <textarea
              className="input"
              rows={5}
              value={alibabaPasteText}
              onChange={e => setAlibabaPasteText(e.target.value)}
              placeholder="Paste the raw Alibaba.com chat text here…"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                type="button"
                onClick={handleSaveAlibabaPaste}
                disabled={alibabaSaveBusy || !alibabaPasteText.trim()}
                className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
              >
                {alibabaSaveBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                {alibabaSaveBusy ? 'Saving…' : 'Save pasted messages'}
              </button>
              {alibabaSaved && (
                <span className="text-xs text-green-600 inline-flex items-center gap-1"><Check size={13} /> Saved</span>
              )}
            </div>
            {alibabaSaveError && (
              <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-start gap-1.5 mt-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {alibabaSaveError}
              </div>
            )}
          </div>

          {alibabaSummaryError && (
            <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {alibabaSummaryError}
            </div>
          )}
          {mergedAlibabaThreads.length === 0 ? (
            <p className="text-sm text-ink-60">Nothing pasted yet — paste the chat above to get started.</p>
          ) : !customer?.alibaba_summary ? (
            <p className="text-sm text-ink-60">Not generated yet — click {alibabaSummaryBusy ? '…' : 'Generate'} to have DeepSeek read the pasted messages.</p>
          ) : (
            <>
              <p className="text-sm text-ink-80">{customer.alibaba_summary.summary}</p>
              {customer.alibaba_summary.recent_activity && (
                <div>
                  <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Recent activity</h4>
                  <p className="text-sm text-ink-70">{customer.alibaba_summary.recent_activity}</p>
                </div>
              )}
              {customer.alibaba_summary.open_commitments?.length > 0 && (
                <div>
                  <h4 className="text-xs text-ink-60 uppercase tracking-wide mb-1">Open commitments</h4>
                  <ul className="text-sm text-ink-70 list-disc list-inside space-y-0.5">
                    {customer.alibaba_summary.open_commitments.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-2xs text-ink-60">
                Generated over {customer.alibaba_summary.paste_count ?? mergedAlibabaThreads.length} paste{(customer.alibaba_summary.paste_count ?? mergedAlibabaThreads.length) === 1 ? '' : 's'} — a draft, not verified. Refresh after new messages come in. Used by Daily Drafts.
              </p>
            </>
          )}
        </div>
        {mergedAlibabaThreads.length > 0 && (
          <div className="divide-y divide-warm-grey">
            {mergedAlibabaThreads.map(t => {
              const expanded = alibabaExpanded === t.id
              const isLinked = t._source === 'linked'
              const d = t.pasted_at?.toDate ? t.pasted_at.toDate() : (t.pasted_at ? new Date(t.pasted_at) : null)
              const dateLabel = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '(unknown date)'
              return (
                <div key={t.id} className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setAlibabaExpanded(v => v === t.id ? null : t.id)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink flex items-center gap-1.5">
                        Pasted {dateLabel}
                        {isLinked && (
                          <span className="text-2xs font-normal uppercase tracking-wide rounded-none px-1 py-0.5 text-amber-600 bg-amber-50 shrink-0">
                            via linked lead
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-60 mt-0.5">{(t.char_count || (t.raw_text || '').length).toLocaleString()} characters</p>
                    </div>
                    {expanded ? <ChevronUp size={16} className="text-ink-60 shrink-0" /> : <ChevronDown size={16} className="text-ink-60 shrink-0" />}
                  </button>
                  {expanded && (
                    <div className="mt-3 max-h-80 overflow-y-auto border-t border-warm-grey pt-3">
                      <p className="text-sm text-ink-80 whitespace-pre-wrap">{t.raw_text}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Collapsible>

      {/* Compose Message */}
      <Collapsible storageKey={`${id}:compose`} defaultOpen={false}
        title={<span className="inline-flex items-center gap-1.5"><Sparkle size={15} />Compose Message</span>}
        bodyClassName="px-5 pb-5 space-y-4">
        <p className="text-xs text-ink-60 -mt-2 mb-1">AI-written message tailored to this customer</p>

          {/* Product picker */}
          <div>
            <label className="label">Product <span className="text-ink-60 font-normal">(optional)</span></label>
            {composeProduct ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-none border border-brand-200 bg-brand-50">
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
                  <div className="absolute z-10 w-full bg-white border border-warm-grey rounded-none shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {allProducts.filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase())).length === 0 ? (
                      <p className="text-xs text-ink-60 px-3 py-2">No products found</p>
                    ) : allProducts
                        .filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => { setComposeProduct(p); setComposeProductSearch(''); setComposeProductOpen(false) }}
                            className="w-full text-left px-3 py-2.5 hover:bg-ivory border-b border-warm-grey last:border-0"
                          >
                            <p className="text-sm font-medium text-ink">{p.name}</p>
                            {p.category && <p className="text-xs text-ink-60">{p.category}</p>}
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
              {CHANNELS.map(c => <option key={c} value={c}>{c}{NO_API_CHANNELS.includes(c) ? ' (manual)' : ''}</option>)}
              {/* Customer.channels[] may still hold a pre-unification value (e.g.
                  plain "WhatsApp") — show it rather than silently defaulting blank. */}
              {composeChannel && !CHANNELS.includes(composeChannel) && <option value={composeChannel}>{composeChannel} (legacy)</option>}
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
      </Collapsible>

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
      <dt className="w-20 text-ink-60 shrink-0">{label}</dt>
      <dd className="text-ink min-w-0 break-words">{value}</dd>
    </div>
  )
}

function isOverdue(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d < new Date()
}
