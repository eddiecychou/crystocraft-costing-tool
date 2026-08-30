import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { SUPPLIER_CATEGORIES, SUPPLIER_PROVINCES, CURRENCIES, PO_PAYMENT_TERMS } from '../constants'
import {
  supplierContactsOf, cleanSupplierContacts, flatFieldsFromContacts, genContactId,
} from '../domain/supplierContacts'

// Supplier Workstation Phase 1 — sourcing/quick-access links. Field names
// use a leading word (shop_1688_url, not 1688_shop_url) because a JS/
// Firestore field name can't start with a digit; "1688" is kept in the
// middle so the platform is still obvious at a glance.
const LINK_FIELDS = [
  { key: 'website_url', label: 'Website' },
  { key: 'shop_1688_url', label: '1688 Shop' },
  { key: 'product_1688_url', label: '1688 Product / Catalogue' },
  { key: 'taobao_shop_url', label: 'Taobao Shop' },
  { key: 'taobao_product_url', label: 'Taobao Product / Catalogue' },
  { key: 'alibaba_shop_url', label: 'Alibaba Shop / Supplier Page' },
  { key: 'alibaba_product_url', label: 'Alibaba Product / Catalogue' },
]
// Deliberately permissive (any http(s) URL) — these are internal sourcing
// links typed in by hand, not something worth over-validating.
const isValidUrl = v => !v || /^https?:\/\/\S+$/i.test(v.trim())

const genLinkId = () => `lk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// Free-form extra sourcing links beyond the seven named platform fields — a
// supplier often has several 1688/Taobao product pages, a WeChat mini-shop, a
// Google Drive of catalogues, etc. Stored as supplier.extra_links[] =
// [{ id, label, url }]; rendered as extra chips on the detail page.
function ExtraLinkRows({ links, onChange, errors }) {
  const set = (i, field, val) => onChange(links.map((l, j) => (j === i ? { ...l, [field]: val } : l)))
  const add = () => onChange([...links, { id: genLinkId(), label: '', url: '' }])
  const remove = i => onChange(links.filter((_, j) => j !== i))
  return (
    <div className="space-y-2 mt-3">
      {links.map((l, i) => (
        <div key={l.id || i}>
          <div className="flex gap-2">
            <input className="input w-40 shrink-0" value={l.label} onChange={e => set(i, 'label', e.target.value)}
                   placeholder="Label e.g. 1688 store 2" />
            <input className="input flex-1" type="url" value={l.url} onChange={e => set(i, 'url', e.target.value)}
                   placeholder="https://…" />
            <button type="button" onClick={() => remove(i)}
                    className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none shrink-0">×</button>
          </div>
          {errors?.[l.id] && <p className="text-xs text-red-600 mt-1">{errors[l.id]}</p>}
        </div>
      ))}
      <button type="button" onClick={add} className="text-xs text-brand-600 hover:text-brand-800">+ Add link</button>
    </div>
  )
}

// Convert old string or existing array → clean array with at least one entry
function toArray(val) {
  if (Array.isArray(val)) return val.length ? val : ['']
  if (val && typeof val === 'string') return [val]
  return ['']
}

function MultiInput({ label, values, onChange, type = 'text', placeholder }) {
  function update(i, v) { onChange(values.map((x, j) => j === i ? v : x)) }
  function add() { onChange([...values, '']) }
  function remove(i) { onChange(values.filter((_, j) => j !== i)) }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              type={type}
              value={v}
              onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
            />
            {values.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-1.5 text-xs text-brand-600 hover:text-brand-800">+ Add another</button>
    </div>
  )
}

// Multiple named people per supplier. A row per contact; "primary" is a single
// choice across the active rows (its name/wechat/whatsapp also mirror to the
// legacy flat fields on save), "active" un-checked greys out a departed rep
// without losing history.
function ContactRows({ contacts, onChange }) {
  const set = (i, field, val) => onChange(contacts.map((c, j) => (j === i ? { ...c, [field]: val } : c)))
  const setPrimary = i => onChange(contacts.map((c, j) => ({ ...c, is_primary: j === i })))
  const addRow = () => onChange([
    ...contacts,
    { id: genContactId(), name: '', title: '', phone: '', wechat: '', whatsapp: '', email: '',
      is_primary: contacts.filter(c => c.active !== false).length === 0, active: true },
  ])
  const removeRow = i => onChange(contacts.filter((_, j) => j !== i))

  return (
    <div className="space-y-3">
      {contacts.length === 0 && (
        <p className="text-xs text-gray-400">No contacts yet — add the supplier's sales rep(s).</p>
      )}
      {contacts.map((c, i) => {
        const inactive = c.active === false
        return (
          <div key={c.id || i} className={`rounded-lg border p-3 space-y-2 ${inactive ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200'}`}>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" value={c.name} onChange={e => set(i, 'name', e.target.value)} placeholder="Name e.g. 王小姐, David Lee" />
              <input className="input" value={c.title} onChange={e => set(i, 'title', e.target.value)} placeholder="Title / role (optional)" />
              <input className="input" value={c.phone} onChange={e => set(i, 'phone', e.target.value)} placeholder="Phone" />
              <input className="input" value={c.wechat} onChange={e => set(i, 'wechat', e.target.value)} placeholder="WeChat ID" />
              <input className="input" value={c.whatsapp} onChange={e => set(i, 'whatsapp', e.target.value)} placeholder="WhatsApp" />
              <input className="input" type="email" value={c.email} onChange={e => set(i, 'email', e.target.value)} placeholder="Email" />
            </div>
            <div className="flex items-center gap-4 text-xs">
              <label className={`inline-flex items-center gap-1.5 ${inactive ? 'text-gray-400' : 'text-gray-600'}`}>
                <input type="radio" name="supplier-primary-contact" disabled={inactive}
                       checked={!!c.is_primary && !inactive} onChange={() => setPrimary(i)} />
                Primary
              </label>
              <label className="inline-flex items-center gap-1.5 text-gray-600">
                <input type="checkbox" checked={!inactive}
                       onChange={e => set(i, 'active', e.target.checked)} />
                Active (still at this supplier)
              </label>
              <button type="button" onClick={() => removeRow(i)}
                      className="ml-auto text-gray-400 hover:text-red-500">Remove</button>
            </div>
          </div>
        )
      })}
      <button type="button" onClick={addRow} className="text-xs text-brand-600 hover:text-brand-800">+ Add contact</button>
    </div>
  )
}

export default function SupplierForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', name_cn: '', erp_code: '', category: '', country: 'China', province: '', city: '',
    address: '', wechat_id: '', whatsapp: '', contact_person: '', notes: '',
    default_currency: '', default_payment_terms: '',
    website_url: '', shop_1688_url: '', product_1688_url: '',
    taobao_shop_url: '', taobao_product_url: '',
    alibaba_shop_url: '', alibaba_product_url: '',
  })
  const [phones, setPhones] = useState([''])
  const [emails, setEmails] = useState([''])
  const [contacts, setContacts] = useState([])
  const [extraLinks, setExtraLinks] = useState([])
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [linkErrors, setLinkErrors] = useState({})

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'suppliers', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm(f => ({ ...f,
          name: d.name || '', name_cn: d.name_cn || '',
          erp_code: d.erp_code || '',
          category: d.category || '',
          country: d.country || 'China', province: d.province || '', city: d.city || '',
          address: d.address || '', wechat_id: d.wechat_id || '',
          whatsapp: d.whatsapp || '', contact_person: d.contact_person || '',
          notes: d.notes || '',
          default_currency: d.default_currency || '', default_payment_terms: d.default_payment_terms || '',
          website_url: d.website_url || '', shop_1688_url: d.shop_1688_url || '', product_1688_url: d.product_1688_url || '',
          taobao_shop_url: d.taobao_shop_url || '', taobao_product_url: d.taobao_product_url || '',
          alibaba_shop_url: d.alibaba_shop_url || '', alibaba_product_url: d.alibaba_product_url || '',
        }))
        setPhones(toArray(d.phones ?? d.phone))
        setEmails(toArray(d.emails ?? d.email))
        // Folds legacy contact_person/wechat_id/whatsapp into one primary
        // contact when the supplier has no contacts[] yet.
        setContacts(supplierContactsOf(d))
        setExtraLinks((Array.isArray(d.extra_links) ? d.extra_links : []).map(l => ({
          id: l.id || genLinkId(), label: l.label || '', url: l.url || '',
        })))
      }
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    for (const { key, label } of LINK_FIELDS) {
      if (!isValidUrl(form[key])) errs[key] = `${label} must be a full http:// or https:// URL`
    }
    for (const l of extraLinks) {
      if (l.url && !isValidUrl(l.url)) errs[l.id] = 'Must be a full http:// or https:// URL'
    }
    setLinkErrors(errs)
    if (Object.keys(errs).length > 0) return
    setLoading(true)
    try {
      const cleanContacts = cleanSupplierContacts(contacts)
      const payload = {
        ...form,
        phones: phones.filter(Boolean),
        emails: emails.filter(Boolean),
        // Keep legacy single-value fields for backward compat display
        phone: phones.filter(Boolean)[0] || '',
        email: emails.filter(Boolean)[0] || '',
        contacts: cleanContacts,
        extra_links: extraLinks
          .map(l => ({ id: l.id, label: (l.label || '').trim(), url: (l.url || '').trim() }))
          .filter(l => l.url),
        // Mirror the primary active contact into the flat fields every existing
        // reader still uses (PO form, supplier list, quote picker, ERP import).
        ...flatFieldsFromContacts(cleanContacts),
        updatedAt: serverTimestamp(),
      }
      if (isEdit) {
        await updateDoc(doc(db, 'suppliers', id), payload)
        navigate(`/suppliers/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'suppliers'), { ...payload, createdAt: serverTimestamp() })
        navigate(`/suppliers/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">← Suppliers</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Edit Supplier' : 'New Supplier'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Supplier Name (English) *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Fei Hong" />
          </div>
          <div>
            <label className="label">Supplier Name (Chinese)</label>
            <input className="input" value={form.name_cn} onChange={set('name_cn')} placeholder="e.g. 浦江晶鸿水晶" />
          </div>
        </div>

        <div>
          <label className="label">ERP Code <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input max-w-xs" value={form.erp_code} onChange={set('erp_code')} placeholder="e.g. S-00456" />
        </div>

        <div>
          <label className="label">Category</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {SUPPLIER_CATEGORIES.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => setForm(f => ({ ...f, category: f.category === c.value ? '' : c.value }))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  form.category === c.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
                }`}
              >
                <c.Icon size={13} className="inline align-[-2px] mr-1" />{c.value}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Country</label>
            <input className="input" value={form.country} onChange={set('country')} placeholder="China" />
          </div>
          <div>
            <label className="label">Province / Region</label>
            <select className="input" value={form.province} onChange={set('province')}>
              <option value="">—</option>
              {SUPPLIER_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={set('city')} placeholder="e.g. 深圳, Guangzhou" />
          </div>
        </div>

        <div>
          <label className="label">Address</label>
          <textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="Full address…" />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">People</p>
          <p className="text-xs text-gray-400 mb-3">One row per sales rep / contact. Mark who's <strong>Primary</strong> (used on purchase orders); un-tick <strong>Active</strong> when someone leaves — the row is kept greyed for history.</p>
          <ContactRows contacts={contacts} onChange={setContacts} />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Office lines</p>
          <p className="text-xs text-gray-400 mb-3">General supplier phone / email — reception or shared inbox, not tied to one person.</p>
          <div className="grid grid-cols-2 gap-4">
            <MultiInput label="Phone" values={phones} onChange={setPhones} placeholder="+86 xxx xxxx xxxx" />
            <MultiInput label="Email" values={emails} onChange={setEmails} type="email" placeholder="supplier@example.com" />
          </div>
        </div>

        {/* Supplier Workstation Phase 1 — sourcing/quick-access links, shown
            as buttons on the detail page. Internal-only (suppliers/{id} is
            admin-gated in firestore.rules; nothing here is ever surfaced to
            the Customer Portal). */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Sourcing Links</p>
          <p className="text-xs text-gray-400 mb-3">Internal only — quick-access buttons on the supplier page. Leave blank if unknown.</p>
          <div className="grid grid-cols-2 gap-4">
            {LINK_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input className="input" type="url" value={form[key]} onChange={set(key)} placeholder="https://…" />
                {linkErrors[key] && <p className="text-xs text-red-600 mt-1">{linkErrors[key]}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4 mb-1">More links — extra 1688 / Taobao pages, a catalogue folder, a WeChat shop, anything else. One chip each on the supplier page.</p>
          <ExtraLinkRows links={extraLinks} onChange={setExtraLinks} errors={linkErrors} />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Purchasing Defaults</p>
          <p className="text-xs text-gray-400 mb-3">Pre-fill new purchase orders for this supplier. Both are overridable per PO.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Default Currency</label>
              <select className="input" value={form.default_currency} onChange={set('default_currency')}>
                <option value="">— none —</option>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default Payment Terms</label>
              <select className="input" value={form.default_payment_terms} onChange={set('default_payment_terms')}>
                <option value="">— none —</option>
                {PO_PAYMENT_TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Specialties, payment terms, reliability notes…" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Supplier'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
