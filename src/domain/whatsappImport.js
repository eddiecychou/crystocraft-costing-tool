import JSZip from 'jszip'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, collection, getDocs, runTransaction } from 'firebase/firestore'
import { db, storage, authedUser } from '../firebase'
import { findOrCreateLeadByPhone, idFromPhone } from './marketingContact'

// V8.2 — client-side parser + importer for WhatsApp's own "Export Chat"
// .txt format. No API access to either Business or Personal WhatsApp (see
// PROJECT-PLAN.md's "Where V8.2 starts"), so this is built entirely around
// the owner manually exporting one zip per conversation and uploading it
// here — same "no bulk export exists" constraint documented there.
//
// One zip = one continuous conversation with one contact; WhatsApp has no
// subject-based threading like email, so each import becomes a single
// Firestore doc under customers/{id}/whatsapp_threads, shaped close to
// email_threads (message_count/date_range/messages) so a future combined
// "Correspondence" view can treat both the same way without a rewrite.

// D/M/YYYY, H:MM:SS with optional 上午/下午 (AM/PM) markers — the format
// confirmed against a real Hong Kong-locale iPhone export, 2026-08-12
// ("WhatsApp Chat - Annie Fan.zip"). A LEFT-TO-RIGHT MARK (U+200E)
// sometimes precedes the line; stripped rather than required, since it
// wasn't consistently present in the sample.
const LINE_RE = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(?:(上午|下午)\s*)?(\d{1,2}):(\d{2}):(\d{2})\]\s*([^:]+):‎?\s?([\s\S]*)$/

// Attachment placeholder — Chinese "<附件：filename>" (confirmed against
// the real sample) and the English "<attached: filename>" WhatsApp is
// documented to use in that locale (NOT yet confirmed against a real
// English export — revisit this pattern if one turns out to look
// different once the owner exports a customer using an English-locale
// phone).
const ATTACHMENT_RE = /<(?:附件|attached)[:：]\s*([^>]+)>/i

// The one system line WhatsApp inserts at the very start of literally
// every export, in every locale — safe to specifically drop rather than
// trying to generalize "system message" detection from a single sample.
// Everything else (e.g. "added to contacts") is deliberately left as a
// normal message rather than guessed at — better to keep a line that
// turns out to be noise than to silently drop one that turns out to be
// real content (same lesson as the email project's retrieval bugs).
function isEncryptionNotice(body) {
  return /加密|end-to-end encrypted/i.test(body)
}

function parseTimestamp(d, mo, y, ampm, h, min, s) {
  let hour = Number(h)
  if (ampm === '下午' && hour < 12) hour += 12
  if (ampm === '上午' && hour === 12) hour = 0
  return new Date(Number(y), Number(mo) - 1, Number(d), hour, Number(min), Number(s))
}

// Raw export text -> ordered message list. Pure function, no Firebase/DOM
// dependency, so it's testable directly against a real export file.
export function parseWhatsAppExport(text) {
  const lines = text.split(/\r?\n/)
  const messages = []
  for (const line of lines) {
    const m = line.match(LINE_RE)
    if (m) {
      const [, d, mo, y, ampm, h, min, s, sender, body] = m
      messages.push({ date: parseTimestamp(d, mo, y, ampm, h, min, s), sender: sender.trim(), body: body.trim() })
    } else if (messages.length && line.trim()) {
      // A continuation line (WhatsApp wraps a long message across several
      // lines with no timestamp prefix on the continuation) — append to
      // the message currently being built rather than starting a new one.
      messages[messages.length - 1].body += '\n' + line
    }
  }
  if (messages.length && isEncryptionNotice(messages[0].body)) messages.shift()

  return messages.map(msg => {
    // Strip stray LEFT-TO-RIGHT MARKs WhatsApp scatters through body text
    // (e.g. before "<this message was edited>") — invisible but confirmed
    // present in the real sample, worth cleaning rather than carrying an
    // unprintable character into stored/searched text.
    const cleanBody = msg.body.replace(/‎/g, '')
    const att = cleanBody.match(ATTACHMENT_RE)
    return {
      ...msg,
      attachment_filename: att ? att[1].trim() : null,
      body: att ? cleanBody.replace(ATTACHMENT_RE, '').trim() : cleanBody,
    }
  })
}

// The contact/company display name WhatsApp bakes into its own export
// filename ("WhatsApp Chat - Annie Fan.zip" -> "Annie Fan") — the only
// identifying string available anywhere in an export; there is no phone
// number or email in either the filename or the transcript itself
// (confirmed against the real sample). Used as both the suggested-match
// seed and the thread doc's display subject.
// iOS wraps a phone-number-like filename in invisible Unicode bidi-control
// characters (LEFT-TO-RIGHT EMBEDDING / POP DIRECTIONAL FORMATTING etc.) for
// RTL-safe display — confirmed against a real export, 2026-08-12
// ("WhatsApp Chat - ‪+852 6189 0268‬.zip"). Invisible on screen but
// breaks a regex anchored on the string actually starting with a digit/+, so
// strip the whole bidi-control range rather than special-casing the two
// marks seen so far.
const BIDI_CONTROL_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function guessContactName(zipFileName) {
  // iOS writes "WhatsApp Chat - <name>.zip", Android "WhatsApp Chat with
  // <name>.txt" — the `( with)? -\s*` this replaced only ever stripped the
  // hyphen form (it still demanded the "-"), so the "with" form kept its whole
  // "WhatsApp Chat with " prefix. Strip either separator.
  return zipFileName.replace(BIDI_CONTROL_RE, '').replace(/\.zip$/i, '').replace(/^WhatsApp Chat(?: with| -)\s*/i, '').trim()
}

// A contact "name" that's really just a phone number (WhatsApp falls back to
// this when the number was never saved to Contacts) — e.g. "+852 6189 0268".
// Used to default the import page toward "Save as Lead" instead of "Match to
// Customer" for exactly the un-named, never-converted chats the owner
// described (2026-08-12) — a real customer relationship almost always has a
// saved contact name by the time there's a chat worth archiving.
const PHONE_LIKE_RE = /^[+\d][\d\s\-()]{6,}$/
export const looksLikePhoneNumber = name => PHONE_LIKE_RE.test(String(name || '').trim())

// §5.3 content-level overlap fingerprint — a deterministic per-message key for
// comparing a freshly-parsed export against already-stored thread messages.
// Accepts either shape: a parsed message ({ date, sender, body,
// attachment_filename }) or a stored thread message ({ date: ISO string, from,
// body_text, attachment_filename }). Normalisation is deliberately conservative
// — trim + collapse whitespace + strip bidi control, but NO lowercasing or
// stemming — because the fingerprint only ever REPORTS overlap for a human to
// review; it must not silently equate two messages on a case difference.
// Timestamp is reduced to epoch ms so a local Date (parse) and an ISO string
// (stored) of the same instant compare equal. Returns a stable string.
export function messageFingerprint(m) {
  const ts = m.date instanceof Date ? m.date.getTime() : (m.date ? new Date(m.date).getTime() : NaN)
  const norm = s => String(s ?? '').replace(BIDI_CONTROL_RE, '').trim().replace(/\s+/g, ' ')
  return JSON.stringify([
    Number.isFinite(ts) ? ts : null,
    norm(m.sender ?? m.from),
    norm(m.body ?? m.body_text),
    norm(m.attachment_filename ?? ''),
  ])
}

// Epoch-ms of a message in either shape (Date / ISO string), or null.
function msgTs(m) {
  const ts = m.date instanceof Date ? m.date.getTime() : (m.date ? new Date(m.date).getTime() : NaN)
  return Number.isFinite(ts) ? ts : null
}

// §5.2/§5.3 dry-run overlap analysis — pure, testable without Firestore.
// Compares freshly-parsed messages against the target's existing threads and
// returns a deterministic verdict + counts the UI shows BEFORE any import:
//   new             — no existing thread for this (account × contact)
//   safe-update     — idempotent re-import (exact matches + new-after-high-water)
//   overlap-review  — a same-time/same-sender edit, a mid-history difference,
//                     or a message that already lives under ANOTHER account/contact
//   invalid         — nothing parsed
// It reports counts and never mutates or deletes anything (§5.3).
export function analyzeImportOverlap({ account, contactId, messages, threads = [] }) {
  if (!messages?.length) return { verdict: 'invalid', reason: 'no-messages' }

  const target = threads.find(t => normalizeAccount(t.account) === normalizeAccount(account) && t.contact_id === contactId)
  const others = threads.filter(t => t !== target)

  const targetFps = new Set()
  let highWater = null
  for (const m of target?.messages || []) {
    targetFps.add(messageFingerprint(m))
    const ts = msgTs(m)
    if (ts != null && (highWater === null || ts > highWater)) highWater = ts
  }

  const otherFps = new Set()
  for (const t of others) for (const m of t.messages || []) otherFps.add(messageFingerprint(m))

  let exact = 0, newAfter = 0, conflicts = 0, crossAccount = 0
  for (const m of messages) {
    const fp = messageFingerprint(m)
    if (targetFps.has(fp)) { exact++; continue }
    if (otherFps.has(fp)) { crossAccount++; continue }
    const ts = msgTs(m)
    if (target && highWater != null && ts != null && ts > highWater) { newAfter++; continue }
    if (target) { conflicts++ } else { newAfter++ }
  }

  if (!target) {
    return {
      verdict: crossAccount > 0 ? 'overlap-review' : 'new',
      exact, newAfter, conflicts, crossAccount,
      targetExists: false, otherThreadCount: others.length,
    }
  }
  return {
    verdict: (conflicts > 0 || crossAccount > 0) ? 'overlap-review' : 'safe-update',
    exact, newAfter, conflicts, crossAccount,
    targetExists: true, targetThreadId: target.id,
  }
}

// §5.5 / step 4 — additive merge: carry what only the stored copy has (a
// transcript and/or attachment URL keyed by attachment filename, stable across
// re-exports) onto freshly-parsed messages. The new export's full history is
// authoritative for message CONTENT; provenance that isn't in the export is
// carried forward. Never deletes an existing message. Pure + testable.
export function carryForwardMedia(newMessages, existingMessages) {
  const prior = new Map()
  for (const m of existingMessages || []) {
    if (!m.attachment_filename) continue
    if (m.transcript || m.attachment_url) {
      prior.set(m.attachment_filename, { transcript: m.transcript ?? null, url: m.attachment_url ?? null })
    }
  }
  return newMessages.map(m => {
    const p = m.attachment_filename ? prior.get(m.attachment_filename) : null
    if (!p) return m
    const out = { ...m }
    if (p.transcript) { out.transcript = p.transcript; out.needs_transcription = false }
    if (p.url && !out.attachment_url) out.attachment_url = p.url
    return out
  })
}

// Merge two stored message lists into one chronological thread: union by
// fingerprint (dedupes a message that appears in both archives), sorted by
// date. Used when two legacy archives for the same person+account collide on
// the new account×contact id. Pure + testable; never deletes a message.
export function mergeThreadMessages(listA, listB) {
  const seen = new Set()
  const merged = []
  for (const m of [...(listA || []), ...(listB || [])]) {
    const fp = messageFingerprint(m)
    if (seen.has(fp)) continue
    seen.add(fp)
    merged.push(m)
  }
  merged.sort((a, b) => (msgTs(a) ?? 0) - (msgTs(b) ?? 0))
  return merged
}

// Parsed messages -> the Firestore doc shape. Attachment URLs are filled
// in separately by uploadAttachments() once the caller has actually
// uploaded each file to Storage — this function never touches Storage.
export function buildThreadDoc({ zipFileName, channel, messages, account, contactId, matchedBy, threadType = 'direct', groupName }) {
  const dates = messages.map(m => m.date.getTime())
  return {
    subject: guessContactName(zipFileName),
    channel,
    // §5.1 identity — account (normalised business/personal) + contact_id;
    // matched_by records which key resolved the contact (phone/name). Null
    // when absent, so pre-§5.1 callers are unaffected.
    account: account ? normalizeAccount(account) : null,
    contact_id: contactId ?? null,
    matched_by: matchedBy ?? null,
    // A GROUP thread has many senders and no single contact person: keyed on
    // account × group name (conversationGroupId), contact_id null.
    thread_type: threadType,
    group_name: threadType === 'group' ? (groupName ?? guessContactName(zipFileName)) : null,
    source_file: zipFileName,
    message_count: messages.length,
    date_range: dates.length ? [new Date(Math.min(...dates)).toISOString(), new Date(Math.max(...dates)).toISOString()] : [],
    messages: messages.map(m => ({
      from: m.sender,
      date: m.date.toISOString(),
      body_text: m.body,
      attachment_filename: m.attachment_filename,
      attachment_url: null,
      // Voice notes need a transcription pass (Deepgram, owner's choice,
      // 2026-08-12 — not built yet) before their content is searchable/
      // summarizable; everything else (photos, PDFs) has no text content
      // to add, so this flag is deliberately opus-only, not "any
      // attachment". Real gap, not an edge case: 44 of 73 media files in
      // the sample export were voice notes.
      needs_transcription: !!m.attachment_filename && /\.opus$/i.test(m.attachment_filename),
      transcript: null,
    })),
  }
}

// A Storage object name has to avoid a handful of characters Firebase
// rejects/mishandles (# [ ] * ?) — WhatsApp's own filenames never use
// them in practice, but a customer's original filename (case with a
// caption-derived name) plausibly could.
const sanitizeStorageName = name => name.replace(/[#[\]*?]/g, '_')

// Uploads every attachment referenced in `threadDoc.messages` under
// `storagePrefix` (customers/{id}/whatsapp/{importId} or
// marketing_contacts/{id}/whatsapp/{importId} — both covered by their own
// storage.rules wildcard, no new rule needed per target) and fills in each
// message's attachment_url in place. `onProgress(done, total)` is optional —
// a real import can mean 70+ files, worth showing progress for.
//
// `existingUrlsByFilename` (re-import only — see importWhatsAppZip) skips
// re-uploading a file that's already there under the same name: WhatsApp
// re-exports the FULL history every time, so without this, re-importing an
// ongoing chat to pick up new messages would re-upload every old photo/voice
// note too, on every single re-import.
async function uploadAttachments(zip, threadDoc, storagePrefix, onProgress, existingUrlsByFilename = null) {
  const withAttachment = threadDoc.messages.filter(m => m.attachment_filename)
  let done = 0
  for (const msg of withAttachment) {
    const existingUrl = existingUrlsByFilename?.get(msg.attachment_filename)
    if (existingUrl) { msg.attachment_url = existingUrl; done++; onProgress?.(done, withAttachment.length); continue }
    const entry = zip.file(msg.attachment_filename)
    if (!entry) { done++; continue } // referenced in the transcript but missing from the zip — leave attachment_url null rather than fail the whole import
    const blob = await entry.async('blob')
    const path = `${storagePrefix}/${sanitizeStorageName(msg.attachment_filename)}`
    const ref = storageRef(storage, path)
    await uploadBytes(ref, blob)
    msg.attachment_url = await getDownloadURL(ref)
    done++
    onProgress?.(done, withAttachment.length)
  }
}

// LEGACY doc id from the export filename only — used by pre-§5.1 imports and
// by the migration review view to locate old name-keyed threads. Replaced for
// new imports by conversationThreadId() below, because a name is neither
// durable nor unique (plan §5.1: rename, dual-account, same-named contacts).
export function threadDocId(zipFileName) {
  return guessContactName(zipFileName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chat'
}

// Normalise the channel selector's display label to the immutable source
// account that §5.1 makes part of thread identity: 'WhatsApp Business' →
// 'business', 'Personal WhatsApp' → 'personal'. Tolerates already-normalised
// input and case; anything unrecognised is 'unknown' (the caller must not
// import with 'unknown' — account is chosen explicitly, never guessed).
export function normalizeAccount(channel) {
  const c = String(channel || '').toLowerCase()
  if (c.includes('business')) return 'business'
  if (c.includes('personal')) return 'personal'
  return 'unknown'
}

// §5.1 thread doc id: folds source account + resolved contact_id into the id,
// so two same-named contacts and one person's Business vs Personal numbers can
// never collide (the old name-only id would overwrite both). The display name
// lives in the doc's `subject` field, NOT in the id, so a phone-side rename
// cannot change identity. Throws without a contact_id — an unattributed
// thread is never silently imported (§5.4).
export function conversationThreadId({ account, contactId }) {
  const a = normalizeAccount(account)
  const c = String(contactId ?? '').trim().toLowerCase()
  if (!c) throw new Error('conversationThreadId needs a resolved contact_id — an unattributed thread must not be imported')
  return `${a}__${c}`
}

// Group chat id — a WhatsApp GROUP has many senders and no single contact
// person, so it's keyed on account + group name instead of account + contact_id
// (and it can never collide with a person's thread id).
export function conversationGroupId({ account, groupName }) {
  const a = normalizeAccount(account)
  const g = String(groupName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!g) throw new Error('conversationGroupId needs a group name')
  return `${a}__group__${g}`
}

// Whether a stored thread doc predates the §5.1 scheme (filename-keyed, no
// attribution). The migration review view uses this to surface legacy threads.
// A group thread legitimately has no contact_id but DOES have an account, so
// the marker is `account` alone — a legacy thread is one with no account.
export function isLegacyThread(threadDoc) {
  return !threadDoc || !threadDoc.account
}

// A tombstoned thread (re-keyed by migrateLegacyThread) carries migrated_to —
// readers skip these so a migrated thread never shows/counts twice.
export function isMigratedThread(threadDoc) {
  return !!threadDoc?.migrated_to
}

// Pure decision helper for migrateLegacyThread — the safety-relevant checks
// live here so they're unit-testable without Firestore. Returns { ok: true }
// or { ok: false, reason }. Reasons: missing / already-attributed /
// already-migrated / target-exists.
export function planMigration({ legacyExists, sourceData, targetExists }) {
  if (!legacyExists) return { ok: false, reason: 'missing' }
  if (!isLegacyThread(sourceData)) return { ok: false, reason: 'already-attributed' }
  if (sourceData?.migrated_to) return { ok: false, reason: 'already-migrated' }
  if (targetExists) return { ok: false, reason: 'target-exists' }
  return { ok: true }
}

// Re-key a legacy (filename-keyed) thread to the §5.1 account×contact id.
// Safe-by-construction and undoable: it NEVER hard-deletes the source — it
// writes the new attributed doc, VERIFIES it persisted, then tombstones the
// source with migrated_to/migrated_at (the source stays as its own undo
// backup). Readers skip migrated_to docs. undoMigrateLegacyThread reverses it.
export async function migrateLegacyThread({ collectionName, parentId, legacyId, account, contactId, matchedBy = 'migrated' }) {
  const newId = conversationThreadId({ account, contactId })
  const srcRef = doc(db, collectionName, parentId, 'whatsapp_threads', legacyId)
  const dstRef = doc(db, collectionName, parentId, 'whatsapp_threads', newId)

  const srcSnap = await getDoc(srcRef)
  const src = srcSnap.exists() ? srcSnap.data() : null
  const dstSnap = await getDoc(dstRef)
  const plan = planMigration({ legacyExists: srcSnap.exists(), sourceData: src, targetExists: dstSnap.exists() })
  if (!plan.ok) throw new Error(`Cannot migrate: ${plan.reason}`)

  // 1. Write the new (attributed) doc — full copy + attribution + lineage.
  await setDoc(dstRef, {
    ...src,
    account: normalizeAccount(account),
    contact_id: contactId,
    matched_by: matchedBy,
    migrated_from: legacyId,
    migrated_at: serverTimestamp(),
  })

  // 2. Verify the new doc persisted BEFORE touching the source.
  if (!(await getDoc(dstRef)).exists()) {
    throw new Error('Migration write did not persist — source left untouched.')
  }

  // 3. Tombstone the source (keeps full content for undo; readers skip it).
  await updateDoc(srcRef, { migrated_to: newId, migrated_at: serverTimestamp() })

  return { legacyId, newId }
}

// Reverse migrateLegacyThread: delete the migrated doc and clear the source's
// tombstone marker, restoring the legacy thread exactly as it was (its content
// was never destroyed). Requires the tombstone marker to be present.
export async function undoMigrateLegacyThread({ collectionName, parentId, legacyId, newId }) {
  const srcRef = doc(db, collectionName, parentId, 'whatsapp_threads', legacyId)
  const dstRef = doc(db, collectionName, parentId, 'whatsapp_threads', newId)

  const srcSnap = await getDoc(srcRef)
  if (!srcSnap.exists() || !srcSnap.data().migrated_to) {
    throw new Error('Nothing to undo — the legacy thread has no migration marker.')
  }

  await deleteDoc(dstRef)
  await updateDoc(srcRef, { migrated_to: deleteField(), migrated_at: deleteField() })
  return { restored: legacyId, removed: newId }
}

// Merge a legacy (filename-keyed) thread into an existing account×contact
// thread — the resolution for "target-exists" when two archives are the same
// person on the same account. Additive: unions the two message lists (deduped
// by fingerprint) into the target and tombstones the source; never deletes a
// message. Transactional (re-reads inside the transaction).
export async function mergeLegacyThread({ collectionName, parentId, legacyId, account, contactId }) {
  const newId = conversationThreadId({ account, contactId })
  const srcRef = doc(db, collectionName, parentId, 'whatsapp_threads', legacyId)
  const dstRef = doc(db, collectionName, parentId, 'whatsapp_threads', newId)

  await runTransaction(db, async (tx) => {
    const sSnap = await tx.get(srcRef)
    const dSnap = await tx.get(dstRef)
    if (!sSnap.exists()) throw new Error('Legacy thread no longer exists.')
    if (!dSnap.exists()) throw new Error('Target thread does not exist — migrate first.')
    const s = sSnap.data()
    const d = dSnap.data()
    if (!isLegacyThread(s) || s.migrated_to) throw new Error('Source is not a pending legacy thread.')

    const messages = mergeThreadMessages(d.messages, s.messages)
    const dates = messages.map(m => msgTs(m)).filter(ts => ts != null)
    tx.set(dstRef, {
      ...d,
      messages,
      message_count: messages.length,
      date_range: dates.length ? [new Date(Math.min(...dates)).toISOString(), new Date(Math.max(...dates)).toISOString()] : d.date_range,
    })
    tx.set(srcRef, { ...s, migrated_to: newId, migrated_at: serverTimestamp() })
  })

  return { legacyId, newId }
}

// One-time scan for legacy (filename-keyed, unattributed) threads across every
// customer and marketing contact, for the migration review view. There is no
// whatsapp_threads collection-group rule, so this is a per-parent scan (same
// posture as whatsappSummaryApi's candidate scan). Sequential is fine for a
// one-time action; onProgress({done,total}) lets the UI show progress.
export async function loadLegacyWhatsappThreads(onProgress) {
  const rows = []
  const customersSnap = await getDocs(collection(db, 'customers'))
  const leadsSnap = await getDocs(collection(db, 'marketing_contacts'))
  const total = customersSnap.size + leadsSnap.size
  let done = 0
  const tick = () => { done++; onProgress?.({ done, total }) }

  const collect = (kind, parentId, displayName, snap) => {
    for (const t of snap.docs) {
      const d = t.data()
      if (isLegacyThread(d) && !isMigratedThread(d)) {
        rows.push({
          kind, parentId, displayName, legacyId: t.id,
          subject: d.subject, channel: d.channel,
          message_count: d.message_count, date_range: d.date_range,
        })
      }
    }
  }

  for (const c of customersSnap.docs) {
    const snap = await getDocs(collection(db, 'customers', c.id, 'whatsapp_threads'))
    collect('customer', c.id, c.data().company_name || c.id, snap)
    tick()
  }
  for (const l of leadsSnap.docs) {
    const d = l.data()
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || d.company || d.phone || l.id
    const snap = await getDocs(collection(db, 'marketing_contacts', l.id, 'whatsapp_threads'))
    collect('lead', l.id, name, snap)
    tick()
  }
  return rows
}

// Whether this (account × contact) conversation has already been imported for
// the given target — re-importing is safe either way (setDoc overwrites the
// same doc id rather than duplicating), but the admin should know before
// hitting Import again, not find out only after. Read-only: never creates the
// lead/customer doc just to check (uses idFromPhone directly rather than
// findOrCreateLeadByPhone, which would create one).
export async function findExistingThread(target, channel) {
  const account = normalizeAccount(channel)
  let collectionName, parentId, contactId
  if (target.type === 'lead') {
    if (!target.phone?.trim()) return null
    collectionName = 'marketing_contacts'
    parentId = idFromPhone(target.phone)
    contactId = idFromPhone(target.phone)
  } else {
    if (!target.customerId) return null
    collectionName = 'customers'
    parentId = target.customerId
    contactId = target.contactId
  }
  if (!contactId) return null
  const importId = conversationThreadId({ account, contactId })
  const snap = await getDoc(doc(db, collectionName, parentId, 'whatsapp_threads', importId))
  return snap.exists() ? { importId, ...snap.data() } : null
}

// Dry-run a prospective import: parse the zip and run the §5.2/§5.3 overlap
// analysis against every (non-tombstoned) thread already under the target
// parent, WITHOUT writing anything. Returns the analyzeImportOverlap result.
export async function analyzeWhatsappImport(file, { target, channel }) {
  const account = normalizeAccount(channel)
  const contactId = target.type === 'lead' ? idFromPhone(target.phone) : target.contactId
  const collectionName = target.type === 'lead' ? 'marketing_contacts' : 'customers'
  const parentId = target.type === 'lead' ? idFromPhone(target.phone) : target.customerId

  const zip = await JSZip.loadAsync(file)
  const chatEntry = zip.file('_chat.txt') || zip.file(/_chat\.txt$/i)?.[0]
  if (!chatEntry) return { verdict: 'invalid', reason: 'no-chat-file' }
  const text = await chatEntry.async('text')
  const messages = parseWhatsAppExport(text)

  const snap = await getDocs(collection(db, collectionName, parentId, 'whatsapp_threads'))
  const threads = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !isMigratedThread(t))

  return analyzeImportOverlap({ account, contactId, messages, threads })
}

// Full pipeline for one export: parse -> resolve target -> upload
// attachments -> write the Firestore doc. `file` is a browser File (from an
// <input type=file>). `target` is either { type: 'customer', customerId,
// contactId } (a real customer + the resolved contacts[] person) or
// { type: 'lead', phone } (a "weak lead" — never converted, saved under
// marketing_contacts/ instead; its "person" is the lead itself). The doc id is
// the §5.1 account × contact key (conversationThreadId), not the filename.
export async function importWhatsAppZip(file, { target, channel, onProgress, matchedBy, media = 'all' }) {
  const zip = await JSZip.loadAsync(file)
  const chatEntry = zip.file('_chat.txt') || zip.file(/_chat\.txt$/i)?.[0]
  if (!chatEntry) throw new Error('No _chat.txt found in this zip — is it a real WhatsApp chat export?')
  const text = await chatEntry.async('text')
  const messages = parseWhatsAppExport(text)
  if (!messages.length) throw new Error('Parsed 0 messages from _chat.txt — the export format may not match what this parser expects.')

  const account = normalizeAccount(channel)
  const contactId = target.type === 'lead' ? idFromPhone(target.phone) : target.contactId
  const importId = conversationThreadId({ account, contactId })
  const threadDoc = buildThreadDoc({ zipFileName: file.name, channel, messages, account, contactId, matchedBy })

  const collectionName = target.type === 'lead' ? 'marketing_contacts' : 'customers'
  const parentId = target.type === 'lead' ? await findOrCreateLeadByPhone(target.phone) : target.customerId
  const ref = doc(db, collectionName, parentId, 'whatsapp_threads', importId)

  // Re-importing (e.g. a fresh export of the same ongoing chat, with newer
  // messages appended) overwrites this whole doc — WhatsApp always exports
  // the FULL history, not just what's new, so there's no way to append-only.
  // Without this, every voice note transcribed via Deepgram would silently
  // come back as needs_transcription:true with its transcript gone, since
  // buildThreadDoc has no way to know a message already had one. Carry
  // forward any existing transcript by matching on attachment_filename —
  // stable across re-exports of the same chat (WhatsApp numbers attachments
  // sequentially and never renumbers existing ones on a fresh export, only
  // appends new ones).
  const existingSnap = await getDoc(ref)
  let existingUrlsByFilename = null
  if (existingSnap.exists()) {
    const existingMessages = existingSnap.data().messages || []
    existingUrlsByFilename = new Map()
    for (const m of existingMessages) {
      if (m.attachment_filename && m.attachment_url) existingUrlsByFilename.set(m.attachment_filename, m.attachment_url)
    }
    threadDoc.messages = carryForwardMedia(threadDoc.messages, existingMessages)
  }

  // 'text first / media later' (§5.5): media:'none' writes the messages with
  // attachment_url left null, so a very large archive imports fast and its
  // media can be uploaded in a later pass (uploadAttachments fills the URLs).
  if (media !== 'none') {
    await uploadAttachments(zip, threadDoc, `${collectionName}/${parentId}/whatsapp/${importId}`, onProgress, existingUrlsByFilename)
  }

  // Transactional final write — re-read and re-carry transcripts/URLs so a
  // transcription that landed mid-import isn't lost, and preserve lineage.
  // The doc id is account×contact-scoped, so this can never overwrite a
  // DIFFERENT account's thread (§5.1).
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const existing = snap.exists() ? snap.data() : null
    const finalDoc = {
      ...threadDoc,
      messages: existing?.messages ? carryForwardMedia(threadDoc.messages, existing.messages) : threadDoc.messages,
      imported_at: serverTimestamp(),
    }
    if (existing?.migrated_from) finalDoc.migrated_from = existing.migrated_from
    if (existing?.migrated_at) finalDoc.migrated_at = existing.migrated_at
    tx.set(ref, finalDoc)
  })
  return { importId, parentId, messageCount: threadDoc.message_count, dateRange: threadDoc.date_range }
}

// Cheap, upload-free pass for the import page's preview step — parses the
// transcript only (fast: JSZip still has to read the zip's central
// directory to find _chat.txt, but none of the media blobs) so the admin
// can see message count / date range / suggested contact name and pick
// the right customer before committing to the slower full import.
export async function previewWhatsAppZip(file) {
  const zip = await JSZip.loadAsync(file)
  const chatEntry = zip.file('_chat.txt') || zip.file(/_chat\.txt$/i)?.[0]
  if (!chatEntry) throw new Error('No _chat.txt found in this zip — is it a real WhatsApp chat export?')
  const text = await chatEntry.async('text')
  const messages = parseWhatsAppExport(text)
  const dates = messages.map(m => m.date.getTime())
  const attachmentCount = messages.filter(m => m.attachment_filename).length
  const voiceCount = messages.filter(m => m.attachment_filename && /\.opus$/i.test(m.attachment_filename)).length
  const contactName = guessContactName(file.name)
  return {
    zip,
    contactName,
    looksLikePhone: looksLikePhoneNumber(contactName),
    messageCount: messages.length,
    dateRange: dates.length ? [new Date(Math.min(...dates)), new Date(Math.max(...dates))] : null,
    attachmentCount,
    voiceCount,
    senders: [...new Set(messages.map(m => m.sender))],
  }
}

// Same target shape import/preview use ({type:'customer',customerId} or
// {type:'lead',phone}) -> the doc path to read/write. Deliberately does NOT
// call findOrCreateLeadByPhone — transcription only ever runs against an
// already-imported thread, so the lead doc is known to exist; this just
// needs its id, not permission to create one.
function targetToPath(target) {
  return target.type === 'lead'
    ? { collectionName: 'marketing_contacts', parentId: idFromPhone(target.phone) }
    : { collectionName: 'customers', parentId: target.customerId }
}

// Deepgram language codes offered in the UI — mirrors the edge function's
// own allowlist. Cantonese isn't in Deepgram's detect_language coverage at
// all (confirmed against their docs, 2026-08-13), so there's no auto-detect
// option here — the two real cases seen so far (a Cantonese-heavy customer,
// a genuinely English-speaking one like Joe Feder) need an explicit pick.
export const WHATSAPP_TRANSCRIBE_LANGUAGES = [
  { value: 'zh-HK', label: 'Cantonese' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Mandarin' },
]

// Transcribes ONE voice note via Deepgram (transcribe-whatsapp-audio edge
// function — see its own header comment) and writes the result back onto
// that message in place. Firestore has no "update one element of an array
// field" op, so this reads the whole thread doc, patches the one message,
// and writes the whole messages array back — fine at the message counts a
// single WhatsApp export actually has (tens, not thousands).
export async function transcribeMessage(target, threadId, messageIndex, language = 'zh-HK') {
  const { collectionName, parentId } = targetToPath(target)
  const ref = doc(db, collectionName, parentId, 'whatsapp_threads', threadId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('This thread no longer exists.')
  const messages = [...(snap.data().messages || [])]
  const msg = messages[messageIndex]
  if (!msg) throw new Error('Message not found.')
  if (!msg.attachment_url) throw new Error('No audio file to transcribe (the attachment may be missing from the original export).')

  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/transcribe-whatsapp-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ audioUrl: msg.attachment_url, language }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)

  messages[messageIndex] = {
    ...msg,
    transcript: data.transcript || '(no speech detected)',
    transcript_language: data.language || language,
    needs_transcription: false,
  }
  await updateDoc(ref, { messages })
  return messages[messageIndex]
}

