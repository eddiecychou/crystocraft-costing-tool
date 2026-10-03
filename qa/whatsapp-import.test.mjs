// node qa/whatsapp-import.test.mjs
//
// Step 1 of docs/plans/WHATSAPP-ARCHIVE-IMPORT-PLAN.md §7: pure
// parser/fingerprint tests against fixture exports. Uses the same
// strip-Firebase-imports pattern as qa/money-fixes.test.mjs — the pure logic
// under test is the real shipped code, not a replica.
//
// Covers: the _chat.txt parser (encryption notice, multiline continuation,
// Chinese + English attachment placeholders, 上午/下午, LTR-mark cleaning), the
// name/identity primitives (guessContactName / looksLikePhoneNumber /
// threadDocId incl. bidi-control handling), the §5.3 message fingerprint, and
// documents the current filename-keyed identity gaps that §5.1 will close.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))

// Load the real module with only its import lines stripped (jszip + Firebase
// SDK + app init + a sibling module that also pulls Firebase). The pure
// functions under test never touch any of them.
const src = readFileSync(join(here, '..', 'src', 'domain', 'whatsappImport.js'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'wa-import-'))
const modPath = join(dir, 'whatsappImport.mjs')
writeFileSync(modPath, src.replace(/^import .*\n/gm, ''))
const {
  parseWhatsAppExport, guessContactName, looksLikePhoneNumber, threadDocId,
  buildThreadDoc, messageFingerprint, normalizeAccount, conversationThreadId,
  isLegacyThread, isMigratedThread, planMigration, analyzeImportOverlap,
  carryForwardMedia, mergeThreadMessages,
} = await import(modPath)
rmSync(dir, { recursive: true, force: true })

const fx = name => readFileSync(join(here, 'fixtures', 'whatsapp', name), 'utf8')

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── parser: encryption notice, senders, body ──────────────────────────────
{
  const msgs = parseWhatsAppExport(fx('annie-fan.txt'))
  check('encryption notice dropped (4 lines → 3 messages)', msgs.length === 3, `got ${msgs.length}`)
  check('senders parsed in order', msgs[0].sender === 'Annie Fan' && msgs[1].sender === 'Eddie Chou' && msgs[2].sender === 'Annie Fan')
  check('body trimmed and clean', msgs[0].body === 'Hi Eddie, can you confirm the crystal price?', JSON.stringify(msgs[0].body))
  check('plain messages carry no attachment', msgs.every(m => m.attachment_filename === null))
}

// ── parser: multiline continuation ────────────────────────────────────────
{
  const msgs = parseWhatsAppExport(fx('multiline.txt'))
  check('continuation lines join the preceding message (4 lines → 2 messages)', msgs.length === 2, `got ${msgs.length}`)
  check('continuation joined with newlines', msgs[0].body === 'First line of a long message\nthat continues on a second line\nand a third line', JSON.stringify(msgs[0].body))
}

// ── parser: attachment placeholders + voice-note flag ─────────────────────
{
  const msgs = parseWhatsAppExport(fx('attachments.txt'))
  check('Chinese <附件：> placeholder extracted', msgs[0].attachment_filename === 'IMG-20240514-WA0001.jpg', JSON.stringify(msgs[0].attachment_filename))
  check('Chinese placeholder removed from body', msgs[0].body === 'Please see this photo', JSON.stringify(msgs[0].body))
  check('English <attached:> placeholder extracted', msgs[1].attachment_filename === 'AUD-20240514-WA0002.opus')
  const doc = buildThreadDoc({ zipFileName: 'x.zip', channel: 'Business', messages: msgs })
  check('.opus voice note flagged needs_transcription', doc.messages[1].needs_transcription === true)
}

// ── parser: malformed export ──────────────────────────────────────────────
{
  check('non-chat text parses to 0 messages', parseWhatsAppExport(fx('malformed.txt')).length === 0)
}

// ── parser: 上午/下午 AM-PM and LTR-mark cleaning ───────────────────────────
{
  const ampm = parseWhatsAppExport('[13/5/2024, 下午2:05:00] Annie Fan: afternoon msg\n[13/5/2024, 上午1:05:00] Annie Fan: morning msg')
  check('下午 2:05 → 14:05', ampm[0].date.getHours() === 14, `got ${ampm[0].date.getHours()}`)
  check('上午 1:05 → 01:05', ampm[1].date.getHours() === 1, `got ${ampm[1].date.getHours()}`)
}
{
  const msgs = parseWhatsAppExport('\u200E[13/5/2024, 10:00:00] Annie Fan: \u200EHi with marks\u200E')
  check('leading LTR mark before [ tolerated', msgs.length === 1, `got ${msgs.length}`)
  check('LTR marks stripped from body', msgs[0].body === 'Hi with marks', JSON.stringify(msgs[0].body))
}

// ── name / identity primitives ────────────────────────────────────────────
{
  check('guessContactName strips "WhatsApp Chat - "', guessContactName('WhatsApp Chat - Annie Fan.zip') === 'Annie Fan')
  check('guessContactName handles "with" variant', guessContactName('WhatsApp Chat with Annie Fan.zip') === 'Annie Fan')
  check('guessContactName strips bidi control around a phone number',
    guessContactName('WhatsApp Chat - \u202A+852 6189 0268\u202C.zip') === '+852 6189 0268',
    JSON.stringify(guessContactName('WhatsApp Chat - \u202A+852 6189 0268\u202C.zip')))
  check('looksLikePhoneNumber true for +852 number', looksLikePhoneNumber('+852 6189 0268') === true)
  check('looksLikePhoneNumber false for a name', looksLikePhoneNumber('Annie Fan') === false)
  check('threadDocId slugifies a name', threadDocId('WhatsApp Chat - Annie Fan.zip') === 'annie-fan')
}

// ── current identity gaps (assert the known bug; §5.1 will flip these) ────
{
  const orig = threadDocId('WhatsApp Chat - Annie Fan.zip')
  const renamed = threadDocId('WhatsApp Chat - Annie Fan (1).zip')
  check('GAP (flip in §5.1): a renamed zip yields a different id', orig !== renamed, `${orig} vs ${renamed}`)
  // Same-name collisions are the same structural gap: threadDocId() is
  // name-only — it has no account or contact_id dimension, so Business vs
  // Personal (same person) and two same-named contacts both produce the same
  // id and overwrite. Covered structurally by the rename check above; the fix
  // (§5.1) adds account + contact_id to the key.
}

// ── §5.3 message fingerprint ──────────────────────────────────────────────
{
  const instant = Date.parse('2024-05-12T02:30:18.000Z')
  const parsed = { date: new Date(instant), sender: 'Annie Fan', body: 'Hi Eddie', attachment_filename: null }
  const stored = { date: new Date(instant).toISOString(), from: 'Annie Fan', body_text: 'Hi Eddie', attachment_filename: null }
  check('fingerprint identical across parsed vs stored shape', messageFingerprint(parsed) === messageFingerprint(stored),
    `${messageFingerprint(parsed)} vs ${messageFingerprint(stored)}`)
  check('fingerprint collapses whitespace', messageFingerprint({ date: parsed.date, sender: '  Annie   Fan ', body: 'Hi   Eddie', attachment_filename: null }) === messageFingerprint(parsed))
  check('different body → different fingerprint', messageFingerprint({ ...parsed, body: 'Bye' }) !== messageFingerprint(parsed))
  check('case difference → different fingerprint (conservative, not silently merged)', messageFingerprint({ ...parsed, body: 'hi eddie' }) !== messageFingerprint(parsed))
  check('attachment filename is part of the fingerprint', messageFingerprint({ ...parsed, attachment_filename: 'IMG-1.jpg' }) !== messageFingerprint(parsed))
}

// ── §5.1 account normalisation ────────────────────────────────────────────
{
  check('normalizeAccount: WhatsApp Business → business', normalizeAccount('WhatsApp Business') === 'business')
  check('normalizeAccount: Personal WhatsApp → personal', normalizeAccount('Personal WhatsApp') === 'personal')
  check('normalizeAccount: tolerates already-normalised input', normalizeAccount('business') === 'business' && normalizeAccount('personal') === 'personal')
  check('normalizeAccount: unrecognised → unknown', normalizeAccount('Signal') === 'unknown')
}

// ── §5.1 conversation id (account + contact folded into the id) ───────────
{
  const biz = conversationThreadId({ account: 'WhatsApp Business', contactId: 'c_abc123' })
  const personal = conversationThreadId({ account: 'Personal WhatsApp', contactId: 'c_abc123' })
  const other = conversationThreadId({ account: 'WhatsApp Business', contactId: 'c_def456' })
  check('id folds account + contact_id (no name, so a rename can\'t change it)', biz === 'business__c_abc123', biz)
  check('contact_id normalised to lowercase', conversationThreadId({ account: 'WhatsApp Business', contactId: 'C_ABC123' }) === 'business__c_abc123')
  check('same person, Business vs Personal → different id (never merged)', biz !== personal, `${biz} vs ${personal}`)
  check('two different contacts → different id (never mixed)', biz !== other, `${biz} vs ${other}`)
  let threw = false
  try { conversationThreadId({ account: 'WhatsApp Business', contactId: '' }) } catch { threw = true }
  check('throws without a contact_id (unattributed must not import)', threw)
}

// ── §5.1/§5.4 buildThreadDoc attribution + legacy detection ───────────────
{
  const msgs = parseWhatsAppExport(fx('annie-fan.txt'))
  const attributed = buildThreadDoc({ zipFileName: 'WhatsApp Chat - Annie Fan.zip', channel: 'WhatsApp Business', messages: msgs, account: 'WhatsApp Business', contactId: 'c_abc123', matchedBy: 'name' })
  check('buildThreadDoc records account + contact_id + matched_by',
    attributed.account === 'business' && attributed.contact_id === 'c_abc123' && attributed.matched_by === 'name')
  check('attributed thread is not legacy', isLegacyThread(attributed) === false)
  const legacy = buildThreadDoc({ zipFileName: 'WhatsApp Chat - Annie Fan.zip', channel: 'WhatsApp Business', messages: msgs })
  check('pre-§5.1 call (no account/contact) leaves them null', legacy.account === null && legacy.contact_id === null && legacy.matched_by === null)
  check('thread without account/contact_id is flagged legacy', isLegacyThread(legacy) === true)
}

// ── §5.1 migration decision (pure) + tombstone flag ──────────────────────
{
  const legacy = { subject: 'Annie Fan', channel: 'WhatsApp Business', message_count: 3 }
  const attributed = { subject: 'Annie Fan', account: 'business', contact_id: 'c_abc123' }
  check('planMigration: ok for a legacy thread with a free target', planMigration({ legacyExists: true, sourceData: legacy, targetExists: false }).ok === true)
  check('planMigration: missing source rejected', planMigration({ legacyExists: false, sourceData: null, targetExists: false }).reason === 'missing')
  check('planMigration: already-attributed source rejected', planMigration({ legacyExists: true, sourceData: attributed, targetExists: false }).reason === 'already-attributed')
  check('planMigration: tombstoned source rejected', planMigration({ legacyExists: true, sourceData: { ...legacy, migrated_to: 'business__c_1' }, targetExists: false }).reason === 'already-migrated')
  check('planMigration: existing target rejected (no clobber)', planMigration({ legacyExists: true, sourceData: legacy, targetExists: true }).reason === 'target-exists')
  check('isMigratedThread flags a tombstone, not a normal thread', isMigratedThread({ migrated_to: 'business__c_1' }) === true && isMigratedThread(legacy) === false)
}

// ── §5.2/§5.3 dry-run overlap analysis ────────────────────────────────────
{
  const T = n => Date.parse('2024-05-12T02:00:00.000Z') + n * 60000 // minute steps
  const mkMsg = (ts, body) => ({ date: new Date(ts), sender: 'Annie Fan', body, attachment_filename: null })
  const storedMsg = (ts, body) => ({ date: new Date(ts).toISOString(), from: 'Annie Fan', body_text: body, attachment_filename: null })

  check('invalid when nothing parsed', analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [], threads: [] }).verdict === 'invalid')

  const fresh = analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [mkMsg(T(0), 'hi')], threads: [] })
  check('no target -> new', fresh.verdict === 'new' && fresh.newAfter === 1, JSON.stringify(fresh))

  const target = { id: 'business__c_1', account: 'business', contact_id: 'c_1', messages: [storedMsg(T(0), 'hi')] }
  const exactRun = analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [mkMsg(T(0), 'hi')], threads: [target] })
  check('exact re-import -> safe-update', exactRun.verdict === 'safe-update' && exactRun.exact === 1 && exactRun.newAfter === 0)

  const upd = analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [mkMsg(T(0), 'hi'), mkMsg(T(1), 'newer')], threads: [target] })
  check('exact + new-after-high-water -> safe-update', upd.verdict === 'safe-update' && upd.exact === 1 && upd.newAfter === 1)

  const edit = analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [mkMsg(T(0), 'edited body')], threads: [target] })
  check('same-time different body -> overlap-review', edit.verdict === 'overlap-review' && edit.conflicts === 1, JSON.stringify(edit))

  const other = { id: 'personal__c_1', account: 'personal', contact_id: 'c_1', messages: [storedMsg(T(0), 'hi')] }
  const cross = analyzeImportOverlap({ account: 'business', contactId: 'c_1', messages: [mkMsg(T(0), 'hi')], threads: [other] })
  check('message already in another account -> overlap-review', cross.verdict === 'overlap-review' && cross.crossAccount === 1 && cross.targetExists === false, JSON.stringify(cross))
}

// ── step 4: carryForwardMedia (additive merge, no data loss) ─────────────
{
  const stored = [
    { from: 'Annie', body_text: 'hi', attachment_filename: 'AUD-1.opus', attachment_url: 'https://old.url', transcript: 'transcribed', needs_transcription: false },
    { from: 'Annie', body_text: 'bye', attachment_filename: 'IMG-1.jpg', attachment_url: 'https://img.url', transcript: null, needs_transcription: false },
  ]
  const fresh = [
    { sender: 'Annie', body: 'hi', attachment_filename: 'AUD-1.opus', attachment_url: null, transcript: null, needs_transcription: true },
    { sender: 'Annie', body: 'bye', attachment_filename: 'IMG-1.jpg', attachment_url: null, transcript: null, needs_transcription: false },
    { sender: 'Annie', body: 'new', attachment_filename: 'AUD-2.opus', attachment_url: null, transcript: null, needs_transcription: true },
  ]
  const merged = carryForwardMedia(fresh, stored)
  check('transcript carried forward by filename', merged[0].transcript === 'transcribed' && merged[0].needs_transcription === false)
  check('attachment URL carried forward', merged[0].attachment_url === 'https://old.url' && merged[1].attachment_url === 'https://img.url')
  check('new message (no stored counterpart) untouched', merged[2].transcript === null && merged[2].needs_transcription === true && merged[2].attachment_url === null)
  check('a fresh URL wins over a carried one', carryForwardMedia([{ attachment_filename: 'AUD-1.opus', attachment_url: 'https://new.url', transcript: null }], stored)[0].attachment_url === 'https://new.url')
  check('never mutates the input arrays', merged.length === fresh.length && fresh[0].transcript === null)
}

// ── step 4: mergeThreadMessages (two archives → one) ─────────────────────
{
  const T = n => Date.parse('2024-05-12T02:00:00.000Z') + n * 60000
  const m = (ts, body) => ({ date: new Date(ts).toISOString(), from: 'Annie', body_text: body, attachment_filename: null })
  const a = [m(T(0), 'hi'), m(T(1), 'there')]
  const b = [m(T(1), 'there'), m(T(2), 'again')]
  const merged = mergeThreadMessages(a, b)
  check('merge unions + dedupes (3 unique)', merged.length === 3, JSON.stringify(merged.map(x => x.body_text)))
  check('merge sorts chronologically', merged[0].body_text === 'hi' && merged[1].body_text === 'there' && merged[2].body_text === 'again')
  check('merge never mutates inputs', a.length === 2 && b.length === 2)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
