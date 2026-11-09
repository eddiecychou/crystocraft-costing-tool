import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { sendPortalMail } from './portalMail.js'

const OWNER = 'eddie@uart.com.hk'
const MINUTE = 60_000
const SAFE_REPLAY = 23 * 60 * MINUTE
const QUEUE = 'portal_access_alerts'

export function queueAccessAlert(tx, invitation, applicant, now = Date.now()) {
  const path = '/portal/accounts/' + encodeURIComponent(applicant.uid)
  let review = new URL(path, 'https://portal.crystocraft.com').href
  if (process.env.PORTAL_URL) {
    try {
      const configured = new URL(path, process.env.PORTAL_URL)
      if (configured.protocol === 'https:' || configured.protocol === 'http:')
        review = configured.href
    } catch {
      /* A bad link override must not prevent registration. */
    }
  }
  tx.create(invitation.firestore.collection(QUEUE).doc(invitation.id), {
    company: applicant.company,
    contact: applicant.contact,
    email: applicant.email,
    review,
    status: 'queued',
    attempts: 0,
    next_attempt_at: now
  })
}

function mailPayload(job, from) {
  const singleLine = (value) =>
    String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
  const company = singleLine(job.company)
  const applicant = [singleLine(job.contact), singleLine(job.email)]
    .filter(Boolean)
    .join(' · ')
  return {
    from,
    to: [OWNER],
    subject: 'New portal access request — ' + company,
    text: `${applicant} requested portal access for ${company}.\n\nReview the application in OC\n${job.review}`,
    tags: [{ name: 'event', value: 'portal_access_request' }]
  }
}

// Persist the attempt before contacting Resend. A crashed sender and the
// scheduled retry use the same recipient, payload and provider key.
export async function deliverAccessAlert(
  db,
  id,
  { now = Date.now, send = sendPortalMail, mail = process.env } = {}
) {
  const jobRef = db.collection(QUEUE).doc(id)
  const invRef = db.collection('portal_invitations').doc(id)
  const claim = await db.runTransaction(async (tx) => {
    const job = (await tx.get(jobRef)).data()
    const time = now()
    if (!job || job.next_attempt_at == null || job.next_attempt_at > time)
      return null
    if (!(await tx.get(invRef)).exists) {
      tx.update(jobRef, {
        status: 'cancelled',
        next_attempt_at: FieldValue.delete()
      })
      return null
    }
    const mark = (status, fields) => {
      tx.update(jobRef, { status, ...fields })
      tx.update(invRef, { access_alert_status: status })
    }
    if (
      job.uncertain_since != null &&
      time - job.uncertain_since >= SAFE_REPLAY
    ) {
      mark('needs_review', { next_attempt_at: FieldValue.delete() })
      return null
    }
    if (!mail.RESEND_API_KEY || !(job.payload_json || mail.MAIL_FROM)) {
      mark('retry', { next_attempt_at: time + 5 * MINUTE })
      return null
    }
    const payload =
      job.payload_json || JSON.stringify(mailPayload(job, mail.MAIL_FROM))
    const attempt = job.attempts + 1
    mark('sending', {
      attempts: attempt,
      payload_json: payload,
      uncertain_since: job.uncertain_since ?? time,
      next_attempt_at: time + MINUTE
    })
    return {
      payload,
      attempt,
      previouslyUncertain: job.uncertain_since != null
    }
  })
  if (!claim) return
  const digest = createHash('sha256').update(claim.payload).digest('hex')
  const result = await send(
    claim.payload,
    'portal-access/' + id + '/' + digest,
    { apiKey: mail.RESEND_API_KEY, timeoutMs: 5000 }
  )
  await db.runTransaction(async (tx) => {
    const job = (await tx.get(jobRef)).data()
    if (!job || job.status !== 'sending' || job.attempts !== claim.attempt)
      return
    const inv = await tx.get(invRef)
    const accepted = result.status === 'sent'
    const status = accepted ? 'accepted' : 'retry'
    const update = accepted
      ? {
          provider_id: result.provider_id,
          next_attempt_at: FieldValue.delete()
        }
      : {
          next_attempt_at:
            now() +
            Math.min(60, 5 * 2 ** Math.min(4, claim.attempt - 1)) * MINUTE
        }
    if (!claim.previouslyUncertain && result.status === 'failed') {
      // A confirmed rejection can be retried after sender configuration is corrected.
      update.uncertain_since = FieldValue.delete()
      update.payload_json = FieldValue.delete()
    }
    tx.update(jobRef, { status, ...update })
    if (inv.exists) tx.update(invRef, { access_alert_status: status })
  })
}

export async function retryAccessAlerts(db, options) {
  const time = options?.now?.() ?? Date.now()
  const due = await db
    .collection(QUEUE)
    .where('next_attempt_at', '<=', time)
    .limit(5)
    .get()
  let failed = 0
  for (const job of due.docs) {
    try {
      await deliverAccessAlert(db, job.id, options)
    } catch {
      failed++
      console.error('Could not confirm portal access alert', job.id)
    }
  }
  if (failed) throw Error('Some portal access alerts still need retry.')
}

// Called only after the admin confirms that an ambiguous, expired attempt
// has no accepted message in Resend. Concurrent clicks release one job.
export async function retryReviewedAccessAlert(db, id, reviewer) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw Object.assign(Error('Choose a valid invitation.'), { status: 400 })
  const ref = db.collection(QUEUE).doc(id)
  const inv = db.collection('portal_invitations').doc(id)
  await db.runTransaction(async (tx) => {
    const job = await tx.get(ref),
      invitation = await tx.get(inv)
    if (
      job.get('status') !== 'needs_review' ||
      invitation.get('status') !== 'claimed'
    )
      throw Object.assign(Error('Refresh the application before retrying.'), {
        status: 409
      })
    tx.update(ref, {
      status: 'queued',
      next_attempt_at: Date.now(),
      reviewed_by: reviewer,
      reviewed_at: Date.now(),
      uncertain_since: FieldValue.delete(),
      payload_json: FieldValue.delete()
    })
    tx.update(inv, { access_alert_status: 'queued' })
  })
  await deliverAccessAlert(db, id)
}
