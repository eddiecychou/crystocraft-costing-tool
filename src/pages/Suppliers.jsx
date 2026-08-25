import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { SUPPLIER_CATEGORIES } from '../constants'
import { MapPin, Phone, MessageCircle } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'

const VIEW_STATE_KEY = 'suppliers.viewState'
const loadViewState = () => {
  try { return JSON.parse(localStorage.getItem(VIEW_STATE_KEY)) || {} } catch { return {} }
}

const CAT_STYLES = {
  'Crystal / Glass':          'bg-blue-50 text-blue-700',
  'Metal Parts':              'bg-gray-100 text-gray-700',
  'Packaging':                'bg-amber-50 text-amber-700',
  'Wood / Acrylic / Plastics':'bg-lime-50 text-lime-700',
  'Electronics':              'bg-purple-50 text-purple-700',
  'Fabric & Textile':         'bg-pink-50 text-pink-700',
  'Printing & Engraving':     'bg-cyan-50 text-cyan-700',
  'Others':                   'bg-gray-50 text-gray-500',
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const initialView = loadViewState()
  const [search, setSearch]       = useState(initialView.search || '')
  const [catFilter, setCatFilter] = useState(initialView.catFilter || '')
  const remember = useScrollMemory('suppliers', !loading)

  useEffect(() => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ search, catFilter }))
  }, [search, catFilter])

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
    return matchSearch && matchCat
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {suppliers.length} suppliers</p>
        </div>
        <Link to="/suppliers/new" className="btn-primary text-sm whitespace-nowrap">+ New Supplier</Link>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name…"
        className="input w-full mb-3"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Category filter pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setCatFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!catFilter ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === c.value ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <c.Icon size={13} className="inline align-[-2px] mr-1" />{c.value} <span className="opacity-60 ml-0.5">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {suppliers.length === 0 ? 'No suppliers yet — add your first one.' : 'No suppliers match your search.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(s => {
            const cat = SUPPLIER_CATEGORIES.find(c => c.value === s.category)
            return (
              <Link
                key={s.id}
                to={`/suppliers/${s.id}`}
                onClick={remember}
                className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{s.name}</p>
                    {cat && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${CAT_STYLES[s.category] || 'bg-gray-100 text-gray-500'}`}>
                        <cat.Icon size={12} className="inline align-[-2px] mr-1" />{s.category}
                      </span>
                    )}
                  </div>
                  {s.name_cn && <p className="text-xs text-gray-500 mt-0.5">{s.name_cn}</p>}
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    {s.city  && <span className="inline-flex items-center gap-1"><MapPin size={12} />{s.city}{s.country && s.country !== 'China' ? `, ${s.country}` : ''}</span>}
                    {!s.city && s.country && <span className="inline-flex items-center gap-1"><MapPin size={12} />{s.country}</span>}
                    {(s.phones?.[0] || s.phone) && <span className="inline-flex items-center gap-1"><Phone size={12} />{s.phones?.[0] || s.phone}</span>}
                    {s.wechat_id && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />{s.wechat_id}</span>}
                  </div>
                </div>
                <span className="text-xs text-gray-400 ml-3">→</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
