import { useState } from 'react'
import CustomerAccounts from './CustomerAccounts'
import Enquiries from './Enquiries'

const TABS = [
  { v: 'accounts',  label: 'Accounts' },
  { v: 'enquiries', label: 'Enquiries' },
]

export default function Portal() {
  const [tab, setTab] = useState('accounts')

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Portal</h1>
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.v ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-60 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'accounts'  && <CustomerAccounts embedded />}
      {tab === 'enquiries' && <Enquiries embedded />}
    </div>
  )
}
