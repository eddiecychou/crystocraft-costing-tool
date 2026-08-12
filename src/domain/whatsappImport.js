import JSZip from 'jszip'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, storage } from '../firebase'
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
  return zipFileName.replace(BIDI_CONTROL_RE, '').replace(/\.zip$/i, '').replace(/^WhatsApp Chat( with)? -\s*/i, '').trim()
}

// A contact "name" that's really just a phone number (WhatsApp falls back to
// this when the number was never saved to Contacts) — e.g. "+852 6189 0268".
// Used to default the import page toward "Save as Lead" instead of "Match to
// Customer" for exactly the un-named, never-converted chats the owner
// described (2026-08-12) — a real customer relationship almost always has a
// saved contact name by the time there's a chat worth archiving.
const PHONE_LIKE_RE = /^[+\d][\d\s\-()]{6,}$/
export const looksLikePhoneNumber = name => PHONE_LIKE_RE.test(String(name || '').trim())

// Parsed messages -> the Firestore doc shape. Attachment URLs are filled
// in separately by uploadAttachments() once the caller has actually
// uploaded each file to Storage — this function never touches Storage.
export function buildThreadDoc({ zipFileName, channel, messages }) {
  const dates = messages.map(m => m.date.getTime())
  return {
    subject: guessContactName(zipFileName),
    channel,
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
async function uploadAttachments(zip, threadDoc, storagePrefix, onProgress) {
  const withAttachment = threadDoc.messages.filter(m => m.attachment_filename)
  let done = 0
  for (const msg of withAttachment) {
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

// Deterministic doc id from the export filename (not a random auto-id) —
// re-importing the same file for the same customer updates the existing
// thread instead of creating a duplicate, same "safe to repeat" property
// importErpCustomers already relies on for its own dedupe.
export function threadDocId(zipFileName) {
  return guessContactName(zipFileName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chat'
}

// Whether this exact file has already been imported for the given target —
// re-importing is safe either way (setDoc overwrites the same doc id rather
// than duplicating), but the admin should know before hitting Import again,
// not find out only after. Read-only: never creates the lead/customer doc
// just to check (uses idFromPhone directly rather than
// findOrCreateLeadByPhone, which would create one).
export async function findExistingThread(target, zipFileName) {
  const importId = threadDocId(zipFileName)
  let collectionName, parentId
  if (target.type === 'lead') {
    if (!target.phone?.trim()) return null
    collectionName = 'marketing_contacts'
    parentId = idFromPhone(target.phone)
  } else {
    if (!target.customerId) return null
    collectionName = 'customers'
    parentId = target.customerId
  }
  const snap = await getDoc(doc(db, collectionName, parentId, 'whatsapp_threads', importId))
  return snap.exists() ? { importId, ...snap.data() } : null
}

// Full pipeline for one export: parse -> resolve target -> upload
// attachments -> write the Firestore doc. `file` is a browser File (from an
// <input type=file>). `target` is either { type: 'customer', customerId }
// (matched to a real customers/ record) or { type: 'lead', phone } (a "weak
// lead" — never converted, saved under marketing_contacts/ instead, see
// findOrCreateLeadByPhone in domain/marketingContact.js).
export async function importWhatsAppZip(file, { target, channel, onProgress }) {
  const zip = await JSZip.loadAsync(file)
  const chatEntry = zip.file('_chat.txt') || zip.file(/_chat\.txt$/i)?.[0]
  if (!chatEntry) throw new Error('No _chat.txt found in this zip — is it a real WhatsApp chat export?')
  const text = await chatEntry.async('text')
  const messages = parseWhatsAppExport(text)
  if (!messages.length) throw new Error('Parsed 0 messages from _chat.txt — the export format may not match what this parser expects.')

  const threadDoc = buildThreadDoc({ zipFileName: file.name, channel, messages })
  const importId = threadDocId(file.name)

  const collectionName = target.type === 'lead' ? 'marketing_contacts' : 'customers'
  const parentId = target.type === 'lead' ? await findOrCreateLeadByPhone(target.phone) : target.customerId

  await uploadAttachments(zip, threadDoc, `${collectionName}/${parentId}/whatsapp/${importId}`, onProgress)
  await setDoc(doc(db, collectionName, parentId, 'whatsapp_threads', importId), {
    ...threadDoc,
    imported_at: serverTimestamp(),
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
