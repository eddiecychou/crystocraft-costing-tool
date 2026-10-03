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
  buildThreadDoc, messageFingerprint,
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
