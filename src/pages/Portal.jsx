import { useContext, useState } from 'react'
import CustomerAccounts from './CustomerAccounts'
import PortalLogins from './PortalLogins'
import Enquiries from './Enquiries'
import PortalInvitations from './PortalInvitations'
import { PortalRequestCount } from '../hooks/usePortalRequestCount'
import { useRole } from '../access'

// Accounts / Invitations / Enquiries are ADMIN tools — they write users/{uid},
// portal_invitations and read the admin-only enquiries collection, all denied
// to sales in firestore.rules. Sales (V8.13) has the Portal module only for the
// read-only Login-activity view (that's what its capability is for), so it sees
// just that tab; showing the others would only surface controls that error.
const TABS = [
  { v: 'accounts',    label: 'Accounts',       adminOnly: true },
  { v: 'invitations', label: 'Invitations',    adminOnly: true },
  { v: 'logins',      label: 'Login activity' },
  { v: 'enquiries',   label: 'Enquiries',      adminOnly: true },
]

export default function Portal() {
  const isAdmin = useRole() === 'admin'
  const tabs = TABS.filter(t => isAdmin || !t.adminOnly)
  const {count,unavailable} = useContext(PortalRequestCount)
  const [reviewVisit,setReviewVisit] = useState(0)
  const [accountTab,setAccountTab] = useState('approved')
  const [tab, setTab] = useState(isAdmin ? 'accounts' : 'logins')

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Portal</h1>
        {isAdmin && count > 0 && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-sm font-medium text-amber-900">{count} portal access {count === 1 ? 'request needs' : 'requests need'} review</span>
          {!(tab === 'accounts' && accountTab === 'pending') && <button type="button" className="btn-secondary text-sm" onClick={() => {
            setTab('accounts'); setAccountTab('pending'); setReviewVisit(v => v + 1)
          }}>Review requests</button>}
        </div>}
        {isAdmin && unavailable && <p role="alert" className="mb-4 text-sm text-amber-800">Pending request count is unavailable. Check the Pending accounts tab.</p>}
        <div className="flex gap-0">
          {tabs.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
 tab === t.v ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-60 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'accounts'    && <CustomerAccounts key={reviewVisit} embedded selectedTab={accountTab} onTabChange={setAccountTab} />}
      {tab === 'invitations' && <PortalInvitations embedded />}
      {tab === 'logins'      && <PortalLogins embedded />}
      {tab === 'enquiries'   && <Enquiries embedded />}
    </div>
  )
}
