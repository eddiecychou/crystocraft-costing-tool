#!/usr/bin/env node
/**
 * Fill the `colour` attribute on the app's crystal stock items.
 *
 * crystals.js has defined attrField 'colour' since the class was created and
 * nothing has ever filled it — all 180 items are blank. This writes the codes
 * the cross-reference resolved confidently, and only those.
 *
 * Deliberately NOT written:
 *   - the 10 "suffix match — CHECK" proposals (Light Rose -> PI etc.)
 *   - the 33 with no app colour code, because the library has no entry
 *   - the 60 items that are not figurine stones (raw Swarovski article
 *     numbers — beads, pearls, steel components — a different scheme)
 *
 *   dry run:  node migration/apply_crystal_colours.cjs
 *   apply:    node migration/apply_crystal_colours.cjs --apply
 *
 * Backs up every affected document's current colour before writing.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUTDIR = path.join(__dirname, 'out')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const APPLY = process.argv.includes('--apply')

if (!fs.existsSync(KEY)) { console.error(`No key at ${KEY}`); process.exit(1) }

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const hdr = rows.shift().map(h => h.replace(/^﻿/, ''))
  return rows.filter(r => r.length === hdr.length)
             .map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i]])))
}

const assigns = parseCsv(fs.readFileSync(
  path.join(OUTDIR, 'crystal_colour_assignments.csv'), 'utf8'))

const FAMILIES = new Set(['C01', 'BDC', 'C07'])
const targets = assigns.filter(r =>
  FAMILIES.has(String(r.code).split('-')[0]) &&
  r.proposed_colour &&
  !r.source.includes('CHECK') &&
  String(r.current_colour || '').trim() !== r.proposed_colour)

const held = {
  check: assigns.filter(r => r.source.includes('CHECK')).length,
  noCode: assigns.filter(r => FAMILIES.has(String(r.code).split('-')[0]) && !r.proposed_colour).length,
  otherScheme: assigns.filter(r => !FAMILIES.has(String(r.code).split('-')[0])).length,
}

;(async () => {
  console.log(`${targets.length} crystals to update (colour attribute)\n`)
  const byColour = {}
  for (const t of targets) byColour[t.proposed_colour] = (byColour[t.proposed_colour] || 0) + 1
  console.log('  ' + Object.entries(byColour).sort()
    .map(([c, n]) => `${c}:${n}`).join('  '))
  console.log(`\nheld back: ${held.check} needing an eye-check, ${held.noCode} with no library entry, ` +
              `${held.otherScheme} not figurine stones`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.')
    process.exit(0)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(OUTDIR, `crystal_colour_backup_${stamp}.json`)
  fs.writeFileSync(backup, JSON.stringify(
    targets.map(t => ({ id: t.id, code: t.code, colour: t.current_colour })), null, 2))
  console.log(`\nbackup -> ${path.relative(ROOT, backup)}`)

  let done = 0
  for (const t of targets) {
    await db.collection('crystals').doc(t.id).set(
      { colour: t.proposed_colour, updatedAt: FieldValue.serverTimestamp() },
      { merge: true })
    done++
  }
  console.log(`written: ${done} documents`)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
