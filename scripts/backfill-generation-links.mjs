// One-off backfill: linkedProduct on pd_generations didn't exist until
// 2026-09-21 (TemplateDetail.tsx), so every "+ New Corp Gift"/"+ Add to
// Existing" click before that shipped a real image onto a real product but
// left no record of it — Eddie: "I made 3 changes before in the product
// design, but it is not linked."
//
// Both write paths name the uploaded file deterministically —
// `generation-${id}.jpg` (products/*/images) or
// `...-generation-${id}.jpg` (range_products gallery URLs) — so the
// generation id can be recovered from the file name/URL itself without
// needing any other record. This scans both catalogues for that pattern
// and sets linkedProduct on any matching pd_generations doc that doesn't
// already have one. Safe to re-run — skips a generation that's already
// linked, and does nothing to any product/image data.
//
// Run from the repo root: node scripts/backfill-generation-links.mjs
//   (add --apply to actually write; without it, prints what it would do)
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import fs from 'fs'

const APPLY = process.argv.includes('--apply')

const sa = JSON.parse(fs.readFileSync(new URL('../firebase-service-account.json', import.meta.url)))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

const GEN_ID_RE = /generation-([A-Za-z0-9_-]{10,})\.(?:jpg|jpeg|png)/i

async function main() {
  const genSnap = await db.collection('pd_generations').get()
  const generations = new Map(genSnap.docs.map(d => [d.id, d.data()]))
  console.log(`${generations.size} pd_generations total`)

  const found = [] // { genId, type, productId, productName }

  // Corp gifts: products/{id}/images subcollection, file_name carries the id.
  const productsSnap = await db.collection('products').get()
  for (const productDoc of productsSnap.docs) {
    const imagesSnap = await productDoc.ref.collection('images').get()
    for (const imgDoc of imagesSnap.docs) {
      const img = imgDoc.data()
      const m = (img.file_name || img.storage_path || '').match(GEN_ID_RE)
      if (m && generations.has(m[1])) {
        found.push({ genId: m[1], type: 'corp_gift', productId: productDoc.id, productName: productDoc.data().name || productDoc.id })
      }
    }
  }

  // Figurines: range_products.gallery[] is a plain array, id is in the URL.
  const rangeSnap = await db.collection('range_products').get()
  for (const rangeDoc of rangeSnap.docs) {
    const gallery = rangeDoc.data().gallery
    if (!Array.isArray(gallery)) continue
    for (const g of gallery) {
      const m = (g?.url || '').match(GEN_ID_RE)
      if (m && generations.has(m[1])) {
        const d = rangeDoc.data()
        const name = d.design_name || d.description || d.design_code || rangeDoc.id
        found.push({ genId: m[1], type: 'range', productId: rangeDoc.id, productName: name })
      }
    }
  }

  console.log(`${found.length} generation→product matches found by filename`)

  let toWrite = 0
  for (const f of found) {
    const gen = generations.get(f.genId)
    if (gen.linkedProduct) {
      console.log(`  skip ${f.genId} — already linked to ${gen.linkedProduct.name}`)
      continue
    }
    toWrite++
    console.log(`  ${APPLY ? 'linking' : 'would link'} ${f.genId} -> ${f.type} "${f.productName}" (${f.productId})`)
    if (APPLY) {
      await db.collection('pd_generations').doc(f.genId).update({
        linkedProduct: { type: f.type, id: f.productId, name: f.productName },
      })
    }
  }

  console.log(`${toWrite} generation(s) ${APPLY ? 'linked' : 'would be linked'}${APPLY ? '' : ' — re-run with --apply to write'}`)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
