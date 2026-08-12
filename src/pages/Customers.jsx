import { useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { Store, ShoppingCart, Gift, Sparkles, Building2, Star, Smartphone } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'
import { useCustomers, CUSTOMER_COUNTRIES, CHANNELS, RETAIL_TAG } from '../domain/customer'

const CRM_STATUS_STYLES = {
  Active:   'bg-green-100 text-green-700',
  Prospect: 'bg-blue-100 text-blue-700',
  Dormant:  'bg-amber-100 text-amber-700',
  Inactive: 'bg-gray-100 text-gray-500',
}

const CATEGORY_TABS = [
  { key: '',               label: 'All' },
  { key: 'Distributor',   label: 'Distributor',   Icon: Store },
  { key: 'Small B2B',     label: 'Small B2B',     Icon: ShoppingCart },
  { key: 'Gift / OEM',    label: 'Gift / OEM',    Icon: Gift },
  { key: 'Crystal Fabric',label: 'Crystal Fabric',Icon: Sparkles },
]

export default function Customers() {
  const { customers, loading }          = useCustomers()
  const [search, setSearch]             = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterChannel, setFilterChannel]   = useState('')
  const [filterStatus, setFilterStatus]     = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [retailOnly, setRetailOnly]         = useState(false)
  const remember = useScrollMemory('customers', !loading)

  const filtered = customers.filter(c => {
    const searchLower = search.toLowerCase()
    const matchSearch = !search ||
      c.company_name?.toLowerCase().includes(searchLower) ||
      c.contact_name?.toLowerCase().includes(searchLower) ||
      c.erp_code?.toLowerCase().includes(searchLower) ||
      c.tags?.some(t => t.toLowerCase().includes(searchLower))
    const matchCountry   = !filterCountry   || (c.country || c.region) === filterCountry
    const matchChannel   = !filterChannel   || c.channels?.includes(filterChannel) || c.primary_channel === filterChannel
    const matchStatus    = !filterStatus    || c.crm_status === filterStatus
    const matchCategory  = !filterCategory  || c.crm_category === filterCategory
    const matchRetail    = !retailOnly      || c.tags?.includes(RETAIL_TAG)
    return matchSearch && matchCountry && matchChannel && matchStatus && matchCategory && matchRetail
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers.length} clients</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/customers/tags" className="btn-secondary text-sm">Manage Tags</Link>
          <Link to="/customers/new" className="btn-primary text-sm">+ New</Link>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {CATEGORY_TABS.map(tab => {
          const count = tab.key ? customers.filter(c => c.crm_category === tab.key).length : customers.length
          return (
            <button
              key={tab.key}
              onClick={() => setFilterCategory(tab.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                filterCategory === tab.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {tab.Icon && <tab.Icon size={13} className="inline align-[-2px] mr-1" />}{tab.label} <span className={`ml-1 ${filterCategory === tab.key ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Retail toggle — most customers here are trade/wholesale by default
          and stay unlabeled; this just isolates the tagged minority (see
          RETAIL_TAG in domain/customer.js). Independent of Customer Type. */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setRetailOnly(v => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
            retailOnly
              ? 'bg-pink-600 text-white border-pink-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          {RETAIL_TAG} only <span className={retailOnly ? 'text-white/70' : 'text-gray-400'}>
            {customers.filter(c => c.tags?.includes(RETAIL_TAG)).length}
          </span>
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-5">
        <input
          type="text"
          placeholder="Search name, contact, tag, segment…"
          className="input w-full"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <select className="input flex-1 min-w-[120px]" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
            <option value="">All countries</option>
            {CUSTOMER_COUNTRIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="input flex-1 min-w-[120px]" value={filterChannel} onChange={e => setFilterChannel(e.target.value)}>
            <option value="">All channels</option>
            {CHANNELS.map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="input flex-1 min-w-[120px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Active', 'Prospect', 'Dormant', 'Inactive'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          <Building2 size={48} strokeWidth={1.25} className="mx-auto mb-4 text-gray-300" />
          <p>{customers.length === 0 ? 'No customers yet — add your first client.' : 'No results found.'}</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(c => (
            <Link key={c.id} to={`/customers/${c.id}`} onClick={remember} className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm truncate">{c.company_name}</p>
                  {c.is_vip && <Star size={13} className="fill-current text-yellow-500 shrink-0" />}
                  {c.is_personal_wa && <Smartphone size={13} className="text-gray-400 shrink-0" aria-label="Personal WhatsApp" />}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {[c.contact_name, c.country || c.region].filter(Boolean).join(' · ')}
                  {c.crm_category && <span className="ml-1 text-gray-400">· {c.crm_category}</span>}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.crm_status && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${CRM_STATUS_STYLES[c.crm_status] || 'bg-gray-100 text-gray-500'}`}>
                      {c.crm_status}
                    </span>
                  )}
                  {c.tags?.includes(RETAIL_TAG) && (
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">{RETAIL_TAG}</span>
                  )}
                  {(() => {
                    const otherTags = (c.tags || []).filter(t => t !== RETAIL_TAG)
                    return <>
                      {otherTags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-600 text-xs">{tag}</span>
                      ))}
                      {otherTags.length > 3 && <span className="text-xs text-gray-400">+{otherTags.length - 3}</span>}
                    </>
                  })()}
                </div>
              </div>
              <span className="text-xs text-gray-400 ml-3 shrink-0">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
