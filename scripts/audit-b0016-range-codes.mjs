// Read-only, privileged legacy-code audit for the B0016 review.
// No catalogue or audit-record writes. Requires an existing admin credential;
// never use the B0016 service identity for this cross-catalogue scan.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { ITEM_CODES, usedSkus } from '../netlify/edge-functions/lib/mcpFigurineRange.js'

const EXPECTED_PROJECT = 'crystocraft-costing'
const CODES = new Set(ITEM_CODES)
const codeArg = flag => {
  const match = process.argv.find(arg => arg.startsWith(`${flag}=`))
  return match ? match.slice(flag.length + 1).trim().toUpperCase() : null
}
const metalCode = codeArg('--metal-code')
const fabricCode = codeArg('--fabric-code')
if ((metalCode && !fabricCode) || (!metalCode && fabricCode)) throw new Error('Supply both --metal-code and --fabric-code, or neither')
if (metalCode && (!/^[A-Z0-9][A-Z0-9-]{1,79}$/.test(metalCode) || !/^[A-Z0-9][A-Z0-9-]{1,79}$/.test(fabricCode) || metalCode === fabricCode)) throw new Error('Two distinct reviewed uppercase component codes are required')

export function auditSnapshot(designs, claims, components, proposed = []) {
  const skuOwners = new Map(ITEM_CODES.map(code => [code, []]))
  for (const design of designs) {
    for (const code of usedSkus(design)) if (CODES.has(code)) skuOwners.get(code).push(design.id)
  }
  const sku_conflicts = [...skuOwners].flatMap(([item_code, range_ids]) => range_ids.map(range_id => ({ item_code, range_id })))
  const claim_issues = claims.filter(claim => {
    const owners = skuOwners.get(claim.id) || []
    return claim.item_code !== claim.id || owners.length !== 1 || owners[0] !== claim.range_id
  }).map(claim => ({ item_code: claim.id, range_id: claim.range_id || null, code: 'ORPHANED_OR_MISMATCHED_SKU_CLAIM' }))
  const component_conflicts = components.filter(row => proposed.includes(String(row.code || '').toUpperCase())).map(row => ({ code: row.code, component_id: row.id }))
  return {
    scanned: { range_products: designs.length, range_components: components.length, exact_sku_claims: claims.length },
    sku_conflicts, claim_issues, component_conflicts,
    component_codes_checked: proposed,
    clear_for_review: sku_conflicts.length === 0 && claim_issues.length === 0 && proposed.length === 2 && component_conflicts.length === 0,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const keyPath = process.env.SA_KEY_PATH
  if (!keyPath) throw new Error('Set SA_KEY_PATH to an existing, owner-controlled service-account JSON file')
  const credential = JSON.parse(readFileSync(keyPath, 'utf8'))
  if (credential.project_id !== EXPECTED_PROJECT) throw new Error(`Credential project does not match ${EXPECTED_PROJECT}`)
  const app = initializeApp({ credential: cert(credential), projectId: EXPECTED_PROJECT }, 'b0016-read-only-audit')
  try {
    const db = getFirestore(app)
    const [designSnap, componentSnap, claimSnaps] = await Promise.all([
      db.collection('range_products').get(),
      db.collection('range_components').get(),
      db.getAll(...ITEM_CODES.map(code => db.doc(`range_sku_claims/${code}`))),
    ])
    const rows = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    const claims = claimSnaps.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }))
    const result = auditSnapshot(rows(designSnap), claims, rows(componentSnap), metalCode ? [metalCode, fabricCode] : [])
    console.log(JSON.stringify({ project_id: EXPECTED_PROJECT, read_only: true, ...result }, null, 2))
    if (!result.clear_for_review) process.exitCode = 2
  } finally {
    await deleteApp(app)
  }
}
