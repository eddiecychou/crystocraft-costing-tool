import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import { guessProvince } from '../supplierProvince'
import LoadingBar from '../components/LoadingBar'
import { SUPPLIER_CATEGORIES, SUPPLIER_PROVINCES } from '../constants'
import { MapPin, Phone, MessageCircle } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'

const VIEW_STATE_KEY = 'suppliers.viewState'
const loadViewState = () => {
  try { return JSON.parse(localStorage.getItem(VIEW_STATE_KEY)) || {} } catch { return {} }
}

const CAT_STYLES = {
  'Crystal / Glass':          'bg-blue-50 text-blue-700',
  'Metal Parts':              'bg-ivory-dark text-ink-80',
  'Packaging':                'bg-amber-50 text-amber-700',
  'Wood / Acrylic / Plastics':'bg-lime-50 text-lime-700',
  'Electronics':              'bg-purple-50 text-purple-700',
  'Fabric & Textile':         'bg-pink-50 text-pink-700',
  'Printing & Engraving':     'bg-cyan-50 text-cyan-700',
  'Others':                   'bg-ivory text-ink-60',
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const initialView = loadViewState()
  const [search, setSearch]       = useState(initialView.search || '')
  const [catFilter, setCatFilter] = useState(initialView.catFilter || '')
  const [provFilter, setProvFilter] = useState(initialView.provFilter || '')
  const [showBackfill, setShowBackfill] = useState(false)
  const remember = useScrollMemory('suppliers', !loading)

  useEffect(() => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ search, catFilter, provFilter }))
  }, [search, catFilter, provFilter])

  useEffect(() => {
    const q = query(collection(db, 'suppliers'), orderBy('name'))
    return onSnapshot(q, snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = suppliers.filter(s => {
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.name_cn?.toLowerCase().includes(search.toLowerCase()) || s.erp_code?.toLowerCase().includes(search.toLowerCase())
    const matchCat = !catFilter || s.category === catFilter
    const matchProv = !provFilter || (provFilter === '(none)' ? !s.province : s.province === provFilter)
    return matchSearch && matchCat && matchProv
  })

  // Region filter options: every distinct province/country value some supplier
  // actually has, China provinces first (in SUPPLIER_PROVINCES order), then any
  // non-China country values alphabetically.
  const usedRegions = [...new Set(suppliers.map(s => s.province).filter(Boolean))]
  const provinceOptions = [
    ...SUPPLIER_PROVINCES.filter(p => usedRegions.includes(p)),
    ...usedRegions.filter(r => !SUPPLIER_PROVINCES.includes(r)).sort(),
  ]
  const someUnset = suppliers.some(s => !s.province)

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink">Suppliers</h1>
          <p className="text-sm text-ink-60 mt-0.5">{filtered.length} of {suppliers.length} suppliers</p>
        </div>
        <Link to="/suppliers/new" className="btn-primary text-sm whitespace-nowrap">+ New Supplier</Link>
      </div>

      {/* Search + province */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Search by name…"
          className="input flex-1"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {(provinceOptions.length > 0 || someUnset) && (
          <select className="input w-48 shrink-0" value={provFilter} onChange={e => setProvFilter(e.target.value)}>
            <option value="">All provinces</option>
            {provinceOptions.map(p => (
              <option key={p} value={p}>{p} ({suppliers.filter(s => s.province === p).length})</option>
            ))}
            {someUnset && <option value="(none)">— no province set ({suppliers.filter(s => !s.province).length})</option>}
          </select>
        )}
      </div>

      {someUnset && (
        <button onClick={() => setShowBackfill(true)}
          className="text-xs text-brand-600 hover:text-brand-800 mb-3">
          Backfill province from city for {suppliers.filter(s => !s.province).length} supplier{suppliers.filter(s => !s.province).length === 1 ? '' : 's'} →
        </button>
      )}
      {showBackfill && (
        <BackfillProvincesModal
          suppliers={suppliers.filter(s => !s.province)}
          onClose={() => setShowBackfill(false)}
        />
      )}

      {/* Category filter pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setCatFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!catFilter ? 'bg-brand-600 text-white' : 'bg-ivory-dark text-ink-70 hover:bg-warm-grey'}`}
        >
          All
        </button>
        {SUPPLIER_CATEGORIES.map(c => {
          const count = suppliers.filter(s => s.category === c.value).length
          if (!count) return null
          return (
            <button
              key={c.value}
              onClick={() => setCatFilter(catFilter === c.value ? '' : c.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === c.value ? 'bg-brand-600 text-white' : 'bg-ivory-dark text-ink-70 hover:bg-warm-grey'}`}
            >
              <c.Icon size={13} className="inline align-[-2px] mr-1" />{c.value} <span className="opacity-60 ml-0.5">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-ink-60">
          {suppliers.length === 0 ? 'No suppliers yet — add your first one.' : 'No suppliers match your search.'}
        </div>
      ) : (
        <div className="card divide-y divide-warm-grey">
          {filtered.map(s => {
            const cat = SUPPLIER_CATEGORIES.find(c => c.value === s.category)
            return (
              <Link
                key={s.id}
                to={`/suppliers/${s.id}`}
                onClick={remember}
                className="flex items-center justify-between px-4 py-3.5 hover:bg-ivory transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-ink text-sm">{s.name}</p>
                    {cat && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${CAT_STYLES[s.category] || 'bg-ivory-dark text-ink-60'}`}>
                        <cat.Icon size={12} className="inline align-[-2px] mr-1" />{s.category}
                      </span>
                    )}
                  </div>
                  {s.name_cn && <p className="text-xs text-ink-60 mt-0.5">{s.name_cn}</p>}
                  <div className="flex gap-3 mt-1 text-xs text-ink-60 flex-wrap">
                    {(() => {
                      const prov = (s.province || '').split(' ')[0]  // 中文 head only, compact
                      const loc = [prov, s.city].filter(Boolean).join(' · ')
                        || (s.country && s.country !== 'China' ? s.country : '')
                        || s.country
                      return loc ? <span className="inline-flex items-center gap-1"><MapPin size={12} />{loc}{s.country && s.country !== 'China' && !loc.includes(s.country) ? `, ${s.country}` : ''}</span> : null
                    })()}
                    {(s.phones?.[0] || s.phone) && <span className="inline-flex items-center gap-1"><Phone size={12} />{s.phones?.[0] || s.phone}</span>}
                    {s.wechat_id && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />{s.wechat_id}</span>}
                  </div>
                </div>
                <span className="text-xs text-ink-60 ml-3">→</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// One-time: guess each province-less supplier's province from its city /
// address / Chinese name, show the mapping for review, write the approved
// rows. Every row is an editable dropdown pre-set to the guess (or "— skip —");
// nothing is written until "Apply".
function BackfillProvincesModal({ suppliers, onClose }) {
  const [rows, setRows] = useState(() =>
    suppliers.map(s => ({ id: s.id, name: s.name, city: s.city || '', country: s.country || '', choice: guessProvince(s) })))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const toApply = rows.filter(r => r.choice)
  const setChoice = (id, choice) => setRows(rs => rs.map(r => (r.id === id ? { ...r, choice } : r)))

  async function apply() {
    setBusy(true)
    try {
      for (let i = 0; i < toApply.length; i += 400) {
        const batch = writeBatch(db)
        for (const r of toApply.slice(i, i + 400)) {
          batch.update(doc(db, 'suppliers', r.id), { province: r.choice, updatedAt: serverTimestamp() })
        }
        await batch.commit()
      }
      setDone(toApply.length)
    } catch (e) {
      setDone(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <h2 className="font-semibold text-ink">Backfill Province / Region</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1 text-lg leading-none">×</button>
        </div>
        <div className="p-5">
          {done != null ? (
            <p className={`text-sm ${String(done).startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
              {String(done).startsWith('Error') ? done : `Set the province on ${done} supplier${done === 1 ? '' : 's'}.`}
            </p>
          ) : (
            <>
              <p className="text-xs text-ink-60 mb-3">
                Guessed from each supplier's city / address. Adjust any row, set to <strong>— skip —</strong> to leave it
                blank, then Apply. Nothing is written until you do.
              </p>
              <div className="border border-warm-grey rounded-none max-h-[52vh] overflow-y-auto divide-y divide-warm-grey">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink truncate">{r.name}</p>
                      <p className="text-xs text-ink-60 truncate">{[r.city, r.country].filter(Boolean).join(' · ') || 'no city on file'}</p>
                    </div>
                    <select className="input w-52 shrink-0 text-xs" value={r.choice}
                            onChange={e => setChoice(r.id, e.target.value)}>
                      <option value="">— skip —</option>
                      {/* a non-China guess (a country name) isn't in the list */}
                      {r.choice && !SUPPLIER_PROVINCES.includes(r.choice) && (
                        <option value={r.choice}>{r.choice}</option>
                      )}
                      {SUPPLIER_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-warm-grey">
          <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">{done != null ? 'Close' : 'Cancel'}</button>
          {done == null && (
            <button onClick={apply} disabled={busy || toApply.length === 0} className="btn-primary text-sm">
              {busy ? 'Applying…' : `Apply to ${toApply.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
