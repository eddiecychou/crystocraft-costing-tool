import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { Store, ShoppingCart, Gift, Sparkles, Building2, Star, Smartphone, ShoppingBag } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'
import { useCustomers, CUSTOMER_COUNTRIES, CHANNELS, RETAIL_TAG, CRM_CATEGORIES } from '../domain/customer'

const VIEW_STATE_KEY = 'customers.viewState'
const loadViewState = () => {
  try { return JSON.parse(localStorage.getItem(VIEW_STATE_KEY)) || {} } catch { return {} }
}

const CRM_STATUS_STYLES = {
  Active:   'bg-green-100 text-green-700',
  Prospect: 'bg-blue-100 text-blue-700',
  Dormant:  'bg-amber-100 text-amber-700',
  Inactive: 'bg-ivory-dark text-ink-60',
}

const CATEGORY_TABS = [
  { key: '',               label: 'All B2B' },
  { key: 'Distributor',   label: 'Distributor',   Icon: Store },
  { key: 'Small B2B',     label: 'Small B2B',     Icon: ShoppingCart },
  { key: 'Gift / OEM',    label: 'Gift / OEM',    Icon: Gift },
  { key: 'Crystal Fabric',label: 'Crystal Fabric',Icon: Sparkles },
]

// Landing on the page defaults to the B2B group — Distributor/Small B2B/
// Gift-OEM/Crystal Fabric, the accounts worked day to day. Retail Customer
// (a tag, not a crm_category — see RETAIL_TAG) is its own group, sitting off
// to the side since it's mostly touched only for seasonal campaigns; "All"
// is the escape hatch when the group split itself gets in the way (e.g.
// searching for a specific person and unsure which group they're in).
const GROUPS = [
  { key: 'b2b',    label: 'B2B' },
  { key: 'retail', label: RETAIL_TAG },
  { key: 'all',    label: 'All' },
]

export default function Customers() {
  const { customers, loading }          = useCustomers()
  const initialView = loadViewState()
  const [search, setSearch]             = useState(initialView.search || '')
  const [filterCountry, setFilterCountry] = useState(initialView.filterCountry || '')
  const [filterChannel, setFilterChannel]   = useState(initialView.filterChannel || '')
  const [filterStatus, setFilterStatus]     = useState(initialView.filterStatus || '')
  const [filterCategory, setFilterCategory] = useState(initialView.filterCategory || '')
  const [group, setGroup]                   = useState(initialView.group || 'b2b')
  const remember = useScrollMemory('customers', !loading)

  useEffect(() => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      search, filterCountry, filterChannel, filterStatus, filterCategory, group,
    }))
  }, [search, filterCountry, filterChannel, filterStatus, filterCategory, group])

  const filtered = customers.filter(c => {
    const searchLower = search.toLowerCase()
    const matchSearch = !search ||
      c.company_name?.toLowerCase().includes(searchLower) ||
      c.contact_name?.toLowerCase().includes(searchLower) ||
      c.erp_code?.toLowerCase().includes(searchLower) ||
      c.tags?.some(t => t.toLowerCase().includes(searchLower)) ||
      c.contact_emails?.some(v => v.toLowerCase().includes(searchLower)) ||
      c.contact_phones?.some(v => v.toLowerCase().includes(searchLower)) ||
      c.contact_whatsapps?.some(v => v.toLowerCase().includes(searchLower))
    const matchCountry   = !filterCountry   || (c.country || c.region) === filterCountry
    const matchChannel   = !filterChannel   || c.channels?.includes(filterChannel) || c.primary_channel === filterChannel
    const matchStatus    = !filterStatus    || c.crm_status === filterStatus
    const matchGroup     = group === 'all'    ? true
                          : group === 'retail' ? c.tags?.includes(RETAIL_TAG)
                          : CRM_CATEGORIES.includes(c.crm_category)
    const matchCategory  = group !== 'b2b' || !filterCategory || c.crm_category === filterCategory
    return matchSearch && matchCountry && matchChannel && matchStatus && matchGroup && matchCategory
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      {/* flex-col on mobile: three buttons + title in one row overflowed the
          viewport on a narrow screen (2026-08-13 report) — stack instead,
          buttons get their own row (wrapping, not scrolling off-screen)
          below the title there. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink">Customers</h1>
          <p className="text-sm text-ink-60 mt-0.5">{customers.length} clients</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/customers/whatsapp-import" className="btn-secondary text-sm">Import WhatsApp</Link>
          <Link to="/customers/tags" className="btn-secondary text-sm">Manage Tags</Link>
          <Link to="/customers/new" className="btn-primary text-sm">+ New</Link>
        </div>
      </div>

      {/* Group toggle — B2B (Distributor/Small B2B/Gift-OEM/Crystal Fabric)
          vs Retail Customer vs everyone. B2B is the default landing view
          (owner, 2026-08-26: day-to-day work is B2B; Retail is mostly
          touched for seasonal campaigns and was cluttering the default
          list). Retail is a tag, not a crm_category, so it can in principle
          overlap with a B2B account — the group split below is a view
          filter, not a claim the two are mutually exclusive. */}
      <div className="flex gap-1.5 mb-2">
        {GROUPS.map(g => {
          const count = g.key === 'all'    ? customers.length
                      : g.key === 'retail' ? customers.filter(c => c.tags?.includes(RETAIL_TAG)).length
                      : customers.filter(c => CRM_CATEGORIES.includes(c.crm_category)).length
          return (
            <button
              key={g.key}
              onClick={() => setGroup(g.key)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors whitespace-nowrap ${
                group === g.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-ink-70 border-warm-grey hover:border-warm-grey hover:bg-ivory'
              }`}
            >
              {g.key === 'retail' && <ShoppingBag size={13} className="inline align-[-2px] mr-1" />}
              {g.label} <span className={`ml-1 ${group === g.key ? 'text-white/70' : 'text-ink-60'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Category sub-tabs, only meaningful within the B2B group. */}
      {group === 'b2b' && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
          {CATEGORY_TABS.map(tab => {
            const count = tab.key ? customers.filter(c => c.crm_category === tab.key).length
                                   : customers.filter(c => CRM_CATEGORIES.includes(c.crm_category)).length
            return (
              <button
                key={tab.key}
                onClick={() => setFilterCategory(tab.key)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                  filterCategory === tab.key
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-70 border-warm-grey hover:border-warm-grey hover:bg-ivory'
                }`}
              >
                {tab.Icon && <tab.Icon size={13} className="inline align-[-2px] mr-1" />}{tab.label} <span className={`ml-1 ${filterCategory === tab.key ? 'text-white/70' : 'text-ink-60'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

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
        <div className="text-center py-20 text-ink-60">
          <Building2 size={48} strokeWidth={1.25} className="mx-auto mb-4 text-platinum" />
          <p>{customers.length === 0 ? 'No customers yet — add your first client.' : 'No results found.'}</p>
        </div>
      ) : (
        <div className="card divide-y divide-warm-grey">
          {filtered.map(c => (
            <Link key={c.id} to={`/customers/${c.id}`} onClick={remember} className="flex items-center justify-between px-4 py-3.5 hover:bg-ivory transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ink text-sm truncate">{c.company_name}</p>
                  {c.is_vip && <Star size={13} className="fill-current text-yellow-500 shrink-0" />}
                  {c.is_personal_wa && <Smartphone size={13} className="text-ink-60 shrink-0" aria-label="Personal WhatsApp" />}
                </div>
                <p className="text-xs text-ink-60 mt-0.5 truncate">
                  {[c.contact_name, c.country || c.region].filter(Boolean).join(' · ')}
                  {c.crm_category && <span className="ml-1 text-ink-60">· {c.crm_category}</span>}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.crm_status && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${CRM_STATUS_STYLES[c.crm_status] || 'bg-ivory-dark text-ink-60'}`}>
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
                      {otherTags.length > 3 && <span className="text-xs text-ink-60">+{otherTags.length - 3}</span>}
                    </>
                  })()}
                </div>
              </div>
              <span className="text-xs text-ink-60 ml-3 shrink-0">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
