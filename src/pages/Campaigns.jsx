import { useEffect, useMemo, useRef, useState } from 'react'
import EmailEditor from 'react-email-editor'
import { Send, Loader2, CheckCircle2 } from 'lucide-react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { useMarketingContacts, MC_AUDIENCES } from '../domain/marketingContact'
import { loadCustomers } from '../domain/customer'
import {
  listCampaigns, createCampaign, recordBatchResults, setCampaignStatus, eligibleContacts,
  eligibleRetailCustomers, listTemplates, saveTemplate, updateTemplate, deleteTemplate, matchesSegment,
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
//
// 'selected:N' is a synthetic option only present when arriving from the
// Contacts tab with a hand-picked list (see presetContactIds) — not a real
// tag/audience, so it's prepended here rather than living in MC_AUDIENCES.
function segmentOptions(contacts, presetCount) {
  const tags = [...new Set(contacts.flatMap(c => c.tags))].sort((a, b) => a.localeCompare(b))
  return [
    ...(presetCount ? [{ v: 'selected', label: `${presetCount} selected contact${presetCount === 1 ? '' : 's'} (from Contacts)` }] : []),
    { v: 'all', label: 'All subscribed contacts' },
    ...MC_AUDIENCES.map(a => ({ v: `audience:${a}`, label: `Audience — ${a}` })),
    ...tags.map(t => ({ v: `tag:${t}`, label: `Tag — ${t}` })),
  ]
}

function segmentFromValue(v, presetIds) {
  if (v === 'selected') return { ids: presetIds || [] }
  if (v === 'all') return { all: true }
  const [kind, val] = v.split(':')
  return kind === 'tag' ? { tag: val } : { audience: val }
}

function segmentLabel(segment) {
  if (!segment) return '—'
  // Retail Customer Campaigns (2026-08-22) — a separate audience source,
  // never mixed with the marketing_contacts segments below. v1 has no
  // sub-segmentation within it (see eligibleRetailCustomers's own comment).
  if (segment.source === 'customers') return 'Retail customers (all)'
  if (segment.all) return 'All subscribed contacts'
  if (segment.tag) return `Tag — ${segment.tag}`
  if (segment.audience) return `Audience — ${segment.audience}`
  if (segment.ids) return `${segment.ids.length} hand-picked contact${segment.ids.length === 1 ? '' : 's'}`
  return '—'
}

// Templates used to be a hardcoded JS object here — "I can't even edit and
// save the existing template 'Portal Invite'" (owner, 2026-08-07), because
// it wasn't a real record, just code. All templates now live in Firestore
// (campaign_templates, see domain/campaigns.js) and are uniformly
// save/update/delete-able from the UI below. "Portal invite" itself was
// migrated into a real template doc via a one-off script — see
// scripts/seed-portal-invite-template.mjs — rather than living here.

export default function Campaigns({ presetContactIds, onConsumedPreset }) {
  const { contacts, loading: contactsLoading } = useMarketingContacts()
  // Retail Customer Campaigns (2026-08-22) — loaded once, same pattern
  // DailyDrafts.jsx already uses for the full customers list. Needed
  // regardless of which audience source is currently selected in the "New
  // campaign" form, because the campaigns LIST below must compute the
  // correct "remaining" count for any already-created customer-sourced
  // campaign too.
  const [allCustomers, setAllCustomers] = useState([])
  const [customersLoading, setCustomersLoading] = useState(true)
  useEffect(() => { loadCustomers().then(setAllCustomers).finally(() => setCustomersLoading(false)) }, [])
  const retailCustomers = useMemo(() => allCustomers.filter(c => c.customer_type === 'retail'), [allCustomers])

  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState(null)
  const [error, setError] = useState('')

  // 'contacts' (default — existing marketing_contacts targeting, unchanged)
  // or 'customers' (retail customers — owner, 2026-08-22: "campaigns will be
  // more targeting B2C retail because i personally don't know the customers
  // unlike the b2b" — Daily Drafts is the personal-note tool for B2B, this
  // bulk path is for retail).
  const [audienceSource, setAudienceSource] = useState('contacts')
  const [segValue, setSegValue] = useState('all')
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [creating, setCreating] = useState(false)
  const editorRef = useRef(null)

  const reload = () => listCampaigns().then(setCampaigns).finally(() => setLoading(false))
  useEffect(() => { reload() }, [])

  const [templates, setTemplates] = useState([])
  const [savingTemplate, setSavingTemplate] = useState(false)
  // The template currently loaded into the editor, if any — lets "Update
  // this template" overwrite it in place instead of always creating a new
  // one. Cleared whenever a DIFFERENT template loads or a campaign starts
  // from scratch; NOT cleared just by editing (that's the whole point).
  const [loadedTemplateId, setLoadedTemplateId] = useState(null)
  const reloadTemplates = () => listTemplates().then(setTemplates)
  useEffect(() => { reloadTemplates() }, [])

  // Arriving from the Contacts tab with a hand-picked list — select that
  // segment automatically. Kept in its own state (not read straight off the
  // prop) because onConsumedPreset clears the prop in the parent right away
  // (so switching tabs and back doesn't keep re-triggering this) — reading
  // the prop directly for segment matching would lose the ids the moment
  // that happens.
  const [localPresetIds, setLocalPresetIds] = useState(null)
  useEffect(() => {
    if (presetContactIds && presetContactIds.length) {
      setLocalPresetIds(presetContactIds)
      setSegValue('selected')
      onConsumedPreset()
    }
  }, [presetContactIds])

  const segOptions = useMemo(() => segmentOptions(contacts, localPresetIds?.length), [contacts, localPresetIds])
  const segment = audienceSource === 'customers'
    ? { source: 'customers', all: true }
    : segmentFromValue(segValue, localPresetIds)
  const previewCount = useMemo(() => {
    if (audienceSource === 'customers') {
      return retailCustomers.filter(c => !c.unsubscribed && !c.email_bounced && !c.email_complained && c.contact_emails?.[0]).length
    }
    return contacts.filter(c => c.status === 'subscribed' && c.emailable && matchesSegment(c, segment)).length
  }, [contacts, segValue, localPresetIds, audienceSource, retailCustomers])

  function applyTemplate(id) {
    if (!id) return
    const t = templates.find(x => x.id === id)
    if (!t) return
    setSubject(t.subject)
    editorRef.current?.editor?.loadDesign(t.design)
    setLoadedTemplateId(id)
  }

  // "Where do I add a template?" (owner, 2026-08-07) — captures whatever's
  // currently in the editor (same exportDesign() the Create button uses) as
  // a new reusable starting point, not tied to any one campaign.
  async function handleSaveAsTemplate() {
    const name = window.prompt('Name this template (e.g. "Autumn newsletter"):')
    if (!name || !name.trim()) return
    setSavingTemplate(true); setError('')
    try {
      const { design } = await exportDesign()
      const id = await saveTemplate({ name: name.trim(), subject: subject.trim(), design })
      await reloadTemplates()
      setLoadedTemplateId(id)
    } catch (e) {
      setError(e.message || 'Could not save this template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  // "I can't even edit and save the existing template" (owner, 2026-08-07) —
  // overwrites the currently-loaded template with whatever's in the editor
  // now, rather than forcing a new template every time.
  async function handleUpdateTemplate() {
    if (!loadedTemplateId) return
    setSavingTemplate(true); setError('')
    try {
      const { design } = await exportDesign()
      await updateTemplate(loadedTemplateId, { subject: subject.trim(), design })
      await reloadTemplates()
    } catch (e) {
      setError(e.message || 'Could not update this template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleDeleteTemplate(id, name) {
    if (!window.confirm(`Delete the template "${name}"? This can't be undone.`)) return
    await deleteTemplate(id)
    if (loadedTemplateId === id) setLoadedTemplateId(null)
    await reloadTemplates()
  }

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
      setName(''); setSubject(''); setLoadedTemplateId(null)
      editorRef.current?.editor?.loadDesign({ body: { rows: [] } })
      await reload()
    } catch (e) {
      setError(e.message || 'Could not create the campaign.')
    } finally {
      setCreating(false)
    }
  }

  async function handleSendBatch(campaign) {
    const isCustomerCampaign = campaign.segment?.source === 'customers'
    const { batch, remaining } = isCustomerCampaign
      ? eligibleRetailCustomers(campaign, allCustomers, BATCH_SIZE)
      : eligibleContacts(campaign, contacts, BATCH_SIZE)
    if (!batch.length) return
    setSendingId(campaign.id); setError('')
    try {
      const results = await sendCampaignBatch({
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        contacts: isCustomerCampaign
          // Retail customer recipient — `id` IS the customer's own doc id
          // (see eligibleRetailCustomers/customer.js), not a marketing_contacts
          // id. recipientKind tells send-campaign.js to patch customers/{id}
          // on unsubscribe and tag the Resend send with customer_id, not
          // mc_id (see that function's own comment).
          ? batch.map(c => ({
              id: c.id, email: c.contact_emails[0],
              first_name: (c.contact_name || '').split(' ')[0] || '',
              last_name: (c.contact_name || '').split(' ').slice(1).join(' '),
              recipientKind: 'customer',
            }))
          // customerId: only present when this contact is already linked to a
          // real customers/ record (possible_customer_match — see
          // domain/marketingContact.js) — lets send-campaign.js tag the send
          // with BOTH mc_id and customer_id, so a bounce/complaint reaches
          // resend-webhook.js's customer-side handling too, not just the
          // marketing_contacts one (found during the SU-08 interaction-log
          // audit, 2026-08-18: a campaign bounce against an already-linked
          // customer never surfaced on their customer record at all before).
          : batch.map(c => ({
              id: c.id, email: c.email, first_name: c.first_name, last_name: c.last_name,
              customerId: c.possible_customer_match?.customer_id || null,
            })),
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

  if (loading || contactsLoading || customersLoading) return <div className="p-6 text-sm text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-5xl space-y-8">
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink">New campaign</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-none px-3 py-2">{error}</div>}

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-60 mb-1">Campaign name (internal)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q3 2026 wholesale re-engagement"
              className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-60 mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="input w-full" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-60 mb-1">Audience</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-ink-80">
              <input type="radio" name="audienceSource" checked={audienceSource === 'contacts'}
                onChange={() => setAudienceSource('contacts')} />
              Marketing Contacts
            </label>
            <label className="flex items-center gap-1.5 text-sm text-ink-80">
              <input type="radio" name="audienceSource" checked={audienceSource === 'customers'}
                onChange={() => setAudienceSource('customers')} />
              Retail Customers
            </label>
          </div>
        </div>

        {audienceSource === 'contacts' ? (
          <div>
            <label className="block text-xs font-medium text-ink-60 mb-1">Segment</label>
            <select value={segValue} onChange={e => setSegValue(e.target.value)} className="input w-full md:w-96">
              {segOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <div className="text-xs text-ink-60 mt-1">{previewCount.toLocaleString()} subscribed contact{previewCount === 1 ? '' : 's'} match this segment</div>
          </div>
        ) : (
          <div>
            {/* No sub-segmentation yet — see eligibleRetailCustomers's own
                comment for why v1 is "every retail customer," full stop. */}
            <div className="text-sm text-ink-80">All retail customers</div>
            <div className="text-xs text-ink-60 mt-1">
              {previewCount.toLocaleString()} retail customer{previewCount === 1 ? '' : 's'} eligible to receive email
              (excludes anyone unsubscribed, bounced, or without an email on file)
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-60 mb-1">Start from a template (optional)</label>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={loadedTemplateId || ''} onChange={e => applyTemplate(e.target.value)} className="input w-full md:w-96">
              <option value="" disabled>{templates.length ? 'Choose a template…' : 'No templates yet — save one below'}</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {loadedTemplateId && (
              <button type="button" onClick={handleUpdateTemplate} disabled={savingTemplate}
                      className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50 whitespace-nowrap">
                {savingTemplate ? 'Updating…' : 'Update this template'}
              </button>
            )}
            <button type="button" onClick={handleSaveAsTemplate} disabled={savingTemplate}
                    className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50 whitespace-nowrap">
              {savingTemplate ? 'Saving…' : '+ Save as new template'}
            </button>
          </div>
          <div className="text-2xs text-ink-60 mt-1">Fills the subject and message below — edit freely before sending.</div>
          {templates.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {templates.map(t => (
                <span key={t.id} className="inline-flex items-center gap-1 text-2xs text-ink-60 bg-ivory rounded-none px-1.5 py-0.5">
                  {t.name}
                  <button type="button" onClick={() => handleDeleteTemplate(t.id, t.name)}
                          className="text-platinum hover:text-red-500" title={`Delete "${t.name}"`}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-60 mb-1">Message</label>
          {/* Unlayer drag-and-drop email builder — proper columns, images,
              buttons, exported as mobile-responsive/Outlook-safe HTML.
              Unsubscribe link + List-Unsubscribe header are added
              server-side (send-campaign.js) regardless of what's built here,
              so compliance doesn't depend on the sender remembering it. */}
          <div className="border border-ivory-dark rounded-none overflow-hidden" style={{ height: 600 }}>
            <EmailEditor ref={editorRef} onReady={handleEditorReady} minHeight="600px" />
          </div>
        </div>

        <button onClick={handleCreate} disabled={creating} className="btn-primary">
          {creating ? 'Creating…' : 'Create campaign'}
        </button>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Campaigns</h2>
        {campaigns.length === 0 && <div className="text-sm text-ink-60">No campaigns yet.</div>}
        {campaigns.map(c => {
          const { remaining } = c.segment?.source === 'customers'
            ? eligibleRetailCustomers(c, allCustomers, BATCH_SIZE)
            : eligibleContacts(c, contacts, BATCH_SIZE)
          const sentCount = Object.keys(c.sent || {}).length
          const failedCount = Object.keys(c.failed || {}).length
          const isSending = sendingId === c.id
          return (
            <div key={c.id} className="card p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-ink truncate">{c.name}</div>
                <div className="text-xs text-ink-60 mt-0.5">
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
