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
import { join, dirname, basename } from 'path'
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
  carryForwardMedia, analyzeImportOverlap, guessContactName, isMigratedThread,
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
    return { collectionName: 'marketing_contacts', parentId: idFromPhone(entry.phone), contactId: idFromPhone(entry.phone) }
  }
  return { collectionName: 'customers', parentId: entry.customerId, contactId: entry.contactId }
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
  const byName = new Map((manifest.archives || []).map(a => [a.file, a]))
  const zips = findZips(ARCHIVE_DIR)

  console.log(`archive dir: ${ARCHIVE_DIR}`)
  console.log(`found ${zips.length} .zip file${zips.length === 1 ? '' : 's'}\n`)

  let imported = 0, updated = 0, skipped = 0, failed = 0

  for (const zipPath of zips) {
    const name = basename(zipPath)
    const entry = byName.get(name)
    if (!entry) {
      console.log(`SKIP (no manifest entry): ${name}`)
      skipped++
      continue
    }

    const { collectionName, parentId, contactId } = resolveTarget(entry)
    const account = normalizeAccount(entry.channel)
    const importId = conversationThreadId({ account, contactId })
    const ref = db.collection(collectionName).doc(parentId).collection('whatsapp_threads').doc(importId)

    try {
      const messages = await parseZip(zipPath)
      const existingSnap = await ref.get()
      const existing = existingSnap.exists ? existingSnap.data() : null
      const threadDoc = buildThreadDoc({ zipFileName: name, channel: entry.channel, messages, account, contactId, matchedBy: 'script' })

      // Dry-run: report match + verdict, no write.
      if (DRY_RUN) {
        const threads = existing ? [existing] : []
        const analysis = analyzeImportOverlap({ account, contactId, messages, threads })
        console.log(`${name}`)
        console.log(`   -> ${collectionName}/${parentId}  id=${importId}`)
        console.log(`   account=${account}  contact_id=${contactId}  ${messages.length} msgs  verdict=${analysis.verdict}${analysis.verdict === 'safe-update' ? ` (${analysis.exact} dup, ${analysis.newAfter} new)` : ''}`)
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

      console.log(`${existing ? 'UPDATE' : 'IMPORT'} ${name} -> ${importId} (${messages.length} msgs, media skipped)`)
      if (existing) updated++; else imported++
    } catch (e) {
      console.log(`FAIL ${name}: ${e.message}`)
      failed++
    }
  }

  console.log(`\n${imported} imported, ${updated} updated, ${skipped} skipped, ${failed} failed${DRY_RUN ? '  [DRY-RUN — no writes]' : ''}`)
}

await main()
