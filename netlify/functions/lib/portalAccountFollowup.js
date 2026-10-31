// Private application correspondence. All browser access goes through the
// existing admin-authenticated portal-invite function, never the users doc.
import { createHash } from 'node:crypto'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEASE_MS = 30_000
const RETRY_MS = 23 * 60 * 60 * 1000 // shorter than Resend's 24-hour key retention
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const email = value => String(value || '').trim().toLowerCase()
const pending = account => {
  if (account?.role !== 'customer' || account.status !== 'pending' || account.account_type === 'internal')
    fail('This account is no longer a pending customer application. Refresh the page.', 409)
}
const revision = (state, expected) => {
  if (!Number.isSafeInteger(expected) || expected !== (state.revision || 0))
    fail('This follow-up changed in another session. Refresh before continuing.', 409)
}
const content = body => {
  if (typeof body.subject !== 'string' || typeof body.message !== 'string') fail('Enter a subject and message.')
  const subject = body.subject.trim(), message = body.message.trim()
  if (!subject || subject.length > 200 || /[\r\n\u0000]/.test(subject)) fail('Enter a subject of up to 200 characters on one line.')
  if (!message || message.length > 6000 || /\u0000/.test(message)) fail('Enter a message of up to 6,000 characters.')
  return { subject, message }
}

export async function sendFollowupEmail(payload, key, { apiKey, fetchImpl = fetch }) {
  try {
    const result = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    })
    if (!result.ok) return { status: result.status >= 500 || [408, 409, 429].includes(result.status) ? 'unknown' : 'failed' }
    const data = await result.json()
    return data.id ? { status: 'sent', provider_id: String(data.id).slice(0, 200) } : { status: 'unknown' }
  } catch { return { status: 'unknown' } }
}

// actorUid MUST come from requireAdmin's verified token, never the request body.
export async function accountFollowupAction({ db, actorUid, action, body, mail, now = Date.now, send = sendFollowupEmail }) {
  const actor = (await db.collection('users').doc(actorUid).get()).data()
  if (actor?.role !== 'admin') fail('Admin access required.', 403)
  const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  if (!uid || uid.length > 128 || /[/\u0000-\u001f]/.test(uid)) fail('A valid account is required.')
  const user = db.collection('users').doc(uid)
  const ref = db.collection('portal_account_followups').doc(uid)
  const snapshot = async () => {
    const [account, state, messages] = await Promise.all([
      user.get(), ref.get(), ref.collection('messages').orderBy('created_at', 'desc').limit(20).get(),
    ])
    if (!account.exists) fail('Account not found.', 404)
    const data = state.data() || {}
    return {
      ok: true, revision: data.revision || 0, state: data.state || 'new', draft: data.draft || null,
      last_sent_at: data.last_sent_at || null, received_at: data.received_at || null,
      active_message_id: data.active_message_id || null,
      messages: messages.docs.map(doc => {
        const m = doc.data()
        return { id: doc.id, to: m.payload.to, subject: m.payload.subject, message: m.payload.text,
          status: m.status, created_at: m.created_at, sent_at: m.sent_at || null,
          manual_resolution: m.manual_resolution || null, retry_until: m.created_at + RETRY_MS }
      }),
      from: mail.from || '', reply_to: mail.replyTo || '',
      mail_configured: !!(mail.apiKey && mail.from && EMAIL.test(mail.replyTo || '')),
    }
  }
  if (action === 'get_account_followup') return snapshot()

  if (action === 'save_account_followup_draft' || action === 'mark_account_information_received') {
    const draft = action === 'save_account_followup_draft' ? content(body) : null
    await db.runTransaction(async tx => {
      const [a, s] = await Promise.all([tx.get(user), tx.get(ref)])
      if (!a.exists) fail('Account not found.', 404)
      pending(a.data())
      const state = s.data() || {}; revision(state, body.revision)
      if (state.active_message_id) fail('An email has an unconfirmed send result. Check it before continuing.', 409)
      if (!draft && state.state !== 'waiting') fail('There is no outstanding information request.', 409)
      tx.set(ref, { ...(draft ? { draft } : { state: 'received', received_at: now() }),
        revision: (state.revision || 0) + 1, updated_at: now(), updated_by: actorUid }, { merge: true })
    })
    return snapshot()
  }

  if (action !== 'send_account_followup' && action !== 'resolve_account_followup') fail('Unknown follow-up action.')
  const id = body.messageId
  if (typeof id !== 'string' || !UUID.test(id)) fail('A valid message reference is required.')
  const messageRef = ref.collection('messages').doc(id)

  if (action === 'resolve_account_followup') {
    if (!['sent', 'not_sent'].includes(body.outcome)) fail('Choose the checked send result.')
    await db.runTransaction(async tx => {
      const [a, s, m] = await Promise.all([tx.get(user), tx.get(ref), tx.get(messageRef)])
      if (!a.exists) fail('Account not found.', 404)
      const state = s.data() || {}, message = m.data()
      revision(state, body.revision)
      if (!message || state.active_message_id !== id || !['sending', 'unknown'].includes(message.status)) fail('This send result has already changed. Refresh the page.', 409)
      if (now() - message.attempted_at < LEASE_MS) fail('This email is still being sent. Wait briefly, then refresh.', 409)
      const sent = body.outcome === 'sent'
      tx.update(messageRef, { status: sent ? 'sent' : 'failed', manual_resolution: body.outcome,
        resolved_at: now(), resolved_by: actorUid, ...(sent ? { sent_at: message.created_at } : {}) })
      tx.set(ref, { active_message_id: null, revision: (state.revision || 0) + 1,
        ...(sent ? { draft: null, state: 'waiting', last_sent_at: message.created_at, received_at: null } : {}),
        updated_at: now(), updated_by: actorUid }, { merge: true })
    })
    return snapshot()
  }

  if (!mail.apiKey || !mail.from || !EMAIL.test(mail.replyTo || '')) fail('Email sending or the reply inbox is not configured. You can still save a draft.', 503)
  const reserved = await db.runTransaction(async tx => {
    const [a, s, m] = await Promise.all([tx.get(user), tx.get(ref), tx.get(messageRef)])
    if (!a.exists) fail('Account not found.', 404)
    const account = a.data(), state = s.data() || {}, previous = m.data()
    if (previous?.status === 'sent') return null // lost response, already accepted
    pending(account)
    if (previous) {
      if (!['sending', 'unknown'].includes(previous.status) || state.active_message_id !== id) fail('This attempt has finished. Refresh before preparing another email.', 409)
      if (email(account.email) !== email(previous.payload.to)) fail('The applicant email changed. Check the earlier send result before continuing.', 409)
      if (now() - previous.created_at >= RETRY_MS) fail('The safe retry period has ended. Check the email service and record the result below.', 409)
      if (now() - previous.attempted_at < LEASE_MS) fail('This email is still being sent. Wait briefly, then refresh.', 409)
      const attemptedAt = now()
      tx.update(messageRef, { status: 'sending', attempted_at: attemptedAt })
      return { ...previous, attempted_at: attemptedAt }
    }
    revision(state, body.revision)
    if (state.active_message_id) fail('An earlier email has an unconfirmed send result. Refresh and check it first.', 409)
    const to = email(account.email)
    if (!EMAIL.test(to) || email(body.expectedEmail) !== to) fail('The applicant email changed or is invalid. Refresh the page.', 409)
    const draft = content(body)
    if (state.last_sent_at && now() - state.last_sent_at < LEASE_MS) fail('An email was just sent. Refresh before sending another.', 409)
    const message = { payload: { from: mail.from, to, subject: draft.subject, text: draft.message, reply_to: mail.replyTo },
      status: 'sending', created_at: now(), attempted_at: now(), created_by: actorUid,
      key: `portal-info/${createHash('sha256').update(uid).digest('hex').slice(0, 24)}/${id}` }
    tx.create(messageRef, message)
    tx.set(ref, { draft, active_message_id: id, revision: (state.revision || 0) + 1,
      updated_at: now(), updated_by: actorUid }, { merge: true })
    return message
  })
  if (!reserved) return snapshot()
  const result = await send(reserved.payload, reserved.key, mail)
  // If this final write fails, retain the outbox/lease. Retrying the same
  // immutable payload/key recovers provider acceptance, never a fresh message.
  await db.runTransaction(async tx => {
    const [s, m] = await Promise.all([tx.get(ref), tx.get(messageRef)])
    const state = s.data() || {}
    if (state.active_message_id !== id || m.data()?.status !== 'sending' || m.data().attempted_at !== reserved.attempted_at) return
    const status = ['sent', 'failed'].includes(result.status) ? result.status : 'unknown'
    tx.update(messageRef, { status, updated_at: now(), ...(result.provider_id ? { provider_id: result.provider_id } : {}), ...(status === 'sent' ? { sent_at: now() } : {}) })
    tx.set(ref, { revision: (state.revision || 0) + 1,
      ...(status === 'unknown' ? {} : { active_message_id: null }),
      ...(status === 'sent' ? { draft: null, state: 'waiting', last_sent_at: now(), received_at: null } : {}),
      updated_at: now(), updated_by: actorUid }, { merge: true })
  })
  return snapshot()
}
