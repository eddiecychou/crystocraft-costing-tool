// Additive, field-only repair. Dry run by default; never reconciles/deletes
// unrelated live composites against the repository's empty composite list.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const fieldName = 'projects/crystocraft-costing/databases/(default)/collectionGroups/enquiries/fields/date'
const api = 'https://firestore.googleapis.com/v1/'
const required = ['COLLECTION', 'COLLECTION_GROUP'].flatMap(queryScope =>
  ['ASCENDING', 'DESCENDING'].map(order => ({ queryScope, fields: [{ fieldPath: 'date', order }] })))
const key = index => JSON.stringify([index.queryScope, index.fields])

export function planRepair(field) {
  if (field?.name !== fieldName || !Array.isArray(field.indexConfig?.indexes) || field.indexConfig.usesAncestorConfig || field.indexConfig.reverting) {
    throw Error('Expected the explicit enquiries.date override in the production default database.')
  }
  const indexes = field.indexConfig.indexes.map(({ name, state, ...spec }) => spec)
  const additions = required.filter(spec => !indexes.some(existing => key(existing) === key(spec)))
  return { additions, body: { name: fieldName, indexConfig: { indexes: [...indexes, ...additions] } } }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply')) throw Error('Usage: node scripts/repair-enquiries-date-index.mjs [--apply]')
  const apply = args.includes('--apply')
  if (apply) execFileSync(process.execPath, ['scripts/check-release-ci.mjs'], { stdio: 'inherit' })
  const { cert } = await import('firebase-admin/app')
  const credential = cert(JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'firebase-service-account.json', 'utf8')))
  async function request(path, options = {}) {
    const token = await credential.getAccessToken()
    const response = await fetch(api + path, {
      ...options, headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
    })
    const data = await response.json()
    if (!response.ok) throw Error(data.error?.message || 'Firestore Admin request failed: ' + response.status)
    return data
  }
  const before = await request(fieldName)
  const plan = planRepair(before)
  const evidence = { mode: apply ? 'apply' : 'dry-run', at: new Date().toISOString(), before, ...plan }
  const output = 'qa/out/lead-history-release/index-repair-' + evidence.mode + '.json'
  await mkdir('qa/out/lead-history-release', { recursive: true })
  // Save the exact baseline and plan BEFORE attempting the single patch.
  await writeFile(output, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ mode: evidence.mode, field: fieldName, additions: plan.additions, output }))
  if (!apply || !plan.additions.length) return
  evidence.operation = await request(fieldName + '?updateMask=indexConfig', { method: 'PATCH', body: JSON.stringify(plan.body) })
  await writeFile(output, JSON.stringify(evidence, null, 2))
  const deadline = Date.now() + 10 * 60 * 1000
  while (!evidence.operation.done && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    evidence.operation = await request(evidence.operation.name)
    await writeFile(output, JSON.stringify(evidence, null, 2))
  }
  if (evidence.operation.error) throw Error(evidence.operation.error.message)
  if (!evidence.operation.done) throw Error('Index operation still pending; inspect saved operation before retrying.')
  evidence.after = await request(fieldName)
  await writeFile(output, JSON.stringify(evidence, null, 2))
  if (planRepair(evidence.after).additions.length || required.some(spec =>
    !evidence.after.indexConfig.indexes.some(index => key(index) === key(spec) && index.state === 'READY'))) {
    throw Error('Required index not READY; inspect saved evidence before retrying.')
  }
  console.log('PASS: collection and collection-group date indexes are READY.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
