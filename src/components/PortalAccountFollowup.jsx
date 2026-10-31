import { useEffect, useRef, useState } from 'react'
import { getAccountFollowup, saveAccountFollowupDraft, sendAccountFollowup,
  markAccountInformationReceived, resolveAccountFollowup } from '../portalInviteApi'
import { accountInformationTemplate } from '../portalFollowup'
import { formatOcDateTime } from '../ocTime'

const date = value => value ? `${formatOcDateTime(value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} HKT` : ''
const messageStatus = { sent: 'Sent', sending: 'Sending — refresh to check', unknown: 'Send result unconfirmed', failed: 'Not sent' }

export default function PortalAccountFollowup({ account }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), generation = useRef(0), errorRef = useRef(null), subjectRef = useRef(null)
  const canRequest = account.role === 'customer' && account.status === 'pending' && account.account_type !== 'internal'

  useEffect(() => {
    const current = ++generation.current
    setData(null); setError(''); setNotice(''); setOpen(false); setDraft(null)
    getAccountFollowup(account.id).then(result => { if (generation.current === current) setData(result) })
      .catch(e => { if (generation.current === current) setError(e.message) })
    return () => { generation.current++ }
  }, [account.id])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => { if (open) subjectRef.current?.focus() }, [open])

  async function run(operation, success) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    const current = generation.current
    try {
      const result = await operation()
      if (generation.current !== current) return
      setData(result)
      if (!result.active_message_id && success) success(result)
    } catch (e) { if (generation.current === current) setError(e.message || 'Could not update. Refresh before trying again.') }
    finally { lock.current = false; if (generation.current === current) setBusy(false) }
  }
  const refresh = () => run(() => getAccountFollowup(account.id))
  const start = () => { setDraft(data.draft || accountInformationTemplate(account)); setNotice(''); setOpen(true) }
  const send = event => {
    event.preventDefault()
    run(() => sendAccountFollowup(account.id, { ...draft, expectedEmail: account.email,
      revision: data.revision, messageId: crypto.randomUUID() }), result => {
      if (result.messages[0]?.status === 'sent') { setOpen(false); setNotice('Email sent. Waiting for reply.') }
      else setError('The email was not sent. Your draft is retained. Check the sender settings, then try again.')
    })
  }
  const active = data?.messages.find(m => m.id === data.active_message_id)
  const confirmResult = outcome => {
    const wording = outcome === 'sent' ? 'sent' : 'not sent'
    if (!confirm(`Have you checked the email service and confirmed this message was ${wording}? This records your checked result without sending an email.`)) return
    run(() => resolveAccountFollowup(account.id, active.id, outcome, data.revision), () => setNotice('Checked send result recorded.'))
  }

  if (!canRequest && data && !data.messages.length && !data.draft) return null
  return (
    <section className="card p-5 mb-5 min-w-0" aria-labelledby="application-followup-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="application-followup-heading" className="eyebrow text-ink-60">Application follow-up</h2>
          <p className="text-sm text-ink-60 mt-2" role="status">
            {!data ? (error ? 'Follow-up unavailable.' : 'Loading follow-up…')
              : data.active_message_id ? 'Checking email send result'
              : data.state === 'waiting' ? `Waiting for reply · Sent ${date(data.last_sent_at)}`
              : data.state === 'received' ? `Information received · ${date(data.received_at)}`
              : data.draft ? 'Draft saved — not sent' : 'Ask about their business before approving access.'}
          </p>
        </div>
        {data && canRequest && !open && !active && <button type="button" className="btn-secondary text-xs min-h-11" onClick={start} disabled={busy}>
          {data.draft ? 'Continue draft' : 'Request more information'}
        </button>}
      </div>
      {notice && <p className="text-sm text-ink-70 mt-3" role="status">{notice}</p>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-brand-600 mt-3 break-words">{error}</p>}
      {!data && error && <button type="button" className="btn-secondary text-xs mt-3 min-h-11" disabled={busy} onClick={refresh}>Retry loading</button>}

      {active && <div className="mt-4 border border-warm-grey p-4 space-y-3">
        <p className="text-sm text-ink-70">{messageStatus[active.status]}. Refresh first. If the result remains unconfirmed, retry the same email; a new message stays blocked until this result is known.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary text-xs min-h-11" disabled={busy} onClick={refresh}>Refresh status</button>
          {canRequest && <button type="button" className="btn-secondary text-xs min-h-11" disabled={busy || Date.now() >= active.retry_until}
            onClick={() => run(() => sendAccountFollowup(account.id, { messageId: active.id }), result => {
              if (result.messages.find(m => m.id === active.id)?.status === 'sent') { setOpen(false); setNotice('Email sent. Waiting for reply.') }
            })}>Retry same email</button>}
        </div>
        <details className="text-sm text-ink-60">
          <summary className="cursor-pointer min-h-11 py-3">Record a checked send result</summary>
          <p className="mb-3">Use only after checking whether the email service accepted this message. No email is sent by these actions.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary text-xs min-h-11" disabled={busy} onClick={() => confirmResult('sent')}>Confirmed sent</button>
            <button type="button" className="btn-secondary text-xs min-h-11" disabled={busy} onClick={() => confirmResult('not_sent')}>Confirmed not sent</button>
          </div>
        </details>
      </div>}

      {open && draft && !active && <form className="mt-4 space-y-4" onSubmit={send}>
        <p className="text-sm text-ink-60">The account stays Pending Approval. Review the message before sending.</p>
        <div className="text-xs text-ink-60 space-y-1 break-all">
          <p>To: {account.email}</p><p>From: {data.from || 'Not configured'}</p><p>Replies to: {data.reply_to || 'Not configured'}</p>
        </div>
        <label className="block"><span className="label mb-1 block">Subject</span>
          <input ref={subjectRef} className="input" aria-label="Email subject" required maxLength={200} value={draft.subject} disabled={busy || !canRequest}
            onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} />
        </label>
        <label className="block"><span className="label mb-1 block">Message</span>
          <textarea className="input min-h-80 resize-y" aria-label="Email message" required maxLength={6000} rows={14} value={draft.message} disabled={busy || !canRequest}
            onChange={e => setDraft(d => ({ ...d, message: e.target.value }))} />
        </label>
        {!data.mail_configured && <p className="text-sm text-ink-60">Sending is unavailable until the sender and reply inbox are configured. You can save this draft.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary text-xs min-h-11" disabled={busy || !canRequest || !data.mail_configured}>{busy ? 'Working…' : 'Send email'}</button>
          <button type="button" className="btn-secondary text-xs min-h-11" disabled={busy || !canRequest}
            onClick={() => run(() => saveAccountFollowupDraft(account.id, { ...draft, revision: data.revision }), () => { setOpen(false); setNotice('Draft saved.'); })}>Save draft</button>
          <button type="button" className="btn-ghost text-xs min-h-11" disabled={busy} onClick={() => setOpen(false)}>Close</button>
        </div>
      </form>}

      {data?.state === 'waiting' && canRequest && !active && <button type="button" className="btn-secondary text-xs min-h-11 mt-4" disabled={busy}
        onClick={() => run(() => markAccountInformationReceived(account.id, data.revision), () => setNotice('Information received. Review the customer details and approve separately.'))}>Mark information received</button>}
      {data?.messages.length > 0 && <details className="mt-4 text-sm">
        <summary className="cursor-pointer min-h-11 py-3 text-ink-60">Email history{data.messages.length === 20 ? ' · latest 20' : ` (${data.messages.length})`}</summary>
        <div className="divide-y divide-warm-grey">
          {data.messages.map(m => <article key={m.id} className="py-4 min-w-0">
            <p className="text-xs text-ink-60 break-words">{messageStatus[m.status]} · {date(m.sent_at || m.created_at)}{m.manual_resolution ? ' · Checked manually' : ''}</p>
            <p className="text-xs text-ink-60 break-all mt-1">To: {m.to}</p>
            <p className="text-sm text-ink mt-2 break-words">{m.subject}</p>
            <p className="text-sm text-ink-70 mt-2 whitespace-pre-wrap break-words">{m.message}</p>
          </article>)}
        </div>
      </details>}
      {data && <p className="text-xs text-ink-60 mt-3">Replies arrive in your email inbox. Mark information received after reviewing the reply.</p>}
      {data && <button type="button" className="text-xs text-brand-600 hover:underline min-h-11 mt-1" disabled={busy} onClick={refresh}>Refresh follow-up</button>}
    </section>
  )
}
