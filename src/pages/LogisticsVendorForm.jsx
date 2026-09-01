import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  getVendor, saveVendor, deleteVendor,
  FREIGHT_MODES, COVERAGE_STRENGTH, FREIGHT_INCOTERMS,
} from '../logistics'
import { Trash2, Plus, X } from 'lucide-react'

const blankContact  = () => ({ name: '', wechat: '', whatsapp: '', phone: '', email: '' })
const blankCoverage = () => ({ region: '', strength: 'strong', modes: [], notes: '' })

export default function LogisticsVendorForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', name_cn: '', payment_terms: '', reliability_rating: '',
    damage_notes: '', notes: '',
    modes: [], incoterms_supported: [],
    contacts: [blankContact()], coverage: [blankCoverage()],
  })
  const [fetching, setFetching] = useState(isEdit)
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (!isEdit) return
    getVendor(id).then(v => {
      if (v) {
        setForm({
          name: v.name, name_cn: v.name_cn,
          payment_terms: v.payment_terms,
          reliability_rating: v.reliability_rating ?? '',
          damage_notes: v.damage_notes, notes: v.notes,
          modes: v.modes, incoterms_supported: v.incoterms_supported,
          contacts: v.contacts.length ? v.contacts : [blankContact()],
          coverage: v.coverage.length ? v.coverage : [blankCoverage()],
        })
      }
      setFetching(false)
    })
  }, [id, isEdit])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))
  const toggle = (field, val) => setForm(f => ({
    ...f, [field]: f[field].includes(val) ? f[field].filter(x => x !== val) : [...f[field], val],
  }))

  // Contacts
  const setContact = (i, k, v) => setForm(f => ({ ...f, contacts: f.contacts.map((c, j) => j === i ? { ...c, [k]: v } : c) }))
  const addContact = () => setForm(f => ({ ...f, contacts: [...f.contacts, blankContact()] }))
  const rmContact  = i => setForm(f => ({ ...f, contacts: f.contacts.filter((_, j) => j !== i) }))

  // Coverage
  const setCov = (i, k, v) => setForm(f => ({ ...f, coverage: f.coverage.map((c, j) => j === i ? { ...c, [k]: v } : c) }))
  const toggleCovMode = (i, m) => setForm(f => ({ ...f, coverage: f.coverage.map((c, j) =>
    j === i ? { ...c, modes: c.modes.includes(m) ? c.modes.filter(x => x !== m) : [...c.modes, m] } : c) }))
  const addCov = () => setForm(f => ({ ...f, coverage: [...f.coverage, blankCoverage()] }))
  const rmCov  = i => setForm(f => ({ ...f, coverage: f.coverage.filter((_, j) => j !== i) }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const savedId = await saveVendor(id, form)
      navigate(`/logistics/${savedId}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this vendor? Past freight quotes are kept.')) return
    await deleteVendor(id)
    navigate('/logistics')
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/logistics" className="text-sm text-brand-600 hover:underline">← Logistics</Link>
        <h1 className="text-2xl text-ink mt-1">{isEdit ? 'Edit Vendor' : 'New Logistics Vendor'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Identity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Vendor Name (English) *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Sunny Worldwide" />
          </div>
          <div>
            <label className="label">Vendor Name (Chinese)</label>
            <input className="input" value={form.name_cn} onChange={set('name_cn')} placeholder="e.g. 阳光国际货运" />
          </div>
        </div>

        {/* Modes */}
        <div>
          <label className="label">Freight Modes</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {FREIGHT_MODES.map(m => (
              <button
                key={m.value} type="button" onClick={() => toggle('modes', m.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
 form.modes.includes(m.value)
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-ink-70 border-warm-grey hover:border-brand-400'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Coverage — graded tags */}
        <div className="border-t border-warm-grey pt-5">
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Coverage</label>
            <span className="text-xs text-ink-60">Region + how good they are there</span>
          </div>
          <div className="space-y-3 mt-2">
            {form.coverage.map((c, i) => (
              <div key={i} className="rounded-none border border-warm-grey p-3 space-y-2.5">
                <div className="flex gap-2">
                  <input
                    className="input flex-1" value={c.region}
                    onChange={e => setCov(i, 'region', e.target.value)}
                    placeholder="Country / region — e.g. Germany, EU, USA West"
                  />
                  {form.coverage.length > 1 && (
                    <button type="button" onClick={() => rmCov(i)} className="text-ink-60 hover:text-red-500 px-1">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {COVERAGE_STRENGTH.map(s => (
                    <button
                      key={s.value} type="button" onClick={() => setCov(i, 'strength', s.value)}
                      className={`px-2.5 py-1 rounded-full text-2xs font-medium border transition-colors ${
 c.strength === s.value ? s.style + ' ring-1 ring-inset ring-current' : 'bg-white text-ink-60 border-warm-grey'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FREIGHT_MODES.map(m => (
                    <button
                      key={m.value} type="button" onClick={() => toggleCovMode(i, m.value)}
                      className={`px-2 py-0.5 rounded-full text-2xs border transition-colors ${
 c.modes.includes(m.value)
                          ? 'bg-ink text-white border-ink'
                          : 'bg-white text-ink-60 border-warm-grey hover:border-ink-60'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <input
                  className="input text-sm" value={c.notes}
                  onChange={e => setCov(i, 'notes', e.target.value)}
                  placeholder="Notes — e.g. strong on DDP door-to-door, slow customs"
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={addCov} className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
            <Plus size={13} /> Add coverage
          </button>
        </div>

        {/* Incoterms + reliability + payment */}
        <div className="border-t border-warm-grey pt-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Incoterms Supported</label>
            <div className="flex gap-2 mt-1">
              {FREIGHT_INCOTERMS.map(t => (
                <button
                  key={t} type="button" onClick={() => toggle('incoterms_supported', t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
 form.incoterms_supported.includes(t)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-ink-70 border-warm-grey hover:border-brand-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Reliability (1–5) <span className="text-ink-60 font-normal">fragile-goods weighted</span></label>
            <input
              className="input max-w-[8rem]" type="number" min="1" max="5" step="1"
              value={form.reliability_rating} onChange={set('reliability_rating')} placeholder="e.g. 4"
            />
          </div>
          <div>
            <label className="label">Payment Terms</label>
            <input className="input" value={form.payment_terms} onChange={set('payment_terms')} placeholder="e.g. 30 days, T/T on collection" />
          </div>
        </div>

        {/* Contacts */}
        <div className="border-t border-warm-grey pt-5">
          <label className="label">Contacts</label>
          <div className="space-y-3 mt-2">
            {form.contacts.map((c, i) => (
              <div key={i} className="rounded-none border border-warm-grey p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-ink-60">Contact {i + 1}</span>
                  {form.contacts.length > 1 && (
                    <button type="button" onClick={() => rmContact(i)} className="text-ink-60 hover:text-red-500"><X size={15} /></button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" value={c.name} onChange={e => setContact(i, 'name', e.target.value)} placeholder="Name" />
                  <input className="input text-sm" value={c.wechat} onChange={e => setContact(i, 'wechat', e.target.value)} placeholder="WeChat" />
                  <input className="input text-sm" value={c.whatsapp} onChange={e => setContact(i, 'whatsapp', e.target.value)} placeholder="WhatsApp" />
                  <input className="input text-sm" value={c.phone} onChange={e => setContact(i, 'phone', e.target.value)} placeholder="Phone" />
                  <input className="input text-sm col-span-2" type="email" value={c.email} onChange={e => setContact(i, 'email', e.target.value)} placeholder="Email" />
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addContact} className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
            <Plus size={13} /> Add contact
          </button>
        </div>

        {/* Notes */}
        <div className="border-t border-warm-grey pt-5 space-y-4">
          <div>
            <label className="label">Damage / Claims History</label>
            <textarea className="input" rows={2} value={form.damage_notes} onChange={set('damage_notes')} placeholder="Handling quality, breakage claims, how disputes were resolved…" />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="General notes…" />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          {isEdit && (
            <button type="button" onClick={handleDelete} className="ml-auto inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700">
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
