import { useEffect, useMemo, useRef, useState } from 'react'
import EmailEditor from 'react-email-editor'
import { Send, Loader2, CheckCircle2 } from 'lucide-react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { useMarketingContacts, MC_AUDIENCES } from '../domain/marketingContact'
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

// Tags come from whatever contacts actually carry, not the fixed MC_CATEGORIES
// list — that list is only the "promoted for filtering" subset shown on the
// Contacts page; a one-off tag like "test" (added there for exactly this kind
// of dry run) still needs to be selectable here.
function segmentOptions(contacts) {
  const tags = [...new Set(contacts.flatMap(c => c.tags))].sort((a, b) => a.localeCompare(b))
  return [
    { v: 'all', label: 'All subscribed contacts' },
    ...MC_AUDIENCES.map(a => ({ v: `audience:${a}`, label: `Audience — ${a}` })),
    ...tags.map(t => ({ v: `tag:${t}`, label: `Tag — ${t}` })),
  ]
}

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
  const [creating, setCreating] = useState(false)
  const editorRef = useRef(null)

  const reload = () => listCampaigns().then(setCampaigns).finally(() => setLoading(false))
  useEffect(() => { reload() }, [])

  const segOptions = useMemo(() => segmentOptions(contacts), [contacts])
  const segment = segmentFromValue(segValue)
  const previewCount = useMemo(
    () => contacts.filter(c => c.status === 'subscribed' && c.emailable && (
      segment.all ? true : segment.tag ? c.tags.includes(segment.tag) : c.audiences.includes(segment.audience)
    )).length,
    [contacts, segValue]
  )

  // Unlayer's default image upload goes through their own hosted service,
  // which wants an account/project id. Overriding it to Firebase Storage
  // instead matches how every other image upload in this app works (see
  // ImageGallery.jsx) and keeps campaign images in the same place as
  // everything else — one less external account to provision.
  function handleEditorReady(unlayer) {
    unlayer.registerCallback('image', async (file, done) => {
      try {
        const path = `campaign_images/${Date.now()}_${file.attachments[0].name}`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, file.attachments[0])
        const url = await getDownloadURL(sRef)
        done({ progress: 100, url })
      } catch {
        done({ progress: 100, url: '' })
      }
    })
  }

  function exportDesign() {
    return new Promise((resolve, reject) => {
      const editor = editorRef.current?.editor
      if (!editor) return reject(new Error('Editor not ready yet.'))
      editor.exportHtml(({ design, html }) => resolve({ design, html }))
    })
  }

  async function handleCreate() {
    if (!name.trim() || !subject.trim()) {
      setError('Name and subject are required.'); return
    }
    setCreating(true); setError('')
    try {
      const { design, html } = await exportDesign()
      await createCampaign({ name: name.trim(), subject: subject.trim(), bodyHtml: html, design, segment })
      setName(''); setSubject('')
      editorRef.current?.editor?.loadDesign({ body: { rows: [] } })
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
        bodyHtml: campaign.bodyHtml,
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
    <div className="p-4 md:p-6 max-w-5xl space-y-8">
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">New campaign</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaign name (internal)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q3 2026 wholesale re-engagement"
              className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="input w-full" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Segment</label>
          <select value={segValue} onChange={e => setSegValue(e.target.value)} className="input w-full md:w-96">
            {segOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div className="text-xs text-gray-500 mt-1">{previewCount.toLocaleString()} subscribed contact{previewCount === 1 ? '' : 's'} match this segment</div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
          {/* Unlayer drag-and-drop email builder — proper columns, images,
              buttons, exported as mobile-responsive/Outlook-safe HTML.
              Unsubscribe link + List-Unsubscribe header are added
              server-side (send-campaign.js) regardless of what's built here,
              so compliance doesn't depend on the sender remembering it. */}
          <div className="border border-ivory-dark rounded overflow-hidden" style={{ height: 600 }}>
            <EmailEditor ref={editorRef} onReady={handleEditorReady} minHeight="600px" />
          </div>
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
