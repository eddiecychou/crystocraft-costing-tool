#!/usr/bin/env node
// Upload the missing WhatsApp attachments for threads imported text-first.
//
// Reads the same manifest as import-whatsapp-archives.mjs, re-opens each zip
// (the archives stay in the folder), and for every message that has an
// attachment_filename but no attachment_url, uploads that file to Storage and
// backfills attachment_url. Idempotent — re-running skips already-uploaded
// files. Token-URL format matches the browser's own uploads.
//
//   node scripts/upload-whatsapp-media.mjs            # upload all missing
//   node scripts/upload-whatsapp-media.mjs --dry-run  # report scope, no upload
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname, basename, relative, sep } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))

// ── load the REAL pure functions (Firebase imports stripped) ──────────────
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
const src = readFileSync(join(here, '..', 'src', 'domain', 'whatsappImport.js'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'wa-media-'))
const modPath = join(dir, 'whatsappImport.mjs')
writeFileSync(modPath, src.replace(/^import .*\n/gm, ''))
const { normalizeAccount, conversationThreadId, conversationGroupId } = await import(modPath)
rmSync(dir, { recursive: true, force: true })

const idFromPhone = phone => 'wa-' + String(phone || '').replace(/[^\d]/g, '')
const sanitize = name => String(name || '').replace(/[#[\]*?]/g, '_')

// ── admin init ─────────────────────────────────────────────────────────────
const SA = JSON.parse(readFileSync(process.env.SA_KEY_PATH || join(here, '..', 'firebase-service-account.json'), 'utf8'))
initializeApp({ credential: cert(SA), projectId: SA.project_id })
const db = getFirestore()
const bucket = getStorage().bucket('crystocraft-costing.firebasestorage.app')

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || join(homedir(), 'Whatsapp Archives')
const MANIFEST_PATH = process.env.MANIFEST || join(here, 'whatsapp-import-manifest.json')
const DRY_RUN = process.argv.includes('--dry-run')
const CONCURRENCY = 20

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
  return out
}

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

function archiveAccount(zipPath) {
  const firstFolder = relative(ARCHIVE_DIR, zipPath).split(sep)[0]
  return normalizeAccount(firstFolder)
}

function archiveKey(zipPath) {
  return `${archiveAccount(zipPath)}:${basename(zipPath)}`
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const zips = findZips(ARCHIVE_DIR)
  const mappedByKey = new Map()
  const mappedByFile = new Map((manifest.archives || []).map(entry => [entry.file, entry]))
  const saved = await db.collection('whatsapp_archive_mappings').get()
  saved.forEach(s => {
    const entry = s.data()
    if (!entry.approved || !entry.file) return
    if (entry.archive_key) mappedByKey.set(entry.archive_key, entry)
    else mappedByFile.set(entry.file, entry)
  })
  const entries = zips.map(zipPath => ({
    zipPath,
    entry: mappedByKey.get(archiveKey(zipPath)) || mappedByFile.get(basename(zipPath)),
  })).filter(x => x.entry)

  let total = 0, uploaded = 0, already = 0

  for (const { entry, zipPath } of entries) {

    const { collectionName, parentId, contactId, groupName } = resolveTarget(entry)
    const account = normalizeAccount(entry.channel || archiveAccount(zipPath))
    const isGroup = entry.type === 'group'
    const importId = isGroup ? conversationGroupId({ account, groupName }) : conversationThreadId({ account, contactId })
    const ref = db.collection(collectionName).doc(parentId).collection('whatsapp_threads').doc(importId)
    const snap = await ref.get()
    if (!snap.exists) { console.log(`SKIP (no thread): ${entry.file}`); continue }

    const messages = snap.data().messages || []
    // Media URLs may live in a separate `media/urls` doc when the thread is
    // too large to hold them inline (Firestore 1 MiB/doc cap) — check both.
    const mediaRef = ref.collection('media').doc('urls')
    const mediaSnap = await mediaRef.get()
    const mediaUrls = mediaSnap.exists ? mediaSnap.data() : {}
    const missing = messages.filter(m => m.attachment_filename && !m.attachment_url && !mediaUrls[m.attachment_filename])
    if (!missing.length) { console.log(`OK (complete): ${entry.file}`); continue }
    total += missing.length
    if (DRY_RUN) { console.log(`WOULD UPLOAD ${missing.length}: ${entry.file}`); continue }

    const zip = await JSZip.loadAsync(readFileSync(zipPath))
    const prefix = `${collectionName}/${parentId}/whatsapp/${importId}`
    let done = 0
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const chunk = missing.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async m => {
        const z = zip.file(m.attachment_filename)
        if (!z) return
        const bytes = await z.async('nodebuffer')
        const path = `${prefix}/${sanitize(m.attachment_filename)}`
        const token = randomUUID()
        await bucket.file(path).save(bytes, { metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
        m.attachment_url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
        done++
      }))
      process.stdout.write(`\r  ${entry.file}: ${Math.min(i + CONCURRENCY, missing.length)}/${missing.length}`)
    }

    // Store inline if the doc still fits; otherwise move the URLs to `media/urls`
    // and strip them from the messages so the thread stays under 1 MiB.
    const fullDoc = { ...snap.data(), messages }
    if (JSON.stringify(fullDoc).length < 1000000) {
      await ref.update({ messages })
    } else {
      const newUrls = {}
      for (const m of messages) {
        if (m.attachment_url) { newUrls[m.attachment_filename] = m.attachment_url; m.attachment_url = null }
      }
      await ref.update({ messages })
      await mediaRef.set({ ...mediaUrls, ...newUrls })
    }
    uploaded += done
    console.log(`\rUPLOADED ${done}: ${entry.file}`)
  }

  console.log(`\n${uploaded} uploaded, ${total} total${DRY_RUN ? '  [DRY-RUN — no upload]' : ''}`)
}

await main()
