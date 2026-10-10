#!/usr/bin/env node
// Server-side WhatsApp archive importer.
//
// Reuses the REAL parser/identity logic from src/domain/whatsappImport.js (its
// Firebase imports are stripped so only the pure functions load), then writes
// via firebase-admin. Matching is NOT automatic — it reads a manifest the owner
// confirms once (filename -> customer/lead + contact + account). Text-first:
// imports the messages and skips media upload (attachment_url stays null for a
// later media pass).
//
// Usage:
//   node scripts/import-whatsapp-archives.mjs --dry-run   # parse+match+report, no writes
//   node scripts/import-whatsapp-archives.mjs             # import (text-first)
//
// Env (optional):
//   ARCHIVE_DIR   — where the WhatsApp .zip files live (default ~/Whatsapp Archives)
//   MANIFEST      — path to the manifest JSON (default scripts/whatsapp-import-manifest.json)
//   SA_KEY_PATH   — firebase service-account JSON (default ./firebase-service-account.json)
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname, basename, relative, sep } from 'path'
import { tmpdir } from 'os'
import { homedir } from 'os'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))

// ── load the REAL pure functions (Firebase imports stripped) ──────────────
const src = readFileSync(join(here, '..', 'src', 'domain', 'whatsappImport.js'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'wa-import-'))
const modPath = join(dir, 'whatsappImport.mjs')
writeFileSync(modPath, src.replace(/^import .*\n/gm, ''))
const {
  parseWhatsAppExport, buildThreadDoc, normalizeAccount, conversationThreadId,
  conversationGroupId, carryForwardMedia, analyzeImportOverlap, guessContactName,
  isMigratedThread,
} = await import(modPath)
rmSync(dir, { recursive: true, force: true })

const idFromPhone = phone => 'wa-' + String(phone || '').replace(/[^\d]/g, '')

// ── admin init ─────────────────────────────────────────────────────────────
const SA_PATH = process.env.SA_KEY_PATH || join(here, '..', 'firebase-service-account.json')
const SA = JSON.parse(readFileSync(SA_PATH, 'utf8'))
initializeApp({ credential: cert(SA), projectId: SA.project_id })
const db = getFirestore()

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || join(homedir(), 'Whatsapp Archives')
const MANIFEST_PATH = process.env.MANIFEST || join(here, 'whatsapp-import-manifest.json')
const DRY_RUN = process.argv.includes('--dry-run')
const STATE_PATH = join(here, '.whatsapp-sync-state.json')

// Recursively collect .zip files.
function findZips(root) {
  const out = []
  if (!existsSync(root)) return out
  const walk = p => {
    for (const name of readdirSync(p)) {
      const full = join(p, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.toLowerCase().endsWith('.zip')) out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

// Resolve a manifest entry -> { collectionName, parentId, contactId }.
function resolveTarget(entry) {
  if (entry.type === 'lead') {
    const leadId = entry.leadId || idFromPhone(entry.phone)
    return { collectionName: 'marketing_contacts', parentId: leadId, contactId: leadId }
  }
  if (entry.type === 'group') {
    return { collectionName: 'customers', parentId: entry.customerId, contactId: null, groupName: entry.groupName }
  }
  return { collectionName: 'customers', parentId: entry.customerId, contactId: entry.contactId }
}

// The two archive folders are the source accounts.  This is not a name-based
// guess: it is part of the local folder contract and keeps a Business export
// separate from a Personal export with the same filename.
function archiveAccount(zipPath) {
  const firstFolder = relative(ARCHIVE_DIR, zipPath).split(sep)[0]
  return normalizeAccount(firstFolder)
}

function archiveKey(zipPath) {
  return `${archiveAccount(zipPath)}:${basename(zipPath)}`
}

// Parse one zip -> messages (or throw with a clear reason).
async function parseZip(path) {
  const buf = readFileSync(path)
  const zip = await JSZip.loadAsync(buf)
  const chat = zip.file('_chat.txt') || zip.file(/_chat\.txt$/i)[0]
  if (!chat) throw new Error('no _chat.txt in archive')
  const text = await chat.async('text')
  const messages = parseWhatsAppExport(text)
  if (!messages.length) throw new Error('parsed 0 messages')
  return messages
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  // OC-managed decisions supplement the legacy manifest. An archive is never
  // guessed: only a human-approved mapping can move it out of the inbox.
  const saved = await db.collection('whatsapp_archive_mappings').get()
  const byName = new Map((manifest.archives || []).map(a => [a.file, a]))
  const byArchiveKey = new Map()
  saved.forEach(s => {
    const v = s.data()
    if (v.file && v.approved === true) {
      if (v.archive_key) byArchiveKey.set(v.archive_key, v)
      // Backward-compatible only for an explicit legacy mapping. New inbox
      // mappings always carry archive_key, so same-named account exports do
      // not collide.
      else byName.set(v.file, v)
    }
  })
  const zips = findZips(ARCHIVE_DIR)
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {}

  console.log(`archive dir: ${ARCHIVE_DIR}`)
  console.log(`found ${zips.length} .zip file${zips.length === 1 ? '' : 's'}\n`)

  let imported = 0, updated = 0, skipped = 0, failed = 0

  for (const zipPath of zips) {
    const name = basename(zipPath)
    const st = statSync(zipPath)
    const sig = `${Math.round(st.mtimeMs)}:${st.size}`
    const accountFromFolder = archiveAccount(zipPath)
    const key = archiveKey(zipPath)
    if (!DRY_RUN && (state[key] === sig || state[name] === sig)) { console.log(`SKIP (unchanged): ${name}`); skipped++; continue }
    const entry = byArchiveKey.get(key) || byName.get(name)
    if (!entry) {
      console.log(`SKIP (no manifest entry): ${name}`)
      if (!DRY_RUN) {
        const messages = await parseZip(zipPath).catch(() => [])
        const id = Buffer.from(key).toString('base64url')
        await db.collection('whatsapp_archive_inbox').doc(id).set({
          file: name, archive_key: key, account: accountFromFolder,
          suggested_name: guessContactName(name), message_count: messages.length,
          first_message_at: messages[0]?.date?.toISOString?.() || null,
          last_message_at: messages.at(-1)?.date?.toISOString?.() || null,
          status: 'pending', discovered_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      skipped++
      continue
    }

    const { collectionName, parentId, contactId, groupName } = resolveTarget(entry)
    const account = normalizeAccount(entry.channel || accountFromFolder)
    const isGroup = entry.type === 'group'
    const importId = isGroup ? conversationGroupId({ account, groupName }) : conversationThreadId({ account, contactId })
    const ref = db.collection(collectionName).doc(parentId).collection('whatsapp_threads').doc(importId)

    try {
      const messages = await parseZip(zipPath)
      const existingSnap = await ref.get()
      const existing = existingSnap.exists ? existingSnap.data() : null
      const threadDoc = buildThreadDoc({
        zipFileName: name, channel: entry.channel, messages, account,
        contactId: isGroup ? null : contactId,
        matchedBy: 'script',
        threadType: isGroup ? 'group' : 'direct',
        groupName: isGroup ? groupName : undefined,
      })

      // Dry-run: report match + verdict, no write.
      if (DRY_RUN) {
        const threads = existing ? [existing] : []
        const analysis = analyzeImportOverlap({ account, contactId: isGroup ? null : contactId, messages, threads })
        console.log(`${name}`)
        console.log(`   -> ${collectionName}/${parentId}  id=${importId}`)
        console.log(`   account=${account}  ${isGroup ? `group="${groupName}"` : `contact_id=${contactId}`}  ${messages.length} msgs  verdict=${analysis.verdict}${analysis.verdict === 'safe-update' ? ` (${analysis.exact} dup, ${analysis.newAfter} new)` : ''}`)
        continue
      }

      // Carry forward transcripts/URLs from an existing thread, then write.
      const finalDoc = {
        ...threadDoc,
        messages: existing?.messages ? carryForwardMedia(threadDoc.messages, existing.messages) : threadDoc.messages,
        imported_at: FieldValue.serverTimestamp(),
      }
      if (existing?.migrated_from) finalDoc.migrated_from = existing.migrated_from
      if (existing?.migrated_at) finalDoc.migrated_at = existing.migrated_at
      await ref.set(finalDoc)
      state[key] = sig
      if (entry.archive_key) {
        await db.collection('whatsapp_archive_inbox').doc(Buffer.from(entry.archive_key).toString('base64url')).set({
          status: 'imported', imported_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        }, { merge: true })
      }

      console.log(`${existing ? 'UPDATE' : 'IMPORT'} ${name} -> ${importId} (${messages.length} msgs, media skipped)`)
      if (existing) updated++; else imported++
    } catch (e) {
      console.log(`FAIL ${name}: ${e.message}`)
      failed++
    }
  }

  if (!DRY_RUN) writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))

  console.log(`\n${imported} imported, ${updated} updated, ${skipped} skipped, ${failed} failed${DRY_RUN ? '  [DRY-RUN — no writes]' : ''}`)
}

await main()
