import { useState } from 'react'
import Catalogues from './Catalogues'
import BlogGenerator from './BlogGenerator'
import MarketingContacts from './MarketingContacts'
import Campaigns from './Campaigns'
import FrontPageConfig from './FrontPageConfig'
import DailyDrafts from '../marketing/DailyDrafts'
import { useRole } from '../access'

const TABS = [
  { v: 'drafts',     label: 'Daily Drafts' },
  { v: 'contacts',   label: 'Contacts' },
  { v: 'campaigns',  label: 'Campaigns' },
  // Front Page config writes settings/front_page, which is admin-only in
  // firestore.rules — so hide it from sales (they'd only hit a save error).
  { v: 'frontpage',  label: 'Front Page', adminOnly: true },
  { v: 'blog',       label: 'Blog Writer' },
  { v: 'catalogues', label: 'Catalogues' },
]

export default function Marketing() {
  const role = useRole()
  const tabs = TABS.filter(t => !t.adminOnly || role === 'admin')
  const [tab, setTab] = useState('drafts')
  // Contacts tab hands off a hand-picked contact list to the Campaigns tab
  // (owner: "click a few contacts and send a template email") — lifted here
  // since both are sibling tabs of the same page, not separate routes.
  const [presetContactIds, setPresetContactIds] = useState(null)

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Marketing</h1>
        <div className="flex gap-0 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {tabs.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 ${
 tab === t.v ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-60 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'catalogues' && <Catalogues embedded />}
      {tab === 'frontpage'  && <FrontPageConfig embedded />}
      {tab === 'blog'       && <BlogGenerator embedded />}
      {tab === 'contacts'   && (
        <MarketingContacts onSendEmail={ids => { setPresetContactIds(ids); setTab('campaigns') }} />
      )}
      {tab === 'campaigns'  && (
        <Campaigns presetContactIds={presetContactIds} onConsumedPreset={() => setPresetContactIds(null)} />
      )}
      {tab === 'drafts'     && <DailyDrafts />}
    </div>
  )
}
