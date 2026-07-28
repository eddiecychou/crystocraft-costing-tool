#!/usr/bin/env node
/**
 * Import cleaned Mailchimp contacts into the `marketing_contacts` collection.
 *
 * This is a SEPARATE store from `customers`, deliberately — the owner wants the
 * marketing list kept apart from the app's real customer records so it can be
 * organised on its own terms first (some people exist in both; they are NOT
 * merged). The one link back is `possible_customer_match`, computed here by
 * email against the live customers collection — a pointer, not a merge.
 *
 * Source: two Mailchimp audience exports (trade + retail), deduped to one row
 * per person, most-restrictive status wins, tags/countries normalised. The
 * cleaning ran offline; this reads the resulting import.json (gitignored — it
 * holds personal data) and upserts by email so re-running is idempotent.
 *
 *   dry run:  node migration/import_marketing_contacts.cjs
 *   apply:    node migration/import_marketing_contacts.cjs --apply
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const SRC = path.join(__dirname, 'marketing_contacts', 'import.json')
const APPLY = process.argv.includes('--apply')

if (!fs.existsSync(KEY)) { console.error(`No key at ${KEY}`); process.exit(1) }
if (!fs.existsSync(SRC)) { console.error(`No import file at ${SRC}`); process.exit(1) }

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

// Firestore doc id from an email: emails carry no '/', so they are id-safe;
// using the email as the id makes the upsert idempotent and makes a future
// WordPress signup (keyed on the same email) land on the same doc.
const idFor = (email) => email.trim().toLowerCase().replace(/\s+/g, '')

async function main() {
  const records = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  console.log(`Loaded ${records.length} cleaned contacts from import.json`)

  // Build an email -> {id, company_name} map from the live customers, so we can
  // flag which marketing contacts are already a real customer (without merging).
  const custSnap = await db.collection('customers').get()
  const byEmail = new Map()
  custSnap.forEach(d => {
    const c = d.data()
    const emails = [
      ...(Array.isArray(c.contact_emails) ? c.contact_emails : []),
      c.contact_email,
    ].filter(Boolean)
    for (const e of emails) {
      const k = String(e).trim().toLowerCase()
      if (k && !byEmail.has(k)) byEmail.set(k, { customer_id: d.id, company_name: c.company_name || c.name || '' })
    }
  })
  console.log(`Indexed ${custSnap.size} customers (${byEmail.size} distinct emails) for matching.`)

  let matched = 0
  const docs = records.map(r => {
    const match = byEmail.get(r.email) || null
    if (match) matched++
    return {
      id: idFor(r.email),
      data: {
        email: r.email,
        first_name: r.first || '',
        last_name: r.last || '',
        company: r.company || '',
        country: r.country || '',
        domain: r.domain || '',
        phone: r.phone || '',
        website: r.website || '',
        address: r.address || '',
        mailchimp_notes: r.notes || '',
        mailchimp_category: r.category || '',
        tags: r.tags || [],
        audiences: r.audiences || [],       // 'trade' | 'retail'
        status: r.status,                    // subscribed | nonsubscribed | unsubscribed | cleaned
        emailable: !!r.emailable,            // only true when subscribed
        is_customer: !!r.is_customer,        // strong signals only (Alibaba = lead, not customer)
        relationship: r.relationship || '',
        channels: r.channels || [],
        freemail: !!r.freemail,
        role_address: !!r.role_address,
        member_rating: r.member_rating || '',
        optin_time: r.optin_time || '',
        last_changed: r.last_changed || '',
        possible_customer_match: match,      // { customer_id, company_name } | null
        source_import: 'mailchimp_2026_07_28',
        // App-side organising fields — the owner's own workspace, kept distinct
        // from the imported Mailchimp data so edits never overwrite the source.
        review_status: '',                   // '', 'keep', 'drop', 'follow_up'
        app_notes: '',
      },
    }
  })

  // Status breakdown for the log.
  const byStatus = docs.reduce((a, d) => (a[d.data.status] = (a[d.data.status] || 0) + 1, a), {})
  console.log('Status:', JSON.stringify(byStatus))
  console.log(`Emailable: ${docs.filter(d => d.data.emailable).length}`)
  console.log(`Flagged is_customer: ${docs.filter(d => d.data.is_customer).length}`)
  console.log(`Matched to an existing customer by email: ${matched}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.')
    console.log('Sample doc:', JSON.stringify(docs[0], null, 2))
    return
  }

  // Batched upsert (merge:false — this doc is fully owned by the import; the
  // review_status/app_notes reset is intentional on a re-import, so guard
  // against clobbering by only writing them if the doc is new).
  const CHUNK = 400
  let written = 0
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK)
    // Preserve any app-side edits already made: read existing app fields first.
    const existing = await Promise.all(slice.map(d => db.collection('marketing_contacts').doc(d.id).get()))
    const batch = db.batch()
    slice.forEach((d, j) => {
      const prev = existing[j].exists ? existing[j].data() : null
      const data = { ...d.data, updatedAt: FieldValue.serverTimestamp() }
      if (prev) {
        // keep the owner's organising edits across a re-import
        data.review_status = prev.review_status || ''
        data.app_notes = prev.app_notes || ''
        if (Array.isArray(prev.tags) && prev.app_tags) data.app_tags = prev.app_tags
      } else {
        data.createdAt = FieldValue.serverTimestamp()
      }
      batch.set(db.collection('marketing_contacts').doc(d.id), data, { merge: true })
    })
    await batch.commit()
    written += slice.length
    process.stdout.write(`\r  written ${written}/${docs.length}`)
  }
  console.log(`\nDone. Upserted ${written} marketing contacts.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
