import { useState } from 'react'
import Catalogues from './Catalogues'
import BlogGenerator from './BlogGenerator'
import MarketingContacts from './MarketingContacts'

const TABS = [
  { v: 'catalogues', label: 'Catalogues' },
  { v: 'blog',       label: 'Blog Writer' },
  { v: 'contacts',   label: 'Contacts' },
]

export default function Marketing() {
  const [tab, setTab] = useState('catalogues')

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Marketing</h1>
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

      {tab === 'catalogues' && <Catalogues embedded />}
      {tab === 'blog'       && <BlogGenerator embedded />}
      {tab === 'contacts'   && <MarketingContacts />}
    </div>
  )
}
