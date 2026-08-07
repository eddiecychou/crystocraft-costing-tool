// One-off migration: the "Portal invite" campaign template used to be a
// hardcoded JS object in src/pages/Campaigns.jsx — not a real record, so the
// owner couldn't edit or delete it from the app. Templates now live in the
// campaign_templates Firestore collection (see src/domain/campaigns.js);
// this script writes the same content there once, as a normal
// (fully editable) template. Safe to re-run — it skips if a template named
// "Portal invite" already exists, rather than creating a duplicate.
//
// Run from the repo root: node scripts/seed-portal-invite-template.mjs
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'fs'

const sa = JSON.parse(fs.readFileSync(new URL('../firebase-service-account.json', import.meta.url)))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

const design = {
  body: {
    rows: [
      {
        cells: [1],
        columns: [{
          contents: [{
            type: 'text',
            values: {
              containerPadding: '10px',
              text: `<p>Hi {{first_name:there}},</p>
<p>We'd like to invite you to the Crystocraft Portal, where you can browse our catalogue, request quotes, and track your orders directly.</p>
<p><a href="https://portal.crystocraft.com" target="_blank">Create your account →</a></p>
<p>Best regards,<br>Crystocraft</p>`,
            },
          }],
          values: {},
        }],
        values: {},
      },
    ],
    values: {},
  },
}

async function main() {
  const existing = await db.collection('campaign_templates').where('name', '==', 'Portal invite').get()
  if (!existing.empty) {
    console.log('Already seeded — "Portal invite" template exists:', existing.docs[0].id)
    return
  }
  const ref = await db.collection('campaign_templates').add({
    name: 'Portal invite',
    subject: "You're invited to the Crystocraft Portal",
    design,
    created_at: FieldValue.serverTimestamp(),
  })
  console.log('Seeded "Portal invite" template:', ref.id)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
