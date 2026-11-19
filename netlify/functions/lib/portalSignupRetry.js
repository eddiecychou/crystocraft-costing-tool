import { createHash, randomUUID } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

const hash = value => createHash('sha256').update(value).digest('hex')

export function emailApplicationStatus(profile, attemptHash) {
  if (profile.get('status') !== 'pending') return { error: 'already_registered' }
  if (attemptHash && profile.get('signup_attempt_hash') === attemptHash)
    return { ok: true, status: 'pending' }
  return { error: 'already_pending' }
}

async function findAuth(auth, email) {
  try { return await auth.getUserByEmail(email) }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    return null
  }
}

// Only the exact passwordless identity reserved by this registration can be resumed.
function ownsPlaceholder(record, registration) {
  return record.uid === registration.uid && record.email?.toLowerCase() === registration.email &&
    !record.disabled && !record.emailVerified && !record.providerData?.length &&
    !record.passwordHash && !Object.keys(record.customClaims || {}).length
}

export async function prepareEmailApplication(db, auth, form, retryKey) {
  const { email } = form
  const attemptHash = retryKey ? hash(retryKey) : null
  const receipt = db.collection('portal_signup_retries').doc(hash(email))
  const invitations = db.collection('portal_invitations')
  const profiles = db.collection('users')
  const existingAuth = await findAuth(auth, email)
  const prepared = await db.runTransaction(async tx => {
    const saved = (await tx.get(receipt)).data()
    const profile = existingAuth
      ? await tx.get(profiles.doc(existingAuth.uid))
      : (await tx.get(profiles.where('email', '==', email).limit(1))).docs[0]
    if (profile?.exists) return emailApplicationStatus(profile, attemptHash)
    if (saved) {
      // Older cached forms have no browser receipt. They can replay only their
      // exact original passwordless application. Never take details from a retry.
      const sameAttempt = saved.attemptHash
        ? saved.attemptHash === attemptHash
        : Object.keys(form).every(key => form[key] === saved[key])
      if (!sameAttempt) return { error: 'signup_retry_unavailable' }
      if (existingAuth && !ownsPlaceholder(existingAuth, saved)) return { error: 'already_registered' }
      return { registration: saved }
    }
    if (existingAuth) return { error: 'already_registered' }
    const active = await tx.get(invitations.where('contact_email', '==', email)
      .where('status', 'in', ['pending', 'claimed', 'approved']).limit(2))
    if (active.size > 1 || (active.size && active.docs[0].get('status') !== 'pending'))
      return { error: 'already_pending' }
    const registration = {
      ...form, attemptHash, uid: randomUUID(), invitationId: active.docs[0]?.id || null,
      createdAt: Timestamp.now()
    }
    tx.create(receipt, registration)
    return { registration }
  })
  if (!prepared.registration) return prepared

  const registration = prepared.registration
  if (!existingAuth) {
    try {
      await auth.createUser({ uid: registration.uid, email, emailVerified: false, disabled: false })
    } catch (error) {
      if (!['auth/email-already-exists', 'auth/uid-already-exists'].includes(error.code)) throw error
      const current = await findAuth(auth, email)
      if (!current || !ownsPlaceholder(current, registration)) return { error: 'already_registered' }
    }
  }
  return { registration, receipt }
}
