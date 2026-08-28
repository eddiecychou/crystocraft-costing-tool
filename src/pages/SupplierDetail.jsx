import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc, collection, collectionGroup, query, where, getDocs, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import SupplierCatalogs from '../components/SupplierCatalogs'
import SupplierAddQuoteModal from '../components/SupplierAddQuoteModal'
import { SUPPLIER_CATEGORIES, PO_PAYMENT_TERM_LABEL, PO_STATUSES } from '../constants'
import { fmtMoney } from '../currency'
import { poTotals } from '../purchaseOrders'
import { AlertTriangle, Star, FileText, ExternalLink, FolderOpen, MessageCircle, Check } from 'lucide-react'

// Supplier Workstation Phase 1 — quick-access sourcing links. Order matters:
// website first, then each marketplace's shop before its product/catalogue
// page, matching the form's own grouping. Only a populated, http(s) value
// ever renders a button — no dead links, no placeholder chips.
const QUICK_LINKS = [
  { key: 'website_url', label: 'Website' },
  { key: 'shop_1688_url', label: '1688 Shop' },
  { key: 'product_1688_url', label: '1688 Product' },
  { key: 'taobao_shop_url', label: 'Taobao Shop' },
  { key: 'taobao_product_url', label: 'Taobao Product' },
  { key: 'alibaba_shop_url', label: 'Alibaba Shop' },
  { key: 'alibaba_product_url', label: 'Alibaba Product' },
]
const isHttpUrl = v => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim())
import useScrollMemory from '../hooks/useScrollMemory'
import {
  supplierContactsOf, activeSupplierContacts, inactiveSupplierContacts,
} from '../domain/supplierContacts'

// WeChat's own search only matches the bare local number, so drop a leading
// +86 / 86 China country code and separators (owner). Other country codes stay.
const wechatSearchPhone = p => (p || '').trim().replace(/^\+?86[\s-]*/, '').replace(/[\s-]/g, '')

const PO_STATUS_META = Object.fromEntries(PO_STATUSES.map(s => [s.value, s]))
// Lists longer than this get a search box + "show all" collapse instead of a
// long scroll — suppliers with years of quotes/POs were becoming unwieldy.
const COLLAPSE_THRESHOLD = 8

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && typeof val === 'string') return [val]
  return []
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 break-all">{value}</span>
    </div>
  )
}

function MultiRow({ label, values, render }) {
  const arr = toArray(values)
  if (!arr.length) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <div className="space-y-0.5">
        {arr.map((v, i) => <div key={i} className="text-sm text-gray-800 break-all">{render ? render(v) : v}</div>)}
      </div>
    </div>
  )
}

export default function SupplierDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [supplier, setSupplier]         = useState(null)
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [quotes, setQuotes]             = useState([])
  const [rangeQuotes, setRangeQuotes]   = useState([])
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [showAddQuote, setShowAddQuote] = useState(false)
  const [indexError, setIndexError]     = useState(false)
  const [quoteSearch, setQuoteSearch]         = useState('')
  const [showAllQuotes, setShowAllQuotes]     = useState(false)
  const [rangeSearch, setRangeSearch]         = useState('')
  const [showAllRangeQuotes, setShowAllRangeQuotes] = useState(false)
  const [pos, setPos]             = useState([])
  const [posLoading, setPosLoading] = useState(true)
  // WeChat has no reliable per-contact deep link (owner re-tested 2026-08-28,
  // weixin:// only ever opens the app). The stored wechat_id is also often an
  // internal wxid_… value that WeChat's own search can't resolve. Phone-number
  // search IS reliable, so the WeChat quick-access copies the supplier's phone
  // (paste into WeChat → Add Contacts).
  const [wechatCopied, setWechatCopied] = useState(false)
  const [copiedContactId, setCopiedContactId] = useState(null)
  const remember = useScrollMemory(`supplier-${id}`, !loading)

  useEffect(() => {
    getDoc(doc(db, 'suppliers', id)).then(snap => {
      if (snap.exists()) setSupplier({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    setPosLoading(true)
    getDocs(query(collection(db, 'purchase_orders'), where('supplier_id', '==', id)))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => (b.issued_date || '').localeCompare(a.issued_date || ''))
        setPos(list)
      })
      .catch(() => setPos([]))
      .finally(() => setPosLoading(false))
  }, [id])

  async function loadQuotes() {
    setQuotesLoading(true)
    setIndexError(false)
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'supplier_quotes'), where('supplier_id', '==', id))
      )

      // Separate corp-gift quotes (products/.../supplier_quotes/...)
      // from range-component quotes (range_components/.../supplier_quotes/...)
      const corpRaw = []
      const rangeRaw = []
      snap.docs.forEach(d => {
        const parts = d.ref.path.split('/')
        if (parts[0] === 'range_components') {
          rangeRaw.push({ id: d.id, componentId: parts[1], ...d.data() })
        } else {
          corpRaw.push({ id: d.id, productId: parts[1], componentId: parts[3], ...d.data() })
        }
      })

      // ── Corp-gift: resolve product + component names ───────────────────
      const productIds = [...new Set(corpRaw.map(r => r.productId))]
      const productNames = {}
      await Promise.all(productIds.map(pid =>
        getDoc(doc(db, 'products', pid)).then(s => { productNames[pid] = s.data()?.name || null })
      ))
      const compKeys = [...new Set(corpRaw.map(r => `${r.productId}::${r.componentId}`))]
      const compNames = {}
      await Promise.all(compKeys.map(key => {
        const [pid, cid] = key.split('::')
        return getDoc(doc(db, 'products', pid, 'components', cid))
          .then(s => { compNames[key] = s.data()?.name || cid })
      }))
      const enrichedCorp = corpRaw.map(r => ({
        ...r,
        _productName:   productNames[r.productId] || '',
        _componentName: compNames[`${r.productId}::${r.componentId}`] || '',
      }))

      // Auto-delete orphaned corp-gift quotes (parent product deleted)
      const orphans = enrichedCorp.filter(r => !productNames[r.productId])
      if (orphans.length) {
        const batch = writeBatch(db)
        orphans.forEach(r => {
          batch.delete(doc(db, 'products', r.productId, 'components', r.componentId, 'supplier_quotes', r.id))
        })
        await batch.commit()
      }

      setQuotes(
        enrichedCorp
          .filter(r => productNames[r.productId])
          .sort((a, b) => a._productName.localeCompare(b._productName))
      )

      // ── Range components: resolve component names ──────────────────────
      const rcIds = [...new Set(rangeRaw.map(r => r.componentId))]
      const rcNames = {}
      await Promise.all(rcIds.map(cid =>
        getDoc(doc(db, 'range_components', cid)).then(s => { rcNames[cid] = s.data()?.name || s.data()?.code || cid })
      ))
      setRangeQuotes(
        rangeRaw
          .map(r => ({ ...r, _componentName: rcNames[r.componentId] || r.componentId }))
          .sort((a, b) => a._componentName.localeCompare(b._componentName))
      )
    } catch (err) {
      console.error('Supplier quotes query error:', err.code, err.message)
      setIndexError(true)
    } finally {
      setQuotesLoading(false)
    }
  }

  useEffect(() => { loadQuotes() }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'suppliers', id))
    navigate('/suppliers')
  }

  const filteredQuotes = useMemo(() => {
    const q = quoteSearch.trim().toLowerCase()
    if (!q) return quotes
    return quotes.filter(x => [x._productName, x._componentName, x.notes].some(v => (v || '').toLowerCase().includes(q)))
  }, [quotes, quoteSearch])
  const visibleQuotes = (showAllQuotes || quoteSearch || filteredQuotes.length <= COLLAPSE_THRESHOLD)
    ? filteredQuotes : filteredQuotes.slice(0, COLLAPSE_THRESHOLD)

  const filteredRangeQuotes = useMemo(() => {
    const q = rangeSearch.trim().toLowerCase()
    if (!q) return rangeQuotes
    return rangeQuotes.filter(x => [x._componentName, x.notes].some(v => (v || '').toLowerCase().includes(q)))
  }, [rangeQuotes, rangeSearch])
  const visibleRangeQuotes = (showAllRangeQuotes || rangeSearch || filteredRangeQuotes.length <= COLLAPSE_THRESHOLD)
    ? filteredRangeQuotes : filteredRangeQuotes.slice(0, COLLAPSE_THRESHOLD)

  if (loading) return <LoadingBar />
  if (!supplier) return <div className="p-6 text-gray-500">Supplier not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">← Suppliers</Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
            {supplier.erp_code && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{supplier.erp_code}</span>
            )}
          </div>
          {supplier.name_cn && <p className="text-gray-500 text-sm mt-0.5">{supplier.name_cn}</p>}
          {supplier.category && (() => {
            const cat = SUPPLIER_CATEGORIES.find(c => c.value === supplier.category)
            return cat ? (
              <span className="inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 font-medium">
                <cat.Icon size={12} className="inline align-[-2px] mr-1" />{supplier.category}
              </span>
            ) : null
          })()}
        </div>
        <div className="flex gap-2">
          <Link to={`/suppliers/${id}/edit`} onClick={remember} className="btn-secondary">Edit</Link>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      {/* Supplier Workstation Phase 1 — Quick Access. Compact single row of
          chips; only renders a link chip for a populated+valid value (no
          dead buttons) — the "Catalogues & Files" chip always shows since
          SupplierCatalogs below already handles the empty case on its own
          ("no catalogs yet").
          WeChat: a copy-to-clipboard chip, not a link. Personal WeChat has
          no reliable per-contact deep link — weixin://dl/profile/<id> was
          re-tested 2026-08-28 and only ever opens the app to nowhere.
          Phone-number search IS reliable, so the chip copies the supplier's
          phone (office line, else the primary contact's) with the +86/86
          China country code stripped, for pasting into WeChat → Add
          Contacts. If there's no phone but a WeChat ID is on file it copies
          that instead. Hidden only when there's neither. */}
      {(() => {
        const links = QUICK_LINKS.filter(l => isHttpUrl(supplier[l.key]))
        const primaryC = supplierContactsOf(supplier).find(c => c.is_primary && c.active)
        const wechatPhone = wechatSearchPhone(
          toArray(supplier.phones ?? supplier.phone)[0] || primaryC?.phone || '',
        )
        const fallbackWechatId = (supplier.wechat_id || primaryC?.wechat || '').trim()
        const copyValue = wechatPhone || fallbackWechatId
        const copyIsPhone = !!wechatPhone
        const copyWechat = async () => {
          try {
            await navigator.clipboard.writeText(copyValue)
            setWechatCopied(true)
            setTimeout(() => setWechatCopied(false), 1500)
          } catch { /* clipboard blocked — value is still visible in the Contacts card */ }
        }
        return (
          <div className="card p-4 mb-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">Quick Access</p>
            <div className="flex flex-wrap items-center gap-2">
              {links.map(l => (
                <a key={l.key} href={supplier[l.key]} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:border-brand-400 hover:text-brand-700 transition-colors">
                  <ExternalLink size={12} />{l.label}
                </a>
              ))}
              {copyValue && (
                <button type="button" onClick={copyWechat}
                   title={`Copy ${copyIsPhone ? `phone "${copyValue}"` : `WeChat ID "${copyValue}"`} — paste into WeChat → Add Contacts`}
                   className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:border-brand-400 hover:text-brand-700 transition-colors">
                  {wechatCopied ? <Check size={12} /> : <MessageCircle size={12} />}
                  {wechatCopied ? 'Copied' : (copyIsPhone ? 'Copy phone for WeChat' : 'Copy WeChat ID')}
                </button>
              )}
              <a href="#catalogues"
                 className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:border-brand-400 hover:text-brand-700 transition-colors">
                <FolderOpen size={12} />Catalogues &amp; Files
              </a>
            </div>
          </div>
        )
      })()}

      {(() => {
        const all = supplierContactsOf(supplier)
        if (all.length === 0) return null
        const active = activeSupplierContacts(all)
        const gone = inactiveSupplierContacts(all)
        const contactWechatValue = c => wechatSearchPhone(c.phone) || (c.wechat || '').trim()
        const copyForWechat = async (c) => {
          const val = contactWechatValue(c)
          if (!val) return
          try {
            await navigator.clipboard.writeText(val)
            setCopiedContactId(c.id)
            setTimeout(() => setCopiedContactId(x => (x === c.id ? null : x)), 1500)
          } catch { /* clipboard blocked — value is still shown on the row */ }
        }
        const Card = (c, dim) => (
          <div key={c.id} className={`py-3 border-b border-gray-50 last:border-0 ${dim ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{c.name || '—'}</span>
              {c.title && <span className="text-xs text-gray-500">{c.title}</span>}
              {c.is_primary && !dim && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 uppercase tracking-wide">Primary</span>}
              {dim && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase tracking-wide">Left</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              {c.phone && <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline">{c.phone}</a>}
              {c.wechat && <span>WeChat: {c.wechat}</span>}
              {c.whatsapp && <span>WhatsApp: {c.whatsapp}</span>}
              {c.email && <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a>}
              {contactWechatValue(c) && (
                <button type="button" onClick={() => copyForWechat(c)}
                  title={`Copy ${wechatSearchPhone(c.phone) ? `phone "${wechatSearchPhone(c.phone)}"` : `WeChat ID "${c.wechat}"`} — paste into WeChat → Add Contacts`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:border-brand-400 hover:text-brand-700 transition-colors">
                  {copiedContactId === c.id ? <Check size={11} /> : <MessageCircle size={11} />}
                  {copiedContactId === c.id ? 'Copied' : (wechatSearchPhone(c.phone) ? 'Copy phone for WeChat' : 'Copy WeChat ID')}
                </button>
              )}
            </div>
          </div>
        )
        return (
          <div className="card p-5 mb-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Contacts</p>
            {active.map(c => Card(c, false))}
            {gone.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-gray-400 cursor-pointer">Former contacts ({gone.length})</summary>
                {gone.map(c => Card(c, true))}
              </details>
            )}
          </div>
        )
      })()}

      <div className="card p-5 space-y-0">
        <InfoRow label="Country" value={supplier.country} />
        <InfoRow label="City / Region" value={supplier.city} />
        <InfoRow label="Address" value={supplier.address} />
        <MultiRow label="Office phone" values={supplier.phones ?? supplier.phone}
          render={v => <a href={`tel:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        <MultiRow label="Office email" values={supplier.emails ?? supplier.email}
          render={v => <a href={`mailto:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        <InfoRow label="Default Currency" value={supplier.default_currency} />
        <InfoRow label="Payment Terms" value={PO_PAYMENT_TERM_LABEL[supplier.default_payment_terms] || supplier.default_payment_terms} />
        {supplier.notes && (
          <div className="pt-3 mt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}
      </div>

      {/* Purchase Orders */}
      <div className="card mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Purchase Orders {!posLoading && <span className="text-gray-400 font-normal">({pos.length})</span>}
          </h2>
          <Link to={`/purchase-orders/new?supplier=${id}`} className="btn-primary text-xs py-1.5 px-3">+ New PO</Link>
        </div>

        {posLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading purchase orders…</p>
        ) : pos.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No purchase orders for this supplier yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {pos.map(p => {
              const meta = PO_STATUS_META[p.status || 'draft'] || PO_STATUS_META.draft
              const { balance } = poTotals(p)
              return (
                <Link key={p.id} to={`/purchase-orders/${p.id}`} onClick={remember}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <FileText size={16} className="text-gray-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-gray-900">{p.pu_number || '(no PU no.)'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                    </div>
                    {p.issued_date && <p className="text-xs text-gray-500 mt-0.5">{fmtDate(p.issued_date)}</p>}
                  </div>
                  <span className="text-sm font-medium tabular-nums text-gray-800 shrink-0">{fmtMoney(balance, p.currency || 'RMB')}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Supplier Quotes */}
      <div className="card mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Corp Gift Component Quotes {!quotesLoading && <span className="text-gray-400 font-normal">({quotes.length})</span>}
          </h2>
          <button onClick={() => setShowAddQuote(true)} className="btn-primary text-xs py-1.5 px-3">
            + Add Quote
          </button>
        </div>

        {indexError && (
          <div className="p-4 text-sm text-amber-700 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />A Firestore index is needed for this query. Check the browser console for a link to create it — takes about 1 minute.
          </div>
        )}

        {quotes.length > COLLAPSE_THRESHOLD && (
          <div className="px-5 py-2.5 border-b border-gray-100">
            <input type="text" placeholder="Search product or component…" className="input w-full text-sm"
                   value={quoteSearch} onChange={e => { setQuoteSearch(e.target.value); setShowAllQuotes(false) }} />
          </div>
        )}

        {quotesLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading quotes…</p>
        ) : quotes.length === 0 && !indexError ? (
          <p className="text-sm text-gray-400 text-center py-8">No component quotes linked to this supplier yet.</p>
        ) : filteredQuotes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No quotes match "{quoteSearch}".</p>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {visibleQuotes.map(q => {
                const isOrphaned = !q._productName || q._productName === q.productId
                const productLabel = isOrphaned ? (q.supplier_name || 'Unknown Product') : q._productName
                const componentLabel = (!q._componentName || q._componentName === q.componentId) ? '—' : q._componentName
                const rowClass = 'flex items-start justify-between px-5 py-3.5 gap-3 transition-colors'
                const inner = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{productLabel}</p>
                        {q.is_preferred && (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-medium shrink-0"><Star size={11} className="fill-current" />Preferred</span>
                        )}
                        {isOrphaned && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 shrink-0">Product deleted</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">Component: {componentLabel}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                        {q.unit_cost != null && (
                          <span className="font-medium text-gray-700">{q.unit_cost} {q.unit_cost_currency}</span>
                        )}
                        {q.moq && <span>MOQ {q.moq.toLocaleString()}</span>}
                        {q.production_lead_time_days && <span>Prod {q.production_lead_time_days}d</span>}
                        {q.sampling_lead_time_days && <span>Sample {q.sampling_lead_time_days}d</span>}
                      </div>
                      {q.notes && <p className="text-xs text-gray-400 mt-0.5 italic truncate">{q.notes}</p>}
                    </div>
                    {!isOrphaned && <span className="text-xs text-gray-400 shrink-0 mt-1">Edit →</span>}
                  </>
                )
                return isOrphaned
                  ? <div key={q.id} className={`${rowClass} opacity-50 cursor-default`}>{inner}</div>
                  : <Link key={q.id} to={`/products/${q.productId}/components/${q.componentId}/quotes/${q.id}`} onClick={remember} className={`${rowClass} hover:bg-gray-50`}>{inner}</Link>
              })}
            </div>
            {!quoteSearch && filteredQuotes.length > COLLAPSE_THRESHOLD && (
              <div className="px-5 py-3 border-t border-gray-100 text-center">
                <button onClick={() => setShowAllQuotes(s => !s)} className="text-xs text-brand-600 hover:underline">
                  {showAllQuotes ? 'Show less' : `Show all ${filteredQuotes.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Range Component Quotes */}
      {!quotesLoading && rangeQuotes.length > 0 && (
        <div className="card mb-6">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Figurine Range Component Quotes <span className="text-gray-400 font-normal">({rangeQuotes.length})</span>
            </h2>
          </div>

          {rangeQuotes.length > COLLAPSE_THRESHOLD && (
            <div className="px-5 py-2.5 border-b border-gray-100">
              <input type="text" placeholder="Search component…" className="input w-full text-sm"
                     value={rangeSearch} onChange={e => { setRangeSearch(e.target.value); setShowAllRangeQuotes(false) }} />
            </div>
          )}

          {filteredRangeQuotes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No quotes match "{rangeSearch}".</p>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {visibleRangeQuotes.map(q => (
                  <Link key={q.id} to={`/components/critical/${q.componentId}/quotes/${q.id}`}
                        className="flex items-start justify-between px-5 py-3.5 gap-3 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{q._componentName}</p>
                        {q.is_preferred && (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-medium shrink-0">
                            <Star size={11} className="fill-current" />Preferred
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                        {q.unit_cost != null && <span className="font-medium text-gray-700">{q.unit_cost} {q.unit_cost_currency}</span>}
                        {q.moq && <span>MOQ {Number(q.moq).toLocaleString()}</span>}
                        {q.production_lead_time_days && <span>Prod {q.production_lead_time_days}d</span>}
                        {q.tooling_sample_cost != null && <span>Tooling {q.tooling_sample_cost} {q.tooling_sample_cost_currency}</span>}
                      </div>
                      {q.notes && <p className="text-xs text-gray-400 mt-0.5 italic truncate">{q.notes}</p>}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 mt-1">Edit →</span>
                  </Link>
                ))}
              </div>
              {!rangeSearch && filteredRangeQuotes.length > COLLAPSE_THRESHOLD && (
                <div className="px-5 py-3 border-t border-gray-100 text-center">
                  <button onClick={() => setShowAllRangeQuotes(s => !s)} className="text-xs text-brand-600 hover:underline">
                    {showAllRangeQuotes ? 'Show less' : `Show all ${filteredRangeQuotes.length}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div id="catalogues" className="scroll-mt-4">
        <SupplierCatalogs supplierId={id} />
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${supplier.name}"? This will not affect existing quotes that reference this supplier.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showAddQuote && (
        <SupplierAddQuoteModal
          supplier={supplier}
          onClose={() => setShowAddQuote(false)}
          onSaved={() => { setShowAddQuote(false); loadQuotes() }}
        />
      )}
    </div>
  )
}
