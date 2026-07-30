import { useEffect, useMemo, useState } from 'react'
import { Send, Loader2, CheckCircle2 } from 'lucide-react'
import { useMarketingContacts, MC_CATEGORIES, MC_AUDIENCES } from '../domain/marketingContact'
import {
  listCampaigns, createCampaign, recordBatchResults, setCampaignStatus, eligibleContacts,
} from '../domain/campaigns'
import { sendCampaignBatch } from '../campaignApi'

// One campaign at a time — pick a segment, write one message, send it out in
// batches. No cron: batches go out when someone clicks "Send next batch",
// deliberately, since this is the app's first bulk-mail feature and a human
// watching deliverability after each batch is worth more than automation
// right now. See PROJECT-PLAN.md "Resend marketing campaigns" for the
// reasoning (Resend free plan: 1 domain, 100/day, 3,000/month).
const BATCH_SIZE = 80

const SEGMENT_OPTIONS = [
  { v: 'all', label: 'All subscribed contacts' },
  ...MC_AUDIENCES.map(a => ({ v: `audience:${a}`, label: `Audience — ${a}` })),
  ...MC_CATEGORIES.map(t => ({ v: `tag:${t}`, label: `Tag — ${t}` })),
]

function segmentFromValue(v) {
  if (v === 'all') return { all: true }
  const [kind, val] = v.split(':')
  return kind === 'tag' ? { tag: val } : { audience: val }
}

function segmentLabel(segment) {
  if (!segment) return '—'
  if (segment.all) return 'All subscribed contacts'
  if (segment.tag) return `Tag — ${segment.tag}`
  if (segment.audience) return `Audience — ${segment.audience}`
  return '—'
}

export default function Campaigns() {
  const { contacts, loading: contactsLoading } = useMarketingContacts()
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState(null)
  const [error, setError] = useState('')

  const [segValue, setSegValue] = useState('all')
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [creating, setCreating] = useState(false)

  const reload = () => listCampaigns().then(setCampaigns).finally(() => setLoading(false))
  useEffect(() => { reload() }, [])

  const segment = segmentFromValue(segValue)
  const previewCount = useMemo(
    () => contacts.filter(c => c.status === 'subscribed' && c.emailable && (
      segment.all ? true : segment.tag ? c.tags.includes(segment.tag) : c.audiences.includes(segment.audience)
    )).length,
    [contacts, segValue]
  )

  async function handleCreate() {
    if (!name.trim() || !subject.trim() || !bodyText.trim()) {
      setError('Name, subject and message are all required.'); return
    }
    setCreating(true); setError('')
    try {
      await createCampaign({ name: name.trim(), subject: subject.trim(), bodyText: bodyText.trim(), segment })
      setName(''); setSubject(''); setBodyText('')
      await reload()
    } catch (e) {
      setError(e.message || 'Could not create the campaign.')
    } finally {
      setCreating(false)
    }
  }

  async function handleSendBatch(campaign) {
    const { batch, remaining } = eligibleContacts(campaign, contacts, BATCH_SIZE)
    if (!batch.length) return
    setSendingId(campaign.id); setError('')
    try {
      const results = await sendCampaignBatch({
        subject: campaign.subject,
        bodyText: campaign.bodyText,
        contacts: batch.map(c => ({ id: c.id, email: c.email, first_name: c.first_name })),
      })
      await recordBatchResults(campaign.id, results)
      if (remaining - batch.length <= 0) await setCampaignStatus(campaign.id, 'completed')
      await reload()
    } catch (e) {
      setError(e.message || 'Send failed.')
    } finally {
      setSendingId(null)
    }
  }

  if (loading || contactsLoading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-8">
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">New campaign</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaign name (internal)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q3 2026 wholesale re-engagement"
            className="input w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Segment</label>
          <select value={segValue} onChange={e => setSegValue(e.target.value)} className="input w-full">
            {SEGMENT_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div className="text-xs text-gray-500 mt-1">{previewCount.toLocaleString()} subscribed contact{previewCount === 1 ? '' : 's'} match this segment</div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} className="input w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
          <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} rows={8}
            placeholder="Blank line starts a new paragraph." className="input w-full font-sans" />
        </div>

        <button onClick={handleCreate} disabled={creating} className="btn-primary">
          {creating ? 'Creating…' : 'Create campaign'}
        </button>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Campaigns</h2>
        {campaigns.length === 0 && <div className="text-sm text-gray-400">No campaigns yet.</div>}
        {campaigns.map(c => {
          const { remaining } = eligibleContacts(c, contacts, BATCH_SIZE)
          const sentCount = Object.keys(c.sent || {}).length
          const failedCount = Object.keys(c.failed || {}).length
          const isSending = sendingId === c.id
          return (
            <div key={c.id} className="card p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{c.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {segmentLabel(c.segment)} · {sentCount} sent{failedCount ? `, ${failedCount} failed` : ''}
                  {c.status === 'completed' && <span className="ml-2 inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={12} /> Completed</span>}
                </div>
              </div>
              {c.status !== 'completed' && (
                <button onClick={() => handleSendBatch(c)} disabled={isSending || remaining === 0} className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
                  {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {isSending ? 'Sending…' : remaining === 0 ? 'Nothing left to send' : `Send next batch (${Math.min(remaining, BATCH_SIZE)})`}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
