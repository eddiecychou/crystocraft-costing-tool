// Manual review runner. Each scenario gets its own Web SDK client process.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { runNodeTest } from './test-process.mjs'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const source = await readFile('qa/shipping-concurrency-review-cases.mjs', 'utf8')
const names = [...source.matchAll(/^test\(\s*['"]([^'"]+)['"]/gm)].map((match) => match[1])
assert.equal(names.length, 10, 'Run every documented review scenario')
const out = 'qa/out/shipping-concurrency-review'
await mkdir(out, { recursive: true })
const results = []
for (const [index, name] of names.entries()) {
  const label = 'case-' + (index + 1)
  const pattern = '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
  runNodeTest(['--test', '--test-name-pattern=' + pattern, 'qa/shipping-concurrency-review-cases.mjs'], {
    label: name,
    timeoutMs: 30000,
    env: { ...process.env, QA_SHIPPING_REVIEW_CASE: label }
  })
  const evidence = JSON.parse(await readFile(out + '/' + label + '.json', 'utf8'))
  assert.equal(evidence.length, 1, 'The selected scenario must execute and produce evidence')
  results.push(evidence[0])
}
await writeFile(out + '/results.json', JSON.stringify(results, null, 2) + '\n')
console.log('All ten review scenarios completed in isolated SDK processes.')
